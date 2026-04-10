import { describe, it, expect, vi } from 'vitest';
import {
  EngagementAnalyzer,
  PlatformMetricsClient,
  RawPlatformMetrics,
  calculateEngagementRate,
} from './engagement-analyzer';
import { Platform } from '../../models/enums';
import { DemographicData } from '../../models/common';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRaw(overrides: Partial<RawPlatformMetrics> = {}): RawPlatformMetrics {
  return {
    likes: 100,
    comments: 20,
    shares: 10,
    views: 500,
    clicks: 30,
    reach: 800,
    impressions: 1000,
    ...overrides,
  };
}

function makeDemographics(overrides: Partial<DemographicData> = {}): DemographicData {
  return {
    ageGroups: { '18-24': 0.3, '25-34': 0.5, '35-44': 0.2 },
    genderDistribution: { male: 0.45, female: 0.50, other: 0.05 },
    topLocations: ['New York', 'London', 'Tokyo'],
    ...overrides,
  };
}

function mockClient(
  metrics?: RawPlatformMetrics,
  demographics?: DemographicData,
): PlatformMetricsClient {
  return {
    fetchPostMetrics: vi.fn().mockResolvedValue(metrics ?? makeRaw()),
    fetchPostDemographics: vi.fn().mockResolvedValue(demographics ?? makeDemographics()),
  };
}

// ---------------------------------------------------------------------------
// calculateEngagementRate
// ---------------------------------------------------------------------------

describe('calculateEngagementRate', () => {
  it('computes (likes + comments + shares + clicks) / impressions', () => {
    const raw = makeRaw({ likes: 100, comments: 20, shares: 10, clicks: 30, impressions: 1000 });
    // (100 + 20 + 10 + 30) / 1000 = 0.16
    expect(calculateEngagementRate(raw)).toBeCloseTo(0.16);
  });

  it('returns 0 when impressions is 0', () => {
    expect(calculateEngagementRate(makeRaw({ impressions: 0 }))).toBe(0);
  });

  it('returns 0 when impressions is negative', () => {
    expect(calculateEngagementRate(makeRaw({ impressions: -5 }))).toBe(0);
  });

  it('clamps the rate to a maximum of 1', () => {
    // engagements > impressions → rate > 1 → clamped to 1
    const raw = makeRaw({ likes: 500, comments: 300, shares: 200, clicks: 100, impressions: 100 });
    expect(calculateEngagementRate(raw)).toBe(1);
  });

  it('returns 0 when all engagement counts are 0', () => {
    const raw = makeRaw({ likes: 0, comments: 0, shares: 0, clicks: 0, impressions: 1000 });
    expect(calculateEngagementRate(raw)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EngagementAnalyzer
// ---------------------------------------------------------------------------

describe('EngagementAnalyzer', () => {
  describe('analyzeEngagement', () => {
    it('returns EngagementMetrics with correct values', async () => {
      const raw = makeRaw();
      const demo = makeDemographics();
      const client = mockClient(raw, demo);

      const analyzer = new EngagementAnalyzer(new Map([[Platform.INSTAGRAM, client]]));
      const result = await analyzer.analyzeEngagement('post-1', Platform.INSTAGRAM);

      expect(result.postId).toBe('post-1');
      expect(result.platform).toBe(Platform.INSTAGRAM);
      expect(result.likes).toBe(raw.likes);
      expect(result.comments).toBe(raw.comments);
      expect(result.shares).toBe(raw.shares);
      expect(result.views).toBe(raw.views);
      expect(result.clicks).toBe(raw.clicks);
      expect(result.reach).toBe(raw.reach);
      expect(result.impressions).toBe(raw.impressions);
      expect(result.engagementRate).toBeCloseTo(0.16);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('calls the platform client with the correct postId', async () => {
      const client = mockClient();
      const analyzer = new EngagementAnalyzer(new Map([[Platform.FACEBOOK, client]]));

      await analyzer.analyzeEngagement('fb-42', Platform.FACEBOOK);

      expect(client.fetchPostMetrics).toHaveBeenCalledWith('fb-42');
      expect(client.fetchPostDemographics).toHaveBeenCalledWith('fb-42');
    });

    it('throws when no client is registered for the platform', async () => {
      const analyzer = new EngagementAnalyzer();
      await expect(analyzer.analyzeEngagement('x', Platform.TIKTOK)).rejects.toThrow(
        'No metrics client registered for platform: TIKTOK',
      );
    });

    it('supports registering clients after construction', async () => {
      const analyzer = new EngagementAnalyzer();
      const client = mockClient();
      analyzer.registerClient(Platform.TWITTER, client);

      const result = await analyzer.analyzeEngagement('tw-1', Platform.TWITTER);
      expect(result.postId).toBe('tw-1');
      expect(result.platform).toBe(Platform.TWITTER);
    });

    it('fetches metrics and demographics in parallel', async () => {
      const order: string[] = [];
      const client: PlatformMetricsClient = {
        fetchPostMetrics: vi.fn().mockImplementation(async () => {
          order.push('metrics-start');
          await new Promise((r) => setTimeout(r, 10));
          order.push('metrics-end');
          return makeRaw();
        }),
        fetchPostDemographics: vi.fn().mockImplementation(async () => {
          order.push('demo-start');
          await new Promise((r) => setTimeout(r, 10));
          order.push('demo-end');
          return makeDemographics();
        }),
      };

      const analyzer = new EngagementAnalyzer(new Map([[Platform.INSTAGRAM, client]]));
      await analyzer.analyzeEngagement('p1', Platform.INSTAGRAM);

      // Both should start before either ends (parallel execution)
      expect(order.indexOf('metrics-start')).toBeLessThan(order.indexOf('metrics-end'));
      expect(order.indexOf('demo-start')).toBeLessThan(order.indexOf('demo-end'));
    });

    it('propagates errors from the metrics client', async () => {
      const client: PlatformMetricsClient = {
        fetchPostMetrics: vi.fn().mockRejectedValue(new Error('API down')),
        fetchPostDemographics: vi.fn().mockResolvedValue(makeDemographics()),
      };

      const analyzer = new EngagementAnalyzer(new Map([[Platform.INSTAGRAM, client]]));
      await expect(analyzer.analyzeEngagement('p1', Platform.INSTAGRAM)).rejects.toThrow('API down');
    });
  });
});
