import { describe, it, expect, beforeEach } from 'vitest';
import { CampaignMetricsCollector } from './campaign-metrics-collector';
import { CampaignManager } from './campaign-manager';
import { Campaign, CampaignType, CampaignStatus, Platform } from '../../models';
import { PlatformContent } from '../../models/platform-content';
import { EngagementMetrics } from '../../models/engagement-metrics';

function makeEngagementMetrics(overrides: Partial<EngagementMetrics> = {}): EngagementMetrics {
  return {
    postId: 'post-1',
    platform: Platform.INSTAGRAM,
    likes: 100,
    comments: 20,
    shares: 10,
    views: 1000,
    clicks: 50,
    reach: 800,
    impressions: 1200,
    engagementRate: 0.15,
    timestamp: new Date(),
    ...overrides,
  };
}

function makeContentWithMetrics(metrics?: EngagementMetrics): PlatformContent {
  return {
    contentId: 'c-1',
    platform: Platform.INSTAGRAM,
    text: 'Test post',
    visualAssets: [],
    hashtags: [],
    mentions: [],
    engagementMetrics: metrics,
  };
}

function makeCampaign(content: PlatformContent[], spent = 0): Campaign {
  return {
    campaignId: 'camp-1',
    name: 'Test Campaign',
    type: CampaignType.MULTI_PLATFORM,
    status: CampaignStatus.ACTIVE,
    content,
    targetAudience: [],
    schedule: { startDate: new Date(), endDate: new Date(), timezone: 'UTC', sendTimes: [] },
    budget: { dailyLimit: 100, totalLimit: 1000, remaining: 1000 - spent, spent, currency: 'USD' },
    startDate: new Date(),
    endDate: new Date(Date.now() + 86400_000),
    metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
    optimizationRules: [],
  };
}

