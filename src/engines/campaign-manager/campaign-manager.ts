import { v4 as uuidv4 } from 'uuid';
import { Campaign, CampaignStatus, CampaignType } from '../../models';
import {
  Audience,
  AudienceMember,
  Budget,
  CampaignMetrics,
  OptimizationRule,
  Schedule,
  Segment,
  SegmentationCriteria,
  SegmentationRule,
} from '../../models/common';
import { PlatformContent } from '../../models/platform-content';
import { createLogger } from '../../utils/logger';
import { CampaignStore } from './campaign-store';
import { CampaignMetricsCollector } from './campaign-metrics-collector';

const log = createLogger('CampaignManager');

/** Input specification for creating a new campaign. */
export interface CampaignSpec {
  name: string;
  type: CampaignType;
  content?: PlatformContent[];
  targetAudience?: Segment[];
  schedule?: Partial<Schedule>;
  budget?: Partial<Budget>;
  startDate?: Date;
  endDate?: Date;
  optimizationRules?: OptimizationRule[];
}

/**
 * Valid state transitions for campaign status.
 * Maps each status to the set of statuses it can transition to.
 */
const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CampaignStatus.DRAFT]: [CampaignStatus.SCHEDULED, CampaignStatus.ACTIVE],
  [CampaignStatus.SCHEDULED]: [CampaignStatus.ACTIVE, CampaignStatus.PAUSED, CampaignStatus.DRAFT],
  [CampaignStatus.ACTIVE]: [CampaignStatus.PAUSED, CampaignStatus.COMPLETED],
  [CampaignStatus.PAUSED]: [CampaignStatus.ACTIVE, CampaignStatus.COMPLETED],
  [CampaignStatus.COMPLETED]: [],
};

/**
 * Campaign Manager — creates, persists, and manages the lifecycle
 * of marketing campaigns including state transitions.
 */
export class CampaignManager {
  private readonly store: CampaignStore;

  constructor(store?: CampaignStore) {
    this.store = store ?? new CampaignStore();
  }

  /**
   * Create a new campaign from a specification.
   * The campaign starts in DRAFT status.
   */
  createCampaign(spec: CampaignSpec): Campaign {
    if (!spec.name || spec.name.trim().length === 0) {
      throw new Error('Campaign name must be non-empty');
    }

    const now = new Date();
    const startDate = spec.startDate ?? now;
    const endDate = spec.endDate ?? new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (endDate <= startDate) {
      throw new Error('endDate must be after startDate');
    }

    const campaign: Campaign = {
      campaignId: uuidv4(),
      name: spec.name.trim(),
      type: spec.type,
      status: CampaignStatus.DRAFT,
      content: spec.content ?? [],
      targetAudience: spec.targetAudience ?? [],
      schedule: {
        startDate,
        endDate,
        timezone: spec.schedule?.timezone ?? 'UTC',
        sendTimes: spec.schedule?.sendTimes ?? [],
        engagementTrackingWindow: spec.schedule?.engagementTrackingWindow,
      },
      budget: {
        dailyLimit: spec.budget?.dailyLimit ?? 0,
        totalLimit: spec.budget?.totalLimit ?? 0,
        remaining: spec.budget?.totalLimit ?? 0,
        spent: 0,
        currency: spec.budget?.currency ?? 'USD',
      },
      startDate,
      endDate,
      metrics: emptyMetrics(),
      optimizationRules: spec.optimizationRules ?? [],
    };

    this.store.save(campaign);
    log.info({ campaignId: campaign.campaignId, name: campaign.name }, 'Campaign created');
    return { ...campaign };
  }

