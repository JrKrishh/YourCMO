import { describe, it, expect, vi } from 'vitest';
import { Platform, TrendLifecyclePhase } from '../../models/enums';
import { Trend } from '../../models/trend';
import { RankingCriteria, TimeRange } from '../../core/interfaces';
import { BaseApiClient, RawTrendingTopic } from './base-api-client';
import {
  TrendAnalysisEngine,
  parseTrend,
  calculateEngagementScore,
  calculateVelocity,
  calculateRelevance,
  predictTrendLifecycle,
  analyzeTrend,
} from './trend-analysis-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrend(overrides: Partial<Trend> = {}): Trend {
  return {
    trendId: 'test-id',
    platform: Platform.TWITTER,
    topic: 'tech',
    hashtags: ['#tech', '#ai'],
    engagementScore: 0.5,
    velocity: 0.5,
    timestamp: new Date(),
    relatedContent: [],
    demographics: { ageGroups: {}, genderDistribution: {}, topLocations: [] },
    predictedLifecycle: {
      currentPhase: TrendLifecyclePhase.GROWING,
      estimatedPeakDate: new Date(),
      estimatedEndDate: new Date(),
      confidence: 0.5,
    },
    ...overrides,
  };
}

/** Stub platform client that returns pre-configured raw topics */
function createStubClient(topics: RawTrendingTopic[]): BaseApiClient {
  return {
    fetchTrendingTopics: vi.fn().mockResolvedValue(topics),
  } as unknown as BaseApiClient;
}

// ---------------------------------------------------------------------------
// parseTrend
// ---------------------------------------------------------------------------

