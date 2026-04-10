import { createLogger } from '../../utils/logger';
import { AdCampaign } from '../../models/ad-campaign';
import { AdPlatform, AdStatus, Platform } from '../../models/enums';
import { AdPerformance, AdTargeting, BidStrategy, Budget } from '../../models/common';
import { PlatformContent } from '../../models/platform-content';
import { BoostRecommendation } from '../../core/interfaces';

const logger = createLogger('GoogleAdsClient');

/**
 * Abstraction layer for the Google Ads API.
 * Implementations can be swapped for testing or different API versions.
 */
export interface GoogleAdsApi {
  createCampaign(params: {
    content: PlatformContent;
    targeting: AdTargeting;
    budget: Budget;
    bidStrategy: BidStrategy;
    startDate: Date;
    endDate: Date;
  }): Promise<{ campaignId: string }>;

  getCampaignPerformance(campaignId: string): Promise<AdPerformance>;

  updateBid(campaignId: string, bidStrategy: BidStrategy): Promise<void>;

  pauseCampaign(campaignId: string): Promise<void>;

  resumeCampaign(campaignId: string): Promise<void>;
}

/** Default campaign duration in days when not specified */
const DEFAULT_CAMPAIGN_DURATION_DAYS = 30;

/**
 * Resolves a BidStrategy from a BoostRecommendation's targeting hints.
 * Falls back to CPC with the recommended budget as max bid.
 */
export function resolveBidStrategy(recommendation: BoostRecommendation): BidStrategy {
  const targeting = recommendation.targeting as Record<string, unknown>;
  const optimizeFor = (targeting.optimizeFor as string) ?? 'engagement';

  switch (optimizeFor) {
    case 'conversions':
      return { type: 'CPA', targetCost: recommendation.recommendedBudget * 0.1 };
    case 'revenue':
      return { type: 'ROAS', targetCost: recommendation.expectedRoi };
    case 'impressions':
      return { type: 'CPM', maxBid: recommendation.recommendedBudget * 0.05 };
    case 'engagement':
    default:
      return { type: 'CPC', maxBid: recommendation.recommendedBudget * 0.02 };
  }
}

/**
 * Builds AdTargeting from a BoostRecommendation's targeting map.
 */
export function buildAdTargeting(recommendation: BoostRecommendation): AdTargeting {
  const raw = recommendation.targeting as Record<string, unknown>;
  return {
    interests: Array.isArray(raw.interests) ? (raw.interests as string[]) : undefined,
    locations: Array.isArray(raw.locations) ? (raw.locations as string[]) : undefined,
    keywords: Array.isArray(raw.keywords) ? (raw.keywords as string[]) : undefined,
    customAudiences: Array.isArray(raw.customAudiences)
      ? (raw.customAudiences as string[])
      : undefined,
  };
}

/**
 * GoogleAdsClient creates and manages Google Ads campaigns.
 *
 * It uses a GoogleAdsApi abstraction so the actual API calls can be
 * mocked in tests or swapped for different implementations.
 */
export class GoogleAdsClient {
  private readonly api: GoogleAdsApi;
  private readonly campaigns: Map<string, AdCampaign> = new Map();

  constructor(api: GoogleAdsApi) {
    this.api = api;
  }

  /**
   * Creates a Google Ads campaign from a BoostRecommendation.
   *
   * Preconditions:
   * - recommendation.recommendedBudget > 0
   * - recommendation.postId is non-empty
   *
   * Postconditions:
   * - Returns an AdCampaign with status ACTIVE and platform GOOGLE_ADS
   * - Campaign is registered with the underlying API
   */
  async createAdCampaign(recommendation: BoostRecommendation): Promise<AdCampaign> {
    logger.info({ postId: recommendation.postId }, 'Creating Google Ads campaign');

    if (recommendation.recommendedBudget <= 0) {
      throw new Error('Recommended budget must be positive');
    }

    const bidStrategy = resolveBidStrategy(recommendation);
    const targeting = buildAdTargeting(recommendation);

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + DEFAULT_CAMPAIGN_DURATION_DAYS);

