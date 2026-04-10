import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GoogleAdsClient,
  GoogleAdsApi,
  resolveBidStrategy,
  buildAdTargeting,
} from './google-ads-client';
import { BoostRecommendation } from '../../core/interfaces';
import { Platform, AdPlatform, AdStatus } from '../../models/enums';
import { AdPerformance, BidStrategy } from '../../models/common';

function createMockApi(): GoogleAdsApi {
  return {
    createCampaign: vi.fn().mockResolvedValue({ campaignId: 'gads-123' }),
    getCampaignPerformance: vi.fn().mockResolvedValue({
      impressions: 1000,
      clicks: 50,
      conversions: 5,
      spend: 25,
      cpc: 0.5,
      cpm: 25,
      ctr: 0.05,
      roi: 2.0,
    } satisfies AdPerformance),
    updateBid: vi.fn().mockResolvedValue(undefined),
    pauseCampaign: vi.fn().mockResolvedValue(undefined),
    resumeCampaign: vi.fn().mockResolvedValue(undefined),
  };
}

function createRecommendation(overrides?: Partial<BoostRecommendation>): BoostRecommendation {
  return {
    postId: 'post-1',
    platform: Platform.INSTAGRAM,
    recommendedBudget: 100,
    expectedRoi: 2.5,
    targeting: { platform: 'INSTAGRAM', postId: 'post-1', optimizeFor: 'engagement' },
    ...overrides,
  };
}

describe('resolveBidStrategy', () => {
  it('returns CPC for engagement optimization', () => {
    const rec = createRecommendation();
    const strategy = resolveBidStrategy(rec);
    expect(strategy.type).toBe('CPC');
    expect(strategy.maxBid).toBeCloseTo(2); // 100 * 0.02
  });

  it('returns CPA for conversions optimization', () => {
    const rec = createRecommendation({
      targeting: { optimizeFor: 'conversions' },
    });
    const strategy = resolveBidStrategy(rec);
    expect(strategy.type).toBe('CPA');
    expect(strategy.targetCost).toBeCloseTo(10); // 100 * 0.1
  });

  it('returns ROAS for revenue optimization', () => {
    const rec = createRecommendation({
      targeting: { optimizeFor: 'revenue' },
      expectedRoi: 3.0,
    });
    const strategy = resolveBidStrategy(rec);
    expect(strategy.type).toBe('ROAS');
    expect(strategy.targetCost).toBe(3.0);
  });

  it('returns CPM for impressions optimization', () => {
    const rec = createRecommendation({
      targeting: { optimizeFor: 'impressions' },
    });
    const strategy = resolveBidStrategy(rec);
    expect(strategy.type).toBe('CPM');
    expect(strategy.maxBid).toBeCloseTo(5); // 100 * 0.05
  });

  it('defaults to CPC when optimizeFor is missing', () => {
    const rec = createRecommendation({ targeting: {} });
    const strategy = resolveBidStrategy(rec);
    expect(strategy.type).toBe('CPC');
  });
});

describe('buildAdTargeting', () => {
  it('extracts arrays from targeting map', () => {
    const rec = createRecommendation({
      targeting: {
        interests: ['tech', 'gaming'],
        locations: ['US'],
        keywords: ['sale'],
        customAudiences: ['aud-1'],
      },
    });
    const targeting = buildAdTargeting(rec);
    expect(targeting.interests).toEqual(['tech', 'gaming']);
    expect(targeting.locations).toEqual(['US']);
    expect(targeting.keywords).toEqual(['sale']);
    expect(targeting.customAudiences).toEqual(['aud-1']);
  });

  it('returns undefined for non-array fields', () => {
    const rec = createRecommendation({ targeting: { optimizeFor: 'engagement' } });
    const targeting = buildAdTargeting(rec);
    expect(targeting.interests).toBeUndefined();
    expect(targeting.locations).toBeUndefined();
  });
});

