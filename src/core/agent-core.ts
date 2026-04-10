import { v4 as uuidv4 } from 'uuid';
import { AgentConfig, Campaign, CampaignStatus, CampaignType, Platform } from '../models';
import { createLogger } from '../utils/logger';
import {
  AgentState,
  CampaignResult,
  CampaignSpec,
  PerformanceMetrics,
  StrategyAdjustment,
  StrategyUpdate,
  ValidationResult,
} from './types';
import {
  AgentCoreDependencies,
  ITrendAnalysisEngine,
  IContentGenerationEngine,
  IVisualAssetCreator,
  IPlatformIntegrationLayer,
  IOptimizationEngine,
  PostResult,
} from './interfaces';
import { Budget, CampaignMetrics } from '../models/common';
import { Trend, ContentSuggestion, VisualAsset, PlatformContent, EngagementMetrics } from '../models';
import { MiMoAgentBrain } from './mimo-agent-brain';
import { buildDefaultCMOPersona } from '../config/rewoz-brand-dna';

const logger = createLogger('AgentCore');

/** Minimum engagement threshold for trend filtering */
const MINIMUM_ENGAGEMENT_THRESHOLD = 0.1;

// ── Performance threshold constants for strategy adaptation ───

/** Engagement rate below this triggers a content/targeting adjustment */
export const LOW_ENGAGEMENT_RATE_THRESHOLD = 0.02;

/** Engagement rate above this is considered high-performing */
export const HIGH_ENGAGEMENT_RATE_THRESHOLD = 0.08;

/** Spend-to-engagement ratio above this triggers a budget adjustment */
export const HIGH_SPEND_LOW_ROI_THRESHOLD = 50; // cost per engagement unit

/** Minimum impressions before metrics are considered meaningful */
export const MIN_IMPRESSIONS_FOR_ANALYSIS = 100;

/**
 * Calculate engagement score from metrics.
 *
 * Formula from design doc (Function 5 — calculateEngagementScore):
 *   score = (likes + comments * 2 + shares * 3) / impressions
 *
 * Weighted so higher-value interactions (shares > comments > likes)
 * contribute more. Result is clamped to [0, 1].
 *
 * Returns 0 when impressions is 0 to avoid division by zero.
 */
export function calculateEngagementScore(metrics: {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
}): number {
  if (metrics.impressions <= 0) return 0;

  const raw =
    (metrics.likes + metrics.comments * 2 + metrics.shares * 3) / metrics.impressions;

  return Math.min(Math.max(raw, 0), 1);
}

/**
 * Core agent class that orchestrates all marketing operations.
 *
 * Implements the AgentCore interface from the design:
 *  - initialize(config) — validate and store configuration, set up state
 *  - executeCampaign(campaign) — run a full campaign workflow
 *  - monitorPerformance() — collect cross-campaign metrics (stub)
 *  - adaptStrategy(metrics) — adjust strategy based on data (stub)
 */
export class AgentCore {
  private state: AgentState;
  private trendAnalysis?: ITrendAnalysisEngine;
  private contentGeneration?: IContentGenerationEngine;
  private visualAssetCreator?: IVisualAssetCreator;
  private platformIntegration?: IPlatformIntegrationLayer;
  private optimization?: IOptimizationEngine;
  private brain?: MiMoAgentBrain;

  constructor(deps?: AgentCoreDependencies) {
    this.state = AgentCore.createInitialState();
    if (deps) {
      this.trendAnalysis = deps.trendAnalysis;
      this.contentGeneration = deps.contentGeneration;
      this.visualAssetCreator = deps.visualAssetCreator;
      this.platformIntegration = deps.platformIntegration;
      this.optimization = deps.optimization;
    }
  }

  /** Set the MiMo V2 Pro agent brain for autonomous decision-making */
  setBrain(brain: MiMoAgentBrain): void {
    this.brain = brain;
  }

  /** Get the current agent brain (if configured) */
  getBrain(): MiMoAgentBrain | undefined {
    return this.brain;
  }

  // ── Dependency setters ──────────────────────────────────────────

  setTrendAnalysis(engine: ITrendAnalysisEngine): void {
    this.trendAnalysis = engine;
  }

  setContentGeneration(engine: IContentGenerationEngine): void {
    this.contentGeneration = engine;
  }

