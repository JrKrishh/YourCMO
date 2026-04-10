import { Platform } from './enums';
import { Location } from './common';
import { VisualAsset } from './visual-asset';
import { EngagementMetrics } from './engagement-metrics';

/**
 * Model 6: PlatformContent
 * Platform-specific content with text, visual assets, hashtags, mentions,
 * location, scheduled time, post ID, engagement metrics.
 */
export interface PlatformContent {
  contentId: string;
  platform: Platform;
  text: string;
  visualAssets: VisualAsset[];
  hashtags: string[];
  mentions: string[];
  location?: Location;
  scheduledTime?: Date;
  postId?: string;
  engagementMetrics?: EngagementMetrics;
}
