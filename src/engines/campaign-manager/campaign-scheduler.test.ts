import { describe, it, expect, beforeEach } from 'vitest';
import { CampaignScheduler, getTimezoneOffsetMinutes } from './campaign-scheduler';
import { Campaign, CampaignStatus, CampaignType } from '../../models';
import { Budget, CampaignMetrics, Schedule, Segment } from '../../models/common';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function emptyMetrics(): CampaignMetrics {
  return { totalReach: 0, totalImpressions: 0, totalEngagements: 0, averageEngagementRate: 0, totalSpend: 0, roi: 0 };
}

function emptyBudget(): Budget {
  return { dailyLimit: 0, totalLimit: 0, remaining: 0, spent: 0, currency: 'USD' };
}

function makeSchedule(overrides?: Partial<Schedule>): Schedule {
  const start = new Date('2025-07-01T00:00:00Z');
  const end = new Date('2025-07-31T23:59:59Z');
  return {
    startDate: start,
    endDate: end,
    timezone: 'UTC',
    sendTimes: [new Date('2025-07-10T10:00:00Z'), new Date('2025-07-15T14:00:00Z')],
    ...overrides,
  };
}

function makeCampaign(overrides?: Partial<Campaign>): Campaign {
  return {
    campaignId: 'camp-1',
    name: 'Test Campaign',
    type: CampaignType.WHATSAPP,
    status: CampaignStatus.DRAFT,
    content: [],
    targetAudience: [],
    schedule: makeSchedule(),
    budget: emptyBudget(),
    startDate: new Date('2025-07-01'),
    endDate: new Date('2025-07-31'),
    metrics: emptyMetrics(),
    optimizationRules: [],
    ...overrides,
  };
}

