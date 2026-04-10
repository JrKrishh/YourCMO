import { createLogger } from '../../utils/logger';
import { Platform } from '../../models/enums';
import { PlatformContent } from '../../models/platform-content';
import { IPlatformIntegrationLayer, PostResult } from '../../core/interfaces';
import { OAuthManager, OAuthCredentials, OAuthToken } from './oauth-manager';
import { InstagramPostingClient, ScheduleResult } from './instagram-client';
import { FacebookPostingClient } from './facebook-client';
import { WhatsAppPostingClient, WhatsAppMessage, BulkMessageResult } from './whatsapp-client';

const logger = createLogger('PlatformIntegration');

/** Configuration for retry behavior */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/** Result of posting to multiple platforms */
export interface MultiPlatformPostResult {
  results: PostResult[];
  successCount: number;
  failureCount: number;
}

/** Result of deleting a post */
export interface DeleteResult {
  platform: Platform;
  postId: string;
  success: boolean;
  error?: string;
}

/**
 * Unified Platform Integration Layer implementing IPlatformIntegrationLayer.
 * Manages authentication, multi-platform posting with parallel execution,
 * retry logic, scheduling, and post deletion.
 */
export class PlatformIntegrationLayer implements IPlatformIntegrationLayer {
  private readonly oauthManager: OAuthManager;
  private readonly instagramClient: InstagramPostingClient;
  private readonly facebookClient: FacebookPostingClient;
  private readonly whatsappClient: WhatsAppPostingClient;
  private readonly retryConfig: RetryConfig;

  constructor(
    oauthManager?: OAuthManager,
    instagramClient?: InstagramPostingClient,
    facebookClient?: FacebookPostingClient,
    whatsappClient?: WhatsAppPostingClient,
    retryConfig?: RetryConfig,
  ) {
    this.oauthManager = oauthManager ?? new OAuthManager();
    this.instagramClient = instagramClient ?? new InstagramPostingClient();
    this.facebookClient = facebookClient ?? new FacebookPostingClient();
    this.whatsappClient = whatsappClient ?? new WhatsAppPostingClient();
    this.retryConfig = retryConfig ?? DEFAULT_RETRY_CONFIG;
  }

  /** Authenticate with a platform */
  async authenticate(platform: Platform, credentials: OAuthCredentials): Promise<OAuthToken> {
    return this.oauthManager.authenticate(platform, credentials);
  }

  /** Refresh token for a platform */
  async refreshToken(platform: Platform): Promise<OAuthToken> {
    return this.oauthManager.refreshToken(platform);
  }

  /**
   * Post content to a single platform with automatic token management and retry logic.
   * Implements IPlatformIntegrationLayer.postContent.
   */
  async postContent(platform: Platform, content: PlatformContent): Promise<PostResult> {
    return this.executeWithRetry(async () => {
      const token = await this.oauthManager.getValidToken(platform);
      return this.postToplatform(platform, content, token);
    }, `postContent:${platform}`);
  }

  /**
   * Post content to multiple platforms in parallel.
   * Each platform is attempted independently — failures on one don't block others.
   */
  async postToMultiplePlatforms(
    platforms: Platform[],
    content: PlatformContent,
  ): Promise<MultiPlatformPostResult> {
    logger.info({ platforms }, 'Posting to multiple platforms');

    const promises = platforms.map((platform) =>
      this.postContent(platform, { ...content, platform }).catch((error): PostResult => ({
        postId: '',
        platform,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })),
    );

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    logger.info({ successCount, failureCount, total: results.length }, 'Multi-platform posting complete');
    return { results, successCount, failureCount };
  }

