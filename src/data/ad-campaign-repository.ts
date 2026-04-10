import { AdCampaign } from '../models/ad-campaign';
import { AdPlatform, AdStatus } from '../models/enums';
import { InMemoryRepository } from './in-memory-repository';

type AdCampaignRecord = AdCampaign & Record<string, unknown>;

export class AdCampaignRepository extends InMemoryRepository<AdCampaignRecord> {
  constructor() {
    super('adCampaignId');
  }

  async findByPlatform(platform: AdPlatform): Promise<AdCampaign[]> {
    return this.query({ filter: { platform } as Partial<AdCampaignRecord> });
  }

  async findByStatus(status: AdStatus): Promise<AdCampaign[]> {
    return this.query({ filter: { status } as Partial<AdCampaignRecord> });
  }

  async findActiveByPlatform(platform: AdPlatform): Promise<AdCampaign[]> {
    const all = await this.findAll();
    return all.filter(
      (c) => c.platform === platform && c.status === AdStatus.ACTIVE,
    );
  }

  async findByDateRange(start: Date, end: Date): Promise<AdCampaign[]> {
    const all = await this.findAll();
    return all.filter(
      (c) => c.startDate >= start && c.endDate <= end,
    );
  }

  async getTotalSpend(): Promise<number> {
    const all = await this.findAll();
    return all.reduce((sum, c) => sum + c.performance.spend, 0);
  }
}
