import { v4 as uuidv4 } from 'uuid';
import { Platform, TrendLifecyclePhase } from '../../models/enums';
import { Trend } from '../../models/trend';
import { TrendLifecycle } from '../../models/common';
import { ITrendAnalysisEngine, TimeRange, RankingCriteria } from '../../core/interfaces';
import { BaseApiClient, RawTrendingTopic } from './base-api-client';
import { createPlatformClient } from './platform-client-factory';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TrendAnalysisEngine');

/** Default weights for composite scoring */
const DEFAULT_ENGAGEMENT_WEIGHT = 0.4;
const DEFAULT_VELOCITY_WEIGHT = 0.35;
const DEFAULT_RELEVANCE_WEIGHT = 0.25;

/**
 * Converts a RawTrendingTopic from a platform API into a Trend model object.
 */
export function parseTrend(raw: RawTrendingTopic, platform: Platform): Trend {
  return {
    trendId: uuidv4(),
    platform,
    topic: raw.name,
    hashtags: raw.hashtags ?? [],
    engagementScore: 0,
    velocity: 0,
    timestamp: new Date(),
    relatedContent: [],
    demographics: {
      ageGroups: {},
      genderDistribution: {},
      topLocations: [],
    },
    predictedLifecycle: {
      currentPhase: TrendLifecyclePhase.EMERGING,
      estimatedPeakDate: new Date(),
      estimatedEndDate: new Date(),
      confidence: 0,
    },
  };
}

/**
 * Calculate engagement score for a trend based on its volume.
 * Normalises to 0–1 using a logarithmic scale.
 */
export function calculateEngagementScore(volume: number): number {
  if (volume <= 0) return 0;
  // log10-based normalisation: 1M volume → ~1.0
  const score = Math.log10(volume + 1) / 6;
  return Math.min(Math.max(score, 0), 1);
}

/**
 * Calculate velocity (rate of growth) for a trend.
 * Uses the time window to determine how quickly engagement is growing.
 * Returns a normalised 0–1 value.
 */
export function calculateVelocity(volume: number, timeWindowHours: number): number {
  if (volume <= 0 || timeWindowHours <= 0) return 0;
  const ratePerHour = volume / timeWindowHours;
  // Normalise: 10 000 mentions/hour → ~1.0
  const score = Math.min(ratePerHour / 10000, 1);
  return Math.max(score, 0);
}

/**
 * Calculate relevance of a trend to a target audience based on
 * matching interests and age range overlap.
 * Returns a 0–1 score.
 */
