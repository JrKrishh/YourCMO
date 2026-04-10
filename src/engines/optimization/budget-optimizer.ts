import { createLogger } from '../../utils/logger';
import { AdCampaign } from '../../models/ad-campaign';
import { AdStatus } from '../../models/enums';
import { AdPerformance } from '../../models/common';

const logger = createLogger('BudgetOptimizer');

/**
 * Performance data for a set of ad campaigns, keyed by adCampaignId.
 */
export interface PerformanceData {
  metrics: Map<string, AdPerformance>;
}

/**
 * Budget allocation for a single campaign after optimization.
 */
export interface CampaignAllocation {
  adCampaignId: string;
  allocatedBudget: number;
  previousBudget: number;
  roiScore: number;
}

/**
 * Alert severity levels for budget tracking.
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * A budget alert raised during optimization.
 */
export interface BudgetAlert {
  adCampaignId: string;
  severity: AlertSeverity;
  message: string;
}

/**
 * Result of the optimizeBudget() call.
 */
export interface BudgetAllocation {
  allocations: CampaignAllocation[];
  totalBudget: number;
  alerts: BudgetAlert[];
}

/**
 * Configuration for the BudgetOptimizer.
 */
export interface BudgetOptimizerConfig {
  /** Minimum budget any single campaign can receive (default: 5) */
  minCampaignBudget: number;
  /** Fraction of remaining budget at which a low-budget warning fires (default: 0.2 = 20%) */
  lowBudgetThreshold: number;
  /** Fraction of total budget at which an overspend alert fires (default: 0.95 = 95%) */
  overspendThreshold: number;
  /** Minimum ROI to keep a campaign funded; below this it loses budget (default: 0) */
  minRoiForFunding: number;
}

const DEFAULT_CONFIG: BudgetOptimizerConfig = {
  minCampaignBudget: 5,
  lowBudgetThreshold: 0.2,
  overspendThreshold: 0.95,
  minRoiForFunding: 0,
};

/**
 * Calculates an ROI score for a campaign.
 *
 * The score combines the raw ROI value with a spend-efficiency factor.
 * Campaigns that convert clicks into conversions efficiently score higher.
 *
 * Returns a non-negative number. Higher is better.
 */
export function calculateRoiScore(perf: AdPerformance): number {
  // Base: direct ROI value
  let score = Math.max(perf.roi, 0);

  // Bonus for click-through efficiency (ctr is typically 0–1)
  score += perf.ctr * 2;

  // Bonus for conversion efficiency: conversions per dollar spent
  if (perf.spend > 0) {
    score += (perf.conversions / perf.spend) * 10;
  }

  return score;
}

/**
 * Generates budget alerts for a campaign based on its current state.
 */
export function generateAlerts(
  campaign: AdCampaign,
  perf: AdPerformance,
  config: BudgetOptimizerConfig = DEFAULT_CONFIG,
): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  const { budget } = campaign;

  // Low budget warning
  const remainingFraction = budget.totalLimit > 0 ? budget.remaining / budget.totalLimit : 0;
  if (remainingFraction <= config.lowBudgetThreshold && remainingFraction > 0) {
    alerts.push({
      adCampaignId: campaign.adCampaignId,
      severity: 'warning',
      message: `Budget running low: ${(remainingFraction * 100).toFixed(1)}% remaining`,
    });
  }

  // Overspend alert
  const spentFraction = budget.totalLimit > 0 ? perf.spend / budget.totalLimit : 0;
  if (spentFraction >= config.overspendThreshold) {
    alerts.push({
      adCampaignId: campaign.adCampaignId,
      severity: 'critical',
      message: `Overspend alert: ${(spentFraction * 100).toFixed(1)}% of total budget spent`,
    });
  }

  // Budget exhausted
  if (budget.remaining <= 0) {
    alerts.push({
      adCampaignId: campaign.adCampaignId,
      severity: 'critical',
      message: 'Budget fully exhausted',
    });
  }

  // Negative ROI warning
  if (perf.roi < 0) {
    alerts.push({
      adCampaignId: campaign.adCampaignId,
      severity: 'warning',
      message: `Negative ROI: ${perf.roi.toFixed(2)}`,
    });
  }

  return alerts;
}

/**
 * BudgetOptimizer allocates budget across ad campaigns based on ROI performance.
 *
 * It implements:
 * 1. ROI-based budget allocation — higher-ROI campaigns get proportionally more budget
 * 2. Dynamic reallocation — shifts budget from underperforming to overperforming campaigns
 * 3. Budget tracking and alerts — warns on low budget, alerts on overspend
 */
export class BudgetOptimizer {
  private readonly config: BudgetOptimizerConfig;