  setVisualAssetCreator(engine: IVisualAssetCreator): void {
    this.visualAssetCreator = engine;
  }

  setPlatformIntegration(engine: IPlatformIntegrationLayer): void {
    this.platformIntegration = engine;
  }

  setOptimization(engine: IOptimizationEngine): void {
    this.optimization = engine;
  }

  // ── Initialisation ──────────────────────────────────────────────

  /**
   * Configure the agent with the provided AgentConfig.
   * Validates the config, stores it, and marks the agent as initialised.
   */
  initialize(config: AgentConfig): ValidationResult {
    logger.info({ agentId: config.agentId }, 'Initializing agent');

    const validation = AgentCore.validateConfig(config);
    if (!validation.valid) {
      logger.error({ errors: validation.errors }, 'Agent initialization failed');
      return validation;
    }

    this.state.config = config;
    this.state.initialized = true;
    this.state.errors = [];

    // Wire CMO persona into the agent brain (create one if not already set)
    const persona = config.cmoPersona ?? buildDefaultCMOPersona();
    if (!this.brain) {
      this.brain = new MiMoAgentBrain(undefined, undefined, persona);
    }

    logger.info(
      { agentId: config.agentId, platforms: config.platforms },
      'Agent initialized successfully',
    );

    return { valid: true, errors: [] };
  }

  // ── Campaign execution ──────────────────────────────────────────

  /**
   * Execute a full marketing campaign following the main algorithm.
   *
   * Steps:
   * 1. Initialize campaign state
   * 2. Analyze trends for target platforms
   * 3. Generate content based on trends
   * 4. Create visual assets
   * 5. Post content to platforms
   * 6. Monitor and optimize (single pass)
   * 7. Generate final report
   *
   * Each step has error recovery — individual failures are captured
   * and the campaign degrades gracefully rather than aborting entirely.
   */
  async executeCampaign(spec: CampaignSpec): Promise<CampaignResult> {
    this.assertInitialized();
    this.validateCampaignSpec(spec);

    const startedAt = new Date();
    const campaignId = uuidv4();
    const errors: string[] = [];

    logger.info({ campaignId, campaign: spec.name }, 'Starting campaign execution');

    // Step 1: Initialize campaign state
    const campaign = this.createCampaignFromSpec(campaignId, spec);
    this.state.activeCampaigns.set(campaignId, campaign);
    campaign.status = CampaignStatus.ACTIVE;

    logger.info({ campaignId }, 'Campaign state initialized — status ACTIVE');

    // Step 2: Analyze trends for target platforms
    let trends: Trend[] = [];
    try {
      trends = await this.analyzeTrends(spec);
      logger.info({ campaignId, trendCount: trends.length }, 'Trend analysis complete');
    } catch (err) {
      const msg = `Trend analysis failed: ${errorMessage(err)}`;
      logger.warn({ campaignId }, msg);
      errors.push(msg);
    }

    // Step 3: Generate content based on trends
    let contentSuggestions: ContentSuggestion[] = [];
    try {
      const contentResult = await this.generateContent(trends, spec);
      contentSuggestions = contentResult.suggestions;
      errors.push(...contentResult.errors);
      logger.info(
        { campaignId, contentCount: contentSuggestions.length },
        'Content generation complete',
      );
    } catch (err) {
      const msg = `Content generation failed: ${errorMessage(err)}`;
      logger.warn({ campaignId }, msg);
      errors.push(msg);
    }

    // Step 4: Create visual assets
    let visualAssets: VisualAsset[] = [];
    try {
      visualAssets = await this.createVisualAssets(contentSuggestions, spec);
      logger.info(
        { campaignId, assetCount: visualAssets.length },
        'Visual asset creation complete',
      );
    } catch (err) {
      const msg = `Visual asset creation failed: ${errorMessage(err)}`;
      logger.warn({ campaignId }, msg);
      errors.push(msg);
    }

    // Step 5: Post content to platforms
    let posts: PostResult[] = [];
    try {
      const postResult = await this.postToPlatforms(spec, contentSuggestions, visualAssets);
      posts = postResult.posts;
      errors.push(...postResult.errors);
      logger.info({ campaignId, postCount: posts.length }, 'Platform posting complete');
    } catch (err) {
      const msg = `Platform posting failed: ${errorMessage(err)}`;
      logger.warn({ campaignId }, msg);
      errors.push(msg);
    }

    // Step 6: Monitor and optimize (single pass — real loop deferred to runtime)
    try {
      await this.monitorAndOptimize(campaign, posts, spec);
      logger.info({ campaignId }, 'Monitoring and optimization pass complete');
    } catch (err) {
      const msg = `Monitoring/optimization failed: ${errorMessage(err)}`;
      logger.warn({ campaignId }, msg);
      errors.push(msg);
    }

    // Step 7: Generate final report
    const completedAt = new Date();
    const successfulPosts = posts.filter((p) => p.success);

    const status = this.determineCampaignStatus(errors, successfulPosts.length);
    campaign.status =
      status === 'completed' ? CampaignStatus.COMPLETED : CampaignStatus.COMPLETED;

    const metrics = this.aggregateMetrics(campaign);

    const result: CampaignResult = {
      campaignId,
      status,
      totalPosts: successfulPosts.length,
      platforms: spec.platforms,
      metrics,
      errors,
      startedAt,
      completedAt,
    };

    // Move from active to history
    this.state.activeCampaigns.delete(campaignId);
    this.state.campaignHistory.push(result);

    logger.info(
      { campaignId, status, totalPosts: result.totalPosts, errorCount: errors.length },
      'Campaign execution finished',
    );

    return result;
  }

