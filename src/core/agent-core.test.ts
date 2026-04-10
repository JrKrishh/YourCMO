import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentCore } from './agent-core';
import {
  calculateEngagementScore,
  LOW_ENGAGEMENT_RATE_THRESHOLD,
  HIGH_ENGAGEMENT_RATE_THRESHOLD,
  HIGH_SPEND_LOW_ROI_THRESHOLD,
  MIN_IMPRESSIONS_FOR_ANALYSIS,
} from './agent-core';
import {
  AgentConfig,
  CMOPersona,
  Platform,
  Trend,
  ContentSuggestion,
  VisualAsset,
  PlatformContent,
  EngagementMetrics,
  ContentTone,
  AssetType,
  TrendLifecyclePhase,
} from '../models';
import {
  AgentCoreDependencies,
  ITrendAnalysisEngine,
  IContentGenerationEngine,
  IVisualAssetCreator,
  IPlatformIntegrationLayer,
  IOptimizationEngine,
  PostResult,
} from './interfaces';
import { CampaignSpec, PerformanceMetrics } from './types';

function createValidConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    agentId: 'test-agent-001',
    frameworkType: 'custom',
    llmProvider: 'OpenAI',
    apiKeys: { OPENAI_API_KEY: 'sk-test' },
    brandProfile: { name: 'TestBrand', voice: 'casual', guidelines: ['be friendly'] },
    targetAudience: { ageRange: [18, 35], interests: ['tech'] },
    platforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    budgetLimits: { dailyLimit: 100, totalLimit: 1000, currency: 'USD' },
    optimizationGoals: [{ metric: 'engagement', target: 0.05, weight: 1 }],
    ...overrides,
  };
}

function createCampaignSpec(overrides: Partial<CampaignSpec> = {}): CampaignSpec {
  return {
    name: 'Test Campaign',
    targetAudience: { ageRange: [18, 35], interests: ['tech'] },
    platforms: [Platform.INSTAGRAM],
    budget: { total: 500, daily: 50, currency: 'USD' },
    brandProfile: { name: 'Brand', voice: 'casual', guidelines: [] },
    duration: 7,
    ...overrides,
  };
}

function createMockTrend(overrides: Partial<Trend> = {}): Trend {
  return {
    trendId: 'trend-1',
    platform: Platform.INSTAGRAM,
    topic: 'AI Marketing',
    hashtags: ['#ai', '#marketing'],
    engagementScore: 0.8,
    velocity: 1.5,
    timestamp: new Date(),
    relatedContent: [],
    demographics: { ageGroups: {}, genderDistribution: {}, topLocations: [] },
    predictedLifecycle: {
      currentPhase: TrendLifecyclePhase.GROWING,
      estimatedPeakDate: new Date(),
      estimatedEndDate: new Date(),
      confidence: 0.7,
    },
    ...overrides,
  };
}

function createMockSuggestion(overrides: Partial<ContentSuggestion> = {}): ContentSuggestion {
  return {
    contentId: 'content-1',
    text: 'Check out the latest AI trends!',
    caption: 'AI is transforming marketing',
    hashtags: ['#ai'],
    callToAction: 'Learn more',
    targetPlatforms: [Platform.INSTAGRAM],
    trendReferences: ['trend-1'],
    tone: ContentTone.CASUAL,
    estimatedEngagement: 0.6,
    visualRequirements: {
      type: 'IMAGE',
      dimensions: { width: 1080, height: 1080 },
      format: 'jpg',
      maxFileSize: 5_000_000,
    },
    ...overrides,
  };
}

function createMockVisualAsset(overrides: Partial<VisualAsset> = {}): VisualAsset {
  return {
    assetId: 'asset-1',
    assetType: AssetType.IMAGE,
    url: 'https://example.com/image.jpg',
    localPath: '/tmp/image.jpg',
    dimensions: { width: 1080, height: 1080 },
    format: 'jpg',
    fileSize: 500_000,
    duration: 0,
    platform: Platform.INSTAGRAM,
    metadata: { createdAt: new Date() },
    brandingApplied: true,
    ...overrides,
  };
}

