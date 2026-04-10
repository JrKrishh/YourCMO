import { describe, it, expect, vi } from 'vitest';
import {
  EngagementAnalyzer,
  PlatformMetricsClient,
  RawPlatformMetrics,
} from './engagement-analyzer';
import { BoostRecommender } from './boost-recommender';
import { GoogleAdsClient, GoogleAdsApi } from './google-ads-client';
import { InstagramAdsClient, InstagramAdsApi, CreativeUploadResult } from './instagram-ads-client';
import { BudgetOptimizer, PerformanceData } from './budget-optimizer';
import { ABTestingFramework, ContentVariation, EngagementSimulator } from './ab-testing-framework';
import { Platform, AdPlatform, AdStatus } from '../../models/enums';
import { AdPerformance, Budget, DemographicData } from '../../models/common';

// ── Shared helpers ───────────────────────────────────────────────────

function makeRaw(overrides: Partial<RawPlatformMetrics> = {}): RawPlatformMetrics {
  return {
    likes: 200,
    comments: 50,
    shares: 30,
    views: 2000,
    clicks: 80,
    reach: 1500,
    impressions: 5000,
    ...overrides,
  };
}

function makeDemographics(): DemographicData {
  return {
    ageGroups: { '18-24': 0.3, '25-34': 0.5, '35-44': 0.2 },
    genderDistribution: { male: 0.45, female: 0.50, other: 0.05 },
    topLocations: ['New York', 'London'],
  };
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    dailyLimit: 100,
    totalLimit: 500,
    remaining: 300,
    spent: 200,
    currency: 'USD',
    ...overrides,
  };
}

function createMockMetricsClient(raw?: RawPlatformMetrics): PlatformMetricsClient {
  return {
    fetchPostMetrics: vi.fn().mockResolvedValue(raw ?? makeRaw()),
    fetchPostDemographics: vi.fn().mockResolvedValue(makeDemographics()),
  };
}

