import { CampaignType, CampaignStatus } from './enums';
import { Budget, CampaignMetrics, OptimizationRule, Schedule, Segment } from './common';
import { PlatformContent } from './platform-content';

/**
 * Model 5: Campaign
 * Campaign with type (WHATSAPP/MULTI_PLATFORM/AD_CAMPAIGN),
 * status (DRAFT/SCHEDULED/ACTIVE/PAUSED/COMPLETED), content,
 * audience segments, schedule, budget, metrics.
 */
export interface Campaign {
  campaignId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  content: PlatformContent[];
  targetAudience: Segment[];
  schedule: Schedule;
  budget: Budget;
  startDate: Date;
  endDate: Date;
  metrics: CampaignMetrics;
  optimizationRules: OptimizationRule[];
}
