import { v4 as uuidv4 } from 'uuid';
import { Campaign, CampaignStatus } from '../../models';
import { Schedule } from '../../models/common';
import { createLogger } from '../../utils/logger';

const log = createLogger('CampaignScheduler');

/** A single scheduled message entry */
export interface ScheduledMessage {
  messageId: string;
  campaignId: string;
  /** The original send time (in campaign schedule timezone) */
  originalSendTime: Date;
  /** The UTC-converted send time for actual delivery */
  utcSendTime: Date;
  /** Recipient timezone (for global campaigns) */
  recipientTimezone: string;
  /** The batch this message belongs to */
  batchId: string;
  status: 'pending' | 'scheduled' | 'sent' | 'failed';
}

/** A batch of messages grouped for efficient delivery */
export interface MessageBatch {
  batchId: string;
  campaignId: string;
  messages: ScheduledMessage[];
  scheduledTime: Date;
  status: 'pending' | 'scheduled' | 'sent' | 'failed';
}

/** Result of scheduling messages for a campaign */
export interface ScheduleResult {
  campaignId: string;
  totalMessages: number;
  batches: MessageBatch[];
  conflicts: ScheduleConflict[];
  success: boolean;
  error?: string;
}

/** A detected schedule conflict */
export interface ScheduleConflict {
  campaignId: string;
  conflictingCampaignId: string;
  overlapStart: Date;
  overlapEnd: Date;
  reason: string;
}

/** Configuration for batch scheduling */
export interface BatchConfig {
  /** Maximum messages per batch */
  maxBatchSize: number;
  /** Minimum delay between batches in milliseconds */
  batchDelayMs: number;
}

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxBatchSize: 100,
  batchDelayMs: 1000,
};

/**
 * Campaign Scheduler — handles scheduling messages for campaigns,
 * time zone conversions, batch grouping, and conflict detection.
 */
export class CampaignScheduler {
  private readonly batchConfig: BatchConfig;

  constructor(batchConfig?: Partial<BatchConfig>) {
    this.batchConfig = { ...DEFAULT_BATCH_CONFIG, ...batchConfig };
  }

  /**
   * Schedule messages for a campaign based on the provided schedule.
   *
   * Creates scheduled message entries for each send time, converts to UTC,
   * groups into batches, and checks for conflicts with existing campaigns.
   */
  scheduleMessages(
    campaign: Campaign,
    schedule: Schedule,
    existingCampaigns?: Campaign[],
    recipientTimezones?: string[],
  ): ScheduleResult {
    // Validate inputs
    if (!campaign) {
      return this.errorResult('', 'Campaign is required');
    }
    if (!schedule) {
      return this.errorResult(campaign.campaignId, 'Schedule is required');
    }
    if (schedule.endDate <= schedule.startDate) {
      return this.errorResult(campaign.campaignId, 'Schedule endDate must be after startDate');
    }
    if (!schedule.sendTimes || schedule.sendTimes.length === 0) {
      return this.errorResult(campaign.campaignId, 'At least one send time is required');
    }
    if (campaign.status === CampaignStatus.COMPLETED) {
      return this.errorResult(campaign.campaignId, 'Cannot schedule a completed campaign');
    }

    // Detect conflicts with existing campaigns
    const conflicts = existingCampaigns
      ? this.detectConflicts(campaign, schedule, existingCampaigns)
      : [];

    // Build scheduled messages with timezone handling
    const timezones = recipientTimezones && recipientTimezones.length > 0
      ? recipientTimezones
      : [schedule.timezone];

    const messages = this.createScheduledMessages(campaign, schedule, timezones);

    // Group messages into batches
    const batches = this.createBatches(campaign.campaignId, messages);

    log.info(
      {
        campaignId: campaign.campaignId,
        totalMessages: messages.length,
        batchCount: batches.length,
        conflictCount: conflicts.length,
      },
      'Messages scheduled',
    );

    return {
      campaignId: campaign.campaignId,
      totalMessages: messages.length,
      batches,
      conflicts,
      success: true,
    };
  }

  /**
   * Convert a date from a source timezone to UTC.
   * Uses simple offset-based conversion for portability.
   */
  convertToUtc(date: Date, sourceTimezone: string): Date {
    const offsetMinutes = getTimezoneOffsetMinutes(sourceTimezone);
    return new Date(date.getTime() - offsetMinutes * 60 * 1000);
  }

  /**
   * Convert a UTC date to a target timezone.
   */
  convertFromUtc(utcDate: Date, targetTimezone: string): Date {
    const offsetMinutes = getTimezoneOffsetMinutes(targetTimezone);
    return new Date(utcDate.getTime() + offsetMinutes * 60 * 1000);
  }

  /**
   * Detect schedule conflicts between a campaign and existing campaigns.
   * A conflict exists when two campaigns targeting overlapping audiences
   * have overlapping schedule windows.
   */
  detectConflicts(
    campaign: Campaign,
    schedule: Schedule,
    existingCampaigns: Campaign[],
  ): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