  // ── Campaign orchestration helpers ──────────────────────────────

  /**
   * Step 2: Analyze trends across all target platforms.
   * Falls back to an empty list if no trend engine is available.
   */
  private async analyzeTrends(spec: CampaignSpec): Promise<Trend[]> {
    if (!this.trendAnalysis) {
      logger.warn('No TrendAnalysisEngine configured — skipping trend analysis');
      return [];
    }

    const now = new Date();
    const timeWindow = {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // last 7 days
      end: now,
    };

    const rawTrends = await this.trendAnalysis.fetchTrends(spec.platforms, timeWindow);

    const ranked = this.trendAnalysis.rankTrends(rawTrends, {
      audienceInterests: spec.targetAudience.interests,
      audienceAgeRange: spec.targetAudience.ageRange,
      engagementWeight: 0.4,
      velocityWeight: 0.3,
      relevanceWeight: 0.3,
    });

    // Filter by minimum engagement threshold
    return ranked.filter((t) => t.engagementScore >= MINIMUM_ENGAGEMENT_THRESHOLD);
  }

  /**
   * Step 3: Generate content suggestions from trends.
   * Falls back to an empty list if no content engine is available.
   * Returns both suggestions and any errors encountered per-trend.
   */
  private async generateContent(
    trends: Trend[],
    spec: CampaignSpec,
  ): Promise<{ suggestions: ContentSuggestion[]; errors: string[] }> {
    if (!this.contentGeneration) {
      logger.warn('No ContentGenerationEngine configured — skipping content generation');
      return { suggestions: [], errors: [] };
    }

    const suggestions: ContentSuggestion[] = [];
    const errors: string[] = [];

    for (const trend of trends) {
      try {
        const trendSuggestions = await this.contentGeneration.generateSuggestions(
          trend,
          {
            name: spec.brandProfile.name,
            voice: spec.brandProfile.voice,
            guidelines: spec.brandProfile.guidelines,
          },
          undefined,
          this.state.config?.cmoPersona ?? buildDefaultCMOPersona(),
        );
        suggestions.push(...trendSuggestions);
      } catch (err) {
        const msg = `Content generation failed: ${errorMessage(err)}`;
        logger.warn({ trendId: trend.trendId }, msg);
        errors.push(msg);
      }
    }

    return { suggestions, errors };
  }

