import { Campaign } from '../models/campaign';
import { CampaignStatus, CampaignType } from '../models/enums';
import { InMemoryRepository } from './in-memory-repository';

type CampaignRecord = Campaign & Record<string, unknown>;

export class CampaignRepository extends InMemoryRepository<CampaignRecord> {
  constructor() {
    super('campaignId');
  }

  async findByStatus(status: CampaignStatus): Promise<Campaign[]> {
    return this.query({ filter: { status } as Partial<CampaignRecord> });
  }

  async findByType(type: CampaignType): Promise<Campaign[]> {
    return this.query({ filter: { type } as Partial<CampaignRecord> });
  }

  async findByDateRange(start: Date, end: Date): Promise<Campaign[]> {
    const all = await this.findAll();
    return all.filter(
      (c) => c.startDate >= start && c.endDate <= end,
    );
  }

  async findActiveCampaigns(): Promise<Campaign[]> {
    return this.findByStatus(CampaignStatus.ACTIVE);
  }
}