    const budget: Budget = {
      dailyLimit: Math.round((recommendation.recommendedBudget / DEFAULT_CAMPAIGN_DURATION_DAYS) * 100) / 100,
      totalLimit: recommendation.recommendedBudget,
      remaining: recommendation.recommendedBudget,
      spent: 0,
      currency: 'USD',
    };

    const content: PlatformContent = {
      contentId: recommendation.postId,
      platform: recommendation.platform ?? Platform.INSTAGRAM,
      text: '',
      visualAssets: [],
      hashtags: [],
      mentions: [],
      postId: recommendation.postId,
    };

    const result = await this.api.createCampaign({
      content,
      targeting,
      budget,
      bidStrategy,
      startDate,
      endDate,
    });

    const adCampaign: AdCampaign = {
      adCampaignId: result.campaignId,
      platform: AdPlatform.GOOGLE_ADS,
      content,
      targeting,
      budget,
      bidStrategy,
      startDate,
      endDate,
      status: AdStatus.ACTIVE,
      performance: {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        spend: 0,
        cpc: 0,
        cpm: 0,
        ctr: 0,
        roi: 0,
      },
    };

    this.campaigns.set(adCampaign.adCampaignId, adCampaign);

    logger.info(
      { adCampaignId: adCampaign.adCampaignId, bidStrategy: bidStrategy.type },
      'Google Ads campaign created',
    );

    return adCampaign;
  }

  /**
   * Fetches current performance metrics for a campaign.
   */
  async getAdCampaignPerformance(adCampaignId: string): Promise<AdPerformance> {
    logger.info({ adCampaignId }, 'Fetching campaign performance');

    const campaign = this.campaigns.get(adCampaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${adCampaignId}`);
    }

    const performance = await this.api.getCampaignPerformance(adCampaignId);
    campaign.performance = performance;
    campaign.budget.spent = performance.spend;
    campaign.budget.remaining = campaign.budget.totalLimit - performance.spend;

    return performance;
  }

  /**
   * Adjusts the bid strategy for an active campaign.
   */
  async adjustBid(adCampaignId: string, bidStrategy: BidStrategy): Promise<void> {
    logger.info({ adCampaignId, bidStrategy: bidStrategy.type }, 'Adjusting bid strategy');

    const campaign = this.campaigns.get(adCampaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${adCampaignId}`);
    }
    if (campaign.status !== AdStatus.ACTIVE) {
      throw new Error(`Cannot adjust bid on campaign with status: ${campaign.status}`);
    }

    await this.api.updateBid(adCampaignId, bidStrategy);
    campaign.bidStrategy = bidStrategy;
  }

  /**
   * Pauses an active campaign.
   */
  async pauseAdCampaign(adCampaignId: string): Promise<void> {
    logger.info({ adCampaignId }, 'Pausing campaign');

    const campaign = this.campaigns.get(adCampaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${adCampaignId}`);
    }
    if (campaign.status !== AdStatus.ACTIVE) {
      throw new Error(`Cannot pause campaign with status: ${campaign.status}`);
    }

    await this.api.pauseCampaign(adCampaignId);
    campaign.status = AdStatus.PAUSED;
  }

  /**
   * Resumes a paused campaign.
   */
  async resumeAdCampaign(adCampaignId: string): Promise<void> {
    logger.info({ adCampaignId }, 'Resuming campaign');

    const campaign = this.campaigns.get(adCampaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${adCampaignId}`);
    }
    if (campaign.status !== AdStatus.PAUSED) {
      throw new Error(`Cannot resume campaign with status: ${campaign.status}`);
    }

    await this.api.resumeCampaign(adCampaignId);
    campaign.status = AdStatus.ACTIVE;
  }

  /** Returns a locally cached campaign by ID, or undefined. */
  getCampaign(adCampaignId: string): AdCampaign | undefined {
    return this.campaigns.get(adCampaignId);
  }
}