  /**
   * Step 4: Create visual assets for content suggestions.
   * Falls back to an empty list if no visual asset creator is available.
   */
  private async createVisualAssets(
    suggestions: ContentSuggestion[],
    spec: CampaignSpec,
  ): Promise<VisualAsset[]> {
    if (!this.visualAssetCreator) {
      logger.warn('No VisualAssetCreator configured — skipping visual asset creation');
      return [];
    }

    const assets: VisualAsset[] = [];

    for (const suggestion of suggestions) {
      try {
        const visualReqs = suggestion.visualRequirements;
        let asset: VisualAsset;

        if (visualReqs.type === 'IMAGE') {
          asset = await this.visualAssetCreator.generateImage(suggestion.text, visualReqs);
        } else {
          asset = await this.visualAssetCreator.generateVideo(suggestion.text, visualReqs);
        }

        // Apply branding
        const branded = await this.visualAssetCreator.addBranding(asset, {
          name: spec.brandProfile.name,
          voice: spec.brandProfile.voice,
          guidelines: spec.brandProfile.guidelines,
        });

        assets.push(branded);
      } catch (err) {
        logger.warn(
          { contentId: suggestion.contentId },
          `Visual asset creation failed: ${errorMessage(err)}`,
        );
        // Continue with other suggestions
      }
    }

    return assets;
  }

  /**
   * Step 5: Post content to all target platforms.
   * Falls back to an empty list if no platform integration is available.
   * Returns both post results and any errors encountered per-platform.
   */
  private async postToPlatforms(
    spec: CampaignSpec,
    suggestions: ContentSuggestion[],
    assets: VisualAsset[],
  ): Promise<{ posts: PostResult[]; errors: string[] }> {
    if (!this.platformIntegration) {
      logger.warn('No PlatformIntegrationLayer configured — skipping posting');
      return { posts: [], errors: [] };
    }

    if (suggestions.length === 0) {
      logger.warn('No content suggestions available — skipping posting');
      return { posts: [], errors: [] };
    }

    const posts: PostResult[] = [];
    const errors: string[] = [];

    for (const platform of spec.platforms) {
      try {
        // Adapt the first suggestion for this platform
        const content = this.contentGeneration
          ? this.contentGeneration.adaptToPlatform(suggestions[0], platform)
          : this.createFallbackContent(suggestions[0], platform);

        // Attach matching visual assets
        const platformAssets = assets.filter((a) => a.platform === platform);
        content.visualAssets = platformAssets;

        const result = await this.platformIntegration.postContent(platform, content);
        posts.push(result);

        if (!result.success) {
          errors.push(`Posting to ${platform} failed: ${result.error ?? 'unknown error'}`);
        }
      } catch (err) {
        const msg = `Posting to ${platform} failed: ${errorMessage(err)}`;
        logger.warn({ platform }, msg);
        errors.push(msg);
        posts.push({
          postId: '',
          platform,
          success: false,
          error: errorMessage(err),
        });
      }
    }

    return { posts, errors };
  }

  /**
   * Step 6: Monitor engagement and trigger optimization if warranted.
   * Single-pass implementation — continuous monitoring is deferred to runtime.
   */
  private async monitorAndOptimize(
    campaign: Campaign,
    posts: PostResult[],
    spec: CampaignSpec,
  ): Promise<void> {
    if (!this.optimization) {
      logger.warn('No OptimizationEngine configured — skipping optimization');
      return;
    }

    const successfulPosts = posts.filter((p) => p.success && p.postId);

    for (const post of successfulPosts) {
      try {
        const metrics = await this.optimization.analyzeEngagement(post.postId, post.platform);

        const campaignBudget: Budget = {
          dailyLimit: spec.budget.daily,
          totalLimit: spec.budget.total,
          remaining: spec.budget.total - campaign.budget.spent,
          spent: campaign.budget.spent,
          currency: spec.budget.currency,
        };

        const goals = spec.optimizationGoals ?? [];
        const recommendation = await this.optimization.recommendBoost(
          metrics,
          campaignBudget,
          goals,
        );

        if (recommendation && campaignBudget.remaining > 0) {
          await this.optimization.createAdCampaign(recommendation);
          logger.info({ postId: post.postId }, 'Ad campaign created for boosted post');
        }
      } catch (err) {
        logger.warn(
          { postId: post.postId },
          `Optimization failed for post: ${errorMessage(err)}`,
        );
        // Continue with other posts
      }
    }
  }

  // ── Performance monitoring ───────────────────────────────────

