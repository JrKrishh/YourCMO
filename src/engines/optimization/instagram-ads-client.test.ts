import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InstagramAdsClient,
  InstagramAdsApi,
  resolveInstagramBidStrategy,
  buildInstagramAdTargeting,
  CreativeUploadResult,
} from './instagram-ads-client';
import { BoostRecommendation } from '../../core/interfaces';
import { Platform, AdPlatform, AdStatus } from '../../models/enums';
import { AdPerformance, BidStrategy } from '../../models/common';

function createMockApi(): InstagramAdsApi {
  return {
    createCampaign: vi.fn().mockResolvedValue({ campaignId: 'ig-ads-123' }),
    getCampaignPerformance: vi.fn().mockResolvedValue({
      impressions: 2000,
      clicks: 80,
      conversions: 8,
      spend: 30,
      cpc: 0.375,
      cpm: 15,
      ctr: 0.04,
      roi: 2.5,
    } satisfies AdPerformance),
    updateBid: vi.fn().mockResolvedValue(undefined),
    pauseCampaign: vi.fn().mockResolvedValue(undefined),
    resumeCampaign: vi.fn().mockResolvedValue(undefined),
    uploadCreative: vi.fn().mockResolvedValue({
      creativeId: 'creative-1',
      url: 'https://cdn.example.com/creative-1.jpg',
      status: 'ready',
    } satisfies CreativeUploadResult),
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

describe('resolveInstagramBidStrategy', () => {
  it('returns CPM for engagement optimization (Instagram default)', () => {
    const rec = createRecommendation();
    const strategy = resolveInstagramBidStrategy(rec);
    expect(strategy.type).toBe('CPM');
    expect(strategy.maxBid).toBeCloseTo(3); // 100 * 0.03
  });

  it('returns CPA for conversions optimization', () => {
    const rec = createRecommendation({
      targeting: { optimizeFor: 'conversions' },
    });
    const strategy = resolveInstagramBidStrategy(rec);
    expect(strategy.type).toBe('CPA');
    expect(strategy.targetCost).toBeCloseTo(10); // 100 * 0.1
  });

  it('returns ROAS for revenue optimization', () => {
    const rec = createRecommendation({
      targeting: { optimizeFor: 'revenue' },
      expectedRoi: 3.0,
    });
    const strategy = resolveInstagramBidStrategy(rec);
    expect(strategy.type).toBe('ROAS');
    expect(strategy.targetCost).toBe(3.0);
  });

  it('returns CPM for impressions optimization', () => {
    const rec = createRecommendation({
      targeting: { optimizeFor: 'impressions' },
    });
    const strategy = resolveInstagramBidStrategy(rec);
    expect(strategy.type).toBe('CPM');
    expect(strategy.maxBid).toBeCloseTo(5); // 100 * 0.05
  });

  it('defaults to CPM when optimizeFor is missing', () => {
    const rec = createRecommendation({ targeting: {} });
    const strategy = resolveInstagramBidStrategy(rec);
    expect(strategy.type).toBe('CPM');
  });
});

describe('buildInstagramAdTargeting', () => {
  it('extracts arrays from targeting map', () => {
    const rec = createRecommendation({
      targeting: {
        interests: ['fashion', 'beauty'],
        locations: ['US', 'UK'],
        keywords: ['summer'],
        customAudiences: ['lookalike-1'],
      },
    });
    const targeting = buildInstagramAdTargeting(rec);
    expect(targeting.interests).toEqual(['fashion', 'beauty']);
    expect(targeting.locations).toEqual(['US', 'UK']);
    expect(targeting.keywords).toEqual(['summer']);
    expect(targeting.customAudiences).toEqual(['lookalike-1']);
  });

  it('extracts ageRange when provided as a two-element array', () => {
    const rec = createRecommendation({
      targeting: { ageRange: [18, 35] },
    });
    const targeting = buildInstagramAdTargeting(rec);
    expect(targeting.ageRange).toEqual([18, 35]);
  });

  it('returns undefined for non-array fields', () => {
    const rec = createRecommendation({ targeting: { optimizeFor: 'engagement' } });
    const targeting = buildInstagramAdTargeting(rec);
    expect(targeting.interests).toBeUndefined();
    expect(targeting.locations).toBeUndefined();
    expect(targeting.ageRange).toBeUndefined();
  });

  it('ignores ageRange if not exactly two elements', () => {
    const rec = createRecommendation({
      targeting: { ageRange: [18] },
    });
    const targeting = buildInstagramAdTargeting(rec);
    expect(targeting.ageRange).toBeUndefined();
  });
});

describe('InstagramAdsClient', () => {
  let api: InstagramAdsApi;
  let client: InstagramAdsClient;

  beforeEach(() => {
    api = createMockApi();
    client = new InstagramAdsClient(api);
  });

  describe('uploadCreative', () => {
    it('uploads an image creative and stores it locally', async () => {
      const result = await client.uploadCreative({
        imageUrl: 'https://example.com/image.jpg',
        caption: 'Check out our new product!',
        callToAction: 'Shop Now',
      });

      expect(result.creativeId).toBe('creative-1');
      expect(result.status).toBe('ready');
      expect(api.uploadCreative).toHaveBeenCalledWith({
        imageUrl: 'https://example.com/image.jpg',
        caption: 'Check out our new product!',
        callToAction: 'Shop Now',
      });
      expect(client.getCreative('creative-1')).toBe(result);
    });

    it('uploads a video creative', async () => {
      const result = await client.uploadCreative({
        videoUrl: 'https://example.com/video.mp4',
        caption: 'Watch our latest reel!',
      });

      expect(result.creativeId).toBe('creative-1');
      expect(api.uploadCreative).toHaveBeenCalledWith({
        videoUrl: 'https://example.com/video.mp4',
        caption: 'Watch our latest reel!',
      });
    });

    it('throws when neither imageUrl nor videoUrl is provided', async () => {
      await expect(
        client.uploadCreative({ caption: 'No media' }),
      ).rejects.toThrow('At least one of imageUrl or videoUrl must be provided');
    });

    it('throws when caption is empty', async () => {
      await expect(
        client.uploadCreative({ imageUrl: 'https://example.com/img.jpg', caption: '' }),
      ).rejects.toThrow('Caption must be non-empty');
    });
  });

  describe('createAdCampaign', () => {
    it('creates a campaign and returns an AdCampaign with ACTIVE status', async () => {
      const rec = createRecommendation();
      const campaign = await client.createAdCampaign(rec);

      expect(campaign.adCampaignId).toBe('ig-ads-123');
      expect(campaign.platform).toBe(AdPlatform.INSTAGRAM_ADS);
      expect(campaign.status).toBe(AdStatus.ACTIVE);
      expect(campaign.bidStrategy.type).toBe('CPM');
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

      expect(perf.impressions).toBe(2000);
      expect(perf.clicks).toBe(80);
      expect(perf.spend).toBe(30);
      expect(api.getCampaignPerformance).toHaveBeenCalledWith('ig-ads-123');

      const updated = client.getCampaign(campaign.adCampaignId)!;
      expect(updated.budget.spent).toBe(30);
      expect(updated.budget.remaining).toBe(70);
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

      expect(api.updateBid).toHaveBeenCalledWith('ig-ads-123', newBid);
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

      expect(api.pauseCampaign).toHaveBeenCalledWith('ig-ads-123');
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

      expect(api.resumeCampaign).toHaveBeenCalledWith('ig-ads-123');
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