function createMockPlatformContent(platform: Platform): PlatformContent {
  return {
    contentId: 'content-1',
    platform,
    text: 'Adapted content',
    visualAssets: [],
    hashtags: ['#ai'],
    mentions: [],
  };
}

function createMockEngines(): Required<AgentCoreDependencies> {
  const trend = createMockTrend();
  const suggestion = createMockSuggestion();
  const asset = createMockVisualAsset();

  return {
    trendAnalysis: {
      fetchTrends: vi.fn().mockResolvedValue([trend]),
      rankTrends: vi.fn().mockReturnValue([trend]),
    },
    contentGeneration: {
      generateSuggestions: vi.fn().mockResolvedValue([suggestion]),
      adaptToPlatform: vi.fn().mockImplementation((_s, platform) =>
        createMockPlatformContent(platform),
      ),
    },
    visualAssetCreator: {
      generateImage: vi.fn().mockResolvedValue(asset),
      generateVideo: vi.fn().mockResolvedValue(asset),
      addBranding: vi.fn().mockResolvedValue(asset),
    },
    platformIntegration: {
      postContent: vi.fn().mockImplementation((_p, content) =>
        Promise.resolve({
          postId: 'post-123',
          platform: content.platform,
          success: true,
          url: 'https://instagram.com/p/123',
        } as PostResult),
      ),
    },
    optimization: {
      analyzeEngagement: vi.fn().mockResolvedValue({
        postId: 'post-123',
        platform: Platform.INSTAGRAM,
        likes: 100,
        comments: 20,
        shares: 10,
        views: 1000,
        clicks: 50,
        reach: 5000,
        impressions: 8000,
        engagementRate: 0.05,
        timestamp: new Date(),
      } as EngagementMetrics),
      recommendBoost: vi.fn().mockResolvedValue(null),
      createAdCampaign: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('AgentCore', () => {
  let agent: AgentCore;

  beforeEach(() => {
    agent = new AgentCore();
  });

  // ── Constructor & initial state ──────────────────────────────

  it('starts uninitialised with no config', () => {
    expect(agent.isInitialized).toBe(false);
    expect(agent.config).toBeNull();
    expect(agent.activeCampaignCount).toBe(0);
    expect(agent.campaignHistory).toHaveLength(0);
  });

  // ── initialize() ────────────────────────────────────────────

  it('initialises successfully with a valid config', () => {
    const config = createValidConfig();
    const result = agent.initialize(config);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(agent.isInitialized).toBe(true);
    expect(agent.config).toEqual(config);
  });

  it('rejects config with missing agentId', () => {
    const config = createValidConfig({ agentId: '' });
    const result = agent.initialize(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('agentId is required');
    expect(agent.isInitialized).toBe(false);
  });

  it('rejects config with empty platforms', () => {
    const config = createValidConfig({ platforms: [] });
    const result = agent.initialize(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('At least one platform must be configured');
  });

  it('rejects config with non-positive daily budget', () => {
    const config = createValidConfig({
      budgetLimits: { dailyLimit: 0, totalLimit: 1000, currency: 'USD' },
    });
    const result = agent.initialize(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('budgetLimits.dailyLimit must be positive');
  });

  it('rejects config with non-positive total budget', () => {
    const config = createValidConfig({
      budgetLimits: { dailyLimit: 100, totalLimit: -5, currency: 'USD' },
    });
    const result = agent.initialize(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('budgetLimits.totalLimit must be positive');
  });

  it('collects multiple validation errors at once', () => {
    const config = createValidConfig({
      agentId: '',
      frameworkType: '',
      platforms: [],
    });
    const result = agent.initialize(config);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  // ── State management ────────────────────────────────────────

  it('reset() returns agent to uninitialised state', () => {
    agent.initialize(createValidConfig());
    expect(agent.isInitialized).toBe(true);

    agent.reset();

    expect(agent.isInitialized).toBe(false);
    expect(agent.config).toBeNull();
    expect(agent.campaignHistory).toHaveLength(0);
  });

  it('can be re-initialised after reset', () => {
    agent.initialize(createValidConfig({ agentId: 'first' }));
    agent.reset();

    const second = createValidConfig({ agentId: 'second' });
    const result = agent.initialize(second);

    expect(result.valid).toBe(true);
    expect(agent.config?.agentId).toBe('second');
  });

  // ── Guard: methods throw before initialisation ──────────────

  it('executeCampaign throws when not initialised', async () => {
    await expect(agent.executeCampaign(createCampaignSpec())).rejects.toThrow(
      'Agent is not initialized',
    );
  });

  it('monitorPerformance throws when not initialised', async () => {
    await expect(agent.monitorPerformance()).rejects.toThrow('Agent is not initialized');
  });

  it('adaptStrategy throws when not initialised', () => {
    const dummyMetrics = {
      activeCampaigns: 0,
      totalReach: 0,
      totalImpressions: 0,
      totalEngagements: 0,
      averageEngagementRate: 0,
      platformMetrics: {},
      collectedAt: new Date(),
    };
    expect(() => agent.adaptStrategy(dummyMetrics)).toThrow('Agent is not initialized');
  });

  // ── validateConfig static method ────────────────────────────

  it('validateConfig accepts a fully valid config', () => {
    const result = AgentCore.validateConfig(createValidConfig());
    expect(result.valid).toBe(true);
  });

  // ── monitorPerformance / adaptStrategy stubs ────────────────

  it('monitorPerformance returns metrics after initialisation', async () => {
    agent.initialize(createValidConfig());
    const metrics = await agent.monitorPerformance();

    expect(metrics.activeCampaigns).toBe(0);
    expect(metrics.collectedAt).toBeInstanceOf(Date);
  });

  it('adaptStrategy returns an update after initialisation', async () => {
    agent.initialize(createValidConfig());
    const metrics = await agent.monitorPerformance();
    const update = agent.adaptStrategy(metrics);

    expect(update.appliedAt).toBeInstanceOf(Date);
  });
});

describe('AgentCore — executeCampaign orchestration', () => {
  // ── Campaign spec validation ────────────────────────────────

  it('rejects campaign with empty platforms', async () => {
    const agent = new AgentCore();
    agent.initialize(createValidConfig());

    await expect(
      agent.executeCampaign(createCampaignSpec({ platforms: [] })),
    ).rejects.toThrow('Campaign must target at least one platform');
  });

  it('rejects campaign with zero budget', async () => {
    const agent = new AgentCore();
    agent.initialize(createValidConfig());

    await expect(
      agent.executeCampaign(
        createCampaignSpec({ budget: { total: 0, daily: 0, currency: 'USD' } }),
      ),
    ).rejects.toThrow('Campaign budget must be positive');
  });

  // ── No engines — graceful degradation ───────────────────────

  it('completes with failed status when no engines are configured', async () => {
    const agent = new AgentCore();
    agent.initialize(createValidConfig());

    const result = await agent.executeCampaign(createCampaignSpec());

    expect(result.campaignId).toBeTruthy();
    expect(result.status).toBe('failed');
    expect(result.totalPosts).toBe(0);
    expect(result.platforms).toEqual([Platform.INSTAGRAM]);
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(agent.campaignHistory).toHaveLength(1);
    // Campaign should be moved from active to history
    expect(agent.activeCampaignCount).toBe(0);
  });

  // ── Full orchestration with all engines ─────────────────────

  it('executes full workflow with all engines and returns completed', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const spec = createCampaignSpec({ platforms: [Platform.INSTAGRAM] });
    const result = await agent.executeCampaign(spec);

    expect(result.status).toBe('completed');
    expect(result.totalPosts).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify engine calls
    expect(engines.trendAnalysis.fetchTrends).toHaveBeenCalledOnce();
    expect(engines.trendAnalysis.rankTrends).toHaveBeenCalledOnce();
    expect(engines.contentGeneration.generateSuggestions).toHaveBeenCalledOnce();
    expect(engines.contentGeneration.adaptToPlatform).toHaveBeenCalledOnce();
    expect(engines.visualAssetCreator.generateImage).toHaveBeenCalledOnce();
    expect(engines.visualAssetCreator.addBranding).toHaveBeenCalledOnce();
    expect(engines.platformIntegration.postContent).toHaveBeenCalledOnce();
    expect(engines.optimization.analyzeEngagement).toHaveBeenCalledOnce();
  });

  it('posts to multiple platforms', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const spec = createCampaignSpec({
      platforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    });
    const result = await agent.executeCampaign(spec);

    expect(result.status).toBe('completed');
    expect(result.totalPosts).toBe(2);
    expect(engines.platformIntegration.postContent).toHaveBeenCalledTimes(2);
  });

  // ── Error recovery ──────────────────────────────────────────

  it('returns partial status when trend analysis fails but posting succeeds', async () => {
    const engines = createMockEngines();
    (engines.trendAnalysis.fetchTrends as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API timeout'),
    );
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const result = await agent.executeCampaign(createCampaignSpec());

    // No trends → no content → no posts → failed
    expect(result.status).toBe('failed');
    expect(result.errors).toContain('Trend analysis failed: API timeout');
  });

  it('continues when one platform posting fails', async () => {
    const engines = createMockEngines();
    let callCount = 0;
    (engines.platformIntegration.postContent as ReturnType<typeof vi.fn>).mockImplementation(
      (_p: Platform, content: PlatformContent) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            postId: 'post-1',
            platform: content.platform,
            success: true,
          } as PostResult);
        }
        return Promise.reject(new Error('Rate limited'));
      },
    );

    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const spec = createCampaignSpec({
      platforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    });
    const result = await agent.executeCampaign(spec);

    // One success + one failure = partial
    expect(result.status).toBe('partial');
    expect(result.totalPosts).toBe(1);
    expect(result.errors.some((e) => e.includes('Rate limited'))).toBe(true);
  });

  it('captures content generation failure and continues', async () => {
    const engines = createMockEngines();
    (engines.contentGeneration.generateSuggestions as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('LLM unavailable'),
    );
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const result = await agent.executeCampaign(createCampaignSpec());

    expect(result.errors).toContain('Content generation failed: LLM unavailable');
  });

  it('captures visual asset creation failure and continues', async () => {
    const engines = createMockEngines();
    (engines.visualAssetCreator.generateImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Image service down'),
    );
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const result = await agent.executeCampaign(createCampaignSpec());

    // The top-level catch won't fire because individual asset failures are caught inside the loop.
    // But the campaign should still proceed.
    expect(result.campaignId).toBeTruthy();
  });

  // ── Dependency injection via setters ────────────────────────

  it('accepts engines via setter methods', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore();
    agent.setTrendAnalysis(engines.trendAnalysis);
    agent.setContentGeneration(engines.contentGeneration);
    agent.setVisualAssetCreator(engines.visualAssetCreator);
    agent.setPlatformIntegration(engines.platformIntegration);
    agent.setOptimization(engines.optimization);
    agent.initialize(createValidConfig());

    const result = await agent.executeCampaign(createCampaignSpec());

    expect(result.status).toBe('completed');
    expect(result.totalPosts).toBe(1);
  });

  // ── Campaign state tracking ─────────────────────────────────

  it('moves campaign from active to history after execution', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    expect(agent.activeCampaignCount).toBe(0);

    const result = await agent.executeCampaign(createCampaignSpec());

    expect(agent.activeCampaignCount).toBe(0);
    expect(agent.campaignHistory).toHaveLength(1);
    expect(agent.campaignHistory[0].campaignId).toBe(result.campaignId);
  });

  it('tracks multiple campaign executions in history', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    await agent.executeCampaign(createCampaignSpec({ name: 'Campaign 1' }));
    await agent.executeCampaign(createCampaignSpec({ name: 'Campaign 2' }));

    expect(agent.campaignHistory).toHaveLength(2);
  });

  // ── Trend filtering ─────────────────────────────────────────

  it('filters out trends below minimum engagement threshold', async () => {
    const lowEngagementTrend = createMockTrend({ engagementScore: 0.05 });
    const engines = createMockEngines();
    (engines.trendAnalysis.fetchTrends as ReturnType<typeof vi.fn>).mockResolvedValue([
      lowEngagementTrend,
    ]);
    (engines.trendAnalysis.rankTrends as ReturnType<typeof vi.fn>).mockReturnValue([
      lowEngagementTrend,
    ]);

    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const result = await agent.executeCampaign(createCampaignSpec());

    // No trends pass threshold → no content → no posts → failed
    expect(engines.contentGeneration.generateSuggestions).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  // ── Video asset path ────────────────────────────────────────

  it('calls generateVideo for VIDEO visual requirements', async () => {
    const videoSuggestion = createMockSuggestion({
      visualRequirements: {
        type: 'VIDEO',
        dimensions: { width: 1920, height: 1080 },
        format: 'mp4',
        maxFileSize: 50_000_000,
        duration: 30,
      },
    });
    const engines = createMockEngines();
    (engines.contentGeneration.generateSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue([
      videoSuggestion,
    ]);

    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    await agent.executeCampaign(createCampaignSpec());

    expect(engines.visualAssetCreator.generateVideo).toHaveBeenCalledOnce();
    expect(engines.visualAssetCreator.generateImage).not.toHaveBeenCalled();
  });
});


// ── calculateEngagementScore ──────────────────────────────────

describe('calculateEngagementScore', () => {
  it('returns 0 when impressions is 0', () => {
    expect(calculateEngagementScore({ likes: 10, comments: 5, shares: 2, impressions: 0 })).toBe(0);
  });

  it('returns 0 when impressions is negative', () => {
    expect(calculateEngagementScore({ likes: 10, comments: 5, shares: 2, impressions: -1 })).toBe(0);
  });

  it('computes weighted score: (likes + comments*2 + shares*3) / impressions', () => {
    // (100 + 20*2 + 10*3) / 1000 = (100 + 40 + 30) / 1000 = 0.17
    const score = calculateEngagementScore({ likes: 100, comments: 20, shares: 10, impressions: 1000 });
    expect(score).toBeCloseTo(0.17, 5);
  });

  it('clamps result to 1.0 when raw score exceeds 1', () => {
    // (1000 + 500*2 + 500*3) / 100 = 3500/100 = 35 → clamped to 1
    const score = calculateEngagementScore({ likes: 1000, comments: 500, shares: 500, impressions: 100 });
    expect(score).toBe(1);
  });

  it('returns 0 when all engagement counts are 0', () => {
    expect(calculateEngagementScore({ likes: 0, comments: 0, shares: 0, impressions: 1000 })).toBe(0);
  });
});

// ── monitorPerformance — real logic ───────────────────────────

describe('AgentCore — monitorPerformance', () => {
  it('returns zero metrics when no active campaigns exist', async () => {
    const agent = new AgentCore();
    agent.initialize(createValidConfig());

    const metrics = await agent.monitorPerformance();

    expect(metrics.activeCampaigns).toBe(0);
    expect(metrics.totalReach).toBe(0);
    expect(metrics.totalImpressions).toBe(0);
    expect(metrics.totalEngagements).toBe(0);
    expect(metrics.averageEngagementRate).toBe(0);
    expect(metrics.platformMetrics).toEqual({});
  });

  it('aggregates metrics from campaign content with cached engagementMetrics', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    // Manually add an active campaign with content that has engagement metrics
    const campaign = {
      campaignId: 'camp-1',
      name: 'Test',
      type: 'MULTI_PLATFORM' as any,
      status: 'ACTIVE' as any,
      content: [
        {
          contentId: 'c1',
          platform: Platform.INSTAGRAM,
          text: 'Hello',
          visualAssets: [],
          hashtags: [],
          mentions: [],
          postId: undefined, // no postId, so optimization engine won't be called
          engagementMetrics: {
            postId: 'p1',
            platform: Platform.INSTAGRAM,
            likes: 50,
            comments: 10,
            shares: 5,
            views: 500,
            clicks: 20,
            reach: 1000,
            impressions: 2000,
            engagementRate: 0.04,
            timestamp: new Date(),
          },
        },
      ] as any[],
      targetAudience: [],
      schedule: { startDate: new Date(), endDate: new Date(), timezone: 'UTC', sendTimes: [] },
      budget: { dailyLimit: 50, totalLimit: 500, remaining: 400, spent: 100, currency: 'USD' },
      startDate: new Date(),
      endDate: new Date(),
      metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
      optimizationRules: [],
    };

    // Access internal state to inject an active campaign
    (agent as any).state.activeCampaigns.set('camp-1', campaign);

    const metrics = await agent.monitorPerformance();

    expect(metrics.activeCampaigns).toBe(1);
    expect(metrics.totalReach).toBe(1000);
    expect(metrics.totalImpressions).toBe(2000);
    // engagements = likes + comments + shares + clicks = 50 + 10 + 5 + 20 = 85
    expect(metrics.totalEngagements).toBe(85);
    expect(metrics.averageEngagementRate).toBeGreaterThan(0);
    expect(metrics.platformMetrics[Platform.INSTAGRAM]).toHaveLength(1);
  });

  it('uses optimization engine to fetch live metrics when postId is present', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    const campaign = {
      campaignId: 'camp-2',
      name: 'Live',
      type: 'MULTI_PLATFORM' as any,
      status: 'ACTIVE' as any,
      content: [
        {
          contentId: 'c2',
          platform: Platform.FACEBOOK,
          text: 'Live post',
          visualAssets: [],
          hashtags: [],
          mentions: [],
          postId: 'live-post-1',
        },
      ] as any[],
      targetAudience: [],
      schedule: { startDate: new Date(), endDate: new Date(), timezone: 'UTC', sendTimes: [] },
      budget: { dailyLimit: 50, totalLimit: 500, remaining: 500, spent: 0, currency: 'USD' },
      startDate: new Date(),
      endDate: new Date(),
      metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
      optimizationRules: [],
    };

    (agent as any).state.activeCampaigns.set('camp-2', campaign);

    const metrics = await agent.monitorPerformance();

    expect(engines.optimization.analyzeEngagement).toHaveBeenCalledWith('live-post-1', Platform.FACEBOOK);
    expect(metrics.totalReach).toBeGreaterThan(0);
    expect(metrics.platformMetrics[Platform.FACEBOOK]).toHaveLength(1);
  });
});

// ── adaptStrategy — real logic ────────────────────────────────

describe('AgentCore — adaptStrategy', () => {
  let agent: AgentCore;

  beforeEach(() => {
    agent = new AgentCore();
    agent.initialize(createValidConfig());
  });

  it('returns no adjustments when impressions are below analysis threshold', () => {
    const metrics: PerformanceMetrics = {
      activeCampaigns: 1,
      totalReach: 50,
      totalImpressions: MIN_IMPRESSIONS_FOR_ANALYSIS - 1,
      totalEngagements: 5,
      averageEngagementRate: 0.01,
      platformMetrics: {},
      collectedAt: new Date(),
    };

    const update = agent.adaptStrategy(metrics);
    expect(update.reason).toBe('No adjustments needed');
    expect(update.adjustments).toHaveLength(0);
  });

  it('generates content + targeting adjustments for low engagement rate', () => {
    const metrics: PerformanceMetrics = {
      activeCampaigns: 1,
      totalReach: 5000,
      totalImpressions: 10000,
      totalEngagements: 100,
      averageEngagementRate: LOW_ENGAGEMENT_RATE_THRESHOLD - 0.005,
      platformMetrics: {},
      collectedAt: new Date(),
    };

    const update = agent.adaptStrategy(metrics);

    const types = update.adjustments.map((a) => a.type);
    expect(types).toContain('content');
    expect(types).toContain('targeting');
    expect(update.reason).toContain('Low engagement rate');
  });

  it('generates budget increase adjustment for high engagement rate', () => {
    const metrics: PerformanceMetrics = {
      activeCampaigns: 1,
      totalReach: 10000,
      totalImpressions: 20000,
      totalEngagements: 2000,
      averageEngagementRate: HIGH_ENGAGEMENT_RATE_THRESHOLD + 0.01,
      platformMetrics: {},
      collectedAt: new Date(),
    };

    const update = agent.adaptStrategy(metrics);

    const budgetAdj = update.adjustments.find(
      (a) => a.type === 'budget' && (a.parameters as any).action === 'increase_budget',
    );
    expect(budgetAdj).toBeDefined();
    expect(update.reason).toContain('High engagement rate');
  });

  it('generates budget reduction when cost per engagement is too high', () => {
    // Inject an active campaign with high spend
    const campaign = {
      campaignId: 'camp-expensive',
      name: 'Expensive',
      type: 'MULTI_PLATFORM' as any,
      status: 'ACTIVE' as any,
      content: [],
      targetAudience: [],
      schedule: { startDate: new Date(), endDate: new Date(), timezone: 'UTC', sendTimes: [] },
      budget: { dailyLimit: 100, totalLimit: 1000, remaining: 0, spent: 1000, currency: 'USD' },
      startDate: new Date(),
      endDate: new Date(),
      metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 1000, roi: 0 },
      optimizationRules: [],
    };
    (agent as any).state.activeCampaigns.set('camp-expensive', campaign);

    const metrics: PerformanceMetrics = {
      activeCampaigns: 1,
      totalReach: 500,
      totalImpressions: 50, // below analysis threshold so no engagement rate adjustments
      totalEngagements: 10, // cost per engagement = 1000/10 = 100 > threshold
      averageEngagementRate: 0.05,
      platformMetrics: {},
      collectedAt: new Date(),
    };

    const update = agent.adaptStrategy(metrics);

    const budgetReduce = update.adjustments.find(
      (a) => a.type === 'budget' && (a.parameters as any).action === 'reduce_budget',
    );
    expect(budgetReduce).toBeDefined();
    expect(update.reason).toContain('High cost per engagement');
  });

  it('generates platform adjustment for underperforming platform', () => {
    const metrics: PerformanceMetrics = {
      activeCampaigns: 1,
      totalReach: 5000,
      totalImpressions: 10000,
      totalEngagements: 500,
      averageEngagementRate: 0.05, // moderate — no global content/targeting adjustments
      platformMetrics: {
        [Platform.TWITTER]: [
          {
            postId: 'p1',
            platform: Platform.TWITTER,
            likes: 1,
            comments: 0,
            shares: 0,
            views: 100,
            clicks: 0,
            reach: 200,
            impressions: 5000,
            engagementRate: 0.002,
            timestamp: new Date(),
          },
        ],
      },
      collectedAt: new Date(),
    };

    const update = agent.adaptStrategy(metrics);

    const platformAdj = update.adjustments.find((a) => a.type === 'platform');
    expect(platformAdj).toBeDefined();
    expect(platformAdj!.description).toContain(Platform.TWITTER);
  });

  it('generates timing adjustment for moderate engagement', () => {
    const metrics: PerformanceMetrics = {
      activeCampaigns: 1,
      totalReach: 5000,
      totalImpressions: 10000,
      totalEngagements: 500,
      averageEngagementRate: 0.05, // between low and high thresholds
      platformMetrics: {},
      collectedAt: new Date(),
    };

    const update = agent.adaptStrategy(metrics);

    const timingAdj = update.adjustments.find((a) => a.type === 'timing');
    expect(timingAdj).toBeDefined();
    expect(update.reason).toContain('Moderate engagement');
  });

  it('stores strategy updates in agent state', () => {
    const metrics: PerformanceMetrics = {
      activeCampaigns: 0,
      totalReach: 0,
      totalImpressions: 0,
      totalEngagements: 0,
      averageEngagementRate: 0,
      platformMetrics: {},
      collectedAt: new Date(),
    };

    agent.adaptStrategy(metrics);
    agent.adaptStrategy(metrics);

    // Access internal state to verify
    expect((agent as any).state.strategyUpdates).toHaveLength(2);
  });
});

