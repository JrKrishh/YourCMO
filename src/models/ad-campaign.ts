import { AdPlatform, AdStatus } from './enums';
import { AdPerformance, AdTargeting, BidStrategy, Budget } from './common';
import { PlatformContent } from './platform-content';

/**
 * Model 8: AdCampaign
 * Ad campaign with platform (GOOGLE_ADS/INSTAGRAM_ADS), content, targeting,
 * budget, bid strategy, performance.
 */
export interface AdCampaign {
  adCampaignId: string;
  platform: AdPlatform;
  content: PlatformContent;
  targeting: AdTargeting;
  budget: Budget;
  bidStrategy: BidStrategy;
  startDate: Date;
  endDate: Date;
  status: AdStatus;
  performance: AdPerformance;
}
