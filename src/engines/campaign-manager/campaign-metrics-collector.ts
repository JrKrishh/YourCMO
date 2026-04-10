import { Campaign } from '../../models';
import { CampaignMetrics } from '../../models/common';
import { EngagementMetrics } from '../../models/engagement-metrics';
import { PlatformContent } from '../../models/platform-content';
import { createLogger } from '../../utils/logger';

const log = createLogger('CampaignMetricsCollector');

/** WhatsApp-specific delivery and engagement metrics */
export interface WhatsAppEngagementMetrics {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalResponded: number;
  deliveryRate: number;
  readRate: number;
  responseRate: number;
}

/** Full campaign performance report */
export interface CampaignPerformanceReport {
  campaignId: string;
  campaignName: string;
  metrics: CampaignMetrics;
  whatsappMetrics?: WhatsAppEngagementMetrics;
  postMetrics: EngagementMetrics[];
  generatedAt: Date;
}

/**
 * CampaignMetricsCollector — aggregates metrics from campaign posts,
 * tracks WhatsApp engagement, and generates performance reports.
 */
export class CampaignMetricsCollector {
  /**
   * Aggregate CampaignMetrics from a campaign's content engagement data.
   * Collects metrics from all posts across platforms and computes totals.
   */
  aggregateMetrics(campaign: Campaign): CampaignMetrics {
    const postMetrics = this.collectPostMetrics(campaign.content);

    if (postMetrics.length === 0) {
      return { ...campaign.metrics };
    }

    const totalReach = postMetrics.reduce((sum, m) => sum + m.reach, 0);
    const totalImpressions = postMetrics.reduce((sum, m) => sum + m.impressions, 0);
    const totalEngagements = postMetrics.reduce(
      (sum, m) => sum + m.likes + m.comments + m.shares + m.clicks,
      0,
    );
    const averageEngagementRate =
      postMetrics.reduce((sum, m) => sum + m.engagementRate, 0) / postMetrics.length;

    return {
      totalReach,
      totalImpressions,
      totalEngagements,
      averageEngagementRate,
      totalSpend: campaign.budget.spent,
      roi: this.calculateRoi(totalEngagements, campaign.budget.spent),
    };
  }

  /**
   * Collect EngagementMetrics from all campaign content that has metrics attached.
   */
  collectPostMetrics(content: PlatformContent[]): EngagementMetrics[] {
    return content
      .filter((c): c is PlatformContent & { engagementMetrics: EngagementMetrics } =>
        c.engagementMetrics !== undefined && c.engagementMetrics !== null,
      )
      .map((c) => c.engagementMetrics);
  }

  /**
   * Compute WhatsApp-specific engagement metrics from delivery data.
   *
   * Rates:
   * - deliveryRate = delivered / sent
   * - readRate = read / delivered
   * - responseRate = responded / delivered
   */
  computeWhatsAppEngagement(
    totalSent: number,
    totalDelivered: number,
    totalRead: number,
    totalResponded: number,
  ): WhatsAppEngagementMetrics {
    const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : 0;
    const readRate = totalDelivered > 0 ? totalRead / totalDelivered : 0;
    const responseRate = totalDelivered > 0 ? totalResponded / totalDelivered : 0;

    return {
      totalSent,
      totalDelivered,
      totalRead,
      totalResponded,
      deliveryRate,
      readRate,
      responseRate,
    };
  }

  /**
   * Generate a full campaign performance report with all KPIs.
   */
  generatePerformanceReport(
    campaign: Campaign,
    whatsappData?: { sent: number; delivered: number; read: number; responded: number },
  ): CampaignPerformanceReport {
    const metrics = this.aggregateMetrics(campaign);
    const postMetrics = this.collectPostMetrics(campaign.content);

    const report: CampaignPerformanceReport = {
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      metrics,
      postMetrics,
      generatedAt: new Date(),
    };

    if (whatsappData) {
      report.whatsappMetrics = this.computeWhatsAppEngagement(
        whatsappData.sent,
        whatsappData.delivered,
        whatsappData.read,
        whatsappData.responded,
      );
    }

    log.info(
      { campaignId: campaign.campaignId, totalEngagements: metrics.totalEngagements },
      'Performance report generated',
    );

    return report;
  }

  /** Calculate ROI: (engagements - spend) / spend. Returns 0 if no spend. */
  private calculateRoi(totalEngagements: number, totalSpend: number): number {
    if (totalSpend <= 0) return 0;
    return (totalEngagements - totalSpend) / totalSpend;
  }
}