function createMockGoogleApi(perf?: Partial<AdPerformance>): GoogleAdsApi {
  return {
    createCampaign: vi.fn().mockResolvedValue({ campaignId: 'gads-int-1' }),
    getCampaignPerformance: vi.fn().mockResolvedValue({
      impressions: 5000, clicks: 200, conversions: 20, spend: 50,
      cpc: 0.25, cpm: 10, ctr: 0.04, roi: 3.0,
      ...perf,
    } satisfies AdPerformance),
    updateBid: vi.fn().mockResolvedValue(undefined),
    pauseCampaign: vi.fn().mockResolvedValue(undefined),
    resumeCampaign: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockInstagramApi(perf?: Partial<AdPerformance>): InstagramAdsApi {
  return {
    createCampaign: vi.fn().mockResolvedValue({ campaignId: 'ig-int-1' }),
    getCampaignPerformance: vi.fn().mockResolvedValue({
      impressions: 3000, clicks: 120, conversions: 12, spend: 40,
      cpc: 0.33, cpm: 13.3, ctr: 0.04, roi: 2.5,
      ...perf,
    } satisfies AdPerformance),
    updateBid: vi.fn().mockResolvedValue(undefined),
    pauseCampaign: vi.fn().mockResolvedValue(undefined),
    resumeCampaign: vi.fn().mockResolvedValue(undefined),
    uploadCreative: vi.fn().mockResolvedValue({
      creativeId: 'cr-int-1', url: 'https://cdn.example.com/cr.jpg', status: 'ready',
    } satisfies CreativeUploadResult),
  };
}

// ── Integration: Engagement → Boost → Ad Campaign ───────────────────

describe('Optimization Integration: Engagement → Boost → Ad Campaign', () => {
  it('analyzes engagement, recommends boost, and creates a Google Ads campaign', async () => {
    // 1. Analyze engagement
    const metricsClient = createMockMetricsClient();
    const analyzer = new EngagementAnalyzer(new Map([[Platform.INSTAGRAM, metricsClient]]));
    const metrics = await analyzer.analyzeEngagement('post-int-1', Platform.INSTAGRAM);

    expect(metrics.engagementRate).toBeGreaterThan(0);

    // 2. Recommend boost
    const recommender = new BoostRecommender();
    const recommendation = recommender.recommendBoost(metrics, makeBudget());

    expect(recommendation).not.toBeNull();
    expect(recommendation!.postId).toBe('post-int-1');
    expect(recommendation!.recommendedBudget).toBeGreaterThan(0);

    // 3. Create Google Ads campaign from recommendation
    const googleApi = createMockGoogleApi();
    const googleClient = new GoogleAdsClient(googleApi);
    const adCampaign = await googleClient.createAdCampaign(recommendation!);

    expect(adCampaign.adCampaignId).toBe('gads-int-1');
    expect(adCampaign.platform).toBe(AdPlatform.GOOGLE_ADS);
    expect(adCampaign.status).toBe(AdStatus.ACTIVE);
    expect(adCampaign.budget.totalLimit).toBe(recommendation!.recommendedBudget);
  });

  it('analyzes engagement, recommends boost, and creates an Instagram Ads campaign', async () => {
    // 1. Analyze engagement
    const metricsClient = createMockMetricsClient();
    const analyzer = new EngagementAnalyzer(new Map([[Platform.FACEBOOK, metricsClient]]));
    const metrics = await analyzer.analyzeEngagement('post-fb-1', Platform.FACEBOOK);

    // 2. Recommend boost
    const recommender = new BoostRecommender();
    const recommendation = recommender.recommendBoost(metrics, makeBudget());
    expect(recommendation).not.toBeNull();

    // 3. Create Instagram Ads campaign
    const igApi = createMockInstagramApi();
    const igClient = new InstagramAdsClient(igApi);
    const adCampaign = await igClient.createAdCampaign(recommendation!);

    expect(adCampaign.adCampaignId).toBe('ig-int-1');
    expect(adCampaign.platform).toBe(AdPlatform.INSTAGRAM_ADS);
    expect(adCampaign.status).toBe(AdStatus.ACTIVE);
  });

  it('low-engagement post gets no boost and no ad campaign is created', async () => {
    const lowEngagementRaw = makeRaw({
      likes: 1, comments: 0, shares: 0, clicks: 0,
      reach: 20, impressions: 5000,
    });
    const metricsClient = createMockMetricsClient(lowEngagementRaw);
    const analyzer = new EngagementAnalyzer(new Map([[Platform.INSTAGRAM, metricsClient]]));
    const metrics = await analyzer.analyzeEngagement('post-low', Platform.INSTAGRAM);

    const recommender = new BoostRecommender();
    const recommendation = recommender.recommendBoost(metrics, makeBudget());

    expect(recommendation).toBeNull();
  });
});

// ── Integration: Ad Campaign → Performance → Budget Optimization ────

describe('Optimization Integration: Ad Campaigns → Budget Optimization', () => {
  it('creates multiple ad campaigns and optimizes budget across them', async () => {
    // Create two Google Ads campaigns with different performance via separate clients
    const highPerfApi: GoogleAdsApi = {
      ...createMockGoogleApi(),
      createCampaign: vi.fn().mockResolvedValue({ campaignId: 'gads-high' }),
      getCampaignPerformance: vi.fn().mockResolvedValue({
        impressions: 10000, clicks: 500, conversions: 50, spend: 80,
        cpc: 0.16, cpm: 8, ctr: 0.05, roi: 5.0,
      } satisfies AdPerformance),
    };
    const lowPerfApi: GoogleAdsApi = {
      ...createMockGoogleApi(),
      createCampaign: vi.fn().mockResolvedValue({ campaignId: 'gads-low' }),
      getCampaignPerformance: vi.fn().mockResolvedValue({
        impressions: 2000, clicks: 20, conversions: 2, spend: 80,
        cpc: 4, cpm: 40, ctr: 0.01, roi: 0.5,
      } satisfies AdPerformance),
    };

    const highClient = new GoogleAdsClient(highPerfApi);
    const lowClient = new GoogleAdsClient(lowPerfApi);

    const highCampaign = await highClient.createAdCampaign({
      postId: 'high-post', platform: Platform.INSTAGRAM,
      recommendedBudget: 200, expectedRoi: 5.0, targeting: {},
    });
    const lowCampaign = await lowClient.createAdCampaign({
      postId: 'low-post', platform: Platform.INSTAGRAM,
      recommendedBudget: 200, expectedRoi: 0.5, targeting: {},
    });

    expect(highCampaign.adCampaignId).toBe('gads-high');
    expect(lowCampaign.adCampaignId).toBe('gads-low');

    // Fetch performance for both
    const highPerf = await highClient.getAdCampaignPerformance(highCampaign.adCampaignId);
    const lowPerf = await lowClient.getAdCampaignPerformance(lowCampaign.adCampaignId);

    // Optimize budget across both campaigns
    const optimizer = new BudgetOptimizer();
    const perfData: PerformanceData = {
      metrics: new Map([
        [highCampaign.adCampaignId, highPerf],
        [lowCampaign.adCampaignId, lowPerf],
      ]),
    };

    const campaigns = [
      highClient.getCampaign(highCampaign.adCampaignId)!,
      lowClient.getCampaign(lowCampaign.adCampaignId)!,
    ];

    const allocation = optimizer.optimizeBudget(campaigns, perfData);

    // Higher ROI campaign should get more budget
    const highAlloc = allocation.allocations.find(a => a.adCampaignId === 'gads-high')!;
    const lowAlloc = allocation.allocations.find(a => a.adCampaignId === 'gads-low')!;
    expect(highAlloc.allocatedBudget).toBeGreaterThan(lowAlloc.allocatedBudget);

    // Total allocated should equal total budget
    const totalAllocated = allocation.allocations.reduce((s, a) => s + a.allocatedBudget, 0);
    expect(totalAllocated).toBeCloseTo(allocation.totalBudget, 1);
  });

  it('paused campaign still receives budget allocation from optimizer', async () => {
    const api = createMockGoogleApi();
    const client = new GoogleAdsClient(api);

    const campaign = await client.createAdCampaign({
      postId: 'p-1', platform: Platform.INSTAGRAM,
      recommendedBudget: 100, expectedRoi: 2.0, targeting: {},
    });
    await client.pauseAdCampaign(campaign.adCampaignId);

    const pausedCampaign = client.getCampaign(campaign.adCampaignId)!;
    expect(pausedCampaign.status).toBe(AdStatus.PAUSED);

    const optimizer = new BudgetOptimizer();
    const perfData: PerformanceData = {
      metrics: new Map([[campaign.adCampaignId, pausedCampaign.performance]]),
    };

    // Paused campaigns are still eligible for budget allocation
    const allocation = optimizer.optimizeBudget([pausedCampaign], perfData);
    expect(allocation.allocations[0].allocatedBudget).toBeGreaterThanOrEqual(0);
  });
});

// ── Integration: A/B Testing → Boost Winner ─────────────────────────

describe('Optimization Integration: A/B Test → Boost Winner', () => {
  it('runs A/B test, identifies winner, and recommends boost for winning variation', () => {
    const framework = new ABTestingFramework({ confidenceLevel: 0.95, minSampleSize: 10 });
    const variations: ContentVariation[] = [
      { variationId: 'v-winner', name: 'Winner', content: 'High engagement content' },
      { variationId: 'v-loser', name: 'Loser', content: 'Low engagement content' },
    ];

    // Winner gets 90% engagement, loser gets 10%
    const simulator: EngagementSimulator = (v) =>
      v.variationId === 'v-winner' ? Math.random() < 0.9 : Math.random() < 0.1;

    const audience = { members: Array.from({ length: 200 }, (_, i) => ({ memberId: `m-${i}`, interests: ['tech'] })) };
    const result = framework.abTest(variations, audience, simulator);

    expect(result.isSignificant).toBe(true);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.variationId).toBe('v-winner');

    // Now use the winning variation's engagement rate to build mock metrics
    // and recommend a boost
    const winnerResult = result.groups.find(g => g.variationId === 'v-winner')!;
    const recommender = new BoostRecommender();
    const mockMetrics = {
      postId: 'ab-winner-post',
      platform: Platform.INSTAGRAM,
      likes: winnerResult.engagements * 2,
      comments: Math.floor(winnerResult.engagements * 0.5),
      shares: Math.floor(winnerResult.engagements * 0.3),
      views: winnerResult.sampleSize * 10,
      clicks: winnerResult.engagements,
      reach: winnerResult.sampleSize * 5,
      impressions: winnerResult.sampleSize * 10,
      engagementRate: winnerResult.engagementRate,
      timestamp: new Date(),
    };

    const recommendation = recommender.recommendBoost(mockMetrics, makeBudget());
    expect(recommendation).not.toBeNull();
    expect(recommendation!.postId).toBe('ab-winner-post');
  });
});

// ── Cross-component error handling ──────────────────────────────────

describe('Optimization Integration: Error Handling', () => {
  it('engagement analysis failure prevents boost recommendation', async () => {
    const failingClient: PlatformMetricsClient = {
      fetchPostMetrics: vi.fn().mockRejectedValue(new Error('API rate limited')),
      fetchPostDemographics: vi.fn().mockResolvedValue(makeDemographics()),
    };
    const analyzer = new EngagementAnalyzer(new Map([[Platform.INSTAGRAM, failingClient]]));

    await expect(analyzer.analyzeEngagement('p-fail', Platform.INSTAGRAM))
      .rejects.toThrow('API rate limited');

    // Without metrics, we can't recommend a boost — the pipeline stops
  });

  it('ad campaign creation failure does not corrupt budget optimizer state', async () => {
    const failingApi: GoogleAdsApi = {
      createCampaign: vi.fn().mockRejectedValue(new Error('Google Ads API unavailable')),
      getCampaignPerformance: vi.fn(),
      updateBid: vi.fn(),
      pauseCampaign: vi.fn(),
      resumeCampaign: vi.fn(),
    };
    const client = new GoogleAdsClient(failingApi);

    await expect(client.createAdCampaign({
      postId: 'p-1', platform: Platform.INSTAGRAM,
      recommendedBudget: 100, expectedRoi: 2.0, targeting: {},
    })).rejects.toThrow('Google Ads API unavailable');

    // Client should have no campaigns stored
    expect(client.getCampaign('gads-int-1')).toBeUndefined();
  });

  it('budget optimizer handles mix of campaigns with and without performance data', async () => {
    const api = createMockGoogleApi();
    const client = new GoogleAdsClient(api);

    const c1 = await client.createAdCampaign({
      postId: 'p-1', platform: Platform.INSTAGRAM,
      recommendedBudget: 100, expectedRoi: 2.0, targeting: {},
    });
    const c2 = await client.createAdCampaign({
      postId: 'p-2', platform: Platform.INSTAGRAM,
      recommendedBudget: 100, expectedRoi: 3.0, targeting: {},
    });

    // Only provide performance data for c1
    const perfData: PerformanceData = {
      metrics: new Map([
        [c1.adCampaignId, { impressions: 1000, clicks: 50, conversions: 5, spend: 25, cpc: 0.5, cpm: 25, ctr: 0.05, roi: 2.0 }],
      ]),
    };

    const optimizer = new BudgetOptimizer();
    // c2 will fall back to campaign.performance (all zeros)
    const allocation = optimizer.optimizeBudget(
      [client.getCampaign(c1.adCampaignId)!, client.getCampaign(c2.adCampaignId)!],
      perfData,
    );

    expect(allocation.allocations).toHaveLength(2);
    const totalAllocated = allocation.allocations.reduce((s, a) => s + a.allocatedBudget, 0);
    expect(totalAllocated).toBeCloseTo(allocation.totalBudget, 1);
  });
});
