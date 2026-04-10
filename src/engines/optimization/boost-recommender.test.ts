import { describe, it, expect } from 'vitest';
import {
  BoostRecommender,
  BoostRecommenderConfig,
  calculatePerformanceScore,
  calculateExpectedRoi,
  meetsBoostThreshold,
} from './boost-recommender';
import { EngagementMetrics } from '../../models/engagement-metrics';
import { Budget, OptimizationGoal } from '../../models/common';
import { Platform } from '../../models/enums';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<EngagementMetrics> = {}): EngagementMetrics {
  return {
    postId: 'post-1',
    platform: Platform.INSTAGRAM,
    likes: 200,
    comments: 50,
    shares: 30,
    views: 2000,
    clicks: 80,
    reach: 1500,
    impressions: 5000,
    engagementRate: 0.072, // (200+50+30+80)/5000
    timestamp: new Date(),
    ...overrides,
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

function makeGoals(goals: Partial<OptimizationGoal>[] = []): OptimizationGoal[] {
  return goals.map((g) => ({
    metric: g.metric ?? 'engagement',
    target: g.target ?? 0.05,
    weight: g.weight ?? 1.0,
  }));
}

// ---------------------------------------------------------------------------
// calculatePerformanceScore
// ---------------------------------------------------------------------------

describe('calculatePerformanceScore', () => {
  it('returns a value between 0 and 1', () => {
    const score = calculatePerformanceScore(makeMetrics());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 for a post with zero engagement and zero reach', () => {
    const metrics = makeMetrics({
      likes: 0,
      comments: 0,
      shares: 0,
      clicks: 0,
      reach: 0,
      impressions: 1000,
      engagementRate: 0,
    });
    expect(calculatePerformanceScore(metrics)).toBe(0);
  });

  it('returns higher score for higher engagement rate', () => {
    const low = calculatePerformanceScore(makeMetrics({ engagementRate: 0.01 }));
    const high = calculatePerformanceScore(makeMetrics({ engagementRate: 0.08 }));
    expect(high).toBeGreaterThan(low);
  });

  it('returns higher score for higher reach', () => {
    const low = calculatePerformanceScore(makeMetrics({ reach: 100 }));
    const high = calculatePerformanceScore(makeMetrics({ reach: 5000 }));
    expect(high).toBeGreaterThan(low);
  });

  it('caps at 1 for extremely high metrics', () => {
    const metrics = makeMetrics({
      engagementRate: 0.5,
      reach: 50_000,
      likes: 10000,
      comments: 5000,
      shares: 3000,
      clicks: 2000,
      impressions: 10000,
    });
    expect(calculatePerformanceScore(metrics)).toBeLessThanOrEqual(1);
  });

  it('handles zero impressions gracefully (velocity = 0)', () => {
    const metrics = makeMetrics({ impressions: 0, engagementRate: 0.05, reach: 500 });
    const score = calculatePerformanceScore(metrics);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// calculateExpectedRoi
// ---------------------------------------------------------------------------

describe('calculateExpectedRoi', () => {
  it('returns a positive ROI for a post with engagement', () => {
    const roi = calculateExpectedRoi(makeMetrics(), 0.5, []);
    expect(roi).toBeGreaterThan(0);
  });

  it('returns higher ROI for higher engagement rate', () => {
    const lowRoi = calculateExpectedRoi(makeMetrics({ engagementRate: 0.01 }), 0.5, []);
    const highRoi = calculateExpectedRoi(makeMetrics({ engagementRate: 0.10 }), 0.5, []);
    expect(highRoi).toBeGreaterThan(lowRoi);
  });

  it('returns higher ROI for higher performance score', () => {
    const metrics = makeMetrics();
    const lowRoi = calculateExpectedRoi(metrics, 0.2, []);
    const highRoi = calculateExpectedRoi(metrics, 0.9, []);
    expect(highRoi).toBeGreaterThan(lowRoi);
  });

  it('adds goal alignment bonus for engagement-related goals', () => {
    const metrics = makeMetrics();
    const noGoals = calculateExpectedRoi(metrics, 0.5, []);
    const withGoals = calculateExpectedRoi(metrics, 0.5, makeGoals([{ metric: 'engagement', weight: 1.0 }]));
    expect(withGoals).toBeGreaterThan(noGoals);
  });

  it('does not add bonus for non-engagement goals', () => {
    const metrics = makeMetrics();
    const noGoals = calculateExpectedRoi(metrics, 0.5, []);
    const withGoals = calculateExpectedRoi(metrics, 0.5, makeGoals([{ metric: 'brand_awareness', weight: 1.0 }]));
    expect(withGoals).toBe(noGoals);
  });
});

// ---------------------------------------------------------------------------
// meetsBoostThreshold
// ---------------------------------------------------------------------------

describe('meetsBoostThreshold', () => {
  it('returns true when engagement rate and reach are above thresholds', () => {
    expect(meetsBoostThreshold(makeMetrics({ engagementRate: 0.05, reach: 500 }))).toBe(true);
  });

  it('returns false when engagement rate is below threshold', () => {
    expect(meetsBoostThreshold(makeMetrics({ engagementRate: 0.01, reach: 500 }))).toBe(false);
  });

  it('returns false when reach is below threshold', () => {
    expect(meetsBoostThreshold(makeMetrics({ engagementRate: 0.05, reach: 50 }))).toBe(false);
  });

  it('returns false when both are below threshold', () => {
    expect(meetsBoostThreshold(makeMetrics({ engagementRate: 0.005, reach: 10 }))).toBe(false);
  });

  it('respects custom config thresholds', () => {
    const config: BoostRecommenderConfig = {
      engagementRateThreshold: 0.10,
      minReach: 1000,
      minBudgetForBoost: 10,
      maxBudgetFraction: 0.5,
      engagementRateWeight: 0.4,
      reachWeight: 0.3,
      velocityWeight: 0.3,
    };
    // Below custom thresholds
    expect(meetsBoostThreshold(makeMetrics({ engagementRate: 0.05, reach: 500 }), config)).toBe(false);
    // Above custom thresholds
    expect(meetsBoostThreshold(makeMetrics({ engagementRate: 0.12, reach: 1500 }), config)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BoostRecommender.recommendBoost
// ---------------------------------------------------------------------------

describe('BoostRecommender', () => {
  describe('recommendBoost', () => {
    it('returns a BoostRecommendation for a post that meets thresholds', () => {
      const recommender = new BoostRecommender();
      const result = recommender.recommendBoost(makeMetrics(), makeBudget());

      expect(result).not.toBeNull();
      expect(result!.postId).toBe('post-1');
      expect(result!.platform).toBe(Platform.INSTAGRAM);
      expect(result!.recommendedBudget).toBeGreaterThan(0);
      expect(result!.expectedRoi).toBeGreaterThan(0);
      expect(result!.targeting).toBeDefined();
    });

    it('returns null when budget is insufficient', () => {
      const recommender = new BoostRecommender();
      const result = recommender.recommendBoost(makeMetrics(), makeBudget({ remaining: 5 }));
      expect(result).toBeNull();
    });

    it('returns null when engagement rate is below threshold', () => {
      const recommender = new BoostRecommender();
      const result = recommender.recommendBoost(
        makeMetrics({ engagementRate: 0.001, reach: 500 }),
        makeBudget(),
      );
      expect(result).toBeNull();
    });

    it('returns null when reach is below threshold', () => {
      const recommender = new BoostRecommender();
      const result = recommender.recommendBoost(
        makeMetrics({ engagementRate: 0.05, reach: 10 }),
        makeBudget(),
      );
      expect(result).toBeNull();
    });

    it('recommended budget does not exceed remaining budget', () => {
      const recommender = new BoostRecommender();
      const budget = makeBudget({ remaining: 15 });
      const result = recommender.recommendBoost(makeMetrics(), budget);

      expect(result).not.toBeNull();
      expect(result!.recommendedBudget).toBeLessThanOrEqual(budget.remaining);
    });

    it('uses custom config thresholds', () => {
      const recommender = new BoostRecommender({ engagementRateThreshold: 0.10 });
      // 7.2% engagement rate is below the custom 10% threshold
      const result = recommender.recommendBoost(makeMetrics(), makeBudget());
      expect(result).toBeNull();
    });

    it('includes targeting information in the recommendation', () => {
      const recommender = new BoostRecommender();
      const result = recommender.recommendBoost(makeMetrics(), makeBudget());

      expect(result).not.toBeNull();
      expect(result!.targeting).toHaveProperty('platform', Platform.INSTAGRAM);
      expect(result!.targeting).toHaveProperty('postId', 'post-1');
      expect(result!.targeting).toHaveProperty('optimizeFor', 'engagement');
    });

    it('factors in optimization goals for ROI calculation', () => {
      const recommender = new BoostRecommender();
      const metrics = makeMetrics();
      const budget = makeBudget();

      const withoutGoals = recommender.recommendBoost(metrics, budget);
      const withGoals = recommender.recommendBoost(
        metrics,
        budget,
        makeGoals([{ metric: 'engagement', weight: 1.0 }]),
      );

      expect(withoutGoals).not.toBeNull();
      expect(withGoals).not.toBeNull();
      expect(withGoals!.expectedRoi).toBeGreaterThan(withoutGoals!.expectedRoi);
    });

    it('returns null when budget remaining is exactly 0', () => {
      const recommender = new BoostRecommender();
      const result = recommender.recommendBoost(makeMetrics(), makeBudget({ remaining: 0 }));
      expect(result).toBeNull();
    });

    it('handles edge case of engagement rate exactly at threshold', () => {
      const recommender = new BoostRecommender({ engagementRateThreshold: 0.02 });
      const result = recommender.recommendBoost(
        makeMetrics({ engagementRate: 0.02, reach: 200 }),
        makeBudget(),
      );
      expect(result).not.toBeNull();
    });
  });
});