export function calculateRelevance(
  trend: Trend,
  audienceInterests: string[],
  audienceAgeRange: [number, number],
): number {
  if (audienceInterests.length === 0) return 0;

  // Interest matching: how many audience interests appear in the trend topic/hashtags
  const trendTerms = [
    trend.topic.toLowerCase(),
    ...trend.hashtags.map((h) => h.toLowerCase().replace(/^#/, '')),
  ];

  let matchCount = 0;
  for (const interest of audienceInterests) {
    const lowerInterest = interest.toLowerCase();
    if (trendTerms.some((t) => t.includes(lowerInterest) || lowerInterest.includes(t))) {
      matchCount++;
    }
  }

  const interestScore = matchCount / audienceInterests.length;

  // Age range overlap with trend demographics
  let ageScore = 0.5; // default when no demographic data
  const ageGroups = trend.demographics.ageGroups;
  if (Object.keys(ageGroups).length > 0) {
    let relevantShare = 0;
    let totalShare = 0;
    for (const [group, share] of Object.entries(ageGroups)) {
      totalShare += share;
      // Parse age group like "18-24"
      const parts = group.split('-').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const [lo, hi] = parts;
        const overlapLo = Math.max(lo, audienceAgeRange[0]);
        const overlapHi = Math.min(hi, audienceAgeRange[1]);
        if (overlapLo <= overlapHi) {
          relevantShare += share;
        }
      }
    }
    if (totalShare > 0) {
      ageScore = relevantShare / totalShare;
    }
  }

  return interestScore * 0.7 + ageScore * 0.3;
}

/**
 * Predict the lifecycle phase of a trend based on velocity and engagement.
 */
export function predictTrendLifecycle(trend: Trend): TrendLifecycle {
  const { engagementScore, velocity } = trend;

  let phase: TrendLifecyclePhase;
  let confidence: number;

  if (velocity >= 0.7 && engagementScore < 0.3) {
    phase = TrendLifecyclePhase.EMERGING;
    confidence = 0.7;
  } else if (velocity >= 0.5 && engagementScore >= 0.3 && engagementScore < 0.7) {
    phase = TrendLifecyclePhase.GROWING;
    confidence = 0.75;
  } else if (engagementScore >= 0.7) {
    phase = TrendLifecyclePhase.PEAKING;
    confidence = 0.8;
  } else if (velocity < 0.2 && engagementScore >= 0.3) {
    phase = TrendLifecyclePhase.DECLINING;
    confidence = 0.7;
  } else {
    phase = TrendLifecyclePhase.EXPIRED;
    confidence = 0.6;
  }

  const now = new Date();
  const daysToAdd = phase === TrendLifecyclePhase.EMERGING ? 7
    : phase === TrendLifecyclePhase.GROWING ? 5
    : phase === TrendLifecyclePhase.PEAKING ? 2
    : phase === TrendLifecyclePhase.DECLINING ? 1
    : 0;

  const estimatedPeakDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const estimatedEndDate = new Date(estimatedPeakDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  return { currentPhase: phase, estimatedPeakDate, estimatedEndDate, confidence };
}

/**
 * Analyses a single trend: calculates engagement score, velocity,
 * and predicts lifecycle. Mutates and returns the trend.
 */
export function analyzeTrend(
  trend: Trend,
  volume: number,
  timeWindowHours: number,
): Trend {
  trend.engagementScore = calculateEngagementScore(volume);
  trend.velocity = calculateVelocity(volume, timeWindowHours);
  trend.predictedLifecycle = predictTrendLifecycle(trend);
  return trend;
}

/**
 * TrendAnalysisEngine implements ITrendAnalysisEngine.
 *
 * Fetches trends from platform API clients, analyses them,
 * and ranks by a composite score.
 */
export class TrendAnalysisEngine implements ITrendAnalysisEngine {
  private readonly clientFactory: (platform: Platform) => BaseApiClient;

  constructor(clientFactory?: (platform: Platform) => BaseApiClient) {
    this.clientFactory = clientFactory ?? createPlatformClient;
  }

  /**
   * Fetch trends from all requested platforms within the given time window.
   * Steps:
   *  1. Create a client per platform
   *  2. Fetch raw trending topics
   *  3. Parse into Trend models
   *  4. Calculate engagement score & velocity
   *  5. Predict lifecycle
   */
  async fetchTrends(platforms: Platform[], timeWindow: TimeRange): Promise<Trend[]> {
    const allTrends: Trend[] = [];
    const windowMs = timeWindow.end.getTime() - timeWindow.start.getTime();
    const windowHours = Math.max(windowMs / (1000 * 60 * 60), 1);

    for (const platform of platforms) {
      try {
        const client = this.clientFactory(platform);
        const rawTopics = await client.fetchTrendingTopics();

        for (const raw of rawTopics) {
          const trend = parseTrend(raw, platform);
          const volume = raw.volume ?? 0;
          analyzeTrend(trend, volume, windowHours);
          allTrends.push(trend);
        }
      } catch (error) {
        logger.error(
          { platform, error: error instanceof Error ? error.message : String(error) },
          'Failed to fetch trends from platform',
        );
        // Continue with other platforms
      }
    }

    return allTrends;
  }

  /**
   * Rank trends by composite score following the design algorithm:
   *   compositeScore = engagementScore * engagementWeight
   *                  + velocity * velocityWeight
   *                  + relevanceScore * relevanceWeight
   *
   * Calculates relevance per trend, computes composite, sorts descending.
   */
  rankTrends(trends: Trend[], criteria: RankingCriteria): Trend[] {
    const engagementWeight = criteria.engagementWeight ?? DEFAULT_ENGAGEMENT_WEIGHT;
    const velocityWeight = criteria.velocityWeight ?? DEFAULT_VELOCITY_WEIGHT;
    const relevanceWeight = criteria.relevanceWeight ?? DEFAULT_RELEVANCE_WEIGHT;

    const scored = trends.map((trend) => {
      const relevanceScore = calculateRelevance(
        trend,
        criteria.audienceInterests,
        criteria.audienceAgeRange,
      );

      const compositeScore =
        trend.engagementScore * engagementWeight +
        trend.velocity * velocityWeight +
        relevanceScore * relevanceWeight;

      return { trend, compositeScore };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    return scored.map((s) => s.trend);
  }
}
