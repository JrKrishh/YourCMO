import { Platform } from './enums';

/**
 * Model 7: EngagementMetrics
 * Post metrics with likes, comments, shares, views, clicks, reach,
 * impressions, engagement rate.
 */
export interface EngagementMetrics {
  postId: string;
  platform: Platform;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  clicks: number;
  reach: number;
  impressions: number;
  engagementRate: number;
  timestamp: Date;
}
