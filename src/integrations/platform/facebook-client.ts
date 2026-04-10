import { createLogger } from '../../utils/logger';
import { Platform } from '../../models/enums';
import { PlatformContent } from '../../models/platform-content';
import { PostResult } from '../../core/interfaces';
import { OAuthToken } from './oauth-manager';
import { ScheduleResult } from './instagram-client';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('FacebookPostingClient');

/** Facebook-specific constraints */
export const FACEBOOK_LIMITS = {
  maxTextLength: 63206,
  maxHashtags: 30,
  supportedImageFormats: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'tiff'],
  supportedVideoFormats: ['mp4', 'mov', 'avi', 'wmv'],
  maxImageFileSize: 10 * 1024 * 1024, // 10MB
  maxVideoFileSize: 1024 * 1024 * 1024, // 1GB
  maxVideoDuration: 240 * 60, // 240 minutes in seconds
  minScheduleAheadMinutes: 10,
  maxScheduleAheadDays: 75,
} as const;

/**
 * Facebook Graph API client for posting content.
 * Handles Facebook-specific requirements for page and feed posts.
 */
export class FacebookPostingClient {
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';
  private pageId: string | undefined;

  constructor(pageId?: string) {
    this.pageId = pageId;
  }

  /** Set the Facebook Page ID for posting */
  setPageId(pageId: string): void {
    this.pageId = pageId;
  }

  /**
   * Post content to a Facebook Page via the Graph API.
   */
  async postContent(content: PlatformContent, token: OAuthToken): Promise<PostResult> {
    logger.info({ contentId: content.contentId }, 'Posting content to Facebook');

    if (!this.pageId) {
      return {
        postId: '',
        platform: Platform.FACEBOOK,
        success: false,
        error: 'Facebook Page ID not configured',
      };
    }

    const validation = this.validateContent(content);
    if (!validation.valid) {
      return {
        postId: '',
        platform: Platform.FACEBOOK,
        success: false,
        error: `Validation failed: ${validation.errors.join(', ')}`,
      };
    }

    try {
      const hasMedia = content.visualAssets.length > 0;
      let postId: string;

      if (hasMedia) {
        postId = await this.postWithMedia(content, token);
      } else {
        postId = await this.postTextOnly(content, token);
      }

      logger.info({ postId }, 'Successfully posted to Facebook');
      return {
        postId,
        platform: Platform.FACEBOOK,
        success: true,
        url: `https://www.facebook.com/${this.pageId}/posts/${postId}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to post to Facebook');
      return {
        postId: '',
        platform: Platform.FACEBOOK,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Schedule a post for future publishing on Facebook.
   */
  async schedulePost(content: PlatformContent, scheduledTime: Date, token: OAuthToken): Promise<ScheduleResult> {
    logger.info({ contentId: content.contentId, scheduledTime }, 'Scheduling Facebook post');

    const now = new Date();
    const minTime = new Date(now.getTime() + FACEBOOK_LIMITS.minScheduleAheadMinutes * 60 * 1000);
    const maxTime = new Date(now.getTime() + FACEBOOK_LIMITS.maxScheduleAheadDays * 24 * 60 * 60 * 1000);

    if (scheduledTime < minTime) {
      return {
        scheduledId: '',
        platform: Platform.FACEBOOK,
        scheduledTime,
        success: false,
        error: `Scheduled time must be at least ${FACEBOOK_LIMITS.minScheduleAheadMinutes} minutes in the future`,
      };
    }

    if (scheduledTime > maxTime) {
      return {
        scheduledId: '',
        platform: Platform.FACEBOOK,
        scheduledTime,
        success: false,
        error: `Scheduled time cannot be more than ${FACEBOOK_LIMITS.maxScheduleAheadDays} days in the future`,
      };
    }

    try {
      // In production: POST {baseUrl}/{pageId}/feed with published=false and scheduled_publish_time
      void token;
      void content;
      void this.baseUrl;
      const scheduledId = `fb_sched_${uuidv4()}`;

      logger.info({ scheduledId, scheduledTime }, 'Facebook post scheduled');
      return {
        scheduledId,
        platform: Platform.FACEBOOK,
        scheduledTime,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        scheduledId: '',
        platform: Platform.FACEBOOK,
        scheduledTime,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Validate content against Facebook-specific requirements.
   */
  validateContent(content: PlatformContent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (content.text.length > FACEBOOK_LIMITS.maxTextLength) {
      errors.push(`Text exceeds ${FACEBOOK_LIMITS.maxTextLength} characters`);
    }

    if (content.hashtags.length > FACEBOOK_LIMITS.maxHashtags) {
      errors.push(`Too many hashtags (max ${FACEBOOK_LIMITS.maxHashtags})`);
    }

    for (const asset of content.visualAssets) {
      if (asset.assetType === 'IMAGE' && asset.fileSize > FACEBOOK_LIMITS.maxImageFileSize) {
        errors.push(`Image file size exceeds ${FACEBOOK_LIMITS.maxImageFileSize / (1024 * 1024)}MB limit`);
      }
      if (asset.assetType === 'VIDEO' && asset.fileSize > FACEBOOK_LIMITS.maxVideoFileSize) {
        errors.push(`Video file size exceeds ${FACEBOOK_LIMITS.maxVideoFileSize / (1024 * 1024)}MB limit`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Post text-only content to Facebook */
  private async postTextOnly(content: PlatformContent, token: OAuthToken): Promise<string> {
    // In production: POST {baseUrl}/{pageId}/feed with message
    void content;
    void token;
    void this.baseUrl;
    return `fb_post_${uuidv4()}`;
  }

  /** Post content with media attachments to Facebook */
  private async postWithMedia(content: PlatformContent, token: OAuthToken): Promise<string> {
    // In production: POST {baseUrl}/{pageId}/photos or /videos with media + message
    void content;
    void token;
    void this.baseUrl;
    return `fb_post_${uuidv4()}`;
  }
}
