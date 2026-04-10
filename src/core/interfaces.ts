import {
  Platform,
  Trend,
  ContentSuggestion,
  VisualAsset,
  PlatformContent,
  EngagementMetrics,
  AdCampaign,
  Campaign,
  CampaignStatus,
} from '../models';
import {
  Audience,
  BrandProfile,
  Budget,
  OptimizationGoal,
  Segment,
  SegmentationCriteria,
  VisualSpecs,
} from '../models/common';
import type { CMOPersona } from '../models/agent-config';

/** Result of posting content to a platform */
export interface PostResult {
  postId: string;
  platform: Platform;
  success: boolean;
  url?: string;
  error?: string;
}

/** Time range for trend queries */
export interface TimeRange {
  start: Date;
  end: Date;
}

/** Ranking criteria for trends */
export interface RankingCriteria {
  audienceInterests: string[];
  audienceAgeRange: [number, number];
  engagementWeight: number;
  velocityWeight: number;
  relevanceWeight: number;
}

/** Boost recommendation from the optimization engine */
export interface BoostRecommendation {
  postId: string;
  platform: Platform;
  recommendedBudget: number;
  expectedRoi: number;
  targeting: Record<string, unknown>;
}

/**
 * Trend Analysis Engine — monitors and analyzes trending content
 * across multiple social media platforms.
 */
export interface ITrendAnalysisEngine {
  fetchTrends(platforms: Platform[], timeWindow: TimeRange): Promise<Trend[]>;
  rankTrends(trends: Trend[], criteria: RankingCriteria): Trend[];
}

/**
 * Content Generation Engine — creates contextually relevant content
 * suggestions based on trend analysis and brand profile.
 */
export interface IContentGenerationEngine {
  generateSuggestions(trend: Trend, brandProfile: BrandProfile, options?: unknown, persona?: CMOPersona): Promise<ContentSuggestion[]>;
  adaptToPlatform(content: ContentSuggestion, platform: Platform): PlatformContent;
}

/**
 * Visual Asset Creator — generates images and videos optimized
 * for each social media platform.
 */
export interface IVisualAssetCreator {
  generateImage(prompt: string, specs: VisualSpecs): Promise<VisualAsset>;
  generateVideo(prompt: string, specs: VisualSpecs): Promise<VisualAsset>;
  generateImageWithUIReference(prompt: string, specs: VisualSpecs, frameNames: string[]): Promise<VisualAsset>;
  generateVideoAd(prompt: string, specs: VisualSpecs, frameNames: string[]): Promise<VisualAsset>;
  addBranding(asset: VisualAsset, brandProfile: BrandProfile): Promise<VisualAsset>;
}

/**
 * Platform Integration Layer — manages authentication and posting
 * across multiple social media platforms.
 */
export interface IPlatformIntegrationLayer {
  postContent(platform: Platform, content: PlatformContent): Promise<PostResult>;
}

/**
 * Optimization Engine — analyzes performance and optimizes content
 * delivery through advertising platforms.
 */
export interface IOptimizationEngine {
  analyzeEngagement(postId: string, platform: Platform): Promise<EngagementMetrics>;
  recommendBoost(
    metrics: EngagementMetrics,
    budget: Budget,
    goals: OptimizationGoal[],
  ): Promise<BoostRecommendation | null>;
  createAdCampaign(recommendation: BoostRecommendation): Promise<AdCampaign>;
}

/** Campaign specification for creating campaigns */
export interface ICampaignSpec {
  name: string;
  type: string;
  content?: PlatformContent[];
  targetAudience?: Segment[];
}

/**
 * Campaign Manager — creates, persists, and manages the lifecycle
 * of marketing campaigns.
 */
export interface ICampaignManager {
  createCampaign(spec: ICampaignSpec): Campaign;
  getCampaign(campaignId: string): Campaign;
  pauseCampaign(campaignId: string): Campaign;
  resumeCampaign(campaignId: string): Campaign;
  transitionStatus(campaignId: string, newStatus: CampaignStatus): Campaign;
  listCampaigns(status?: CampaignStatus): Campaign[];
  deleteCampaign(campaignId: string): void;
  segmentAudience(audience: Audience, criteria: SegmentationCriteria): Segment[];
}

/** Dependencies that can be injected into AgentCore */
export interface AgentCoreDependencies {
  trendAnalysis?: ITrendAnalysisEngine;
  contentGeneration?: IContentGenerationEngine;
  visualAssetCreator?: IVisualAssetCreator;
  platformIntegration?: IPlatformIntegrationLayer;
  optimization?: IOptimizationEngine;
  campaignManager?: ICampaignManager;
}
