import { describe, it, expect, beforeEach } from 'vitest';
import { DataAccessLayer } from './data-access-layer';
import { CampaignStatus, CampaignType, Platform, ContentTone, AdPlatform, AdStatus } from '../models/enums';
import { Campaign } from '../models/campaign';
import { Trend } from '../models/trend';
import { ContentSuggestion } from '../models/content-suggestion';
import { AdCampaign } from '../models/ad-campaign';
import { EngagementMetrics } from '../models/engagement-metrics';

// --- Helpers to build test data ---

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign & Record<string, unknown> {
  return {
    campaignId: 'camp-1',
    name: 'Test Campaign',
    type: CampaignType.MULTI_PLATFORM,
    status: CampaignStatus.DRAFT,
    content: [],
    targetAudience: [],
    schedule: { startDate: new Date(), endDate: new Date(), timezone: 'UTC', sendTimes: [] },
    budget: { dailyLimit: 100, totalLimit: 1000, remaining: 1000, spent: 0, currency: 'USD' },
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
    optimizationRules: [],
    ...overrides,
  };
}

function makeTrend(overrides: Partial<Trend> = {}): Trend & Record<string, unknown> {
  return {
    trendId: 'trend-1',
    platform: Platform.INSTAGRAM,
    topic: 'AI Marketing',
    hashtags: ['#ai'],
    engagementScore: 0.8,
    velocity: 1.5,
    timestamp: new Date('2024-06-15'),
    relatedContent: [],
    demographics: { ageGroups: {}, genderDistribution: {}, topLocations: [] },
    predictedLifecycle: {
      currentPhase: 'GROWING' as never,
      estimatedPeakDate: new Date(),
      estimatedEndDate: new Date(),
      confidence: 0.7,
    },
    ...overrides,
  };
}

function makeContent(overrides: Partial<ContentSuggestion> = {}): ContentSuggestion & Record<string, unknown> {
  return {
    contentId: 'content-1',
    text: 'Check out this trend!',
    caption: 'Trending now',
    hashtags: ['#trending'],
    callToAction: 'Learn more',
    targetPlatforms: [Platform.INSTAGRAM],
    trendReferences: ['trend-1'],
    tone: ContentTone.CASUAL,
    estimatedEngagement: 0.6,
    visualRequirements: { type: 'IMAGE', dimensions: { width: 1080, height: 1080 }, format: 'jpg', maxFileSize: 5000000 },
    ...overrides,
  };
}

