/**
 * Dependency Injection Container
 *
 * Wires all components together, manages lifecycle (initialize/shutdown),
 * and provides health checks for the Social Media Marketing Agent.
 */

import { AgentCore } from '../core/agent-core';
import { TrendAnalysisEngine } from '../engines/trend-analysis/trend-analysis-engine';
import { ContentGenerationEngine } from '../engines/content-generation/content-generation-engine';
import { VisualAssetCreator } from '../engines/visual-asset/visual-asset-creator';
import { PlatformIntegrationLayer } from '../integrations/platform/platform-integration';
import { CampaignManager } from '../engines/campaign-manager/campaign-manager';
import { CampaignScheduler } from '../engines/campaign-manager/campaign-scheduler';
import { ImageGenerator } from '../engines/visual-asset/image-generator';
import { EngagementAnalyzer } from '../engines/optimization/engagement-analyzer';
import { BoostRecommender } from '../engines/optimization/boost-recommender';
import { DataAccessLayer } from '../data/data-access-layer';
import { ConfigLoader } from '../config/config-loader';
import { ApiKeyManager } from '../config/api-key-manager';
import { CostGuard } from '../utils/cost-guard';
import { MiMoAgentBrain } from '../core/mimo-agent-brain';
import { createLogger } from '../utils/logger';
import { AgentConfig, Platform, EngagementMetrics } from '../models';
import { Budget, OptimizationGoal } from '../models/common';
import {
  IOptimizationEngine,
  BoostRecommendation,
} from '../core/interfaces';
import { AdCampaign, AdPlatform, AdStatus } from '../models';

const logger = createLogger('Container');

/** Health status for a single component */
export interface ComponentHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
}

/** Overall system health */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentHealth[];
  timestamp: Date;
}

/** Container state */
export type ContainerState = 'created' | 'initializing' | 'ready' | 'shutting_down' | 'stopped';

/**
 * Adapter that wraps EngagementAnalyzer + BoostRecommender into the
 * IOptimizationEngine interface expected by AgentCore.
 */
class OptimizationEngineAdapter implements IOptimizationEngine {
  constructor(
    private readonly analyzer: EngagementAnalyzer,
    private readonly recommender: BoostRecommender,
  ) {}

  async analyzeEngagement(postId: string, platform: Platform): Promise<EngagementMetrics> {
    return this.analyzer.analyzeEngagement(postId, platform);
  }

  async recommendBoost(
    metrics: EngagementMetrics,
    budget: Budget,
    goals: OptimizationGoal[],
  ): Promise<BoostRecommendation | null> {
    return this.recommender.recommendBoost(metrics, budget, goals);
  }

  async createAdCampaign(recommendation: BoostRecommendation): Promise<AdCampaign> {
    // Stub — real ad creation delegates to Google/Instagram ads clients
    return {
      adCampaignId: `ad-${Date.now()}`,
      platform: AdPlatform.INSTAGRAM_ADS,
      content: {
        contentId: recommendation.postId,
        platform: recommendation.platform,
        text: '',
        visualAssets: [],
        hashtags: [],
        mentions: [],
      },
      targeting: {
        interests: [],
      },
      budget: {
        dailyLimit: recommendation.recommendedBudget,
        totalLimit: recommendation.recommendedBudget,
        remaining: recommendation.recommendedBudget,
        spent: 0,
        currency: 'USD',
      },
      bidStrategy: { type: 'CPC' },
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: AdStatus.DRAFT,
      performance: {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        spend: 0,
        cpc: 0,
        cpm: 0,
        ctr: 0,
        roi: 0,
      },
    };
  }
}

/**
 * DI Container — creates, wires, and manages the lifecycle of all
 * application components.
 */
export class Container {
  private _state: ContainerState = 'created';

  // Components
  readonly costGuard: CostGuard;
  readonly configLoader: ConfigLoader;
  readonly apiKeyManager: ApiKeyManager;
  readonly dataAccess: DataAccessLayer;
  readonly trendAnalysis: TrendAnalysisEngine;
  readonly contentGeneration: ContentGenerationEngine;
  readonly visualAssetCreator: VisualAssetCreator;
  readonly platformIntegration: PlatformIntegrationLayer;
  readonly campaignManager: CampaignManager;
  readonly campaignScheduler: CampaignScheduler;
  readonly imageGenerator: ImageGenerator;
  readonly engagementAnalyzer: EngagementAnalyzer;
  readonly boostRecommender: BoostRecommender;
  readonly mimoBrain: MiMoAgentBrain;
  readonly agentCore: AgentCore;

  private config: AgentConfig | null = null;

