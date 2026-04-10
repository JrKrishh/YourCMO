import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WhatsAppCampaignExecutor, Recipient } from './whatsapp-campaign-executor';
import { WhatsAppPostingClient, BulkMessageResult } from '../../integrations/platform/whatsapp-client';
import { Campaign, CampaignType, CampaignStatus, Platform } from '../../models';
import { OAuthToken } from '../../integrations/platform/oauth-manager';
import { PlatformContent } from '../../models/platform-content';

function makeToken(): OAuthToken {
  return {
    accessToken: 'test-token',
    expiresAt: new Date(Date.now() + 3600_000),
    tokenType: 'Bearer',
    platform: Platform.WHATSAPP,
  };
}

function makeContent(text = 'Hello {{name}}, welcome!'): PlatformContent {
  return {
    contentId: 'content-1',
    platform: Platform.WHATSAPP,
    text,
    visualAssets: [],
    hashtags: [],
    mentions: [],
  };
}

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    campaignId: 'camp-1',
    name: 'Test WhatsApp Campaign',
    type: CampaignType.WHATSAPP,
    status: CampaignStatus.ACTIVE,
    content: [makeContent()],
    targetAudience: [{ segmentId: 'seg-1', name: 'All', criteria: {}, size: 3, members: ['m1', 'm2', 'm3'] }],
    schedule: { startDate: new Date(), endDate: new Date(Date.now() + 86400_000), timezone: 'UTC', sendTimes: [] },
    budget: { dailyLimit: 100, totalLimit: 500, remaining: 500, spent: 0, currency: 'USD' },
    startDate: new Date(),
    endDate: new Date(Date.now() + 86400_000),
    metrics: { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 },
    optimizationRules: [],
    ...overrides,
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
      status: allSent ? 'sent' as const : 'failed' as const,
      timestamp: new Date(),
      error: allSent ? undefined : 'Send failed',
    })),
  };
}

