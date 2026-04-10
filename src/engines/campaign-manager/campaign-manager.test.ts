import { describe, it, expect, beforeEach } from 'vitest';
import { CampaignManager } from './campaign-manager';
import { CampaignStore } from './campaign-store';
import { CampaignType, CampaignStatus } from '../../models';

describe('CampaignStore', () => {
  let store: CampaignStore;

  beforeEach(() => {
    store = new CampaignStore();
  });

  it('should save and retrieve a campaign', () => {
    const manager = new CampaignManager(store);
    const campaign = manager.createCampaign({ name: 'Test', type: CampaignType.WHATSAPP });
    const retrieved = store.get(campaign.campaignId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Test');
  });

  it('should return undefined for unknown ID', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('should delete a campaign', () => {
    const manager = new CampaignManager(store);
    const campaign = manager.createCampaign({ name: 'Del', type: CampaignType.WHATSAPP });
    expect(store.delete(campaign.campaignId)).toBe(true);
    expect(store.get(campaign.campaignId)).toBeUndefined();
  });

  it('should report correct size', () => {
    const manager = new CampaignManager(store);
    expect(store.size).toBe(0);
    manager.createCampaign({ name: 'A', type: CampaignType.WHATSAPP });
    manager.createCampaign({ name: 'B', type: CampaignType.MULTI_PLATFORM });
    expect(store.size).toBe(2);
  });

  it('should clear all campaigns', () => {
    const manager = new CampaignManager(store);
    manager.createCampaign({ name: 'A', type: CampaignType.WHATSAPP });
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe('CampaignManager', () => {
  let manager: CampaignManager;

  beforeEach(() => {
    manager = new CampaignManager();
  });

  describe('createCampaign', () => {
    it('should create a campaign in DRAFT status', () => {
      const campaign = manager.createCampaign({
        name: 'Summer Sale',
        type: CampaignType.WHATSAPP,
      });

      expect(campaign.campaignId).toBeDefined();
      expect(campaign.name).toBe('Summer Sale');
      expect(campaign.type).toBe(CampaignType.WHATSAPP);
      expect(campaign.status).toBe(CampaignStatus.DRAFT);
      expect(campaign.content).toEqual([]);
      expect(campaign.targetAudience).toEqual([]);
      expect(campaign.metrics.totalSpend).toBe(0);
    });

    it('should apply provided budget', () => {
      const campaign = manager.createCampaign({
        name: 'Budget Test',
        type: CampaignType.AD_CAMPAIGN,
        budget: { dailyLimit: 100, totalLimit: 1000, currency: 'EUR' },
      });

      expect(campaign.budget.dailyLimit).toBe(100);
      expect(campaign.budget.totalLimit).toBe(1000);
      expect(campaign.budget.remaining).toBe(1000);
      expect(campaign.budget.spent).toBe(0);
      expect(campaign.budget.currency).toBe('EUR');
    });

    it('should apply provided schedule timezone', () => {
      const campaign = manager.createCampaign({
        name: 'TZ Test',
        type: CampaignType.MULTI_PLATFORM,
        schedule: { timezone: 'America/New_York' },
      });

      expect(campaign.schedule.timezone).toBe('America/New_York');
    });

    it('should throw on empty name', () => {
      expect(() => manager.createCampaign({ name: '', type: CampaignType.WHATSAPP })).toThrow(
        'Campaign name must be non-empty',
      );
    });

    it('should throw when endDate is before startDate', () => {
      const start = new Date('2025-06-01');
      const end = new Date('2025-05-01');
      expect(() =>
        manager.createCampaign({
          name: 'Bad Dates',
          type: CampaignType.WHATSAPP,
          startDate: start,
          endDate: end,
        }),
      ).toThrow('endDate must be after startDate');
    });

    it('should default endDate to 30 days after startDate', () => {
      const start = new Date('2025-01-01T00:00:00Z');
      const campaign = manager.createCampaign({
        name: 'Default End',
        type: CampaignType.WHATSAPP,
        startDate: start,
      });

      const expectedEnd = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(campaign.endDate.getTime()).toBe(expectedEnd.getTime());
    });
  });

  describe('getCampaign', () => {
    it('should retrieve a created campaign', () => {
      const created = manager.createCampaign({ name: 'Get Test', type: CampaignType.WHATSAPP });
      const retrieved = manager.getCampaign(created.campaignId);
      expect(retrieved.name).toBe('Get Test');
    });

    it('should throw for unknown campaign ID', () => {
      expect(() => manager.getCampaign('unknown-id')).toThrow('Campaign not found');
    });
  });

  describe('state transitions', () => {
    it('should transition DRAFT → ACTIVE', () => {
      const campaign = manager.createCampaign({ name: 'Trans', type: CampaignType.WHATSAPP });
      const updated = manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
      expect(updated.status).toBe(CampaignStatus.ACTIVE);
    });

    it('should transition DRAFT → SCHEDULED', () => {
      const campaign = manager.createCampaign({ name: 'Sched', type: CampaignType.WHATSAPP });
      const updated = manager.transitionStatus(campaign.campaignId, CampaignStatus.SCHEDULED);
      expect(updated.status).toBe(CampaignStatus.SCHEDULED);
    });

    it('should transition ACTIVE → PAUSED → ACTIVE', () => {
      const campaign = manager.createCampaign({ name: 'Pause', type: CampaignType.WHATSAPP });
      manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
      const paused = manager.pauseCampaign(campaign.campaignId);
      expect(paused.status).toBe(CampaignStatus.PAUSED);
      const resumed = manager.resumeCampaign(campaign.campaignId);
      expect(resumed.status).toBe(CampaignStatus.ACTIVE);
    });

    it('should transition ACTIVE → COMPLETED', () => {
      const campaign = manager.createCampaign({ name: 'Complete', type: CampaignType.WHATSAPP });
      manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
      const completed = manager.transitionStatus(campaign.campaignId, CampaignStatus.COMPLETED);
      expect(completed.status).toBe(CampaignStatus.COMPLETED);
    });

    it('should reject invalid transition DRAFT → COMPLETED', () => {
      const campaign = manager.createCampaign({ name: 'Bad', type: CampaignType.WHATSAPP });
      expect(() =>
        manager.transitionStatus(campaign.campaignId, CampaignStatus.COMPLETED),
      ).toThrow('Invalid status transition');
    });

    it('should reject transition from COMPLETED', () => {
      const campaign = manager.createCampaign({ name: 'Done', type: CampaignType.WHATSAPP });
      manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
      manager.transitionStatus(campaign.campaignId, CampaignStatus.COMPLETED);
      expect(() =>
        manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE),
      ).toThrow('Invalid status transition');
    });

    it('should reject pausing a DRAFT campaign', () => {
      const campaign = manager.createCampaign({ name: 'NoPause', type: CampaignType.WHATSAPP });
      expect(() => manager.pauseCampaign(campaign.campaignId)).toThrow('Invalid status transition');
    });

    it('should reject resuming a non-PAUSED campaign', () => {
      const campaign = manager.createCampaign({ name: 'NoResume', type: CampaignType.WHATSAPP });
      manager.transitionStatus(campaign.campaignId, CampaignStatus.ACTIVE);
      expect(() => manager.resumeCampaign(campaign.campaignId)).toThrow('Invalid status transition');
    });
  });

  describe('listCampaigns', () => {
    it('should list all campaigns', () => {
      manager.createCampaign({ name: 'A', type: CampaignType.WHATSAPP });
      manager.createCampaign({ name: 'B', type: CampaignType.MULTI_PLATFORM });
      expect(manager.listCampaigns()).toHaveLength(2);
    });

    it('should filter by status', () => {
      const c = manager.createCampaign({ name: 'A', type: CampaignType.WHATSAPP });
      manager.createCampaign({ name: 'B', type: CampaignType.WHATSAPP });
      manager.transitionStatus(c.campaignId, CampaignStatus.ACTIVE);

      expect(manager.listCampaigns(CampaignStatus.ACTIVE)).toHaveLength(1);
      expect(manager.listCampaigns(CampaignStatus.DRAFT)).toHaveLength(1);
    });
  });

  describe('deleteCampaign', () => {
    it('should delete a DRAFT campaign', () => {
      const c = manager.createCampaign({ name: 'Del', type: CampaignType.WHATSAPP });
      manager.deleteCampaign(c.campaignId);
      expect(() => manager.getCampaign(c.campaignId)).toThrow('Campaign not found');
    });

    it('should delete a COMPLETED campaign', () => {
      const c = manager.createCampaign({ name: 'Del2', type: CampaignType.WHATSAPP });
      manager.transitionStatus(c.campaignId, CampaignStatus.ACTIVE);
      manager.transitionStatus(c.campaignId, CampaignStatus.COMPLETED);
      manager.deleteCampaign(c.campaignId);
      expect(manager.listCampaigns()).toHaveLength(0);
    });

    it('should reject deleting an ACTIVE campaign', () => {
      const c = manager.createCampaign({ name: 'NoDel', type: CampaignType.WHATSAPP });
      manager.transitionStatus(c.campaignId, CampaignStatus.ACTIVE);
      expect(() => manager.deleteCampaign(c.campaignId)).toThrow('Cannot delete campaign');
    });
  });
});