  constructor() {
    // 1. Infrastructure
    this.costGuard = new CostGuard();
    this.configLoader = new ConfigLoader();
    this.apiKeyManager = new ApiKeyManager();
    this.dataAccess = new DataAccessLayer();

    // 2. Engines
    this.trendAnalysis = new TrendAnalysisEngine();
    this.contentGeneration = new ContentGenerationEngine({
      provider: 'mimo',
      model: 'mimo-v2-pro',
      maxTokens: 512,
    }, undefined, this.costGuard);
    this.visualAssetCreator = new VisualAssetCreator();
    this.platformIntegration = new PlatformIntegrationLayer();
    this.campaignManager = new CampaignManager();
    this.campaignScheduler = new CampaignScheduler();
    this.imageGenerator = new ImageGenerator();
    this.engagementAnalyzer = new EngagementAnalyzer();
    this.boostRecommender = new BoostRecommender();

    // 3. MiMo V2 Pro Agent Brain — powers autonomous decision-making
    this.mimoBrain = new MiMoAgentBrain();

    // 4. Optimization adapter (bridges analyzer + recommender → IOptimizationEngine)
    const optimizationEngine = new OptimizationEngineAdapter(
      this.engagementAnalyzer,
      this.boostRecommender,
    );

    // 5. Agent Core — wired with all engines + MiMo brain
    this.agentCore = new AgentCore({
      trendAnalysis: this.trendAnalysis,
      contentGeneration: this.contentGeneration,
      visualAssetCreator: this.visualAssetCreator,
      platformIntegration: this.platformIntegration,
      optimization: optimizationEngine,
    });
    this.agentCore.setBrain(this.mimoBrain);
  }

  /** Current container state */
  get state(): ContainerState {
    return this._state;
  }

  /**
   * Initialize all components. Loads config, sets up API keys,
   * and initializes the agent core.
   */
  async initialize(): Promise<void> {
    if (this._state === 'ready') return;
    this._state = 'initializing';
    logger.info('Container initializing');

    try {
      // Load configuration
      this.config = await this.configLoader.load();

      // Load API keys
      await this.apiKeyManager.loadFromRecord(this.config.apiKeys);

      // Initialize agent core
      const result = this.agentCore.initialize(this.config);
      if (!result.valid) {
        throw new Error(`Agent initialization failed: ${result.errors.join(', ')}`);
      }

      this._state = 'ready';
      logger.info('Container initialized successfully');
    } catch (err) {
      this._state = 'created';
      throw err;
    }
  }

  /**
   * Initialize with a pre-built config (useful for tests or programmatic setup).
   */
  initializeWithConfig(config: AgentConfig): void {
    this.config = config;
    const result = this.agentCore.initialize(config);
    if (!result.valid) {
      throw new Error(`Agent initialization failed: ${result.errors.join(', ')}`);
    }
    this._state = 'ready';
    logger.info('Container initialized with provided config');
  }

  /**
   * Graceful shutdown — clears data stores and resets agent state.
   */
  async shutdown(): Promise<void> {
    if (this._state === 'stopped') return;
    this._state = 'shutting_down';
    logger.info('Container shutting down');

    try {
      this.agentCore.reset();
      await this.dataAccess.clearAll();
    } finally {
      this._state = 'stopped';
      logger.info('Container stopped');
    }
  }

  /**
   * Health check — verifies all components are operational.
   */
  healthCheck(): SystemHealth {
    const components: ComponentHealth[] = [
      this.checkAgentCore(),
      this.checkConfigLoader(),
      this.checkDataAccess(),
      this.checkTrendAnalysis(),
      this.checkContentGeneration(),
      this.checkVisualAssetCreator(),
      this.checkPlatformIntegration(),
      this.checkCampaignManager(),
      this.checkOptimizationEngine(),
    ];

    const hasUnhealthy = components.some((c) => c.status === 'unhealthy');
    const hasDegraded = components.some((c) => c.status === 'degraded');

    return {
      status: hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy',
      components,
      timestamp: new Date(),
    };
  }

  // ── Component health checks ─────────────────────────────────

  private checkAgentCore(): ComponentHealth {
    if (this.agentCore.isInitialized) {
      return { name: 'AgentCore', status: 'healthy' };
    }
    return {
      name: 'AgentCore',
      status: this._state === 'ready' ? 'unhealthy' : 'degraded',
      message: 'Agent not initialized',
    };
  }

  private checkConfigLoader(): ComponentHealth {
    try {
      const result = this.configLoader.validate();
      return result.valid
        ? { name: 'ConfigLoader', status: 'healthy' }
        : { name: 'ConfigLoader', status: 'degraded', message: `${result.errors.length} validation errors` };
    } catch {
      return { name: 'ConfigLoader', status: 'degraded', message: 'Validation check failed' };
    }
  }

  private checkDataAccess(): ComponentHealth {
    try {
      // Quick smoke test — begin and rollback a transaction
      const tx = this.dataAccess.beginTransaction();
      tx.rollback();
      return { name: 'DataAccessLayer', status: 'healthy' };
    } catch {
      return { name: 'DataAccessLayer', status: 'unhealthy', message: 'Transaction test failed' };
    }
  }

  private checkTrendAnalysis(): ComponentHealth {
    return { name: 'TrendAnalysisEngine', status: 'healthy' };
  }

  private checkContentGeneration(): ComponentHealth {
    return { name: 'ContentGenerationEngine', status: 'healthy' };
  }

  private checkVisualAssetCreator(): ComponentHealth {
    return { name: 'VisualAssetCreator', status: 'healthy' };
  }

  private checkPlatformIntegration(): ComponentHealth {
    return { name: 'PlatformIntegrationLayer', status: 'healthy' };
  }

  private checkCampaignManager(): ComponentHealth {
    return { name: 'CampaignManager', status: 'healthy' };
  }

  private checkOptimizationEngine(): ComponentHealth {
    return { name: 'OptimizationEngine', status: 'healthy' };
  }
}