  /**
   * Collect aggregated performance metrics across all active campaigns.
   *
   * Iterates over every active campaign, collects engagement metrics
   * from each piece of content, groups them by platform, and computes
   * aggregate totals (reach, impressions, engagements, avg engagement rate).
   */
  async monitorPerformance(): Promise<PerformanceMetrics> {
    this.assertInitialized();

    const now = new Date();
    this.state.lastPerformanceCheck = now;

    let totalReach = 0;
    let totalImpressions = 0;
    let totalEngagements = 0;
    const platformMetrics: Record<string, EngagementMetrics[]> = {};
    const engagementRates: number[] = [];

    for (const [, campaign] of this.state.activeCampaigns) {
      for (const content of campaign.content) {
        // If we have an optimization engine, fetch live metrics
        if (this.optimization && content.postId) {
          try {
            const metrics = await this.optimization.analyzeEngagement(
              content.postId,
              content.platform,
            );

            totalReach += metrics.reach;
            totalImpressions += metrics.impressions;
            const engagements = metrics.likes + metrics.comments + metrics.shares + metrics.clicks;
            totalEngagements += engagements;

            const score = calculateEngagementScore(metrics);
            engagementRates.push(score);

            const platformKey = content.platform;
            if (!platformMetrics[platformKey]) {
              platformMetrics[platformKey] = [];
            }
            platformMetrics[platformKey].push(metrics);
          } catch (err) {
            logger.warn(
              { postId: content.postId },
              `Failed to collect metrics: ${errorMessage(err)}`,
            );
          }
        } else if (content.engagementMetrics) {
          // Fall back to cached metrics on the content object
          const m = content.engagementMetrics;
          totalReach += m.reach;
          totalImpressions += m.impressions;
          const engagements = m.likes + m.comments + m.shares + m.clicks;
          totalEngagements += engagements;

          const score = calculateEngagementScore(m);
          engagementRates.push(score);

          const platformKey = content.platform;
          if (!platformMetrics[platformKey]) {
            platformMetrics[platformKey] = [];
          }
          platformMetrics[platformKey].push(m);
        }
      }

      // Also aggregate from campaign-level metrics
      totalReach += campaign.metrics.totalReach;
      totalImpressions += campaign.metrics.totalImpressions;
      totalEngagements += campaign.metrics.totalEngagements;
      if (campaign.metrics.averageEngagementRate > 0) {
        engagementRates.push(campaign.metrics.averageEngagementRate);
      }
    }

    const averageEngagementRate =
      engagementRates.length > 0
        ? engagementRates.reduce((sum, r) => sum + r, 0) / engagementRates.length
        : 0;

    return {
      activeCampaigns: this.state.activeCampaigns.size,
      totalReach,
      totalImpressions,
      totalEngagements,
      averageEngagementRate,
      platformMetrics,
      collectedAt: now,
    };
  }

  // ── Strategy adaptation ──────────────────────────────────────