  /** Retrieve a campaign by ID. Throws if not found. */
  getCampaign(campaignId: string): Campaign {
    const campaign = this.store.get(campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    return campaign;
  }

  /**
   * Transition a campaign to a new status.
   * Validates the transition against the allowed state machine.
   */
  transitionStatus(campaignId: string, newStatus: CampaignStatus): Campaign {
    const campaign = this.getCampaign(campaignId);
    const allowed = VALID_TRANSITIONS[campaign.status];

    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${campaign.status} → ${newStatus}`,
      );
    }

    campaign.status = newStatus;
    this.store.save(campaign);
    log.info({ campaignId, from: campaign.status, to: newStatus }, 'Campaign status changed');
    return { ...campaign };
  }

  /** Pause an ACTIVE or SCHEDULED campaign. */
  pauseCampaign(campaignId: string): Campaign {
    return this.transitionStatus(campaignId, CampaignStatus.PAUSED);
  }

  /** Resume a PAUSED campaign back to ACTIVE. */
  resumeCampaign(campaignId: string): Campaign {
    return this.transitionStatus(campaignId, CampaignStatus.ACTIVE);
  }

  /** List all campaigns, optionally filtered by status. */
  listCampaigns(status?: CampaignStatus): Campaign[] {
    const all = this.store.getAll();
    return status ? all.filter((c) => c.status === status) : all;
  }

  /** Delete a campaign. Only DRAFT and COMPLETED campaigns can be deleted. */
  deleteCampaign(campaignId: string): void {
    const campaign = this.getCampaign(campaignId);
    if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.COMPLETED) {
      throw new Error(`Cannot delete campaign in ${campaign.status} status`);
    }
    this.store.delete(campaignId);
    log.info({ campaignId }, 'Campaign deleted');
  }

  /**
   * Retrieve aggregated metrics for a campaign.
   * Collects engagement data from all campaign posts and computes totals.
   */
  getCampaignMetrics(campaignId: string): CampaignMetrics {
    const campaign = this.getCampaign(campaignId);
    const collector = new CampaignMetricsCollector();
    return collector.aggregateMetrics(campaign);
  }

  /**
   * Segment an audience into mutually exclusive groups based on criteria.
   *
   * Postconditions (from design):
   * - Each segment meets minSegmentSize requirement
   * - Union of all segments equals original audience
   * - Segments are mutually exclusive (no overlap)
   * - Each segment has homogeneous characteristics per criteria
   */
  segmentAudience(audience: Audience, criteria: SegmentationCriteria): Segment[] {
    if (!audience || audience.members.length === 0) {
      throw new Error('Audience must be non-empty');
    }
    if (!criteria || !criteria.rules || criteria.rules.length === 0) {
      throw new Error('Segmentation criteria must contain at least one rule');
    }
    if (criteria.minSegmentSize <= 0) {
      throw new Error('minSegmentSize must be greater than 0');
    }

    // Build a composite key for each member based on all rules
    const bucketMap = new Map<string, AudienceMember[]>();

    for (const member of audience.members) {
      const key = criteria.rules.map((rule) => this.bucketKey(member, rule)).join('|');
      const list = bucketMap.get(key) ?? [];
      list.push(member);
      bucketMap.set(key, list);
    }

    // Collect segments that meet the minimum size
    const validSegments: Segment[] = [];
    const overflow: AudienceMember[] = [];

    for (const [key, members] of bucketMap) {
      if (members.length >= criteria.minSegmentSize) {
        validSegments.push(this.buildSegment(key, members, criteria));
      } else {
        overflow.push(...members);
      }
    }

    // Merge undersized buckets into an "Other" segment if they collectively meet the minimum
    if (overflow.length > 0) {
      if (overflow.length >= criteria.minSegmentSize) {
        validSegments.push(this.buildSegment('other', overflow, criteria));
      } else {
        // If the overflow is still too small, distribute members into the nearest valid segment
        this.distributeOverflow(overflow, validSegments, criteria);
      }
    }

    // Edge case: if no valid segments were created (all buckets too small), put everyone in one segment
    if (validSegments.length === 0) {
      validSegments.push(this.buildSegment('all', audience.members, criteria));
    }

    log.info(
      { segmentCount: validSegments.length, audienceSize: audience.members.length },
      'Audience segmented',
    );

    return validSegments;
  }

  /**
   * Determine the bucket key for a member under a single rule.
   */
  private bucketKey(member: AudienceMember, rule: SegmentationRule): string {
    const value = member[rule.field];

    if (rule.type === 'demographic') {
      return this.demographicBucket(value, rule);
    }
    return this.behavioralBucket(value, rule);
  }

  /**
   * Demographic bucketing: numeric fields use bucket boundaries, string fields use explicit groups.
   */
  private demographicBucket(value: unknown, rule: SegmentationRule): string {
    if (rule.buckets && rule.buckets.length > 0 && typeof value === 'number') {
      const sorted = [...rule.buckets].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length - 1; i++) {
        if (value >= sorted[i] && value < sorted[i + 1]) {
          return `${rule.field}:${sorted[i]}-${sorted[i + 1]}`;
        }
      }
      // Below first or at/above last boundary
      if (value < sorted[0]) return `${rule.field}:<${sorted[0]}`;
      return `${rule.field}:>=${sorted[sorted.length - 1]}`;
    }

    if (rule.groups && rule.groups.length > 0) {
      const strVal = String(value ?? '').toLowerCase();
      for (const group of rule.groups) {
        if (group.map((g) => g.toLowerCase()).includes(strVal)) {
          return `${rule.field}:${group.join(',')}`;
        }
      }
      return `${rule.field}:unknown`;
    }

    // Fallback: use the raw value
    return `${rule.field}:${String(value ?? 'unknown')}`;
  }

  /**
   * Behavioral bucketing: engagement level, purchase history ranges, etc.
   */
  private behavioralBucket(value: unknown, rule: SegmentationRule): string {
    // Numeric behavioral fields (e.g. purchaseHistory) use buckets
    if (rule.buckets && rule.buckets.length > 0 && typeof value === 'number') {
      const sorted = [...rule.buckets].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length - 1; i++) {
        if (value >= sorted[i] && value < sorted[i + 1]) {
          return `${rule.field}:${sorted[i]}-${sorted[i + 1]}`;
        }
      }
      if (value < sorted[0]) return `${rule.field}:<${sorted[0]}`;
      return `${rule.field}:>=${sorted[sorted.length - 1]}`;
    }

    // String behavioral fields (e.g. engagementLevel) use groups
    if (rule.groups && rule.groups.length > 0) {
      const strVal = String(value ?? '').toLowerCase();
      for (const group of rule.groups) {
        if (group.map((g) => g.toLowerCase()).includes(strVal)) {
          return `${rule.field}:${group.join(',')}`;
        }
      }
      return `${rule.field}:unknown`;
    }

    return `${rule.field}:${String(value ?? 'unknown')}`;
  }

  /**
   * Build a Segment from a bucket key and its members.
   */
  private buildSegment(
    key: string,
    members: AudienceMember[],
    criteria: SegmentationCriteria,
  ): Segment {
    return {
      segmentId: uuidv4(),
      name: key === 'other' ? 'Other' : key === 'all' ? 'All' : key,
      criteria: this.extractCriteria(members, criteria),
      size: members.length,
      members: members.map((m) => m.memberId),
    };
  }

  /**
   * Extract summary criteria from a group of members.
   */
  private extractCriteria(
    members: AudienceMember[],
    criteria: SegmentationCriteria,
  ): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    for (const rule of criteria.rules) {
      const values = members.map((m) => m[rule.field]).filter((v) => v !== undefined);
      if (values.length > 0 && typeof values[0] === 'number') {
        const nums = values as number[];
        summary[rule.field] = {
          min: Math.min(...nums),
          max: Math.max(...nums),
          avg: nums.reduce((a, b) => a + b, 0) / nums.length,
        };
      } else {
        // Count distinct values
        const counts: Record<string, number> = {};
        for (const v of values) {
          const s = String(v);
          counts[s] = (counts[s] ?? 0) + 1;
        }
        summary[rule.field] = counts;
      }
    }
    return summary;
  }

  /**
   * Distribute overflow members into the closest valid segment.
   * "Closest" is determined by matching the most rule values.
   */
  private distributeOverflow(
    overflow: AudienceMember[],
    segments: Segment[],
    criteria: SegmentationCriteria,
  ): void {
    if (segments.length === 0) return;

    for (const member of overflow) {
      // Find the segment whose first member shares the most rule-field values
      let bestIdx = 0;
      let bestScore = -1;

      for (let i = 0; i < segments.length; i++) {
        const segKey = segments[i].name;
        const memberKey = criteria.rules.map((r) => this.bucketKey(member, r)).join('|');
        // Simple similarity: count matching key parts
        const segParts = segKey.split('|');
        const memParts = memberKey.split('|');
        let score = 0;
        for (let j = 0; j < segParts.length; j++) {
          if (segParts[j] === memParts[j]) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      segments[bestIdx].members.push(member.memberId);
      segments[bestIdx].size++;
    }
  }
}

function emptyMetrics(): CampaignMetrics {
  return {
    totalReach: 0,
    totalImpressions: 0,
    totalEngagements: 0,
    averageEngagementRate: 0,
    totalSpend: 0,
    roi: 0,
  };
}