function makeAdCampaign(overrides: Partial<AdCampaign> = {}): AdCampaign & Record<string, unknown> {
  return {
    adCampaignId: 'ad-1',
    platform: AdPlatform.GOOGLE_ADS,
    content: {
      contentId: 'c1', platform: Platform.INSTAGRAM, text: 'Ad text',
      visualAssets: [], hashtags: [], mentions: [],
    },
    targeting: { locations: ['US'] },
    budget: { dailyLimit: 50, totalLimit: 500, remaining: 500, spent: 0, currency: 'USD' },
    bidStrategy: { type: 'CPC', maxBid: 2.0 },
    startDate: new Date('2024-03-01'),
    endDate: new Date('2024-06-01'),
    status: AdStatus.ACTIVE,
    performance: { impressions: 1000, clicks: 50, conversions: 5, spend: 100, cpc: 2, cpm: 10, ctr: 0.05, roi: 1.5 },
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<EngagementMetrics> = {}): EngagementMetrics & Record<string, unknown> {
  return {
    postId: 'post-1',
    platform: Platform.INSTAGRAM,
    likes: 100,
    comments: 20,
    shares: 10,
    views: 500,
    clicks: 30,
    reach: 400,
    impressions: 600,
    engagementRate: 0.25,
    timestamp: new Date('2024-06-15'),
    ...overrides,
  };
}

describe('CampaignRepository', () => {
  let dal: DataAccessLayer;

  beforeEach(async () => {
    dal = new DataAccessLayer();
  });

  it('should find campaigns by status', async () => {
    await dal.campaigns.create(makeCampaign({ campaignId: 'c1', status: CampaignStatus.ACTIVE }));
    await dal.campaigns.create(makeCampaign({ campaignId: 'c2', status: CampaignStatus.DRAFT }));
    await dal.campaigns.create(makeCampaign({ campaignId: 'c3', status: CampaignStatus.ACTIVE }));

    const active = await dal.campaigns.findByStatus(CampaignStatus.ACTIVE);
    expect(active).toHaveLength(2);
  });

  it('should find campaigns by type', async () => {
    await dal.campaigns.create(makeCampaign({ campaignId: 'c1', type: CampaignType.WHATSAPP }));
    await dal.campaigns.create(makeCampaign({ campaignId: 'c2', type: CampaignType.MULTI_PLATFORM }));

    const whatsapp = await dal.campaigns.findByType(CampaignType.WHATSAPP);
    expect(whatsapp).toHaveLength(1);
  });

  it('should find campaigns by date range', async () => {
    await dal.campaigns.create(makeCampaign({
      campaignId: 'c1',
      startDate: new Date('2024-03-01'),
      endDate: new Date('2024-06-01'),
    }));
    await dal.campaigns.create(makeCampaign({
      campaignId: 'c2',
      startDate: new Date('2024-07-01'),
      endDate: new Date('2024-09-01'),
    }));

    const results = await dal.campaigns.findByDateRange(
      new Date('2024-01-01'),
      new Date('2024-06-30'),
    );
    expect(results).toHaveLength(1);
    expect(results[0].campaignId).toBe('c1');
  });

  it('should find active campaigns', async () => {
    await dal.campaigns.create(makeCampaign({ campaignId: 'c1', status: CampaignStatus.ACTIVE }));
    await dal.campaigns.create(makeCampaign({ campaignId: 'c2', status: CampaignStatus.PAUSED }));

    const active = await dal.campaigns.findActiveCampaigns();
    expect(active).toHaveLength(1);
  });
});

describe('TrendRepository', () => {
  let dal: DataAccessLayer;

  beforeEach(() => {
    dal = new DataAccessLayer();
  });

  it('should find trends by platform', async () => {
    await dal.trends.create(makeTrend({ trendId: 't1', platform: Platform.INSTAGRAM }));
    await dal.trends.create(makeTrend({ trendId: 't2', platform: Platform.FACEBOOK }));

    const ig = await dal.trends.findByPlatform(Platform.INSTAGRAM);
    expect(ig).toHaveLength(1);
  });

  it('should find trends by date range', async () => {
    await dal.trends.create(makeTrend({ trendId: 't1', timestamp: new Date('2024-06-10') }));
    await dal.trends.create(makeTrend({ trendId: 't2', timestamp: new Date('2024-08-10') }));

    const results = await dal.trends.findByDateRange(
      new Date('2024-06-01'),
      new Date('2024-07-01'),
    );
    expect(results).toHaveLength(1);
  });

  it('should find top trends by engagement', async () => {
    await dal.trends.create(makeTrend({ trendId: 't1', engagementScore: 0.3 }));
    await dal.trends.create(makeTrend({ trendId: 't2', engagementScore: 0.9 }));
    await dal.trends.create(makeTrend({ trendId: 't3', engagementScore: 0.6 }));

    const top = await dal.trends.findTopByEngagement(2);
    expect(top).toHaveLength(2);
    expect(top[0].engagementScore).toBe(0.9);
  });

  it('should find trends by topic (case-insensitive)', async () => {
    await dal.trends.create(makeTrend({ trendId: 't1', topic: 'AI Marketing' }));
    await dal.trends.create(makeTrend({ trendId: 't2', topic: 'Food Trends' }));

    const results = await dal.trends.findByTopic('ai');
    expect(results).toHaveLength(1);
    expect(results[0].topic).toBe('AI Marketing');
  });
});

describe('ContentSuggestionRepository', () => {
  let dal: DataAccessLayer;

  beforeEach(() => {
    dal = new DataAccessLayer();
  });

  it('should find content by tone', async () => {
    await dal.contentSuggestions.create(makeContent({ contentId: 'c1', tone: ContentTone.CASUAL }));
    await dal.contentSuggestions.create(makeContent({ contentId: 'c2', tone: ContentTone.PROFESSIONAL }));

    const casual = await dal.contentSuggestions.findByTone(ContentTone.CASUAL);
    expect(casual).toHaveLength(1);
  });

  it('should find content by platform', async () => {
    await dal.contentSuggestions.create(makeContent({
      contentId: 'c1',
      targetPlatforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    }));
    await dal.contentSuggestions.create(makeContent({
      contentId: 'c2',
      targetPlatforms: [Platform.TWITTER],
    }));

    const ig = await dal.contentSuggestions.findByPlatform(Platform.INSTAGRAM);
    expect(ig).toHaveLength(1);
  });

  it('should find top content by engagement', async () => {
    await dal.contentSuggestions.create(makeContent({ contentId: 'c1', estimatedEngagement: 0.3 }));
    await dal.contentSuggestions.create(makeContent({ contentId: 'c2', estimatedEngagement: 0.9 }));

    const top = await dal.contentSuggestions.findTopByEngagement(1);
    expect(top).toHaveLength(1);
    expect(top[0].estimatedEngagement).toBe(0.9);
  });
});

describe('AdCampaignRepository', () => {
  let dal: DataAccessLayer;

  beforeEach(() => {
    dal = new DataAccessLayer();
  });

  it('should find ad campaigns by platform', async () => {
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a1', platform: AdPlatform.GOOGLE_ADS }));
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a2', platform: AdPlatform.INSTAGRAM_ADS }));

    const google = await dal.adCampaigns.findByPlatform(AdPlatform.GOOGLE_ADS);
    expect(google).toHaveLength(1);
  });

  it('should find ad campaigns by status', async () => {
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a1', status: AdStatus.ACTIVE }));
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a2', status: AdStatus.PAUSED }));

    const active = await dal.adCampaigns.findByStatus(AdStatus.ACTIVE);
    expect(active).toHaveLength(1);
  });

  it('should find active campaigns by platform', async () => {
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a1', platform: AdPlatform.GOOGLE_ADS, status: AdStatus.ACTIVE }));
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a2', platform: AdPlatform.GOOGLE_ADS, status: AdStatus.PAUSED }));
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a3', platform: AdPlatform.INSTAGRAM_ADS, status: AdStatus.ACTIVE }));

    const activeGoogle = await dal.adCampaigns.findActiveByPlatform(AdPlatform.GOOGLE_ADS);
    expect(activeGoogle).toHaveLength(1);
  });

  it('should calculate total spend', async () => {
    await dal.adCampaigns.create(makeAdCampaign({
      adCampaignId: 'a1',
      performance: { impressions: 0, clicks: 0, conversions: 0, spend: 150, cpc: 0, cpm: 0, ctr: 0, roi: 0 },
    }));
    await dal.adCampaigns.create(makeAdCampaign({
      adCampaignId: 'a2',
      performance: { impressions: 0, clicks: 0, conversions: 0, spend: 250, cpc: 0, cpm: 0, ctr: 0, roi: 0 },
    }));

    const total = await dal.adCampaigns.getTotalSpend();
    expect(total).toBe(400);
  });
});

describe('EngagementMetricsRepository', () => {
  let dal: DataAccessLayer;

  beforeEach(() => {
    dal = new DataAccessLayer();
  });

  it('should find metrics by platform', async () => {
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p1', platform: Platform.INSTAGRAM }));
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p2', platform: Platform.FACEBOOK }));

    const ig = await dal.engagementMetrics.findByPlatform(Platform.INSTAGRAM);
    expect(ig).toHaveLength(1);
  });

  it('should find metrics by date range', async () => {
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p1', timestamp: new Date('2024-06-10') }));
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p2', timestamp: new Date('2024-08-10') }));

    const results = await dal.engagementMetrics.findByDateRange(
      new Date('2024-06-01'),
      new Date('2024-07-01'),
    );
    expect(results).toHaveLength(1);
  });

  it('should calculate average engagement rate', async () => {
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p1', engagementRate: 0.2 }));
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p2', engagementRate: 0.4 }));

    const avg = await dal.engagementMetrics.getAverageEngagementRate();
    expect(avg).toBeCloseTo(0.3);
  });

  it('should calculate average engagement rate by platform', async () => {
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p1', platform: Platform.INSTAGRAM, engagementRate: 0.5 }));
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p2', platform: Platform.FACEBOOK, engagementRate: 0.1 }));

    const avg = await dal.engagementMetrics.getAverageEngagementRate(Platform.INSTAGRAM);
    expect(avg).toBeCloseTo(0.5);
  });

  it('should return 0 for average when no metrics exist', async () => {
    const avg = await dal.engagementMetrics.getAverageEngagementRate();
    expect(avg).toBe(0);
  });

  it('should get top performing posts', async () => {
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p1', engagementRate: 0.1 }));
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p2', engagementRate: 0.9 }));
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p3', engagementRate: 0.5 }));

    const top = await dal.engagementMetrics.getTopPerforming(2);
    expect(top).toHaveLength(2);
    expect(top[0].engagementRate).toBe(0.9);
  });
});

describe('DataAccessLayer - Transactions', () => {
  let dal: DataAccessLayer;

  beforeEach(() => {
    dal = new DataAccessLayer();
  });

  it('should commit transaction across repositories', async () => {
    const tx = dal.beginTransaction();
    await dal.campaigns.create(makeCampaign({ campaignId: 'c1' }));
    await dal.trends.create(makeTrend({ trendId: 't1' }));
    tx.commit();

    expect(await dal.campaigns.findById('c1')).not.toBeNull();
    expect(await dal.trends.findById('t1')).not.toBeNull();
  });

  it('should rollback transaction across repositories', async () => {
    // Pre-populate
    await dal.campaigns.create(makeCampaign({ campaignId: 'c0', name: 'original' }));

    const tx = dal.beginTransaction();
    await dal.campaigns.update('c0', { name: 'changed' });
    await dal.campaigns.create(makeCampaign({ campaignId: 'c1' }));
    await dal.trends.create(makeTrend({ trendId: 't1' }));
    tx.rollback();

    const c0 = await dal.campaigns.findById('c0');
    expect(c0!.name).toBe('original');
    expect(await dal.campaigns.findById('c1')).toBeNull();
    expect(await dal.trends.findById('t1')).toBeNull();
  });

  it('should executeInTransaction and commit on success', async () => {
    await dal.executeInTransaction(async (d) => {
      await d.campaigns.create(makeCampaign({ campaignId: 'c1' }));
      await d.trends.create(makeTrend({ trendId: 't1' }));
    });

    expect(await dal.campaigns.findById('c1')).not.toBeNull();
    expect(await dal.trends.findById('t1')).not.toBeNull();
  });

  it('should executeInTransaction and rollback on error', async () => {
    await dal.campaigns.create(makeCampaign({ campaignId: 'existing' }));

    await expect(
      dal.executeInTransaction(async (d) => {
        await d.campaigns.update('existing', { name: 'changed' });
        throw new Error('Simulated failure');
      }),
    ).rejects.toThrow('Simulated failure');

    const result = await dal.campaigns.findById('existing');
    expect(result!.name).toBe('Test Campaign');
  });

  it('should clearAll repositories', async () => {
    await dal.campaigns.create(makeCampaign({ campaignId: 'c1' }));
    await dal.trends.create(makeTrend({ trendId: 't1' }));
    await dal.contentSuggestions.create(makeContent({ contentId: 'cs1' }));
    await dal.adCampaigns.create(makeAdCampaign({ adCampaignId: 'a1' }));
    await dal.engagementMetrics.create(makeMetrics({ postId: 'p1' }));

    await dal.clearAll();

    expect(await dal.campaigns.count()).toBe(0);
    expect(await dal.trends.count()).toBe(0);
    expect(await dal.contentSuggestions.count()).toBe(0);
    expect(await dal.adCampaigns.count()).toBe(0);
    expect(await dal.engagementMetrics.count()).toBe(0);
  });
});
