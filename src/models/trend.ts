import { Platform } from './enums';
import { ContentReference, DemographicData, TrendLifecycle } from './common';

/**
 * Model 2: Trend
 * Trending topic data with engagement score (0-1), velocity, hashtags,
 * demographics, predicted lifecycle.
 */
export interface Trend {
  trendId: string;
  platform: Platform;
  topic: string;
  hashtags: string[];
  engagementScore: number;
  velocity: number;
  timestamp: Date;
  relatedContent: ContentReference[];
  demographics: DemographicData;
  predictedLifecycle: TrendLifecycle;
}