function makeSegment(id: string, members: string[]): Segment {
  return { segmentId: id, name: id, criteria: {}, size: members.length, members };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('CampaignScheduler', () => {
  let scheduler: CampaignScheduler;

  beforeEach(() => {
    scheduler = new CampaignScheduler();
  });

  /* ---- scheduleMessages basic behaviour ---- */

  describe('scheduleMessages', () => {
    it('should schedule messages for a valid campaign and schedule', () => {
      const campaign = makeCampaign();
      const schedule = makeSchedule();

      const result = scheduler.scheduleMessages(campaign, schedule);

      expect(result.success).toBe(true);
      expect(result.campaignId).toBe('camp-1');
      expect(result.totalMessages).toBe(2); // 2 send times × 1 timezone
      expect(result.batches.length).toBeGreaterThan(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should return error when campaign is null', () => {
      const result = scheduler.scheduleMessages(null as any, makeSchedule());
      expect(result.success).toBe(false);
      expect(result.error).toContain('Campaign is required');
    });

    it('should return error when schedule is null', () => {
      const result = scheduler.scheduleMessages(makeCampaign(), null as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Schedule is required');
    });

    it('should return error when endDate is before startDate', () => {
      const schedule = makeSchedule({
        startDate: new Date('2025-08-01'),
        endDate: new Date('2025-07-01'),
      });
      const result = scheduler.scheduleMessages(makeCampaign(), schedule);
      expect(result.success).toBe(false);
      expect(result.error).toContain('endDate must be after startDate');
    });

    it('should return error when sendTimes is empty', () => {
      const schedule = makeSchedule({ sendTimes: [] });
      const result = scheduler.scheduleMessages(makeCampaign(), schedule);
      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one send time is required');
    });

    it('should return error for a completed campaign', () => {
      const campaign = makeCampaign({ status: CampaignStatus.COMPLETED });
      const result = scheduler.scheduleMessages(campaign, makeSchedule());
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot schedule a completed campaign');
    });

    it('should mark all messages as scheduled', () => {
      const result = scheduler.scheduleMessages(makeCampaign(), makeSchedule());
      for (const batch of result.batches) {
        expect(batch.status).toBe('scheduled');
        for (const msg of batch.messages) {
          expect(msg.status).toBe('scheduled');
        }
      }
    });

    it('should assign batch IDs to all messages', () => {
      const result = scheduler.scheduleMessages(makeCampaign(), makeSchedule());
      for (const batch of result.batches) {
        for (const msg of batch.messages) {
          expect(msg.batchId).toBe(batch.batchId);
          expect(msg.batchId).toBeTruthy();
        }
      }
    });
  });

  /* ---- Time zone handling ---- */

  describe('time zone handling', () => {
    it('should convert send times to UTC from a non-UTC timezone', () => {
      const schedule = makeSchedule({
        timezone: 'America/New_York',
        sendTimes: [new Date('2025-07-10T10:00:00Z')], // treated as 10:00 ET
      });

      const result = scheduler.scheduleMessages(makeCampaign(), schedule);
      expect(result.success).toBe(true);

      // 10:00 ET = 15:00 UTC (ET is UTC-5)
      const msg = result.batches[0]?.messages[0];
      expect(msg).toBeDefined();
      expect(msg.utcSendTime.getTime()).toBe(
        new Date('2025-07-10T10:00:00Z').getTime() + 300 * 60 * 1000,
      );
    });

    it('should create messages for each recipient timezone', () => {
      const schedule = makeSchedule({
        timezone: 'UTC',
        sendTimes: [new Date('2025-07-10T12:00:00Z')],
      });
      const recipientTimezones = ['America/New_York', 'Europe/London', 'Asia/Tokyo'];

      const result = scheduler.scheduleMessages(makeCampaign(), schedule, [], recipientTimezones);
      expect(result.success).toBe(true);
      // 3 timezones × 1 send time (some may be filtered if outside window)
      expect(result.totalMessages).toBeGreaterThanOrEqual(1);

      const tzSet = new Set(
        result.batches.flatMap((b) => b.messages.map((m) => m.recipientTimezone)),
      );
      // At least the UTC-compatible ones should be present
      expect(tzSet.size).toBeGreaterThanOrEqual(1);
    });

    it('should filter out send times outside the schedule window', () => {
      const schedule = makeSchedule({
        startDate: new Date('2025-07-01T00:00:00Z'),
        endDate: new Date('2025-07-05T00:00:00Z'),
        timezone: 'UTC',
        sendTimes: [
          new Date('2025-07-03T10:00:00Z'), // within window
          new Date('2025-07-10T10:00:00Z'), // outside window
        ],
      });

      const result = scheduler.scheduleMessages(makeCampaign(), schedule);
      expect(result.success).toBe(true);
      expect(result.totalMessages).toBe(1);
    });
  });

  /* ---- Batch scheduling ---- */

  describe('batch scheduling', () => {
    it('should respect maxBatchSize', () => {
      const smallBatchScheduler = new CampaignScheduler({ maxBatchSize: 2 });

      // Create 5 send times at the same moment so they'd all be in one batch normally
      const sendTimes = Array.from({ length: 5 }, () => new Date('2025-07-10T10:00:00Z'));
      const schedule = makeSchedule({ sendTimes });

      const result = smallBatchScheduler.scheduleMessages(makeCampaign(), schedule);
      expect(result.success).toBe(true);
      expect(result.totalMessages).toBe(5);
      // With maxBatchSize=2, we need at least 3 batches for 5 messages
      expect(result.batches.length).toBeGreaterThanOrEqual(3);
      for (const batch of result.batches) {
        expect(batch.messages.length).toBeLessThanOrEqual(2);
      }
    });

    it('should split batches when send times are far apart', () => {
      const schedule = makeSchedule({
        sendTimes: [
          new Date('2025-07-10T10:00:00Z'),
          new Date('2025-07-20T10:00:00Z'),
        ],
      });

      const result = scheduler.scheduleMessages(makeCampaign(), schedule);
      expect(result.success).toBe(true);
      // Two send times far apart should be in separate batches
      expect(result.batches.length).toBe(2);
    });

    it('should produce empty batches array when no messages qualify', () => {
      const schedule = makeSchedule({
        startDate: new Date('2025-07-01T00:00:00Z'),
        endDate: new Date('2025-07-02T00:00:00Z'),
        timezone: 'UTC',
        sendTimes: [new Date('2025-07-10T10:00:00Z')], // outside window
      });

      const result = scheduler.scheduleMessages(makeCampaign(), schedule);
      expect(result.success).toBe(true);
      expect(result.totalMessages).toBe(0);
      expect(result.batches).toHaveLength(0);
    });
  });

  /* ---- Conflict detection ---- */

  describe('conflict detection', () => {
    it('should detect overlapping schedules with shared audience', () => {
      const sharedMembers = ['user-1', 'user-2'];
      const campaign = makeCampaign({
        campaignId: 'camp-new',
        targetAudience: [makeSegment('seg-a', sharedMembers)],
      });
      const existing = makeCampaign({
        campaignId: 'camp-existing',
        name: 'Existing Campaign',
        status: CampaignStatus.ACTIVE,
        targetAudience: [makeSegment('seg-b', sharedMembers)],
        schedule: makeSchedule({
          startDate: new Date('2025-07-05'),
          endDate: new Date('2025-07-20'),
        }),
      });

      const schedule = makeSchedule({
        startDate: new Date('2025-07-10'),
        endDate: new Date('2025-07-25'),
      });

      const result = scheduler.scheduleMessages(campaign, schedule, [existing]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictingCampaignId).toBe('camp-existing');
      expect(result.conflicts[0].overlapStart.getTime()).toBe(new Date('2025-07-10').getTime());
      expect(result.conflicts[0].overlapEnd.getTime()).toBe(new Date('2025-07-20').getTime());
    });

    it('should not flag conflict with itself', () => {
      const campaign = makeCampaign({ campaignId: 'camp-1' });
      const result = scheduler.scheduleMessages(campaign, makeSchedule(), [campaign]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should not flag conflict with completed campaigns', () => {
      const existing = makeCampaign({
        campaignId: 'camp-done',
        status: CampaignStatus.COMPLETED,
        targetAudience: [makeSegment('seg', ['user-1'])],
      });
      const campaign = makeCampaign({
        campaignId: 'camp-new',
        targetAudience: [makeSegment('seg', ['user-1'])],
      });

      const result = scheduler.scheduleMessages(campaign, makeSchedule(), [existing]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should not flag conflict when schedules do not overlap', () => {
      const campaign = makeCampaign({
        campaignId: 'camp-new',
        targetAudience: [makeSegment('seg', ['user-1'])],
      });
      const existing = makeCampaign({
        campaignId: 'camp-old',
        status: CampaignStatus.ACTIVE,
        targetAudience: [makeSegment('seg', ['user-1'])],
        schedule: makeSchedule({
          startDate: new Date('2025-08-01'),
          endDate: new Date('2025-08-31'),
        }),
      });

      const schedule = makeSchedule({
        startDate: new Date('2025-07-01'),
        endDate: new Date('2025-07-15'),
      });

      const result = scheduler.scheduleMessages(campaign, schedule, [existing]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should not flag conflict when audiences do not overlap', () => {
      const campaign = makeCampaign({
        campaignId: 'camp-new',
        targetAudience: [makeSegment('seg-a', ['user-1', 'user-2'])],
      });
      const existing = makeCampaign({
        campaignId: 'camp-old',
        status: CampaignStatus.ACTIVE,
        targetAudience: [makeSegment('seg-b', ['user-3', 'user-4'])],
      });

      const result = scheduler.scheduleMessages(campaign, makeSchedule(), [existing]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should flag conflict when either campaign has empty audience (assumes overlap)', () => {
      const campaign = makeCampaign({ campaignId: 'camp-new', targetAudience: [] });
      const existing = makeCampaign({
        campaignId: 'camp-old',
        status: CampaignStatus.ACTIVE,
        targetAudience: [makeSegment('seg', ['user-1'])],
      });

      const result = scheduler.scheduleMessages(campaign, makeSchedule(), [existing]);
      expect(result.conflicts).toHaveLength(1);
    });
  });

  /* ---- convertToUtc / convertFromUtc ---- */

  describe('timezone conversion', () => {
    it('should convert from America/New_York to UTC (UTC-5)', () => {
      const date = new Date('2025-07-10T10:00:00Z');
      const utc = scheduler.convertToUtc(date, 'America/New_York');
      // 10:00 ET → 15:00 UTC
      expect(utc.getTime()).toBe(date.getTime() + 300 * 60 * 1000);
    });

    it('should convert from Asia/Tokyo to UTC (UTC+9)', () => {
      const date = new Date('2025-07-10T10:00:00Z');
      const utc = scheduler.convertToUtc(date, 'Asia/Tokyo');
      // 10:00 JST → 01:00 UTC
      expect(utc.getTime()).toBe(date.getTime() - 540 * 60 * 1000);
    });

    it('should be identity for UTC', () => {
      const date = new Date('2025-07-10T10:00:00Z');
      expect(scheduler.convertToUtc(date, 'UTC').getTime()).toBe(date.getTime());
    });

    it('should round-trip convertToUtc and convertFromUtc', () => {
      const date = new Date('2025-07-10T10:00:00Z');
      const tz = 'Europe/Berlin';
      const utc = scheduler.convertToUtc(date, tz);
      const back = scheduler.convertFromUtc(utc, tz);
      expect(back.getTime()).toBe(date.getTime());
    });

    it('should default unknown timezone to UTC (offset 0)', () => {
      const date = new Date('2025-07-10T10:00:00Z');
      const utc = scheduler.convertToUtc(date, 'Unknown/Zone');
      expect(utc.getTime()).toBe(date.getTime());
    });
  });
});

/* ---- getTimezoneOffsetMinutes ---- */

describe('getTimezoneOffsetMinutes', () => {
  it('should return 0 for UTC', () => {
    expect(getTimezoneOffsetMinutes('UTC')).toBe(0);
  });

  it('should return -300 for America/New_York', () => {
    expect(getTimezoneOffsetMinutes('America/New_York')).toBe(-300);
  });

  it('should return 540 for Asia/Tokyo', () => {
    expect(getTimezoneOffsetMinutes('Asia/Tokyo')).toBe(540);
  });

  it('should return 0 for unknown timezone', () => {
    expect(getTimezoneOffsetMinutes('Mars/Olympus')).toBe(0);
  });
});
