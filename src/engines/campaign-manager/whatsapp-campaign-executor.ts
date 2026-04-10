import { Campaign, CampaignType } from '../../models';
import { PlatformContent } from '../../models/platform-content';
import {
  WhatsAppPostingClient,
  WhatsAppMessage,
  BulkMessageResult,
} from '../../integrations/platform/whatsapp-client';
import { OAuthToken } from '../../integrations/platform/oauth-manager';
import { createLogger } from '../../utils/logger';

const log = createLogger('WhatsAppCampaignExecutor');

/** Configuration for WhatsApp campaign execution */
export interface WhatsAppExecutionConfig {
  /** Max recipients per batch */
  batchSize: number;
  /** Delay in ms between batches for rate limiting */
  rateLimitDelayMs: number;
  /** Cost per message in campaign currency */
  costPerMessage: number;
  /** Engagement tracking window in ms (default: 0 = skip wait) */
  engagementTrackingWindowMs: number;
}

const DEFAULT_CONFIG: WhatsAppExecutionConfig = {
  batchSize: 100,
  rateLimitDelayMs: 1000,
  costPerMessage: 0.05,
  engagementTrackingWindowMs: 0,
};

/** Delivery status counts tracked during execution */
export interface DeliveryStatusCounts {
  delivered: number;
  failed: number;
  pending: number;
}

/** Result of executing a WhatsApp campaign */
export interface WhatsAppCampaignExecutionResult {
  campaignId: string;
  totalRecipients: number;
  delivered: number;
  failed: number;
  pending: number;
  totalCost: number;
  budgetRemaining: number;
  batchResults: BulkMessageResult[];
  success: boolean;
  error?: string;
}

/** Recipient info extracted from audience segments */
export interface Recipient {
  memberId: string;
  phone: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * WhatsApp Campaign Executor — handles the execution of WhatsApp marketing
 * campaigns following the executeWhatsAppCampaign algorithm from the design.
 *
 * Steps:
 * 1. Segment audience into batches
 * 2. For each batch: personalize messages, send via WhatsApp Business API, track delivery
 * 3. Update budget after each batch
 * 4. Rate limiting delay between batches
 * 5. Assert delivered + failed + pending = total recipients
 */
export class WhatsAppCampaignExecutor {
  private readonly client: WhatsAppPostingClient;
  private readonly config: WhatsAppExecutionConfig;

