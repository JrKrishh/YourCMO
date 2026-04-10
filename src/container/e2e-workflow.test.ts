/**
 * End-to-end campaign workflow integration tests.
 *
 * Tests the complete flow from trend analysis → content generation →
 * visual asset creation → platform posting → optimization, using
 * mocked external services wired through the Container.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from './container';
import { AgentCore } from '../core/agent-core';
import { AgentConfig, Platform, CampaignType, CampaignStatus } from '../models';
import { CampaignSpec } from '../core/types';
import {
  ITrendAnalysisEngine,
  IContentGenerationEngine,
  IVisualAssetCreator,
  IPlatformIntegrationLayer,
  IOptimizationEngine,
  PostResult,
  BoostRecommendation,
  TimeRange,
  RankingCriteria,
} from '../core/interfaces';
import { Trend, ContentSuggestion, VisualAsset, EngagementMetrics, AdCampaign } from '../models';
import { BrandProfile, Budget, OptimizationGoal, VisualSpecs } from '../models/common';
import { TrendLifecyclePhase, AssetType, AdPlatform, AdStatus, ContentTone } from '../models/enums';

// ── Test helpers ──────────────────────────────────────────────────

function makeConfig(): AgentConfig {
  return {
    agentId: 'e2e-agent',
    frameworkType: 'OpenClaw',
    llmProvider: 'OpenAI',
    apiKeys: {},
    brandProfile: { name: 'TestBrand', voice: 'casual', guidelines: [] },
    targetAudience: { ageRange: [18, 45], interests: ['tech', 'marketing'] },
    platforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    budgetLimits: { dailyLimit: 100, totalLimit: 1000, currency: 'USD' },
    optimizationGoals: [{ metric: 'engagementRate', target: 0.05, weight: 1 }],
  };
}

function makeCampaignSpec(overrides?: Partial<CampaignSpec>): CampaignSpec {
  return {
    name: 'E2E Test Campaign',
    platforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    budget: { total: 500, daily: 50, currency: 'USD' },
    brandProfile: { name: 'TestBrand', voice: 'casual', guidelines: [] },
    targetAudience: { ageRange: [18, 45], interests: ['tech'] },
    duration: 7,
    optimizationGoals: [{ metric: 'engagementRate', target: 0.05, weight: 1 }],
    ...overrides,
  };
}

function makeTrend(platform: Platform, topic: string): Trend {
  return {
    trendId: `trend-${topic}`,
    platform,
    topic,
    hashtags: [`#${topic}`],
    engagementScore: 0.6,
    velocity: 0.5,
    timestamp: new Date(),
    relatedContent: [],
    demographics: { ageGroups: {}, genderDistribution: {}, topLocations: [] },
    predictedLifecycle: {
      currentPhase: TrendLifecyclePhase.GROWING,
      estimatedPeakDate: new Date(),
      estimatedEndDate: new Date(),
      confidence: 0.8,
    },
  };
}

function makeSuggestion(text: string): ContentSuggestion {
  return {
    contentId: `content-${Date.now()}`,
    text,
    caption: 'Test caption',
    hashtags: ['#test'],
    callToAction: 'Learn more',
    targetPlatforms: [Platform.INSTAGRAM],
    trendReferences: ['trend-1'],
    tone: ContentTone.CASUAL,
    estimatedEngagement: 0.5,
    visualRequirements: {
      type: 'IMAGE',
      dimensions: { width: 1080, height: 1080 },
      format: 'jpg',
      maxFileSize: 5_000_000,
    },
  };
}

function makeVisualAsset(): VisualAsset {
  return {
    assetId: `asset-${Date.now()}`,
    assetType: AssetType.IMAGE,
    url: 'https://example.com/image.jpg',
    localPath: '/tmp/image.jpg',
    dimensions: { width: 1080, height: 1080 },
    format: 'jpg',
    fileSize: 500_000,
    duration: 0,
    platform: Platform.INSTAGRAM,
    metadata: { altText: 'Test image', createdAt: new Date(), tags: [] },
    brandingApplied: true,
  };
}

// ── Mock implementations ──────────────────────────────────────────

class MockTrendAnalysis implements ITrendAnalysisEngine {
  fetchTrendsCalled = false;
  rankTrendsCalled = false;

  async fetchTrends(platforms: Platform[]): Promise<Trend[]> {
    this.fetchTrendsCalled = true;
    return platforms.map((p) => makeTrend(p, 'ai-marketing'));
  }

  rankTrends(trends: Trend[]): Trend[] {
    this.rankTrendsCalled = true;
    return [...trends].sort((a, b) => b.engagementScore - a.engagementScore);
  }
}

class MockContentGeneration implements IContentGenerationEngine {
  generateCalled = false;
  adaptCalled = false;

  async generateSuggestions(): Promise<ContentSuggestion[]> {
    this.generateCalled = true;
    return [makeSuggestion('Check out the latest AI marketing trends!')];
  }

  adaptToPlatform(content: ContentSuggestion, platform: Platform) {
    this.adaptCalled = true;
    return {
      contentId: content.contentId,
      platform,
      text: content.text,
      visualAssets: [],
      hashtags: content.hashtags,
      mentions: [],
    };
  }
}

class MockVisualAssetCreator implements IVisualAssetCreator {
  generateImageCalled = false;

  async generateImage(): Promise<VisualAsset> {
    this.generateImageCalled = true;
    return makeVisualAsset();
  }

  async generateVideo(): Promise<VisualAsset> {
    return { ...makeVisualAsset(), assetType: AssetType.VIDEO };
  }

  async addBranding(asset: VisualAsset): Promise<VisualAsset> {
    return { ...asset, brandingApplied: true };
  }
}

class MockPlatformIntegration implements IPlatformIntegrationLayer {
  postedPlatforms: Platform[] = [];

  async postContent(platform: Platform): Promise<PostResult> {
    this.postedPlatforms.push(platform);
    return { postId: `post-${platform}`, platform, success: true, url: `https://${platform}/post` };
  }
}

class MockOptimization implements IOptimizationEngine {
  analyzeCalled = false;
  boostCalled = false;
  adCreated = false;

  async analyzeEngagement(postId: string, platform: Platform): Promise<EngagementMetrics> {
    this.analyzeCalled = true;
    return {
      postId,
      platform,
      likes: 100,
      comments: 20,
      shares: 10,
      views: 5000,
      clicks: 50,
      reach: 3000,
      impressions: 8000,
      engagementRate: 0.06,
      timestamp: new Date(),
    };
  }

  async recommendBoost(
    metrics: EngagementMetrics,
    budget: Budget,
  ): Promise<BoostRecommendation | null> {
    this.boostCalled = true;
    if (budget.remaining <= 0) return null;
    return {
      postId: metrics.postId,
      platform: metrics.platform,
      recommendedBudget: 50,
      expectedRoi: 2.5,
      targeting: { optimizeFor: 'engagement' },
    };
  }

  async createAdCampaign(): Promise<AdCampaign> {
    this.adCreated = true;
    return {
      adCampaignId: 'ad-1',
      platform: AdPlatform.INSTAGRAM_ADS,
      content: {
        contentId: 'c1',
        platform: Platform.INSTAGRAM,
        text: '',
        visualAssets: [],
        hashtags: [],
        mentions: [],
      },
      targeting: {},
      budget: { dailyLimit: 50, totalLimit: 50, remaining: 50, spent: 0, currency: 'USD' },
      bidStrategy: { type: 'CPC' },
      startDate: new Date(),
      endDate: new Date(),
      status: AdStatus.DRAFT,
      performance: { impressions: 0, clicks: 0, conversions: 0, spend: 0, cpc: 0, cpm: 0, ctr: 0, roi: 0 },
    };
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('End-to-end campaign workflow', () => {
  let agent: AgentCore;
  let trendMock: MockTrendAnalysis;
  let contentMock: MockContentGeneration;
  let visualMock: MockVisualAssetCreator;
  let platformMock: MockPlatformIntegration;
  let optimizationMock: MockOptimization;

  beforeEach(() => {
    trendMock = new MockTrendAnalysis();
    contentMock = new MockContentGeneration();
    visualMock = new MockVisualAssetCreator();
    platformMock = new MockPlatformIntegration();
    optimizationMock = new MockOptimization();

    agent = new AgentCore({
      trendAnalysis: trendMock,
      contentGeneration: contentMock,
      visualAssetCreator: visualMock,
      platformIntegration: platformMock,
      optimization: optimizationMock,
    });
    agent.initialize(makeConfig());
  });

  it('executes full campaign: trends → content → assets → post → optimize', async () => {
    const result = await agent.executeCampaign(makeCampaignSpec());

    // All pipeline stages were invoked
    expect(trendMock.fetchTrendsCalled).toBe(true);
    expect(trendMock.rankTrendsCalled).toBe(true);
    expect(contentMock.generateCalled).toBe(true);
    expect(contentMock.adaptCalled).toBe(true);
    expect(visualMock.generateImageCalled).toBe(true);
    expect(platformMock.postedPlatforms).toContain(Platform.INSTAGRAM);
    expect(platformMock.postedPlatforms).toContain(Platform.FACEBOOK);
    expect(optimizationMock.analyzeCalled).toBe(true);
    expect(optimizationMock.boostCalled).toBe(true);
    expect(optimizationMock.adCreated).toBe(true);

    // Campaign completed successfully
    expect(result.status).toBe('completed');
    expect(result.totalPosts).toBe(2);
    expect(result.platforms).toEqual([Platform.INSTAGRAM, Platform.FACEBOOK]);
    expect(result.errors).toHaveLength(0);
  });

  it('handles WhatsApp campaign execution via CampaignManager', () => {
    const container = new Container();
    container.initializeWithConfig(makeConfig());

    const campaign = container.campaignManager.createCampaign({
      name: 'WhatsApp Promo',
      type: CampaignType.WHATSAPP,
    });

    expect(campaign.campaignId).toBeDefined();
    expect(campaign.type).toBe(CampaignType.WHATSAPP);
    expect(campaign.status).toBe(CampaignStatus.DRAFT);

    // Transition to active
    const active = container.campaignManager.transitionStatus(
      campaign.campaignId,
      CampaignStatus.ACTIVE,
    );
    expect(active.status).toBe(CampaignStatus.ACTIVE);
  });

  it('handles ad campaign creation through optimization engine', async () => {
    const result = await agent.executeCampaign(makeCampaignSpec());

    // Optimization engine was called for each successful post
    expect(optimizationMock.analyzeCalled).toBe(true);
    expect(optimizationMock.adCreated).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('degrades gracefully when trend analysis fails', async () => {
    trendMock.fetchTrends = async () => {
      throw new Error('API rate limited');
    };

    const result = await agent.executeCampaign(makeCampaignSpec());

    // Campaign still completes (with errors) — no posts since no trends
    expect(result.status).toBe('failed');
    expect(result.errors.some((e) => e.includes('Trend analysis failed'))).toBe(true);
  });

  it('degrades gracefully when posting fails for one platform', async () => {
    let callCount = 0;
    platformMock.postContent = async (platform: Platform) => {
      callCount++;
      if (platform === Platform.FACEBOOK) {
        return { postId: '', platform, success: false, error: 'Auth expired' };
      }
      return { postId: `post-${platform}`, platform, success: true };
    };

    const result = await agent.executeCampaign(makeCampaignSpec());

    expect(result.status).toBe('partial');
    expect(result.totalPosts).toBe(1);
    expect(result.errors.some((e) => e.includes('FACEBOOK'))).toBe(true);
  });
});