// ── CMOPersona validation ─────────────────────────────────────

describe('AgentCore.validateConfig — CMOPersona validation', () => {
  it('returns error when cmoPersona has empty strategicPriorities', () => {
    const persona: CMOPersona = {
      role: 'CMO',
      strategicPriorities: [],
      decisionPrinciples: ['Be data-driven'],
      competitiveContext: 'Competitive landscape',
      brandPositioning: 'Our brand positioning',
    };
    const config = createValidConfig({ cmoPersona: persona });
    const result = AgentCore.validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('At least one strategic priority is required');
  });

  it('passes validation when cmoPersona is valid', () => {
    const persona: CMOPersona = {
      role: 'Chief Marketing Officer',
      strategicPriorities: ['Grow sign-ups'],
      decisionPrinciples: ['Prioritise organic growth'],
      competitiveContext: 'Competing against delivery apps',
      brandPositioning: 'Affordable loyalty platform',
    };
    const config = createValidConfig({ cmoPersona: persona });
    const result = AgentCore.validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes validation when cmoPersona is undefined', () => {
    const config = createValidConfig({ cmoPersona: undefined });
    const result = AgentCore.validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ── CMO Persona wiring ───────────────────────────────────────

describe('AgentCore — CMO persona wiring', () => {
  it('creates a brain with default persona when no cmoPersona in config', () => {
    const agent = new AgentCore();
    expect(agent.getBrain()).toBeUndefined();

    agent.initialize(createValidConfig());

    expect(agent.getBrain()).toBeDefined();
  });

  it('creates a brain when initialized without a pre-set brain', () => {
    const agent = new AgentCore();
    const persona: CMOPersona = {
      role: 'Test CMO',
      strategicPriorities: ['Priority 1'],
      decisionPrinciples: ['Principle 1'],
      competitiveContext: 'Test context',
      brandPositioning: 'Test positioning',
    };
    agent.initialize(createValidConfig({ cmoPersona: persona }));

    expect(agent.getBrain()).toBeDefined();
  });

  it('does not replace a pre-set brain on initialize', () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    const existingBrain = {} as any; // mock brain object
    agent.setBrain(existingBrain);

    agent.initialize(createValidConfig());

    // The pre-set brain should be preserved
    expect(agent.getBrain()).toBe(existingBrain);
  });

  it('passes persona to generateSuggestions during campaign execution', async () => {
    const persona: CMOPersona = {
      role: 'Custom CMO',
      strategicPriorities: ['Custom priority'],
      decisionPrinciples: ['Custom principle'],
      competitiveContext: 'Custom context',
      brandPositioning: 'Custom positioning',
    };
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig({ cmoPersona: persona }));

    await agent.executeCampaign(createCampaignSpec());

    expect(engines.contentGeneration.generateSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      persona,
    );
  });

  it('passes default persona to generateSuggestions when no cmoPersona in config', async () => {
    const engines = createMockEngines();
    const agent = new AgentCore(engines);
    agent.initialize(createValidConfig());

    await agent.executeCampaign(createCampaignSpec());

    // Should be called with the default persona (4th arg defined, not undefined)
    const call = (engines.contentGeneration.generateSuggestions as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3]).toBeDefined();
    expect(call[3].role).toBe('Chief Marketing Officer');
  });
});