describe('GoogleAdsClient', () => {
  let api: GoogleAdsApi;
  let client: GoogleAdsClient;

  beforeEach(() => {
    api = createMockApi();
    client = new GoogleAdsClient(api);
  });

  describe('createAdCampaign', () => {
    it('creates a campaign and returns an AdCampaign with ACTIVE status', async () => {
      const rec = createRecommendation();
      const campaign = await client.createAdCampaign(rec);

      expect(campaign.adCampaignId).toBe('gads-123');
      expect(campaign.platform).toBe(AdPlatform.GOOGLE_ADS);
      expect(campaign.status).toBe(AdStatus.ACTIVE);
      expect(campaign.bidStrategy.type).toBe('CPC');
      expect(campaign.budget.totalLimit).toBe(100);
      expect(campaign.budget.remaining).toBe(100);
      expect(campaign.budget.spent).toBe(0);
      expect(campaign.performance.impressions).toBe(0);
      expect(api.createCampaign).toHaveBeenCalledOnce();
    });

    it('throws when recommendedBudget is zero', async () => {
      const rec = createRecommendation({ recommendedBudget: 0 });
      await expect(client.createAdCampaign(rec)).rejects.toThrow('Recommended budget must be positive');
    });

    it('throws when recommendedBudget is negative', async () => {
      const rec = createRecommendation({ recommendedBudget: -10 });
      await expect(client.createAdCampaign(rec)).rejects.toThrow('Recommended budget must be positive');
    });

    it('stores the campaign locally for later retrieval', async () => {
      const rec = createRecommendation();
      const campaign = await client.createAdCampaign(rec);
      expect(client.getCampaign(campaign.adCampaignId)).toBe(campaign);
    });
  });

  describe('getAdCampaignPerformance', () => {
    it('fetches and updates campaign performance', async () => {
      const rec = createRecommendation();
      const campaign = await client.createAdCampaign(rec);

      const perf = await client.getAdCampaignPerformance(campaign.adCampaignId);

      expect(perf.impressions).toBe(1000);
      expect(perf.clicks).toBe(50);
      expect(perf.spend).toBe(25);
      expect(api.getCampaignPerformance).toHaveBeenCalledWith('gads-123');

      // Budget should be updated
      const updated = client.getCampaign(campaign.adCampaignId)!;
      expect(updated.budget.spent).toBe(25);
      expect(updated.budget.remaining).toBe(75);
    });

    it('throws for unknown campaign ID', async () => {
      await expect(client.getAdCampaignPerformance('unknown')).rejects.toThrow(
        'Campaign not found: unknown',
      );
    });
  });

  describe('adjustBid', () => {
    it('updates bid strategy on an active campaign', async () => {
      const campaign = await client.createAdCampaign(createRecommendation());
      const newBid: BidStrategy = { type: 'CPA', targetCost: 5 };

      await client.adjustBid(campaign.adCampaignId, newBid);

      expect(api.updateBid).toHaveBeenCalledWith('gads-123', newBid);
      expect(client.getCampaign(campaign.adCampaignId)!.bidStrategy).toEqual(newBid);
    });

    it('throws for unknown campaign', async () => {
      await expect(client.adjustBid('unknown', { type: 'CPC', maxBid: 1 })).rejects.toThrow(
        'Campaign not found: unknown',
      );
    });

    it('throws when campaign is not active', async () => {
      const campaign = await client.createAdCampaign(createRecommendation());
      await client.pauseAdCampaign(campaign.adCampaignId);

      await expect(
        client.adjustBid(campaign.adCampaignId, { type: 'CPC', maxBid: 1 }),
      ).rejects.toThrow('Cannot adjust bid on campaign with status: PAUSED');
    });
  });

  describe('pauseAdCampaign', () => {
    it('pauses an active campaign', async () => {
      const campaign = await client.createAdCampaign(createRecommendation());
      await client.pauseAdCampaign(campaign.adCampaignId);

      expect(api.pauseCampaign).toHaveBeenCalledWith('gads-123');
      expect(client.getCampaign(campaign.adCampaignId)!.status).toBe(AdStatus.PAUSED);
    });

    it('throws for unknown campaign', async () => {
      await expect(client.pauseAdCampaign('unknown')).rejects.toThrow('Campaign not found: unknown');
    });

    it('throws when campaign is already paused', async () => {
      const campaign = await client.createAdCampaign(createRecommendation());
      await client.pauseAdCampaign(campaign.adCampaignId);

      await expect(client.pauseAdCampaign(campaign.adCampaignId)).rejects.toThrow(
        'Cannot pause campaign with status: PAUSED',
      );
    });
  });

  describe('resumeAdCampaign', () => {
    it('resumes a paused campaign', async () => {
      const campaign = await client.createAdCampaign(createRecommendation());
      await client.pauseAdCampaign(campaign.adCampaignId);
      await client.resumeAdCampaign(campaign.adCampaignId);

      expect(api.resumeCampaign).toHaveBeenCalledWith('gads-123');
      expect(client.getCampaign(campaign.adCampaignId)!.status).toBe(AdStatus.ACTIVE);
    });

    it('throws for unknown campaign', async () => {
      await expect(client.resumeAdCampaign('unknown')).rejects.toThrow(
        'Campaign not found: unknown',
      );
    });

    it('throws when campaign is active (not paused)', async () => {
      const campaign = await client.createAdCampaign(createRecommendation());

      await expect(client.resumeAdCampaign(campaign.adCampaignId)).rejects.toThrow(
        'Cannot resume campaign with status: ACTIVE',
      );
    });
  });
});
