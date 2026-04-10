import {
  AgentConfig,
  Campaign,
  CampaignMetrics,
  EngagementMetrics,
  Platform,
} from '../models';

/** Specification for creating and executing a campaign */
export interface CampaignSpec {
  name: string;
  targetAudience: {
    ageRange: [number, number];
    interests: string[];
    locations?: string[];
  };
  platforms: Platform[];
  budget: { total: number; daily: number; currency: string };
  brandProfile: {
    name: string;
    voice: string;
    guidelines: string[];
  };
  duration: number; // in days
  optimizationGoals?: { metric: string; target: number; weight: number }[];
}

/** Result of a completed campaign execution */
export interface CampaignResult {
  campaignId: string;
  status: 'completed' | 'failed' | 'partial';
  totalPosts: number;
  platforms: Platform[];
  metrics: CampaignMetrics;
  errors: string[];
  startedAt: Date;
  completedAt: Date;
}

/** Aggregated performance metrics across campaigns */
export interface PerformanceMetrics {
  activeCampaigns: number;
  totalReach: number;
  totalImpressions: number;
  totalEngagements: number;
  averageEngagementRate: number;
  platformMetrics: Record<string, EngagementMetrics[]>;
  collectedAt: Date;
}

/** Strategy adjustment based on performance analysis */
export interface StrategyUpdate {
  adjustments: StrategyAdjustment[];
  reason: string;
  appliedAt: Date;
}

export interface StrategyAdjustment {
  type: 'budget' | 'targeting' | 'content' | 'timing' | 'platform';
  description: string;
  parameters: Record<string, unknown>;
}

/** Internal agent state tracking */
export interface AgentState {
  initialized: boolean;
  config: AgentConfig | null;
  activeCampaigns: Map<string, Campaign>;
  campaignHistory: CampaignResult[];
  lastPerformanceCheck: Date | null;
  strategyUpdates: StrategyUpdate[];
  errors: string[];
}

/** Validation result for config checks */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
