import { createLogger } from '../../utils/logger';
import { EngagementMetrics } from '../../models/engagement-metrics';
import { Budget, OptimizationGoal } from '../../models/common';
import { BoostRecommendation } from '../../core/interfaces';

const logger = createLogger('BoostRecommender');

/**
 * Configuration for the boost recommender thresholds and weights.
 */
export interface BoostRecommenderConfig {
  /** Minimum engagement rate to consider a post for boosting (default: 0.02 = 2%) */
  engagementRateThreshold: number;
  /** Minimum reach to consider a post for boosting (default: 100) */
  minReach: number;
  /** Minimum budget remaining to recommend a boost (default: 10) */
  minBudgetForBoost: number;
  /** Maximum fraction of remaining budget to allocate to a single boost (default: 0.5) */
  maxBudgetFraction: number;
  /** Weight for engagement rate in performance score (default: 0.4) */
  engagementRateWeight: number;
  /** Weight for reach in performance score (default: 0.3) */
  reachWeight: number;
  /** Weight for engagement velocity in performance score (default: 0.3) */
  velocityWeight: number;
}

const DEFAULT_CONFIG: BoostRecommenderConfig = {
  engagementRateThreshold: 0.02,
  minReach: 100,
  minBudgetForBoost: 10,
  maxBudgetFraction: 0.5,
  engagementRateWeight: 0.4,
  reachWeight: 0.3,
  velocityWeight: 0.3,
};

/**
 * Calculates a performance score for a post based on its engagement metrics.
 *
 * The score is a weighted combination of:
 * - Normalized engagement rate (capped at 1.0, divided by a baseline of 0.10)
 * - Normalized reach (capped at 1.0, divided by a baseline of 10,000)
 * - Engagement velocity: total interactions relative to impressions, weighted by reach
 *
 * Returns a value in [0, 1].
 */
export function calculatePerformanceScore(
  metrics: EngagementMetrics,
  config: BoostRecommenderConfig = DEFAULT_CONFIG,
): number {
  // Normalize engagement rate against a baseline of 10%
  const normalizedEngagement = Math.min(metrics.engagementRate / 0.10, 1.0);

  // Normalize reach against a baseline of 10,000
  const normalizedReach = Math.min(metrics.reach / 10_000, 1.0);

  // Velocity: how fast interactions accumulate relative to impressions, scaled by reach
  const totalInteractions = metrics.likes + metrics.comments + metrics.shares + metrics.clicks;
  const velocity =
    metrics.impressions > 0
      ? Math.min((totalInteractions / metrics.impressions) * (metrics.reach / 10_000), 1.0)
      : 0;

  const score =
    normalizedEngagement * config.engagementRateWeight +
    normalizedReach * config.reachWeight +
    velocity * config.velocityWeight;

  return Math.min(Math.max(score, 0), 1);
}

/**
 * Estimates the expected ROI for boosting a post.
 *
 * The estimate is based on:
 * - Current engagement rate (higher organic engagement → better paid performance)
 * - Performance score (composite quality signal)
 * - Optimization goal alignment bonus
 *
 * Returns a multiplier (e.g. 2.5 means $2.50 return per $1 spent).
 */
export function calculateExpectedRoi(
  metrics: EngagementMetrics,
  performanceScore: number,
  goals: OptimizationGoal[],
): number {
  // Base ROI estimate from engagement rate (organic engagement is a strong predictor)
  const baseRoi = 1.0 + metrics.engagementRate * 20; // e.g. 5% engagement → 2.0x base

  // Performance multiplier: high-performing posts convert better
  const performanceMultiplier = 0.5 + performanceScore; // range [0.5, 1.5]

  // Goal alignment bonus: if goals target engagement-related metrics, boost ROI estimate
  let goalBonus = 1.0;
  for (const goal of goals) {
    const metric = goal.metric.toLowerCase();
    if (metric === 'engagement' || metric === 'clicks' || metric === 'reach') {
      goalBonus += 0.1 * goal.weight;
    }
  }

  return baseRoi * performanceMultiplier * goalBonus;
}

/**
 * Determines whether a post meets the threshold for boosting.
 */
export function meetsBoostThreshold(
  metrics: EngagementMetrics,
  config: BoostRecommenderConfig = DEFAULT_CONFIG,
): boolean {
  return (
    metrics.engagementRate >= config.engagementRateThreshold &&
    metrics.reach >= config.minReach
  );
}

/**
 * Calculates the recommended budget for a boost based on performance and available budget.
 */
function calculateRecommendedBudget(
  performanceScore: number,
  budget: Budget,
  config: BoostRecommenderConfig,
): number {
  const maxAllocation = budget.remaining * config.maxBudgetFraction;
  // Scale allocation by performance score — better posts get more budget
  const allocation = maxAllocation * performanceScore;
  // Ensure at least the minimum budget if we're recommending at all
  return Math.max(Math.round(allocation * 100) / 100, config.minBudgetForBoost);
}

/**
 * Builds basic targeting parameters from the engagement metrics.
 */
function buildTargeting(metrics: EngagementMetrics): Record<string, unknown> {
  return {
    platform: metrics.platform,
    postId: metrics.postId,
    optimizeFor: 'engagement',
  };
}

/**
 * BoostRecommender analyzes engagement metrics and recommends whether
 * to boost a post with paid advertising.
 *
 * It uses a performance scoring algorithm, ROI estimation, and
 * configurable thresholds to make data-driven boost decisions.
 */
export class BoostRecommender {
  private readonly config: BoostRecommenderConfig;

  constructor(config?: Partial<BoostRecommenderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze engagement metrics and recommend whether to boost a post.
   *
   * Returns a BoostRecommendation if the post meets the boost threshold
   * and the budget is sufficient. Returns null otherwise.
   */
  recommendBoost(
    metrics: EngagementMetrics,
    budget: Budget,
    goals: OptimizationGoal[] = [],
  ): BoostRecommendation | null {
    logger.info({ postId: metrics.postId, platform: metrics.platform }, 'Evaluating post for boost');

    // Check budget sufficiency
    if (budget.remaining < this.config.minBudgetForBoost) {
      logger.info({ remaining: budget.remaining }, 'Insufficient budget for boost');
      return null;
    }

    // Check boost threshold
    if (!meetsBoostThreshold(metrics, this.config)) {
      logger.info(
        {
          engagementRate: metrics.engagementRate,
          reach: metrics.reach,
          threshold: this.config.engagementRateThreshold,
          minReach: this.config.minReach,
        },
        'Post does not meet boost threshold',
      );
      return null;
    }

    // Calculate performance score
    const performanceScore = calculatePerformanceScore(metrics, this.config);

    // Calculate expected ROI
    const expectedRoi = calculateExpectedRoi(metrics, performanceScore, goals);

    // Calculate recommended budget
    const recommendedBudget = calculateRecommendedBudget(performanceScore, budget, this.config);

    // Ensure recommended budget doesn't exceed remaining
    const finalBudget = Math.min(recommendedBudget, budget.remaining);

    const recommendation: BoostRecommendation = {
      postId: metrics.postId,
      platform: metrics.platform,
      recommendedBudget: finalBudget,
      expectedRoi,
      targeting: buildTargeting(metrics),
    };

    logger.info(
      { postId: metrics.postId, performanceScore, expectedRoi, recommendedBudget: finalBudget },
      'Boost recommended',
    );

    return recommendation;
  }
}
