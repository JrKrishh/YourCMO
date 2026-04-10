import { Campaign } from '../../models';
import { createLogger } from '../../utils/logger';

const log = createLogger('CampaignStore');

/**
 * In-memory persistence layer for campaigns.
 * Provides CRUD operations and query methods.
 */
export class CampaignStore {
  private readonly campaigns = new Map<string, Campaign>();

  /** Persist a campaign (insert or update). */
  save(campaign: Campaign): void {
    this.campaigns.set(campaign.campaignId, { ...campaign });
    log.debug({ campaignId: campaign.campaignId }, 'Campaign saved');
  }

  /** Retrieve a campaign by ID, or undefined if not found. */
  get(campaignId: string): Campaign | undefined {
    const campaign = this.campaigns.get(campaignId);
    return campaign ? { ...campaign } : undefined;
  }

  /** Delete a campaign by ID. Returns true if it existed. */
  delete(campaignId: string): boolean {
    return this.campaigns.delete(campaignId);
  }

  /** Return all stored campaigns. */
  getAll(): Campaign[] {
    return Array.from(this.campaigns.values()).map((c) => ({ ...c }));
  }

  /** Return the number of stored campaigns. */
  get size(): number {
    return this.campaigns.size;
  }

  /** Remove all campaigns. */
  clear(): void {
    this.campaigns.clear();
  }
}
