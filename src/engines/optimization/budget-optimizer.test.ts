import { describe, it, expect } from 'vitest';
import {
  BudgetOptimizer,
  calculateRoiScore,
  generateAlerts,
  PerformanceData,
} from './budget-optimizer';
import { AdCampaign } from '../../models/ad-campaign';
import { AdPlatform, AdStatus, Platform } from '../../models/enums';
import { AdPerformance, Budget } from '../../models/common';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePerf(overrides: Partial<AdPerformance> = {}): AdPerformance {
  return {
    impressions: 10000,
    clicks: 200,
    conversions: 20,
    spend: 100,
    cpc: 0.5,
    cpm: 10,
    ctr: 0.02,
    roi: 1.5,
    ...overrides,
  };
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    dailyLimit: 50,
    totalLimit: 500,
    remaining: 200,
    spent: 300,
    currency: 'USD',
    ...overrides,
  };
}

function makeCampaign(
  id: string,
  overrides: Partial<AdCampaign> = {},
): AdCampaign {
  return {
    adCampaignId: id,
    platform: AdPlatform.GOOGLE_ADS,
    content: {
      contentId: 'c-1',
      platform: Platform.INSTAGRAM,
      text: '',
      visualAssets: [],
      hashtags: [],
      mentions: [],
      postId: 'p-1',
    },
    targeting: {},
    budget: makeBudget(),
    bidStrategy: { type: 'CPC', maxBid: 1 },
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 86400000),
    status: AdStatus.ACTIVE,
    performance: makePerf(),
    ...overrides,
  };
}

function makePerfData(entries: Array<[string, Partial<AdPerformance>]>): PerformanceData {
  const metrics = new Map<string, AdPerformance>();
  for (const [id, overrides] of entries) {
    metrics.set(id, makePerf(overrides));
  }
  return { metrics };
}

// ---------------------------------------------------------------------------
// calculateRoiScore
// ---------------------------------------------------------------------------

describe('calculateRoiScore', () => {
  it('returns 0 for a campaign with zero ROI, zero CTR, and zero conversions', () => {
    const score = calculateRoiScore(makePerf({ roi: 0, ctr: 0, conversions: 0, spend: 100 }));
    expect(score).toBe(0);
  });

  it('returns a positive score for positive ROI', () => {
    expect(calculateRoiScore(makePerf({ roi: 2.0 }))).toBeGreaterThan(0);
  });

  it('treats negative ROI as 0 for the ROI component', () => {
    const negativeRoi = calculateRoiScore(makePerf({ roi: -1, ctr: 0, conversions: 0, spend: 100 }));
    expect(negativeRoi).toBe(0);
  });

  it('higher ROI yields higher score', () => {
    const low = calculateRoiScore(makePerf({ roi: 0.5 }));
    const high = calculateRoiScore(makePerf({ roi: 3.0 }));
    expect(high).toBeGreaterThan(low);
  });

  it('includes CTR bonus', () => {
    const noCtr = calculateRoiScore(makePerf({ roi: 1, ctr: 0, conversions: 0, spend: 100 }));
    const withCtr = calculateRoiScore(makePerf({ roi: 1, ctr: 0.05, conversions: 0, spend: 100 }));
    expect(withCtr).toBeGreaterThan(noCtr);
  });

  it('includes conversion efficiency bonus', () => {
    const noConv = calculateRoiScore(makePerf({ roi: 1, ctr: 0, conversions: 0, spend: 100 }));
    const withConv = calculateRoiScore(makePerf({ roi: 1, ctr: 0, conversions: 10, spend: 100 }));
    expect(withConv).toBeGreaterThan(noConv);
  });
});

// ---------------------------------------------------------------------------
// generateAlerts
// ---------------------------------------------------------------------------

