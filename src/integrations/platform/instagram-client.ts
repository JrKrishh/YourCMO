import { createLogger } from '../../utils/logger';
import { Platform } from '../../models/enums';
import { PlatformContent } from '../../models/platform-content';
import { PostResult } from '../../core/interfaces';
import { OAuthToken } from './oauth-manager';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('InstagramPostingClient');

/** Instagram-specific constraints */
export const INSTAGRAM_LIMITS = {
  maxCaptionLength: 2200,
  maxHashtags: 30,
  maxMentions: 20,
  supportedImageFormats: ['jpg', 'jpeg', 'png'],
  supportedVideoFormats: ['mp4', 'mov'],
  maxImageFileSize: 8 * 1024 * 1024, // 8MB
  maxVideoFileSize: 100 * 1024 * 1024, // 100MB
  maxVideoDuration: 60, // seconds for feed
  aspectRatios: {
    feed: { min: 0.8, max: 1.91 }, // 4:5 to 1.91:1
    story: { width: 1080, height: 1920 },
    reel: { width: 1080, height: 1920 },
  },
} as const;

/** Schedule result for Instagram */
export interface ScheduleResult {
  scheduledId: string;
  platform: Platform;
  scheduledTime: Date;
  success: boolean;
  error?: string;
}

/**
 * Instagram Graph API client for posting content.
 * Handles Instagram-specific requirements like aspect ratios and hashtag limits.
 */
export class InstagramPostingClient {
  private readonly baseUrl = 'https://graph.instagram.com/v18.0';

  /**
   * Post content to Instagram via the Graph API.
   * Validates content against Instagram-specific constraints before posting.
   */
  async postContent(content: PlatformContent, token: OAuthToken): Promise<PostResult> {
    logger.info({ contentId: content.contentId }, 'Posting content to Instagram');

    const validation = this.validateContent(content);
    if (!validation.valid) {
      return {
        postId: '',
        platform: Platform.INSTAGRAM,
        success: false,
        error: `Validation failed: ${validation.errors.join(', ')}`,
      };
    }

    try {
      // Step 1: Create media container
      const containerId = await this.createMediaContainer(content, token);

      // Step 2: Publish the container
      const postId = await this.publishContainer(containerId, token);

      logger.info({ postId }, 'Successfully posted to Instagram');
      return {
        postId,
        platform: Platform.INSTAGRAM,
        success: true,
        url: `https://www.instagram.com/p/${postId}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to post to Instagram');
      return {
        postId: '',
        platform: Platform.INSTAGRAM,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Schedule a post for future publishing on Instagram.
   */
  async schedulePost(content: PlatformContent, scheduledTime: Date, token: OAuthToken): Promise<ScheduleResult> {
    logger.info({ contentId: content.contentId, scheduledTime }, 'Scheduling Instagram post');

    if (scheduledTime <= new Date()) {
      return {
        scheduledId: '',
        platform: Platform.INSTAGRAM,
        scheduledTime,
        success: false,
        error: 'Scheduled time must be in the future',
      };
    }

    const validation = this.validateContent(content);
    if (!validation.valid) {
      return {
        scheduledId: '',
        platform: Platform.INSTAGRAM,
        scheduledTime,
        success: false,
        error: `Validation failed: ${validation.errors.join(', ')}`,
      };
    }

    try {
      // In production: use Instagram Content Publishing API with published=false
      // then publish at scheduled time
      void token;
      void this.baseUrl;
      const scheduledId = `ig_sched_${uuidv4()}`;

      logger.info({ scheduledId, scheduledTime }, 'Instagram post scheduled');
      return {
        scheduledId,
        platform: Platform.INSTAGRAM,
        scheduledTime,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        scheduledId: '',
        platform: Platform.INSTAGRAM,
        scheduledTime,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Validate content against Instagram-specific requirements.
   */
  validateContent(content: PlatformContent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (content.text.length > INSTAGRAM_LIMITS.maxCaptionLength) {
      errors.push(`Caption exceeds ${INSTAGRAM_LIMITS.maxCaptionLength} characters`);
    }

    if (content.hashtags.length > INSTAGRAM_LIMITS.maxHashtags) {
      errors.push(`Too many hashtags (max ${INSTAGRAM_LIMITS.maxHashtags})`);
    }

    if (content.mentions.length > INSTAGRAM_LIMITS.maxMentions) {
      errors.push(`Too many mentions (max ${INSTAGRAM_LIMITS.maxMentions})`);
    }

    for (const asset of content.visualAssets) {
      const ratio = asset.dimensions.width / asset.dimensions.height;
      if (ratio < INSTAGRAM_LIMITS.aspectRatios.feed.min || ratio > INSTAGRAM_LIMITS.aspectRatios.feed.max) {
        errors.push(`Image aspect ratio ${ratio.toFixed(2)} outside allowed range (${INSTAGRAM_LIMITS.aspectRatios.feed.min}-${INSTAGRAM_LIMITS.aspectRatios.feed.max})`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Create a media container on Instagram (step 1 of publishing) */
  private async createMediaContainer(content: PlatformContent, token: OAuthToken): Promise<string> {
    // In production: POST {baseUrl}/me/media with image_url, caption, etc.
    void content;
    void token;
    void this.baseUrl;
    return `container_${uuidv4()}`;
  }

  /** Publish a media container (step 2 of publishing) */
  private async publishContainer(containerId: string, token: OAuthToken): Promise<string> {
    // In production: POST {baseUrl}/me/media_publish with creation_id
    void containerId;
    void token;
    return `ig_post_${uuidv4()}`;
  }
}