describe('WhatsAppCampaignExecutor', () => {
  let client: WhatsAppPostingClient;
  let executor: WhatsAppCampaignExecutor;
  const token = makeToken();

  beforeEach(() => {
    client = new WhatsAppPostingClient('phone-id');
    executor = new WhatsAppCampaignExecutor(client, {
      batchSize: 2,
      rateLimitDelayMs: 0, // no delay in tests
      costPerMessage: 0.05,
      engagementTrackingWindowMs: 0,
    });
  });

  describe('executeCampaign', () => {
    it('should execute a campaign and return correct delivery counts', async () => {
      const campaign = makeCampaign();
      const recipients = makeRecipients(3);

      vi.spyOn(client, 'sendBulkMessages')
        .mockResolvedValueOnce(makeBulkResult(2))
        .mockResolvedValueOnce(makeBulkResult(1));

      const result = await executor.executeCampaign(campaign, token, recipients);

      expect(result.campaignId).toBe('camp-1');
      expect(result.totalRecipients).toBe(3);
      expect(result.delivered).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.pending).toBe(0);
      expect(result.delivered + result.failed + result.pending).toBe(result.totalRecipients);
      expect(result.success).toBe(true);
      expect(result.batchResults).toHaveLength(2);
    });

    it('should track failed deliveries correctly', async () => {
      const campaign = makeCampaign();
      const recipients = makeRecipients(2);

      vi.spyOn(client, 'sendBulkMessages').mockResolvedValueOnce(makeBulkResult(2, false));

      const result = await executor.executeCampaign(campaign, token, recipients);

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.pending).toBe(0);
      expect(result.delivered + result.failed + result.pending).toBe(2);
    });

    it('should calculate costs correctly', async () => {
      const campaign = makeCampaign();
      const recipients = makeRecipients(4);

      vi.spyOn(client, 'sendBulkMessages')
        .mockResolvedValueOnce(makeBulkResult(2))
        .mockResolvedValueOnce(makeBulkResult(2));

      const result = await executor.executeCampaign(campaign, token, recipients);

      // 4 sent messages × $0.05 = $0.20
      expect(result.totalCost).toBeCloseTo(0.20);
      expect(result.budgetRemaining).toBeCloseTo(500 - 0.20);
    });

    it('should stop when budget is insufficient for a batch', async () => {
      const campaign = makeCampaign({
        budget: { dailyLimit: 1, totalLimit: 0.08, remaining: 0.08, spent: 0, currency: 'USD' },
      });
      const recipients = makeRecipients(4);

      // First batch (2 recipients) costs 0.10, but budget is only 0.08
      const result = await executor.executeCampaign(campaign, token, recipients);

      // All 4 recipients should be pending since even the first batch exceeds budget
      expect(result.pending).toBe(4);
      expect(result.delivered).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it('should process partial batches when budget runs out mid-campaign', async () => {
      const campaign = makeCampaign({
        budget: { dailyLimit: 100, totalLimit: 0.15, remaining: 0.15, spent: 0, currency: 'USD' },
      });
      const recipients = makeRecipients(4);

      // First batch (2 recipients) costs 0.10, budget remaining = 0.05
      // Second batch (2 recipients) estimated cost 0.10 > 0.05 remaining
      vi.spyOn(client, 'sendBulkMessages').mockResolvedValueOnce(makeBulkResult(2));

      const result = await executor.executeCampaign(campaign, token, recipients);

      expect(result.delivered).toBe(2);
      expect(result.pending).toBe(2); // second batch skipped
      expect(result.totalCost).toBeCloseTo(0.10);
      expect(result.delivered + result.failed + result.pending).toBe(4);
    });
  });

  describe('validation', () => {
    it('should throw if campaign type is not WHATSAPP', async () => {
      const campaign = makeCampaign({ type: CampaignType.MULTI_PLATFORM });
      await expect(executor.executeCampaign(campaign, token, makeRecipients(1)))
        .rejects.toThrow('Campaign type must be WHATSAPP');
    });

    it('should throw if target audience is empty', async () => {
      const campaign = makeCampaign({ targetAudience: [] });
      await expect(executor.executeCampaign(campaign, token, makeRecipients(1)))
        .rejects.toThrow('Campaign target audience must be non-empty');
    });

    it('should throw if content is empty', async () => {
      const campaign = makeCampaign({ content: [] });
      await expect(executor.executeCampaign(campaign, token, makeRecipients(1)))
        .rejects.toThrow('Campaign content must be non-empty');
    });

    it('should throw if budget remaining is zero', async () => {
      const campaign = makeCampaign({
        budget: { dailyLimit: 0, totalLimit: 0, remaining: 0, spent: 100, currency: 'USD' },
      });
      await expect(executor.executeCampaign(campaign, token, makeRecipients(1)))
        .rejects.toThrow('Campaign budget must have remaining funds');
    });

    it('should throw if recipients list is empty', async () => {
      const campaign = makeCampaign();
      await expect(executor.executeCampaign(campaign, token, []))
        .rejects.toThrow('Recipients list must be non-empty');
    });
  });

  describe('segmentIntoBatches', () => {
    it('should split recipients into correct batch sizes', () => {
      const recipients = makeRecipients(5);
      const batches = executor.segmentIntoBatches(recipients, 2);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(2);
      expect(batches[1]).toHaveLength(2);
      expect(batches[2]).toHaveLength(1);
    });

    it('should return single batch when recipients fit', () => {
      const recipients = makeRecipients(2);
      const batches = executor.segmentIntoBatches(recipients, 10);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });

    it('should handle empty recipients', () => {
      const batches = executor.segmentIntoBatches([], 10);
      expect(batches).toHaveLength(0);
    });
  });

  describe('personalizeMessage', () => {
    it('should replace placeholders with recipient data', () => {
      const content = makeContent('Hi {{name}}, your ID is {{memberId}}.');
      const recipient: Recipient = { memberId: 'r1', phone: '+1555', name: 'Alice' };

      const message = executor.personalizeMessage(content, recipient);

      expect(message.text).toBe('Hi Alice, your ID is r1.');
      expect(message.recipientPhone).toBe('+1555');
    });

    it('should replace missing placeholders with empty string', () => {
      const content = makeContent('Hello {{name}}, code: {{promoCode}}');
      const recipient: Recipient = { memberId: 'r1', phone: '+1555', name: 'Bob' };

      const message = executor.personalizeMessage(content, recipient);

      expect(message.text).toBe('Hello Bob, code: ');
    });

    it('should handle content with no placeholders', () => {
      const content = makeContent('No placeholders here.');
      const recipient: Recipient = { memberId: 'r1', phone: '+1555' };

      const message = executor.personalizeMessage(content, recipient);

      expect(message.text).toBe('No placeholders here.');
    });
  });

  describe('cost calculation', () => {
    it('should calculate batch cost based on sent count', () => {
      const result = makeBulkResult(5);
      const cost = executor.calculateBatchCost(result);
      expect(cost).toBeCloseTo(0.25); // 5 × 0.05
    });

    it('should not charge for failed messages', () => {
      const result = makeBulkResult(3, false);
      const cost = executor.calculateBatchCost(result);
      expect(cost).toBe(0); // 0 sent × 0.05
    });

    it('should estimate batch cost correctly', () => {
      const estimate = executor.estimateBatchCost(10);
      expect(estimate).toBeCloseTo(0.50); // 10 × 0.05
    });
  });
});