  constructor(client: WhatsAppPostingClient, config?: Partial<WhatsAppExecutionConfig>) {
    this.client = client;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a WhatsApp campaign following the design algorithm.
   *
   * Preconditions:
   * - campaign.type = WHATSAPP
   * - campaign.targetAudience is non-empty
   * - campaign.content is non-empty
   * - campaign.budget.remaining > 0
   *
   * Postconditions:
   * - All messages are processed (delivered, failed, or pending)
   * - Budget is updated with actual costs
   * - delivered + failed + pending = totalRecipients
   */
  async executeCampaign(
    campaign: Campaign,
    token: OAuthToken,
    recipients: Recipient[],
  ): Promise<WhatsAppCampaignExecutionResult> {
    // Validate preconditions
    this.validatePreconditions(campaign, recipients);

    const totalRecipients = recipients.length;
    const status: DeliveryStatusCounts = { delivered: 0, failed: 0, pending: 0 };
    const batchResults: BulkMessageResult[] = [];
    let totalCost = 0;
    let budgetRemaining = campaign.budget.remaining;

    // Step 1: Segment audience into batches
    const batches = this.segmentIntoBatches(recipients, this.config.batchSize);
    const totalBatches = batches.length;

    log.info(
      { campaignId: campaign.campaignId, totalRecipients, totalBatches },
      'Starting WhatsApp campaign execution',
    );

    // Step 2: Process each batch
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batch = batches[batchIndex];

      // Check budget before processing batch
      const estimatedBatchCost = this.estimateBatchCost(batch.length);
      if (budgetRemaining < estimatedBatchCost) {
        log.warn(
          { campaignId: campaign.campaignId, batchIndex, budgetRemaining, estimatedBatchCost },
          'Insufficient budget for batch, stopping execution',
        );
        // Mark remaining recipients as pending
        status.pending += batch.length;
        for (let remaining = batchIndex + 1; remaining < totalBatches; remaining++) {
          status.pending += batches[remaining].length;
        }
        break;
      }

      // Step 3: Personalize messages for batch
      const content = campaign.content[0];
      const personalizedMessages = batch.map((recipient) =>
        this.personalizeMessage(content, recipient),
      );

      // Step 4: Send batch via WhatsApp Business API
      const sendResult = await this.client.sendBulkMessages(personalizedMessages, token);
      batchResults.push(sendResult);

      // Step 5: Track delivery status
      this.trackDeliveryStatus(sendResult, status);

      // Step 6: Update budget
      const batchCost = this.calculateBatchCost(sendResult);
      totalCost += batchCost;
      budgetRemaining -= batchCost;

      log.info(
        {
          campaignId: campaign.campaignId,
          batchIndex: batchIndex + 1,
          totalBatches,
          batchCost,
          budgetRemaining,
        },
        'Batch processed',
      );

      // Step 7: Rate limiting delay between batches
      if (batchIndex < totalBatches - 1) {
        await this.sleep(this.config.rateLimitDelayMs);
      }
    }

    // Postcondition assertion: delivered + failed + pending = totalRecipients
    const totalProcessed = status.delivered + status.failed + status.pending;
    if (totalProcessed !== totalRecipients) {
      log.error(
        { totalProcessed, totalRecipients, ...status },
        'Delivery count mismatch',
      );
    }

    const result: WhatsAppCampaignExecutionResult = {
      campaignId: campaign.campaignId,
      totalRecipients,
      delivered: status.delivered,
      failed: status.failed,
      pending: status.pending,
      totalCost,
      budgetRemaining,
      batchResults,
      success: true,
    };

    log.info(
      { campaignId: campaign.campaignId, ...status, totalCost },
      'WhatsApp campaign execution complete',
    );

    return result;
  }

  /** Validate campaign preconditions per the design algorithm */
  private validatePreconditions(campaign: Campaign, recipients: Recipient[]): void {
    if (campaign.type !== CampaignType.WHATSAPP) {
      throw new Error(`Campaign type must be WHATSAPP, got ${campaign.type}`);
    }
    if (!campaign.targetAudience || campaign.targetAudience.length === 0) {
      throw new Error('Campaign target audience must be non-empty');
    }
    if (!campaign.content || campaign.content.length === 0) {
      throw new Error('Campaign content must be non-empty');
    }
    if (campaign.budget.remaining <= 0) {
      throw new Error('Campaign budget must have remaining funds');
    }
    if (!recipients || recipients.length === 0) {
      throw new Error('Recipients list must be non-empty');
    }
  }

  /** Segment recipients into batches of configurable size */
  segmentIntoBatches(recipients: Recipient[], batchSize: number): Recipient[][] {
    const batches: Recipient[][] = [];
    for (let i = 0; i < recipients.length; i += batchSize) {
      batches.push(recipients.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Personalize a message for a specific recipient.
   * Replaces {{placeholder}} tokens in the content text with recipient data.
   */
  personalizeMessage(content: PlatformContent, recipient: Recipient): WhatsAppMessage {
    let text = content.text;

    // Replace placeholders like {{name}}, {{memberId}}, etc.
    text = text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = recipient[key];
      return value !== undefined && value !== null ? String(value) : '';
    });

    return {
      recipientPhone: recipient.phone,
      text,
    };
  }

  /** Track delivery status from a bulk send result */
  private trackDeliveryStatus(sendResult: BulkMessageResult, status: DeliveryStatusCounts): void {
    for (const result of sendResult.results) {
      if (result.status === 'delivered' || result.status === 'sent') {
        status.delivered++;
      } else if (result.status === 'failed') {
        status.failed++;
      } else {
        status.pending++;
      }
    }
  }

  /** Calculate the cost for a batch based on successful sends */
  calculateBatchCost(sendResult: BulkMessageResult): number {
    // Cost is charged per sent/delivered message
    const chargeableCount = sendResult.sent;
    return chargeableCount * this.config.costPerMessage;
  }

  /** Estimate cost for a batch before sending */
  estimateBatchCost(batchSize: number): number {
    return batchSize * this.config.costPerMessage;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