describe('generateAlerts', () => {
  it('generates a low-budget warning when remaining is below threshold', () => {
    const campaign = makeCampaign('a', {
      budget: makeBudget({ totalLimit: 1000, remaining: 100 }), // 10% remaining
    });
    const alerts = generateAlerts(campaign, makePerf());
    const lowBudget = alerts.find((a) => a.message.includes('Budget running low'));
    expect(lowBudget).toBeDefined();
    expect(lowBudget!.severity).toBe('warning');
  });

  it('does not generate low-budget warning when remaining is above threshold', () => {
    const campaign = makeCampaign('a', {
      budget: makeBudget({ totalLimit: 1000, remaining: 500 }), // 50% remaining
    });
    const alerts = generateAlerts(campaign, makePerf());
    expect(alerts.find((a) => a.message.includes('Budget running low'))).toBeUndefined();
  });

  it('generates an overspend alert when spend exceeds threshold', () => {
    const campaign = makeCampaign('a', {
      budget: makeBudget({ totalLimit: 100, remaining: 2 }),
    });
    const alerts = generateAlerts(campaign, makePerf({ spend: 96 }));
    const overspend = alerts.find((a) => a.message.includes('Overspend'));
    expect(overspend).toBeDefined();
    expect(overspend!.severity).toBe('critical');
  });

  it('generates a critical alert when budget is fully exhausted', () => {
    const campaign = makeCampaign('a', {
      budget: makeBudget({ totalLimit: 100, remaining: 0 }),
    });
    const alerts = generateAlerts(campaign, makePerf());
    expect(alerts.find((a) => a.message.includes('fully exhausted'))).toBeDefined();
  });

  it('generates a negative ROI warning', () => {
    const campaign = makeCampaign('a');
    const alerts = generateAlerts(campaign, makePerf({ roi: -0.5 }));
    expect(alerts.find((a) => a.message.includes('Negative ROI'))).toBeDefined();
  });

  it('generates no alerts for a healthy campaign', () => {
    const campaign = makeCampaign('a', {
      budget: makeBudget({ totalLimit: 1000, remaining: 600 }),
    });
    const alerts = generateAlerts(campaign, makePerf({ spend: 100, roi: 2 }));
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BudgetOptimizer.optimizeBudget
// ---------------------------------------------------------------------------

describe('BudgetOptimizer', () => {
  describe('optimizeBudget', () => {
    it('throws when campaigns list is empty', () => {
      const optimizer = new BudgetOptimizer();
      expect(() =>
        optimizer.optimizeBudget([], { metrics: new Map() }),
      ).toThrow('Campaigns list must not be empty');
    });

    it('allocates more budget to higher-ROI campaigns', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('high', { performance: makePerf({ roi: 5, ctr: 0.05, conversions: 50, spend: 100 }) }),
        makeCampaign('low', { performance: makePerf({ roi: 0.5, ctr: 0.01, conversions: 2, spend: 100 }) }),
      ];
      const perfData = makePerfData([
        ['high', { roi: 5, ctr: 0.05, conversions: 50, spend: 100 }],
        ['low', { roi: 0.5, ctr: 0.01, conversions: 2, spend: 100 }],
      ]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      const highAlloc = result.allocations.find((a) => a.adCampaignId === 'high')!;
      const lowAlloc = result.allocations.find((a) => a.adCampaignId === 'low')!;

      expect(highAlloc.allocatedBudget).toBeGreaterThan(lowAlloc.allocatedBudget);
    });

    it('sum of allocations equals total available budget', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('a', { budget: makeBudget({ remaining: 100 }) }),
        makeCampaign('b', { budget: makeBudget({ remaining: 150 }) }),
        makeCampaign('c', { budget: makeBudget({ remaining: 50 }) }),
      ];
      const perfData = makePerfData([
        ['a', { roi: 2 }],
        ['b', { roi: 3 }],
        ['c', { roi: 1 }],
      ]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      const totalAllocated = result.allocations.reduce((s, a) => s + a.allocatedBudget, 0);

      expect(totalAllocated).toBeCloseTo(result.totalBudget, 1);
    });

    it('all allocations are non-negative', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('a'),
        makeCampaign('b', { performance: makePerf({ roi: -1 }) }),
      ];
      const perfData = makePerfData([
        ['a', { roi: 2 }],
        ['b', { roi: -1, ctr: 0, conversions: 0, spend: 100 }],
      ]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      for (const alloc of result.allocations) {
        expect(alloc.allocatedBudget).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns zero allocations when total budget is zero', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('a', { budget: makeBudget({ remaining: 0 }) }),
      ];
      const perfData = makePerfData([['a', { roi: 2 }]]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      expect(result.totalBudget).toBe(0);
      expect(result.allocations[0].allocatedBudget).toBe(0);
    });

    it('distributes equally when all campaigns have zero ROI score', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('a', { budget: makeBudget({ remaining: 100 }) }),
        makeCampaign('b', { budget: makeBudget({ remaining: 100 }) }),
      ];
      const perfData = makePerfData([
        ['a', { roi: 0, ctr: 0, conversions: 0, spend: 0 }],
        ['b', { roi: 0, ctr: 0, conversions: 0, spend: 0 }],
      ]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      const allocA = result.allocations.find((a) => a.adCampaignId === 'a')!;
      const allocB = result.allocations.find((a) => a.adCampaignId === 'b')!;

      expect(allocA.allocatedBudget).toBeCloseTo(allocB.allocatedBudget, 1);
    });

    it('excludes completed campaigns from eligible pool', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('active', { status: AdStatus.ACTIVE, budget: makeBudget({ remaining: 100 }) }),
        makeCampaign('done', { status: AdStatus.COMPLETED, budget: makeBudget({ remaining: 100 }) }),
      ];
      const perfData = makePerfData([
        ['active', { roi: 2 }],
        ['done', { roi: 5 }],
      ]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      // Total budget includes all campaigns' remaining
      expect(result.totalBudget).toBe(200);
      // Active campaign should get the full eligible allocation
      const activeAlloc = result.allocations.find((a) => a.adCampaignId === 'active')!;
      expect(activeAlloc.allocatedBudget).toBeGreaterThan(0);
    });

    it('includes paused campaigns in eligible pool', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('paused', { status: AdStatus.PAUSED, budget: makeBudget({ remaining: 100 }) }),
      ];
      const perfData = makePerfData([['paused', { roi: 2 }]]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      const alloc = result.allocations.find((a) => a.adCampaignId === 'paused')!;
      expect(alloc.allocatedBudget).toBeGreaterThan(0);
    });

    it('generates alerts for campaigns with issues', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('low-budget', {
          budget: makeBudget({ totalLimit: 1000, remaining: 50 }),
        }),
      ];
      const perfData = makePerfData([['low-budget', { roi: 2, spend: 950 }]]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      expect(result.alerts.length).toBeGreaterThan(0);
    });

    it('records previousBudget and roiScore in each allocation', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [makeCampaign('a', { budget: makeBudget({ remaining: 200 }) })];
      const perfData = makePerfData([['a', { roi: 3 }]]);

      const result = optimizer.optimizeBudget(campaigns, perfData);
      const alloc = result.allocations[0];

      expect(alloc.previousBudget).toBe(200);
      expect(alloc.roiScore).toBeGreaterThan(0);
    });

    it('uses campaign.performance as fallback when performance data is missing', () => {
      const optimizer = new BudgetOptimizer();
      const campaigns = [
        makeCampaign('a', {
          performance: makePerf({ roi: 2 }),
          budget: makeBudget({ remaining: 100 }),
        }),
      ];
      // Empty performance data — should fall back to campaign.performance
      const perfData: PerformanceData = { metrics: new Map() };

      const result = optimizer.optimizeBudget(campaigns, perfData);
      expect(result.allocations[0].allocatedBudget).toBe(100);
      expect(result.allocations[0].roiScore).toBeGreaterThan(0);
    });
  });
});
