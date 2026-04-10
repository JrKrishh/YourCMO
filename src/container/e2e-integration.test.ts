/**
 * End-to-end integration tests.
 *
 * Tests complete campaign execution with mocked external services,
 * error scenarios and recovery, and concurrent campaign execution.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentCore } from '../core/agent-core';
import { AgentConfig, Platform, ContentSuggestion, Trend, VisualAsset, EngagementMetrics, AdCampaign } from '../models';
import { CampaignSpec } from '../core/types';
import {
  ITrendAnalysisEngine,
  IContentGenerationEngine,
  IVisualAssetCreator,
  IPlatformIntegrationLayer,
  IOptimizationEngine,
  PostResult,
  BoostRecommendation,
} from '../core/interfaces';
import { BrandProfile, Budget, OptimizationGoal, VisualSpecs } from '../models/common';
import { TrendLifecyclePhase, AssetType, AdPlatform, AdStatus, ContentTone } from '../models/enums';

// ── Helpers ───────────────────────────────────────────────────────

function makeConfig(): AgentConfig {
  return {
    agentId: 'integration-agent',
    frameworkType: 'OpenClaw',
    llmProvider: 'OpenAI',
    apiKeys: {},
    brandProfile: { name: 'IntBrand', voice: 'professional', guidelines: [] },
    targetAudience: { ageRange: [20, 50], interests: ['tech'] },
    platforms: [Platform.INSTAGRAM],
    budgetLimits: { dailyLimit: 100, totalLimit: 1000, currency: 'USD' },
    optimizationGoals: [],
  };
}

function makeSpec(overrides?: Partial<CampaignSpec>): CampaignSpec {
  return {
    name: 'Integration Campaign',
    platforms: [Platform.INSTAGRAM],
    budget: { total: 500, daily: 50, currency: 'USD' },
    brandProfile: { name: 'IntBrand', voice: 'professional', guidelines: [] },
    targetAudience: { ageRange: [20, 50], interests: ['tech'] },
    duration: 7,
    ...overrides,
  };
}

// ── Configurable mocks ────────────────────────────────────────────

function stubTrend(platform: Platform): Trend {
  return {
    trendId: `t-${platform}`,
    platform,
    topic: 'integration-test',
    hashtags: ['#test'],
    engagementScore: 0.5,
    velocity: 0.4,
    timestamp: new Date(),
    relatedContent: [],
    demographics: { ageGroups: {}, genderDistribution: {}, topLocations: [] },
    predictedLifecycle: {
      currentPhase: TrendLifecyclePhase.GROWING,
      estimatedPeakDate: new Date(),
      estimatedEndDate: new Date(),
      confidence: 0.7,
    },
  };
}

function stubSuggestion(): ContentSuggestion {
  return {
    contentId: 'cs-1',
    text: 'Integration test post',
    caption: 'caption',
    hashtags: ['#integration'],
    callToAction: 'Click',
    targetPlatforms: [Platform.INSTAGRAM],
    trendReferences: ['t-1'],
    tone: ContentTone.PROFESSIONAL,
    estimatedEngagement: 0.4,
    visualRequirements: {
      type: 'IMAGE',
      dimensions: { width: 1080, height: 1080 },
      format: 'jpg',
      maxFileSize: 5_000_000,
    },
  };
}

function stubAsset(): VisualAsset {
  return {
    assetId: 'va-1',
    assetType: AssetType.IMAGE,
    url: 'https://example.com/img.jpg',
    localPath: '',
    dimensions: { width: 1080, height: 1080 },
    format: 'jpg',
    fileSize: 100_000,
    duration: 0,
    platform: Platform.INSTAGRAM,
    metadata: { altText: 'test', createdAt: new Date(), tags: [] },
    brandingApplied: false,
  };
}

function stubMetrics(postId: string, platform: Platform): EngagementMetrics {
  return {
    postId,
    platform,
    likes: 50,
    comments: 10,
    shares: 5,
    views: 2000,
    clicks: 30,
    reach: 1500,
    impressions: 4000,
    engagementRate: 0.04,
    timestamp: new Date(),
  };
}

function createMocks(overrides?: {
  trendError?: boolean;
  contentError?: boolean;
  visualError?: boolean;
  postError?: boolean;
  optimizationError?: boolean;
}) {
  const opts = overrides ?? {};

  const trendAnalysis: ITrendAnalysisEngine = {
    fetchTrends: async (platforms) => {
      if (opts.trendError) throw new Error('Trend API down');
      return platforms.map((p) => stubTrend(p));
    },
    rankTrends: (trends) => trends,
  };

  const contentGeneration: IContentGenerationEngine = {
    generateSuggestions: async () => {
      if (opts.contentError) throw new Error('LLM unavailable');
      return [stubSuggestion()];
    },
    adaptToPlatform: (content, platform) => ({
      contentId: content.contentId,
      platform,
      text: content.text,
      visualAssets: [],
      hashtags: content.hashtags,
      mentions: [],
    }),
  };

  const visualAssetCreator: IVisualAssetCreator = {
    generateImage: async () => {
      if (opts.visualError) throw new Error('Image gen failed');
      return stubAsset();
    },
    generateVideo: async () => stubAsset(),
    addBranding: async (asset) => ({ ...asset, brandingApplied: true }),
  };

  const platformIntegration: IPlatformIntegrationLayer = {
    postContent: async (platform) => {
      if (opts.postError) throw new Error('Post failed');
      return { postId: `p-${platform}`, platform, success: true };
    },
  };

  const optimization: IOptimizationEngine = {
    analyzeEngagement: async (postId, platform) => {
      if (opts.optimizationError) throw new Error('Analytics down');
      return stubMetrics(postId, platform);
    },
    recommendBoost: async () => null,
    createAdCampaign: async () => ({
      adCampaignId: 'ad-1',
      platform: AdPlatform.INSTAGRAM_ADS,
      content: { contentId: '', platform: Platform.INSTAGRAM, text: '', visualAssets: [], hashtags: [], mentions: [] },
      targeting: {},
      budget: { dailyLimit: 0, totalLimit: 0, remaining: 0, spent: 0, currency: 'USD' },
      bidStrategy: { type: 'CPC' as const },
      startDate: new Date(),
      endDate: new Date(),
      status: AdStatus.DRAFT,
      performance: { impressions: 0, clicks: 0, conversions: 0, spend: 0, cpc: 0, cpm: 0, ctr: 0, roi: 0 },
    }),
  };

  return { trendAnalysis, contentGeneration, visualAssetCreator, platformIntegration, optimization };
}

function createAgent(overrides?: Parameters<typeof createMocks>[0]): AgentCore {
  const mocks = createMocks(overrides);
  const agent = new AgentCore(mocks);
  agent.initialize(makeConfig());
  return agent;
}

// ── Test suites ───────────────────────────────────────────────────

describe('E2E Integration: complete campaign execution', () => {
  it('runs a full campaign with all mocked services', async () => {
    const agent = createAgent();
    const result = await agent.executeCampaign(makeSpec());

    expect(result.campaignId).toBeDefined();
    expect(result.status).toBe('completed');
    expect(result.totalPosts).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(result.completedAt.getTime()).toBeGreaterThanOrEqual(result.startedAt.getTime());
  });

  it('records campaign in history after completion', async () => {
    const agent = createAgent();
    await agent.executeCampaign(makeSpec());

    expect(agent.campaignHistory).toHaveLength(1);
    expect(agent.activeCampaignCount).toBe(0);
  });
});

describe('E2E Integration: error scenarios and recovery', () => {
  it('recovers from trend analysis failure', async () => {
    const agent = createAgent({ trendError: true });
    const result = await agent.executeCampaign(makeSpec());

    expect(result.errors.some((e) => e.includes('Trend analysis failed'))).toBe(true);
    // Campaign still finishes (failed because no content was generated)
    expect(['failed', 'partial']).toContain(result.status);
  });

  it('recovers from content generation failure', async () => {
    const agent = createAgent({ contentError: true });
    const result = await agent.executeCampaign(makeSpec());

    expect(result.errors.some((e) => e.includes('Content generation failed'))).toBe(true);
  });

  it('recovers from visual asset creation failure', async () => {
    const agent = createAgent({ visualError: true });
    const result = await agent.executeCampaign(makeSpec());

    // Posts still go through even without visual assets
    expect(result.totalPosts).toBeGreaterThan(0);
  });

  it('recovers from platform posting failure', async () => {
    const agent = createAgent({ postError: true });
    const result = await agent.executeCampaign(makeSpec());

    expect(result.status).toBe('failed');
    expect(result.totalPosts).toBe(0);
  });

  it('recovers from optimization failure', async () => {
    const agent = createAgent({ optimizationError: true });
    const result = await agent.executeCampaign(makeSpec());

    // Campaign still completes — optimization is non-critical
    expect(result.totalPosts).toBeGreaterThan(0);
    expect(['completed', 'partial']).toContain(result.status);
  });

  it('handles multiple simultaneous failures gracefully', async () => {
    const agent = createAgent({ trendError: true, visualError: true });
    const result = await agent.executeCampaign(makeSpec());

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.campaignId).toBeDefined();
  });
});

describe('E2E Integration: concurrent campaign execution', () => {
  it('executes multiple campaigns concurrently', async () => {
    const agent = createAgent();

    const [r1, r2, r3] = await Promise.all([
      agent.executeCampaign(makeSpec({ name: 'Campaign A' })),
      agent.executeCampaign(makeSpec({ name: 'Campaign B' })),
      agent.executeCampaign(makeSpec({ name: 'Campaign C' })),
    ]);

    expect(r1.status).toBe('completed');
    expect(r2.status).toBe('completed');
    expect(r3.status).toBe('completed');

    // Each campaign gets a unique ID
    const ids = new Set([r1.campaignId, r2.campaignId, r3.campaignId]);
    expect(ids.size).toBe(3);

    // All three are in history
    expect(agent.campaignHistory).toHaveLength(3);
  });

  it('isolates failures between concurrent campaigns', async () => {
    // Create an agent where the first call to fetchTrends fails, rest succeed
    let callCount = 0;
    const mocks = createMocks();
    mocks.trendAnalysis.fetchTrends = async (platforms) => {
      callCount++;
      if (callCount === 1) throw new Error('First call fails');
      return platforms.map((p) => stubTrend(p));
    };

    const agent = new AgentCore(mocks);
    agent.initialize(makeConfig());

    const [r1, r2] = await Promise.all([
      agent.executeCampaign(makeSpec({ name: 'Failing' })),
      agent.executeCampaign(makeSpec({ name: 'Succeeding' })),
    ]);

    // One should have trend errors, the other should succeed
    const results = [r1, r2];
    const hasFailure = results.some((r) => r.errors.some((e) => e.includes('Trend analysis failed')));
    const hasSuccess = results.some((r) => r.status === 'completed');

    expect(hasFailure).toBe(true);
    expect(hasSuccess).toBe(true);
  });
});