  /**
   * Analyse performance metrics and produce strategy adjustments.
   *
   * Detects performance thresholds and generates typed adjustments:
   *  - Low engagement rate → content + targeting adjustments
   *  - High engagement rate → budget increase recommendation
   *  - High spend with low engagement → budget reduction + platform shift
   *  - Platform-specific underperformance → platform adjustment
   */
  adaptStrategy(metrics: PerformanceMetrics): StrategyUpdate {
    this.assertInitialized();

    const adjustments: StrategyAdjustment[] = [];
    const reasons: string[] = [];

    // Only analyse when we have meaningful data
    if (metrics.totalImpressions >= MIN_IMPRESSIONS_FOR_ANALYSIS) {
      // ── Low engagement rate ──────────────────────────────────
      if (metrics.averageEngagementRate < LOW_ENGAGEMENT_RATE_THRESHOLD) {
        adjustments.push({
          type: 'content',
          description: 'Engagement rate is below threshold — refresh content strategy',
          parameters: {
            currentRate: metrics.averageEngagementRate,
            threshold: LOW_ENGAGEMENT_RATE_THRESHOLD,
            action: 'diversify_content',
          },
        });
        adjustments.push({
          type: 'targeting',
          description: 'Refine audience targeting to improve engagement',
          parameters: {
            currentRate: metrics.averageEngagementRate,
            action: 'narrow_audience',
          },
        });
        reasons.push(
          `Low engagement rate (${(metrics.averageEngagementRate * 100).toFixed(2)}% < ${(LOW_ENGAGEMENT_RATE_THRESHOLD * 100).toFixed(2)}%)`,
        );
      }

      // ── High engagement rate — scale up ──────────────────────
      if (metrics.averageEngagementRate >= HIGH_ENGAGEMENT_RATE_THRESHOLD) {
        adjustments.push({
          type: 'budget',
          description: 'High engagement detected — increase budget to capitalise',
          parameters: {
            currentRate: metrics.averageEngagementRate,
            threshold: HIGH_ENGAGEMENT_RATE_THRESHOLD,
            action: 'increase_budget',
            suggestedMultiplier: 1.5,
          },
        });
        reasons.push(
          `High engagement rate (${(metrics.averageEngagementRate * 100).toFixed(2)}% >= ${(HIGH_ENGAGEMENT_RATE_THRESHOLD * 100).toFixed(2)}%)`,
        );
      }
    }

    // ── High spend with low engagement (cost-per-engagement) ──
    if (metrics.totalEngagements > 0) {
      // Use campaign budget spend as a proxy — sum from active campaigns
      let totalSpend = 0;
      for (const [, campaign] of this.state.activeCampaigns) {
        totalSpend += campaign.budget.spent;
      }

      if (totalSpend > 0) {
        const costPerEngagement = totalSpend / metrics.totalEngagements;
        if (costPerEngagement > HIGH_SPEND_LOW_ROI_THRESHOLD) {
          adjustments.push({
            type: 'budget',
            description: 'Cost per engagement is too high — reduce spend or reallocate',
            parameters: {
              costPerEngagement,
              threshold: HIGH_SPEND_LOW_ROI_THRESHOLD,
              action: 'reduce_budget',
            },
          });
          reasons.push(
            `High cost per engagement ($${costPerEngagement.toFixed(2)} > $${HIGH_SPEND_LOW_ROI_THRESHOLD})`,
          );
        }
      }
    }

    // ── Platform-specific underperformance ─────────────────────
    for (const [platform, metricsArr] of Object.entries(metrics.platformMetrics)) {
      if (metricsArr.length === 0) continue;

      const avgRate =
        metricsArr.reduce((sum, m) => sum + calculateEngagementScore(m), 0) / metricsArr.length;

      if (avgRate < LOW_ENGAGEMENT_RATE_THRESHOLD) {
        adjustments.push({
          type: 'platform',
          description: `Platform ${platform} underperforming — consider pausing or adjusting`,
          parameters: {
            platform,
            averageEngagementRate: avgRate,
            threshold: LOW_ENGAGEMENT_RATE_THRESHOLD,
            action: 'pause_or_adjust_platform',
          },
        });
        reasons.push(`Platform ${platform} engagement below threshold`);
      }
    }

    // ── Timing adjustment when we have data but no other issues ─
    if (
      adjustments.length === 0 &&
      metrics.totalImpressions >= MIN_IMPRESSIONS_FOR_ANALYSIS &&
      metrics.averageEngagementRate >= LOW_ENGAGEMENT_RATE_THRESHOLD &&
      metrics.averageEngagementRate < HIGH_ENGAGEMENT_RATE_THRESHOLD
    ) {
      adjustments.push({
        type: 'timing',
        description: 'Performance is moderate — experiment with posting times',
        parameters: {
          currentRate: metrics.averageEngagementRate,
          action: 'optimize_timing',
        },
      });
      reasons.push('Moderate engagement — optimising posting schedule');
    }

    const reason =
      reasons.length > 0 ? reasons.join('; ') : 'No adjustments needed';

    const update: StrategyUpdate = {
      adjustments,
      reason,
      appliedAt: new Date(),
    };

    this.state.strategyUpdates.push(update);
    return update;
  }

  // ── State accessors ─────────────────────────────────────────────

  /** Whether the agent has been successfully initialised. */
  get isInitialized(): boolean {
    return this.state.initialized;
  }

  /** Current agent configuration (null before initialisation). */
  get config(): AgentConfig | null {
    return this.state.config;
  }

  /** Number of currently active campaigns. */
  get activeCampaignCount(): number {
    return this.state.activeCampaigns.size;
  }

  /** History of completed campaign results. */
  get campaignHistory(): readonly CampaignResult[] {
    return this.state.campaignHistory;
  }

  /** Accumulated errors. */
  get errors(): readonly string[] {
    return this.state.errors;
  }

  /** Reset the agent to its initial state. */
  reset(): void {
    this.state = AgentCore.createInitialState();
    logger.info('Agent state reset');
  }