describe('parseTrend', () => {
  it('converts a RawTrendingTopic into a Trend with defaults', () => {
    const raw: RawTrendingTopic = {
      name: 'AI revolution',
      volume: 5000,
      hashtags: ['#ai', '#ml'],
    };
    const trend = parseTrend(raw, Platform.TWITTER);

    expect(trend.topic).toBe('AI revolution');
    expect(trend.platform).toBe(Platform.TWITTER);
    expect(trend.hashtags).toEqual(['#ai', '#ml']);
    expect(trend.engagementScore).toBe(0);
    expect(trend.velocity).toBe(0);
    expect(trend.trendId).toBeTruthy();
  });

  it('handles missing optional fields', () => {
    const raw: RawTrendingTopic = { name: 'minimal' };
    const trend = parseTrend(raw, Platform.FACEBOOK);

    expect(trend.hashtags).toEqual([]);
    expect(trend.relatedContent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calculateEngagementScore
// ---------------------------------------------------------------------------

describe('calculateEngagementScore', () => {
  it('returns 0 for zero volume', () => {
    expect(calculateEngagementScore(0)).toBe(0);
  });

  it('returns 0 for negative volume', () => {
    expect(calculateEngagementScore(-100)).toBe(0);
  });

  it('returns a value between 0 and 1 for positive volume', () => {
    const score = calculateEngagementScore(50000);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('caps at 1 for very large volumes', () => {
    expect(calculateEngagementScore(10_000_000)).toBe(1);
  });

  it('increases monotonically with volume', () => {
    const s1 = calculateEngagementScore(100);
    const s2 = calculateEngagementScore(10000);
    const s3 = calculateEngagementScore(500000);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });
});

// ---------------------------------------------------------------------------
// calculateVelocity
// ---------------------------------------------------------------------------

describe('calculateVelocity', () => {
  it('returns 0 for zero volume', () => {
    expect(calculateVelocity(0, 24)).toBe(0);
  });

  it('returns 0 for zero time window', () => {
    expect(calculateVelocity(1000, 0)).toBe(0);
  });

  it('returns a value between 0 and 1', () => {
    const v = calculateVelocity(5000, 10);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('caps at 1 for very high rate', () => {
    expect(calculateVelocity(100000, 1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// calculateRelevance
// ---------------------------------------------------------------------------

describe('calculateRelevance', () => {
  it('returns 0 when audience interests are empty', () => {
    const trend = makeTrend();
    expect(calculateRelevance(trend, [], [18, 35])).toBe(0);
  });

  it('returns higher score when interests match trend topic', () => {
    const trend = makeTrend({ topic: 'technology trends', hashtags: ['#tech'] });
    const high = calculateRelevance(trend, ['tech'], [18, 35]);
    const low = calculateRelevance(trend, ['cooking'], [18, 35]);
    expect(high).toBeGreaterThan(low);
  });

  it('accounts for age range overlap in demographics', () => {
    const trend = makeTrend({
      topic: 'fashion',
      hashtags: ['#fashion'],
      demographics: {
        ageGroups: { '18-24': 60, '25-34': 30, '55-64': 10 },
        genderDistribution: {},
        topLocations: [],
      },
    });
    const youngAudience = calculateRelevance(trend, ['fashion'], [18, 30]);
    const olderAudience = calculateRelevance(trend, ['fashion'], [50, 65]);
    expect(youngAudience).toBeGreaterThan(olderAudience);
  });
});

// ---------------------------------------------------------------------------
// predictTrendLifecycle
// ---------------------------------------------------------------------------

describe('predictTrendLifecycle', () => {
  it('predicts EMERGING for high velocity, low engagement', () => {
    const trend = makeTrend({ velocity: 0.8, engagementScore: 0.1 });
    const lc = predictTrendLifecycle(trend);
    expect(lc.currentPhase).toBe(TrendLifecyclePhase.EMERGING);
  });

  it('predicts GROWING for moderate velocity and engagement', () => {
    const trend = makeTrend({ velocity: 0.6, engagementScore: 0.5 });
    const lc = predictTrendLifecycle(trend);
    expect(lc.currentPhase).toBe(TrendLifecyclePhase.GROWING);
  });

  it('predicts PEAKING for high engagement', () => {
    const trend = makeTrend({ velocity: 0.3, engagementScore: 0.8 });
    const lc = predictTrendLifecycle(trend);
    expect(lc.currentPhase).toBe(TrendLifecyclePhase.PEAKING);
  });

  it('predicts DECLINING for low velocity with moderate engagement', () => {
    const trend = makeTrend({ velocity: 0.1, engagementScore: 0.5 });
    const lc = predictTrendLifecycle(trend);
    expect(lc.currentPhase).toBe(TrendLifecyclePhase.DECLINING);
  });

  it('predicts EXPIRED for low velocity and low engagement', () => {
    const trend = makeTrend({ velocity: 0.1, engagementScore: 0.1 });
    const lc = predictTrendLifecycle(trend);
    expect(lc.currentPhase).toBe(TrendLifecyclePhase.EXPIRED);
  });

  it('returns estimated dates in the future', () => {
    const trend = makeTrend({ velocity: 0.8, engagementScore: 0.1 });
    const lc = predictTrendLifecycle(trend);
    const now = new Date();
    expect(lc.estimatedPeakDate.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(lc.estimatedEndDate.getTime()).toBeGreaterThan(lc.estimatedPeakDate.getTime());
  });

  it('returns confidence between 0 and 1', () => {
    const trend = makeTrend({ velocity: 0.5, engagementScore: 0.5 });
    const lc = predictTrendLifecycle(trend);
    expect(lc.confidence).toBeGreaterThan(0);
    expect(lc.confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// analyzeTrend
// ---------------------------------------------------------------------------

describe('analyzeTrend', () => {
  it('populates engagement score, velocity, and lifecycle', () => {
    const trend = makeTrend({ engagementScore: 0, velocity: 0 });
    const result = analyzeTrend(trend, 50000, 24);

    expect(result.engagementScore).toBeGreaterThan(0);
    expect(result.velocity).toBeGreaterThan(0);
    expect(result.predictedLifecycle.currentPhase).toBeDefined();
  });

  it('returns the same trend object (mutated)', () => {
    const trend = makeTrend();
    const result = analyzeTrend(trend, 1000, 10);
    expect(result).toBe(trend);
  });
});

// ---------------------------------------------------------------------------
// TrendAnalysisEngine.fetchTrends
// ---------------------------------------------------------------------------

describe('TrendAnalysisEngine.fetchTrends', () => {
  const timeWindow: TimeRange = {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: new Date(),
  };

  it('fetches and parses trends from multiple platforms', async () => {
    const rawTopics: RawTrendingTopic[] = [
      { name: 'AI', volume: 80000, hashtags: ['#ai'] },
      { name: 'Web3', volume: 30000, hashtags: ['#web3'] },
    ];

    const factory = vi.fn().mockReturnValue(createStubClient(rawTopics));
    const engine = new TrendAnalysisEngine(factory);

    const trends = await engine.fetchTrends(
      [Platform.TWITTER, Platform.INSTAGRAM],
      timeWindow,
    );

    expect(factory).toHaveBeenCalledTimes(2);
    expect(trends).toHaveLength(4); // 2 topics × 2 platforms
    expect(trends[0].engagementScore).toBeGreaterThan(0);
    expect(trends[0].velocity).toBeGreaterThan(0);
  });

  it('continues when a platform fails', async () => {
    const failClient = {
      fetchTrendingTopics: vi.fn().mockRejectedValue(new Error('API down')),
    } as unknown as BaseApiClient;

    const okClient = createStubClient([{ name: 'ok', volume: 100 }]);

    const factory = vi.fn()
      .mockReturnValueOnce(failClient)
      .mockReturnValueOnce(okClient);

    const engine = new TrendAnalysisEngine(factory);
    const trends = await engine.fetchTrends(
      [Platform.TWITTER, Platform.INSTAGRAM],
      timeWindow,
    );

    expect(trends).toHaveLength(1);
    expect(trends[0].topic).toBe('ok');
  });

  it('returns empty array when all platforms fail', async () => {
    const failClient = {
      fetchTrendingTopics: vi.fn().mockRejectedValue(new Error('fail')),
    } as unknown as BaseApiClient;

    const engine = new TrendAnalysisEngine(() => failClient);
    const trends = await engine.fetchTrends([Platform.TWITTER], timeWindow);

    expect(trends).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TrendAnalysisEngine.rankTrends
// ---------------------------------------------------------------------------

describe('TrendAnalysisEngine.rankTrends', () => {
  const criteria: RankingCriteria = {
    audienceInterests: ['tech'],
    audienceAgeRange: [18, 35],
    engagementWeight: 0.4,
    velocityWeight: 0.35,
    relevanceWeight: 0.25,
  };

  it('sorts trends by composite score descending', () => {
    const engine = new TrendAnalysisEngine();

    const low = makeTrend({ trendId: 'low', engagementScore: 0.1, velocity: 0.1, topic: 'cooking' });
    const high = makeTrend({ trendId: 'high', engagementScore: 0.9, velocity: 0.8, topic: 'tech news' });
    const mid = makeTrend({ trendId: 'mid', engagementScore: 0.5, velocity: 0.4, topic: 'tech' });

    const ranked = engine.rankTrends([low, high, mid], criteria);

    expect(ranked[0].trendId).toBe('high');
    expect(ranked[ranked.length - 1].trendId).toBe('low');
  });

  it('returns same number of trends as input', () => {
    const engine = new TrendAnalysisEngine();
    const trends = [makeTrend(), makeTrend(), makeTrend()];
    const ranked = engine.rankTrends(trends, criteria);
    expect(ranked).toHaveLength(3);
  });

  it('handles empty trends list', () => {
    const engine = new TrendAnalysisEngine();
    const ranked = engine.rankTrends([], criteria);
    expect(ranked).toEqual([]);
  });

  it('uses relevance to break ties', () => {
    const engine = new TrendAnalysisEngine();

    const relevant = makeTrend({
      trendId: 'relevant',
      engagementScore: 0.5,
      velocity: 0.5,
      topic: 'tech innovation',
      hashtags: ['#tech'],
    });
    const irrelevant = makeTrend({
      trendId: 'irrelevant',
      engagementScore: 0.5,
      velocity: 0.5,
      topic: 'gardening tips',
      hashtags: ['#garden'],
    });

    const ranked = engine.rankTrends([irrelevant, relevant], criteria);
    expect(ranked[0].trendId).toBe('relevant');
  });
});
