import { createLogger } from '../../utils/logger';
import { Platform } from '../../models/enums';
import { EngagementMetrics } from '../../models/engagement-metrics';
import { DemographicData } from '../../models/common';

const logger = createLogger('EngagementAnalyzer');

/**
 * Raw metrics fetched from a platform API before rate/demographic calculations.
 */
export interface RawPlatformMetrics {
  likes: number;
  comments: number;
  shares: number;
  views: number;
  clicks: number;
  reach: number;
  impressions: number;
}

/**
 * Abstraction for fetching raw engagement data from a social platform.
 * Each platform client (Instagram, Facebook, etc.) should implement this.
 */
export interface PlatformMetricsClient {
  fetchPostMetrics(postId: string): Promise<RawPlatformMetrics>;
  fetchPostDemographics(postId: string): Promise<DemographicData>;
}

/**
 * Calculates the engagement rate for a post.
 *
 * Formula: engagementRate = (likes + comments + shares + clicks) / impressions
 *
 * Returns 0 when impressions is 0 to avoid division by zero.
 * The result is clamped to [0, 1].
 */
export function calculateEngagementRate(metrics: RawPlatformMetrics): number {
  if (metrics.impressions <= 0) {
    return 0;
  }
  const totalEngagements = metrics.likes + metrics.comments + metrics.shares + metrics.clicks;
  const rate = totalEngagements / metrics.impressions;
  return Math.min(rate, 1);
}

/**
 * EngagementAnalyzer collects metrics from platform APIs, computes
 * engagement rates, and produces demographic breakdowns.
 */
export class EngagementAnalyzer {
  private readonly clients: Map<Platform, PlatformMetricsClient>;

  constructor(clients?: Map<Platform, PlatformMetricsClient>) {
    this.clients = clients ?? new Map();
  }

  /** Register a platform metrics client */
  registerClient(platform: Platform, client: PlatformMetricsClient): void {
    this.clients.set(platform, client);
  }

  /**
   * Analyze engagement for a specific post on a given platform.
   *
   * 1. Fetches raw metrics from the platform API
   * 2. Calculates the engagement rate
   * 3. Fetches demographic data
   * 4. Returns a complete EngagementMetrics object
   */
  async analyzeEngagement(postId: string, platform: Platform): Promise<EngagementMetrics> {
    logger.info({ postId, platform }, 'Analyzing engagement');

    const client = this.clients.get(platform);
    if (!client) {
      throw new Error(`No metrics client registered for platform: ${platform}`);
    }

    const [rawMetrics, demographics] = await Promise.all([
      client.fetchPostMetrics(postId),
      client.fetchPostDemographics(postId),
    ]);

    const engagementRate = calculateEngagementRate(rawMetrics);

    logger.info(
      { postId, platform, engagementRate, demographics },
      'Engagement analysis complete',
    );

    return {
      postId,
      platform,
      likes: rawMetrics.likes,
      comments: rawMetrics.comments,
      shares: rawMetrics.shares,
      views: rawMetrics.views,
      clicks: rawMetrics.clicks,
      reach: rawMetrics.reach,
      impressions: rawMetrics.impressions,
      engagementRate,
      timestamp: new Date(),
    };
  }
}