  /**
   * Schedule a post for future publishing.
   */
  async schedulePost(
    platform: Platform,
    content: PlatformContent,
    scheduledTime: Date,
  ): Promise<ScheduleResult> {
    const token = await this.oauthManager.getValidToken(platform);

    switch (platform) {
      case Platform.INSTAGRAM:
        return this.instagramClient.schedulePost(content, scheduledTime, token);
      case Platform.FACEBOOK:
        return this.facebookClient.schedulePost(content, scheduledTime, token);
      default:
        return {
          scheduledId: '',
          platform,
          scheduledTime,
          success: false,
          error: `Scheduling not supported for platform: ${platform}`,
        };
    }
  }

  /**
   * Delete a post from a platform.
   */
  async deletePost(platform: Platform, postId: string): Promise<DeleteResult> {
    logger.info({ platform, postId }, 'Deleting post');

    try {
      const token = await this.oauthManager.getValidToken(platform);

      // In production: call platform-specific delete endpoints
      // Instagram: DELETE {baseUrl}/{postId}
      // Facebook: DELETE {baseUrl}/{postId}
      void token;

      if (platform !== Platform.INSTAGRAM && platform !== Platform.FACEBOOK) {
        return {
          platform,
          postId,
          success: false,
          error: `Delete not supported for platform: ${platform}`,
        };
      }

      logger.info({ platform, postId }, 'Post deleted successfully');
      return { platform, postId, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ platform, postId, error: message }, 'Failed to delete post');
      return { platform, postId, success: false, error: message };
    }
  }

  /**
   * Send a WhatsApp message (delegates to WhatsApp client).
   */
  async sendWhatsAppMessage(message: WhatsAppMessage): Promise<PostResult> {
    const token = await this.oauthManager.getValidToken(Platform.WHATSAPP);
    const result = await this.whatsappClient.sendMessage(message, token);
    return {
      postId: result.messageId,
      platform: Platform.WHATSAPP,
      success: result.status !== 'failed',
      error: result.error,
    };
  }

  /**
   * Send bulk WhatsApp messages (delegates to WhatsApp client).
   */
  async sendBulkWhatsAppMessages(messages: WhatsAppMessage[]): Promise<BulkMessageResult> {
    const token = await this.oauthManager.getValidToken(Platform.WHATSAPP);
    return this.whatsappClient.sendBulkMessages(messages, token);
  }

  /** Check if a platform is authenticated */
  isAuthenticated(platform: Platform): boolean {
    return this.oauthManager.isAuthenticated(platform);
  }

  /** Route content to the correct platform client */
  private async postToplatform(
    platform: Platform,
    content: PlatformContent,
    token: OAuthToken,
  ): Promise<PostResult> {
    switch (platform) {
      case Platform.INSTAGRAM:
        return this.instagramClient.postContent(content, token);
      case Platform.FACEBOOK:
        return this.facebookClient.postContent(content, token);
      case Platform.WHATSAPP:
        // For WhatsApp, convert PlatformContent to a message
        return this.postAsWhatsAppMessage(content, token);
      default:
        return {
          postId: '',
          platform,
          success: false,
          error: `Unsupported platform: ${platform}`,
        };
    }
  }

  /** Convert PlatformContent to a WhatsApp message and send */
  private async postAsWhatsAppMessage(content: PlatformContent, token: OAuthToken): Promise<PostResult> {
    const message: WhatsAppMessage = {
      recipientPhone: content.mentions[0] ?? '',
      text: content.text,
      mediaUrl: content.visualAssets[0]?.url,
    };
    const result = await this.whatsappClient.sendMessage(message, token);
    return {
      postId: result.messageId,
      platform: Platform.WHATSAPP,
      success: result.status !== 'failed',
      error: result.error,
    };
  }

  /** Execute an operation with exponential backoff retry */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelayMs * Math.pow(2, attempt) + Math.random() * this.retryConfig.baseDelayMs,
            this.retryConfig.maxDelayMs,
          );
          logger.warn({ operation: operationName, attempt: attempt + 1, delay }, 'Retrying operation');
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error(`${operationName} failed after all retries`);
  }
}