describe('CampaignMetricsCollector', () => {
  let collector: CampaignMetricsCollector;

  beforeEach(() => {
    collector = new CampaignMetricsCollector();
  });

  describe('collectPostMetrics', () => {
    it('should collect metrics from content that has engagement data', () => {
      const m1 = makeEngagementMetrics({ postId: 'p1' });
      const m2 = makeEngagementMetrics({ postId: 'p2' });
      const content = [
        makeContentWithMetrics(m1),
        makeContentWithMetrics(undefined), // no metrics
        makeContentWithMetrics(m2),
      ];

      const result = collector.collectPostMetrics(content);
      expect(result).toHaveLength(2);
      expect(result[0].postId).toBe('p1');
      expect(result[1].postId).toBe('p2');
    });

    it('should return empty array when no content has metrics', () => {
      const content = [makeContentWithMetrics(undefined), makeContentWithMetrics(undefined)];
      expect(collector.collectPostMetrics(content)).toHaveLength(0);
    });

    it('should return empty array for empty content list', () => {
      expect(collector.collectPostMetrics([])).toHaveLength(0);
    });
  });

  describe('aggregateMetrics', () => {
    it('should aggregate metrics from multiple posts', () => {
      const m1 = makeEngagementMetrics({ reach: 500, impressions: 800, likes: 50, comments: 10, shares: 5, clicks: 20, engagementRate: 0.10 });
      const m2 = makeEngagementMetrics({ reach: 300, impressions: 600, likes: 30, comments: 5, shares: 3, clicks: 10, engagementRate: 0.08 });
      const campaign = makeCampaign([makeContentWithMetrics(m1), makeContentWithMetrics(m2)], 200);

      const metrics = collector.aggregateMetrics(campaign);

      expect(metrics.totalReach).toBe(800);
      expect(metrics.totalImpressions).toBe(1400);
      // engagements = (50+10+5+20) + (30+5+3+10) = 85 + 48 = 133
      expect(metrics.totalEngagements).toBe(133);
      expect(metrics.averageEngagementRate).toBeCloseTo(0.09);
      expect(metrics.totalSpend).toBe(200);
      // roi = (133 - 200) / 200 = -0.335
      expect(metrics.roi).toBeCloseTo(-0.335);
    });

    it('should return existing metrics when no posts have engagement data', () => {
      const campaign = makeCampaign([makeContentWithMetrics(undefined)]);
      campaign.metrics = { totalReach: 5, totalImpressions: 10, totalEngagements: 2, averageEngagementRate: 0.2, totalSpend: 0, roi: 0 };

      const metrics = collector.aggregateMetrics(campaign);
      expect(metrics.totalReach).toBe(5);
      expect(metrics.totalImpressions).toBe(10);
    });

    it('should return zero ROI when no spend', () => {
      const m = makeEngagementMetrics({ reach: 100, impressions: 200 });
      const campaign = makeCampaign([makeContentWithMetrics(m)], 0);

      const metrics = collector.aggregateMetrics(campaign);
      expect(metrics.roi).toBe(0);
      expect(metrics.totalSpend).toBe(0);
    });
  });

  describe('computeWhatsAppEngagement', () => {
    it('should compute correct rates', () => {
      const result = collector.computeWhatsAppEngagement(1000, 900, 600, 200);

      expect(result.totalSent).toBe(1000);
      expect(result.totalDelivered).toBe(900);
      expect(result.totalRead).toBe(600);
      expect(result.totalResponded).toBe(200);
      expect(result.deliveryRate).toBeCloseTo(0.9);
      expect(result.readRate).toBeCloseTo(0.6667, 3);
      expect(result.responseRate).toBeCloseTo(0.2222, 3);
    });

    it('should return zero rates when no messages sent', () => {
      const result = collector.computeWhatsAppEngagement(0, 0, 0, 0);

      expect(result.deliveryRate).toBe(0);
      expect(result.readRate).toBe(0);
      expect(result.responseRate).toBe(0);
    });

    it('should handle zero delivered (readRate and responseRate = 0)', () => {
      const result = collector.computeWhatsAppEngagement(100, 0, 0, 0);

      expect(result.deliveryRate).toBe(0);
      expect(result.readRate).toBe(0);
      expect(result.responseRate).toBe(0);
    });

    it('should handle perfect delivery and engagement', () => {
      const result = collector.computeWhatsAppEngagement(500, 500, 500, 500);

      expect(result.deliveryRate).toBe(1);
      expect(result.readRate).toBe(1);
      expect(result.responseRate).toBe(1);
    });
  });

  describe('generatePerformanceReport', () => {
    it('should generate a report with aggregated metrics', () => {
      const m = makeEngagementMetrics({ reach: 400, impressions: 700 });
      const campaign = makeCampaign([makeContentWithMetrics(m)], 50);

      const report = collector.generatePerformanceReport(campaign);

      expect(report.campaignId).toBe('camp-1');
      expect(report.campaignName).toBe('Test Campaign');
      expect(report.metrics.totalReach).toBe(400);
      expect(report.metrics.totalImpressions).toBe(700);
      expect(report.postMetrics).toHaveLength(1);
      expect(report.whatsappMetrics).toBeUndefined();
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('should include WhatsApp metrics when provided', () => {
      const campaign = makeCampaign([makeContentWithMetrics(makeEngagementMetrics())]);

      const report = collector.generatePerformanceReport(campaign, {
        sent: 200,
        delivered: 180,
        read: 100,
        responded: 40,
      });

      expect(report.whatsappMetrics).toBeDefined();
      expect(report.whatsappMetrics!.deliveryRate).toBeCloseTo(0.9);
      expect(report.whatsappMetrics!.readRate).toBeCloseTo(0.5556, 3);
      expect(report.whatsappMetrics!.responseRate).toBeCloseTo(0.2222, 3);
    });
  });
});

describe('CampaignManager.getCampaignMetrics', () => {
  it('should return aggregated metrics for a campaign', () => {
    const manager = new CampaignManager();
    const campaign = manager.createCampaign({
      name: 'Metrics Test',
      type: CampaignType.MULTI_PLATFORM,
    });

    const metrics = manager.getCampaignMetrics(campaign.campaignId);

    // No content with engagement data, so returns existing (empty) metrics
    expect(metrics.totalReach).toBe(0);
    expect(metrics.totalEngagements).toBe(0);
    expect(metrics.totalSpend).toBe(0);
  });

  it('should throw for unknown campaign ID', () => {
    const manager = new CampaignManager();
    expect(() => manager.getCampaignMetrics('nonexistent')).toThrow('Campaign not found');
  });
});
