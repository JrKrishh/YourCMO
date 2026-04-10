import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CampaignManager } from './campaign-manager';
import { CampaignStore } from './campaign-store';
import { CampaignScheduler } from './campaign-scheduler';
import { WhatsAppCampaignExecutor, Recipient } from './whatsapp-campaign-executor';
import { CampaignMetricsCollector } from './campaign-metrics-collector';
import { WhatsAppPostingClient, BulkMessageResult } from '../../integrations/platform/whatsapp-client';
import { CampaignType, CampaignStatus, Platform } from '../../models';
import { OAuthToken } from '../../integrations/platform/oauth-manager';
import { PlatformContent } from '../../models/platform-content';
import { EngagementMetrics } from '../../models/engagement-metrics';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeToken(): OAuthToken {
  return {
    accessToken: 'test-token',
    expiresAt: new Date(Date.now() + 3600_000),
    tokenType: 'Bearer',
    platform: Platform.WHATSAPP,
  };
}

function makeRecipients(count: number): Recipient[] {
  return Array.from({ length: count }, (_, i) => ({
    memberId: `m${i + 1}`,
    phone: `+1555000${String(i).padStart(4, '0')}`,
    name: `User ${i + 1}`,
  }));
}

function makeBulkResult(count: number, allSent = true): BulkMessageResult {
  return {
    batchId: 'batch-1',
    total: count,
    sent: allSent ? count : 0,
    failed: allSent ? 0 : count,
    pending: 0,
    results: Array.from({ length: count }, (_, i) => ({
      messageId: `msg-${i}`,
      recipientPhone: `+1555${i}`,
      status: allSent ? ('sent' as const) : ('failed' as const),
      timestamp: new Date(),
      error: allSent ? undefined : 'Send failed',
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Integration: create → schedule → execute → collect metrics        */
/* ------------------------------------------------------------------ */

describe('Campaign Manager Integration', () => {
  let store: CampaignStore;
  let manager: CampaignManager;
  let scheduler: CampaignScheduler;
  let client: WhatsAppPostingClient;
  let executor: WhatsAppCampaignExecutor;
  let metricsCollector: CampaignMetricsCollector;
  const token = makeToken();

  beforeEach(() => {
    store = new CampaignStore();
    manager = new CampaignManager(store);
    scheduler = new CampaignScheduler();
    client = new WhatsAppPostingClient('phone-id');
    executor = new WhatsAppCampaignExecutor(client, {
      batchSize: 5,
      rateLimitDelayMs: 0,
      costPerMessage: 0.05,
      engagementTrackingWindowMs: 0,
    });
    metricsCollector = new CampaignMetricsCollector();
  });

  it('should flow: create → schedule → execute → collect metrics', async () => {
    // Step 1: Create campaign
    const campaign = manager.createCampaign({
      name: 'End-to-End WhatsApp',
      type: CampaignType.WHATSAPP,
      budget: { dailyLimit: 50, totalLimit: 500, currency: 'USD' },
      schedule: { timezone: 'UTC' },
      startDate: new Date('2025-07-01T00:00:00Z'),
      endDate: new Date('2025-07-31T23:59:59Z'),
    });
    expect(campaign.status).toBe(CampaignStatus.DRAFT);

    // Step 2: Schedule messages
    const scheduleResult = scheduler.scheduleMessages(
      manager.getCampaign(campaign.campaignId),
      {
        startDate: new Date('2025-07-01T00:00:00Z'),
        endDate: new Date('2025-07-31T23:59:59Z'),
        timezone: 'UTC',
        sendTimes: [new Date('2025-07-10T10:00:00Z')],
      },
    );
    expect(scheduleResult.success).toBe(true);
    expect(scheduleResult.totalMessages).toBe(1);

    // Step 3: Transition to ACTIVE
    const activeCampaign = manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
    expect(activeCampaign.status).toBe(CampaignStatus.ACTIVE);

    // Step 4: Add content and audience to the stored campaign for execution
    const storedCampaign = manager.getCampaign(campaign.campaignId);
    storedCampaign.content = [{
      contentId: 'c-1',
      platform: Platform.WHATSAPP,
      text: 'Hello {{name}}, welcome to our campaign!',
      visualAssets: [],
      hashtags: [],
      mentions: [],
    }];
    storedCampaign.targetAudience = [{
      segmentId: 'seg-1',
      name: 'All Users',
      criteria: {},
      size: 3,
      members: ['m1', 'm2', 'm3'],
    }];

    // Step 5: Execute WhatsApp campaign
    const recipients = makeRecipients(3);
    vi.spyOn(client, 'sendBulkMessages').mockResolvedValueOnce(makeBulkResult(3));

    const execResult = await executor.executeCampaign(storedCampaign, token, recipients);
    expect(execResult.success).toBe(true);
    expect(execResult.delivered).toBe(3);
    expect(execResult.totalCost).toBeCloseTo(0.15);

    // Step 6: Collect metrics
    const whatsappMetrics = metricsCollector.computeWhatsAppEngagement(3, 3, 2, 1);
    expect(whatsappMetrics.deliveryRate).toBe(1);
    expect(whatsappMetrics.readRate).toBeCloseTo(0.6667, 3);

    const report = metricsCollector.generatePerformanceReport(storedCampaign, {
      sent: 3,
      delivered: 3,
      read: 2,
      responded: 1,
    });
    expect(report.campaignId).toBe(campaign.campaignId);
    expect(report.whatsappMetrics).toBeDefined();
    expect(report.whatsappMetrics!.totalSent).toBe(3);

    // Step 7: Complete campaign
    const completed = manager.transitionStatus(campaign.campaignId, CampaignStatus.COMPLETED);
    expect(completed.status).toBe(CampaignStatus.COMPLETED);
  });

  it('should flow: create → schedule with conflict detection → pause → resume → complete', () => {
    // Create two campaigns targeting the same audience
    const campaign1 = manager.createCampaign({
      name: 'Campaign A',
      type: CampaignType.WHATSAPP,
      startDate: new Date('2025-07-01'),
      endDate: new Date('2025-07-31'),
    });
    manager.transitionStatus(campaign1.campaignId, CampaignStatus.ACTIVE);

    const campaign2 = manager.createCampaign({
      name: 'Campaign B',
      type: CampaignType.WHATSAPP,
      startDate: new Date('2025-07-15'),
      endDate: new Date('2025-08-15'),
    });

    // Add overlapping audiences
    const stored1 = manager.getCampaign(campaign1.campaignId);
    stored1.targetAudience = [{ segmentId: 's1', name: 'Seg', criteria: {}, size: 2, members: ['u1', 'u2'] }];
    store.save(stored1);

    const stored2 = manager.getCampaign(campaign2.campaignId);
    stored2.targetAudience = [{ segmentId: 's2', name: 'Seg', criteria: {}, size: 2, members: ['u1', 'u3'] }];

    // Schedule campaign2 and detect conflict with campaign1
    const scheduleResult = scheduler.scheduleMessages(
      stored2,
      {
        startDate: new Date('2025-07-15'),
        endDate: new Date('2025-08-15'),
        timezone: 'UTC',
        sendTimes: [new Date('2025-07-20T10:00:00Z')],
      },
      [stored1],
    );
    expect(scheduleResult.success).toBe(true);
    expect(scheduleResult.conflicts).toHaveLength(1);
    expect(scheduleResult.conflicts[0].conflictingCampaignId).toBe(campaign1.campaignId);

    // Pause and resume campaign1
    const paused = manager.pauseCampaign(campaign1.campaignId);
    expect(paused.status).toBe(CampaignStatus.PAUSED);

    const resumed = manager.resumeCampaign(campaign1.campaignId);
    expect(resumed.status).toBe(CampaignStatus.ACTIVE);

    // Complete campaign1
    const completed = manager.transitionStatus(campaign1.campaignId, CampaignStatus.COMPLETED);
    expect(completed.status).toBe(CampaignStatus.COMPLETED);
  });
});

/* ------------------------------------------------------------------ */
/*  Additional edge cases for state transitions                       */
/* ------------------------------------------------------------------ */

describe('CampaignManager additional state transitions', () => {
  let manager: CampaignManager;

  beforeEach(() => {
    manager = new CampaignManager();
  });

  it('should transition SCHEDULED → ACTIVE', () => {
    const campaign = manager.createCampaign({ name: 'Sched→Active', type: CampaignType.WHATSAPP });
    manager.transitionStatus(campaign.campaignId, CampaignStatus.SCHEDULED);
    const active = manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
    expect(active.status).toBe(CampaignStatus.ACTIVE);
  });

  it('should transition SCHEDULED → PAUSED', () => {
    const campaign = manager.createCampaign({ name: 'Sched→Paused', type: CampaignType.WHATSAPP });
    manager.transitionStatus(campaign.campaignId, CampaignStatus.SCHEDULED);
    const paused = manager.transitionStatus(campaign.campaignId, CampaignStatus.PAUSED);
    expect(paused.status).toBe(CampaignStatus.PAUSED);
  });

  it('should transition SCHEDULED → DRAFT (back to editing)', () => {
    const campaign = manager.createCampaign({ name: 'Sched→Draft', type: CampaignType.WHATSAPP });
    manager.transitionStatus(campaign.campaignId, CampaignStatus.SCHEDULED);
    const draft = manager.transitionStatus(campaign.campaignId, CampaignStatus.DRAFT);
    expect(draft.status).toBe(CampaignStatus.DRAFT);
  });

  it('should reject PAUSED → SCHEDULED', () => {
    const campaign = manager.createCampaign({ name: 'Paused→Sched', type: CampaignType.WHATSAPP });
    manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
    manager.pauseCampaign(campaign.campaignId);
    expect(() =>
      manager.transitionStatus(campaign.campaignId, CampaignStatus.SCHEDULED),
    ).toThrow('Invalid status transition');
  });

  it('should allow deleting a PAUSED campaign only if it is not allowed', () => {
    const campaign = manager.createCampaign({ name: 'Del Paused', type: CampaignType.WHATSAPP });
    manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
    manager.pauseCampaign(campaign.campaignId);
    // PAUSED is neither DRAFT nor COMPLETED, so deletion should be rejected
    expect(() => manager.deleteCampaign(campaign.campaignId)).toThrow('Cannot delete campaign');
  });
});

/* ------------------------------------------------------------------ */
/*  WhatsApp executor error handling edge cases                       */
/* ------------------------------------------------------------------ */

describe('WhatsAppCampaignExecutor error handling', () => {
  let client: WhatsAppPostingClient;
  let executor: WhatsAppCampaignExecutor;
  const token = makeToken();

  beforeEach(() => {
    client = new WhatsAppPostingClient('phone-id');
    executor = new WhatsAppCampaignExecutor(client, {
      batchSize: 2,
      rateLimitDelayMs: 0,
      costPerMessage: 0.05,
      engagementTrackingWindowMs: 0,
    });
  });

  function makeActiveCampaign() {
    return {
      campaignId: 'camp-err',
      name: 'Error Test',
      type: CampaignType.WHATSAPP,
      status: CampaignStatus.ACTIVE,
      content: [{
        contentId: 'c-1',
        platform: Platform.WHATSAPP,
        text: 'Hello {{name}}',
        visualAssets: [],
        hashtags: [],
        mentions: [],
      } as PlatformContent],
      targetAudience: [{ segmentId: 's1', name: 'All', criteria: {}, size: 4, members: ['m1', 'm2', 'm3', 'm4'] }],
      schedule: { startDate: new Date(), endDate: new Date(Date.now() + 86400_000), timezone: 'UTC', sendTimes: [] },
      budget: { dailyLimit: 100, totalLimit: 500, remaining: 500, spent: 0, currency: 'USD' },
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400_000),
      metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
      optimizationRules: [],
    };
  }

  it('should handle API rejection mid-campaign gracefully', async () => {
    const campaign = makeActiveCampaign();
    const recipients = makeRecipients(4);

    vi.spyOn(client, 'sendBulkMessages')
      .mockResolvedValueOnce(makeBulkResult(2, true))
      .mockRejectedValueOnce(new Error('API rate limit exceeded'));

    await expect(executor.executeCampaign(campaign, token, recipients)).rejects.toThrow(
      'API rate limit exceeded',
    );
  });

  it('should handle mixed success/failure in a single batch', async () => {
    const campaign = makeActiveCampaign();
    const recipients = makeRecipients(2);

    const mixedResult: BulkMessageResult = {
      batchId: 'batch-mixed',
      total: 2,
      sent: 1,
      failed: 1,
      pending: 0,
      results: [
        { messageId: 'msg-0', recipientPhone: '+15550', status: 'sent', timestamp: new Date() },
        { messageId: 'msg-1', recipientPhone: '+15551', status: 'failed', timestamp: new Date(), error: 'Invalid number' },
      ],
    };

    vi.spyOn(client, 'sendBulkMessages').mockResolvedValueOnce(mixedResult);

    const result = await executor.executeCampaign(campaign, token, recipients);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.totalCost).toBeCloseTo(0.05); // only 1 sent
    expect(result.delivered + result.failed + result.pending).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Metrics collector edge cases                                      */
/* ------------------------------------------------------------------ */

describe('CampaignMetricsCollector edge cases', () => {
  let collector: CampaignMetricsCollector;

  beforeEach(() => {
    collector = new CampaignMetricsCollector();
  });

  it('should handle single post with all-zero engagement', () => {
    const metrics: EngagementMetrics = {
      postId: 'p-zero',
      platform: Platform.INSTAGRAM,
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      clicks: 0,
      reach: 0,
      impressions: 0,
      engagementRate: 0,
      timestamp: new Date(),
    };

    const campaign = {
      campaignId: 'camp-zero',
      name: 'Zero Engagement',
      type: CampaignType.MULTI_PLATFORM,
      status: CampaignStatus.ACTIVE,
      content: [{
        contentId: 'c-1',
        platform: Platform.INSTAGRAM,
        text: 'Test',
        visualAssets: [],
        hashtags: [],
        mentions: [],
        engagementMetrics: metrics,
      }],
      targetAudience: [],
      schedule: { startDate: new Date(), endDate: new Date(), timezone: 'UTC', sendTimes: [] },
      budget: { dailyLimit: 0, totalLimit: 0, remaining: 0, spent: 0, currency: 'USD' },
      startDate: new Date(),
      endDate: new Date(),
      metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
      optimizationRules: [],
    };

    const result = collector.aggregateMetrics(campaign);
    expect(result.totalReach).toBe(0);
    expect(result.totalEngagements).toBe(0);
    expect(result.averageEngagementRate).toBe(0);
    expect(result.roi).toBe(0);
  });

  it('should compute negative ROI when spend exceeds engagements', () => {
    const metrics: EngagementMetrics = {
      postId: 'p-neg',
      platform: Platform.FACEBOOK,
      likes: 5,
      comments: 1,
      shares: 0,
      views: 100,
      clicks: 2,
      reach: 50,
      impressions: 100,
      engagementRate: 0.08,
      timestamp: new Date(),
    };

    const campaign = {
      campaignId: 'camp-neg',
      name: 'Negative ROI',
      type: CampaignType.MULTI_PLATFORM,
      status: CampaignStatus.ACTIVE,
      content: [{
        contentId: 'c-1',
        platform: Platform.FACEBOOK,
        text: 'Test',
        visualAssets: [],
        hashtags: [],
        mentions: [],
        engagementMetrics: metrics,
      }],
      targetAudience: [],
      schedule: { startDate: new Date(), endDate: new Date(), timezone: 'UTC', sendTimes: [] },
      budget: { dailyLimit: 100, totalLimit: 1000, remaining: 0, spent: 1000, currency: 'USD' },
      startDate: new Date(),
      endDate: new Date(),
      metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
      optimizationRules: [],
    };

    const result = collector.aggregateMetrics(campaign);
    // engagements = 5 + 1 + 0 + 2 = 8, spend = 1000, roi = (8 - 1000) / 1000 = -0.992
    expect(result.roi).toBeCloseTo(-0.992);
    expect(result.totalSpend).toBe(1000);
  });
});