    for (const existing of existingCampaigns) {
      // Skip self
      if (existing.campaignId === campaign.campaignId) continue;
      // Skip completed campaigns
      if (existing.status === CampaignStatus.COMPLETED) continue;

      const existingStart = existing.schedule.startDate;
      const existingEnd = existing.schedule.endDate;

      // Check for time overlap
      const overlapStart = schedule.startDate > existingStart ? schedule.startDate : existingStart;
      const overlapEnd = schedule.endDate < existingEnd ? schedule.endDate : existingEnd;

      if (overlapStart < overlapEnd) {
        // Check for audience overlap
        const hasAudienceOverlap = this.hasAudienceOverlap(campaign, existing);

        if (hasAudienceOverlap) {
          conflicts.push({
            campaignId: campaign.campaignId,
            conflictingCampaignId: existing.campaignId,
            overlapStart,
            overlapEnd,
            reason: `Schedule overlaps with campaign "${existing.name}" from ${overlapStart.toISOString()} to ${overlapEnd.toISOString()}`,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Create scheduled message entries for each send time × recipient timezone.
   */
  private createScheduledMessages(
    campaign: Campaign,
    schedule: Schedule,
    recipientTimezones: string[],
  ): ScheduledMessage[] {
    const messages: ScheduledMessage[] = [];

    for (const sendTime of schedule.sendTimes) {
      for (const tz of recipientTimezones) {
        const utcTime = this.convertToUtc(sendTime, tz);

        // Only schedule if the UTC time falls within the schedule window
        const scheduleStartUtc = this.convertToUtc(schedule.startDate, schedule.timezone);
        const scheduleEndUtc = this.convertToUtc(schedule.endDate, schedule.timezone);

        if (utcTime >= scheduleStartUtc && utcTime <= scheduleEndUtc) {
          messages.push({
            messageId: uuidv4(),
            campaignId: campaign.campaignId,
            originalSendTime: sendTime,
            utcSendTime: utcTime,
            recipientTimezone: tz,
            batchId: '', // assigned during batching
            status: 'pending',
          });
        }
      }
    }

    // Sort by UTC send time for ordered delivery
    messages.sort((a, b) => a.utcSendTime.getTime() - b.utcSendTime.getTime());

    return messages;
  }

  /**
   * Group messages into batches for efficient delivery.
   * Messages are grouped by proximity in time and capped at maxBatchSize.
   */
  private createBatches(campaignId: string, messages: ScheduledMessage[]): MessageBatch[] {
    if (messages.length === 0) return [];

    const batches: MessageBatch[] = [];
    let currentBatch: ScheduledMessage[] = [];
    let currentBatchTime = messages[0].utcSendTime;

    for (const message of messages) {
      const timeDiff = message.utcSendTime.getTime() - currentBatchTime.getTime();
      const shouldStartNewBatch =
        currentBatch.length >= this.batchConfig.maxBatchSize ||
        timeDiff > this.batchConfig.batchDelayMs;

      if (shouldStartNewBatch && currentBatch.length > 0) {
        batches.push(this.buildBatch(campaignId, currentBatch, currentBatchTime));
        currentBatch = [];
        currentBatchTime = message.utcSendTime;
      }

      currentBatch.push(message);
    }

    // Flush remaining messages
    if (currentBatch.length > 0) {
      batches.push(this.buildBatch(campaignId, currentBatch, currentBatchTime));
    }

    return batches;
  }

  private buildBatch(
    campaignId: string,
    messages: ScheduledMessage[],
    scheduledTime: Date,
  ): MessageBatch {
    const batchId = uuidv4();
    for (const msg of messages) {
      msg.batchId = batchId;
      msg.status = 'scheduled';
    }
    return {
      batchId,
      campaignId,
      messages: [...messages],
      scheduledTime,
      status: 'scheduled',
    };
  }

  /**
   * Check if two campaigns have overlapping audience segments.
   */
  private hasAudienceOverlap(campaignA: Campaign, campaignB: Campaign): boolean {
    if (campaignA.targetAudience.length === 0 || campaignB.targetAudience.length === 0) {
      // If either has no audience defined, assume potential overlap
      return true;
    }

    for (const segA of campaignA.targetAudience) {
      for (const segB of campaignB.targetAudience) {
        // Check for member overlap
        const membersA = new Set(segA.members);
        for (const member of segB.members) {
          if (membersA.has(member)) return true;
        }
      }
    }

    return false;
  }

  private errorResult(campaignId: string, error: string): ScheduleResult {
    log.warn({ campaignId, error }, 'Scheduling failed');
    return {
      campaignId,
      totalMessages: 0,
      batches: [],
      conflicts: [],
      success: false,
      error,
    };
  }
}

/**
 * Get timezone offset in minutes from UTC for common timezones.
 * Positive = ahead of UTC, negative = behind UTC.
 */
export function getTimezoneOffsetMinutes(timezone: string): number {
  const offsets: Record<string, number> = {
    'UTC': 0,
    'GMT': 0,
    'US/Eastern': -300,
    'US/Central': -360,
    'US/Mountain': -420,
    'US/Pacific': -480,
    'America/New_York': -300,
    'America/Chicago': -360,
    'America/Denver': -420,
    'America/Los_Angeles': -480,
    'America/Sao_Paulo': -180,
    'Europe/London': 0,
    'Europe/Paris': 60,
    'Europe/Berlin': 60,
    'Europe/Moscow': 180,
    'Asia/Dubai': 240,
    'Asia/Kolkata': 330,
    'Asia/Shanghai': 480,
    'Asia/Tokyo': 540,
    'Australia/Sydney': 660,
    'Pacific/Auckland': 780,
  };

  const offset = offsets[timezone];
  if (offset === undefined) {
    log.warn({ timezone }, 'Unknown timezone, defaulting to UTC');
    return 0;
  }
  return offset;
}