  // ── Private helpers ─────────────────────────────────────────────

  private assertInitialized(): void {
    if (!this.state.initialized || !this.state.config) {
      throw new Error('Agent is not initialized. Call initialize() first.');
    }
  }

  /** Validate campaign spec preconditions. */
  private validateCampaignSpec(spec: CampaignSpec): void {
    if (!spec) {
      throw new Error('Campaign spec is required');
    }
    if (!spec.platforms || spec.platforms.length === 0) {
      throw new Error('Campaign must target at least one platform');
    }
    if (!spec.budget || spec.budget.total <= 0) {
      throw new Error('Campaign budget must be positive');
    }
  }

  /** Create a Campaign model from a CampaignSpec. */
  private createCampaignFromSpec(campaignId: string, spec: CampaignSpec): Campaign {
    const now = new Date();
    const endDate = new Date(now.getTime() + spec.duration * 24 * 60 * 60 * 1000);

    return {
      campaignId,
      name: spec.name,
      type: CampaignType.MULTI_PLATFORM,
      status: CampaignStatus.DRAFT,
      content: [],
      targetAudience: [],
      schedule: {
        startDate: now,
        endDate,
        timezone: 'UTC',
        sendTimes: [],
      },
      budget: {
        dailyLimit: spec.budget.daily,
        totalLimit: spec.budget.total,
        remaining: spec.budget.total,
        spent: 0,
        currency: spec.budget.currency,
      },
      startDate: now,
      endDate,
      metrics: {
        totalReach: 0,
        totalImpressions: 0,
        totalEngagements: 0,
        averageEngagementRate: 0,
        totalSpend: 0,
        roi: 0,
      },
      optimizationRules: [],
    };
  }

  /** Create a minimal PlatformContent when no content engine is available. */
  private createFallbackContent(
    suggestion: ContentSuggestion,
    platform: Platform,
  ): PlatformContent {
    return {
      contentId: suggestion.contentId,
      platform,
      text: suggestion.text,
      visualAssets: [],
      hashtags: suggestion.hashtags,
      mentions: [],
    };
  }

  /** Determine final campaign status based on errors and post count. */
  private determineCampaignStatus(
    errors: string[],
    successfulPostCount: number,
  ): 'completed' | 'failed' | 'partial' {
    if (errors.length === 0 && successfulPostCount > 0) {
      return 'completed';
    }
    if (successfulPostCount > 0) {
      return 'partial';
    }
    return 'failed';
  }

  /** Aggregate metrics from a campaign (placeholder — real aggregation in later tasks). */
  private aggregateMetrics(campaign: Campaign): CampaignMetrics {
    return { ...campaign.metrics };
  }

  /** Validate an AgentConfig against the design-doc rules. */
  static validateConfig(config: AgentConfig): ValidationResult {
    const errors: string[] = [];

    if (!config.agentId) {
      errors.push('agentId is required');
    }

    if (!config.frameworkType) {
      errors.push('frameworkType is required');
    }

    if (!config.llmProvider) {
      errors.push('llmProvider is required');
    }

    if (!config.platforms || config.platforms.length === 0) {
      errors.push('At least one platform must be configured');
    }

    if (!config.budgetLimits) {
      errors.push('budgetLimits is required');
    } else {
      if (config.budgetLimits.dailyLimit <= 0) {
        errors.push('budgetLimits.dailyLimit must be positive');
      }
      if (config.budgetLimits.totalLimit <= 0) {
        errors.push('budgetLimits.totalLimit must be positive');
      }
    }

    if (!config.brandProfile) {
      errors.push('brandProfile is required');
    }

    if (!config.targetAudience) {
      errors.push('targetAudience is required');
    }

    if (config.cmoPersona && config.cmoPersona.strategicPriorities.length === 0) {
      errors.push('At least one strategic priority is required');
    }

    return { valid: errors.length === 0, errors };
  }

  /** Produce a clean initial state object. */
  private static createInitialState(): AgentState {
    return {
      initialized: false,
      config: null,
      activeCampaigns: new Map(),
      campaignHistory: [],
      lastPerformanceCheck: null,
      strategyUpdates: [],
      errors: [],
    };
  }
}

/** Safely extract an error message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