  constructor(config?: Partial<BudgetOptimizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Optimizes budget allocation across a set of ad campaigns.
   *
   * Preconditions:
   * - campaigns list is non-empty
   * - All campaigns have performance data in the performance map
   * - Total available budget > 0
   *
   * Postconditions:
   * - Returns BudgetAllocation with optimized distribution
   * - Sum of allocations equals total available budget
   * - Higher ROI campaigns receive more budget
   * - All allocations are non-negative
   * - Minimum budget threshold is respected for each funded campaign
   */
  optimizeBudget(campaigns: AdCampaign[], performance: PerformanceData): BudgetAllocation {
    if (campaigns.length === 0) {
      throw new Error('Campaigns list must not be empty');
    }

    // Only consider active/paused campaigns (not completed/rejected)
    const eligibleCampaigns = campaigns.filter(
      (c) => c.status === AdStatus.ACTIVE || c.status === AdStatus.PAUSED,
    );

    // Calculate total available budget across all campaigns
    const totalBudget = campaigns.reduce((sum, c) => sum + c.budget.remaining, 0);

    if (totalBudget <= 0) {
      return this.buildZeroBudgetResult(campaigns, performance);
    }

    // Step 1: Calculate ROI scores for each eligible campaign
    const scored: Array<{ campaign: AdCampaign; perf: AdPerformance; roiScore: number }> = [];
    for (const campaign of eligibleCampaigns) {
      const perf = performance.metrics.get(campaign.adCampaignId) ?? campaign.performance;
      const roiScore = calculateRoiScore(perf);
      scored.push({ campaign, perf, roiScore });
    }

    // Step 2: Separate funded vs unfunded campaigns
    const funded = scored.filter((s) => s.roiScore > this.config.minRoiForFunding);
    const unfunded = scored.filter((s) => s.roiScore <= this.config.minRoiForFunding);

    // Step 3: Allocate budget proportionally by ROI score
    const totalRoiScore = funded.reduce((sum, s) => sum + s.roiScore, 0);

    const allocations: CampaignAllocation[] = [];
    let allocatedSoFar = 0;

    if (totalRoiScore > 0 && funded.length > 0) {
      for (let i = 0; i < funded.length; i++) {
        const { campaign, roiScore } = funded[i];
        const proportion = roiScore / totalRoiScore;
        let allocated: number;

        if (i === funded.length - 1) {
          // Last campaign gets the remainder to avoid rounding drift
          allocated = Math.round((totalBudget - allocatedSoFar) * 100) / 100;
        } else {
          allocated = Math.round(totalBudget * proportion * 100) / 100;
        }

        // Enforce minimum budget
        allocated = Math.max(allocated, Math.min(this.config.minCampaignBudget, totalBudget - allocatedSoFar));
        allocatedSoFar += allocated;

        allocations.push({
          adCampaignId: campaign.adCampaignId,
          allocatedBudget: allocated,
          previousBudget: campaign.budget.remaining,
          roiScore,
        });
      }
    } else {
      // No campaigns with positive ROI — distribute equally among eligible
      const perCampaign = Math.round((totalBudget / eligibleCampaigns.length) * 100) / 100;
      for (let i = 0; i < eligibleCampaigns.length; i++) {
        const campaign = eligibleCampaigns[i];
        const perf = performance.metrics.get(campaign.adCampaignId) ?? campaign.performance;
        const roiScore = calculateRoiScore(perf);
        const allocated = i === eligibleCampaigns.length - 1
          ? Math.round((totalBudget - allocatedSoFar) * 100) / 100
          : perCampaign;
        allocatedSoFar += allocated;

        allocations.push({
          adCampaignId: campaign.adCampaignId,
          allocatedBudget: allocated,
          previousBudget: campaign.budget.remaining,
          roiScore,
        });
      }
    }

    // Unfunded campaigns get 0
    for (const { campaign, roiScore } of unfunded) {
      allocations.push({
        adCampaignId: campaign.adCampaignId,
        allocatedBudget: 0,
        previousBudget: campaign.budget.remaining,
        roiScore,
      });
    }

    // Step 4: Generate alerts
    const alerts: BudgetAlert[] = [];
    for (const campaign of campaigns) {
      const perf = performance.metrics.get(campaign.adCampaignId) ?? campaign.performance;
      alerts.push(...generateAlerts(campaign, perf, this.config));
    }

    logger.info(
      { totalBudget, campaignCount: campaigns.length, alertCount: alerts.length },
      'Budget optimization complete',
    );

    return { allocations, totalBudget, alerts };
  }

  /**
   * Builds a result when total budget is zero — all campaigns get 0 allocation
   * and critical alerts are raised.
   */
  private buildZeroBudgetResult(
    campaigns: AdCampaign[],
    performance: PerformanceData,
  ): BudgetAllocation {
    const alerts: BudgetAlert[] = [];
    const allocations: CampaignAllocation[] = [];

    for (const campaign of campaigns) {
      const perf = performance.metrics.get(campaign.adCampaignId) ?? campaign.performance;
      allocations.push({
        adCampaignId: campaign.adCampaignId,
        allocatedBudget: 0,
        previousBudget: campaign.budget.remaining,
        roiScore: calculateRoiScore(perf),
      });
      alerts.push(...generateAlerts(campaign, perf, this.config));
    }

    return { allocations, totalBudget: 0, alerts };
  }
}
