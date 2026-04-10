import { Transaction } from './repository';
import { CampaignRepository } from './campaign-repository';
import { TrendRepository } from './trend-repository';
import { ContentSuggestionRepository } from './content-suggestion-repository';
import { AdCampaignRepository } from './ad-campaign-repository';
import { EngagementMetricsRepository } from './engagement-metrics-repository';
import { v4 as uuidv4 } from 'uuid';

/**
 * Unified data access layer providing access to all repositories
 * and coordinated transaction support across them.
 */
export class DataAccessLayer {
  readonly campaigns: CampaignRepository;
  readonly trends: TrendRepository;
  readonly contentSuggestions: ContentSuggestionRepository;
  readonly adCampaigns: AdCampaignRepository;
  readonly engagementMetrics: EngagementMetricsRepository;

  constructor() {
    this.campaigns = new CampaignRepository();
    this.trends = new TrendRepository();
    this.contentSuggestions = new ContentSuggestionRepository();
    this.adCampaigns = new AdCampaignRepository();
    this.engagementMetrics = new EngagementMetricsRepository();
  }

  /**
   * Begin a transaction across all repositories.
   * Returns a Transaction object that can commit or rollback all changes atomically.
   */
  beginTransaction(): Transaction {
    const txId = uuidv4();
    const txCampaigns = this.campaigns.beginTransaction();
    const txTrends = this.trends.beginTransaction();
    const txContent = this.contentSuggestions.beginTransaction();
    const txAdCampaigns = this.adCampaigns.beginTransaction();
    const txMetrics = this.engagementMetrics.beginTransaction();

    return {
      id: txId,
      begin: () => { /* snapshots already taken */ },
      commit: () => {
        txCampaigns.commit();
        txTrends.commit();
        txContent.commit();
        txAdCampaigns.commit();
        txMetrics.commit();
      },
      rollback: () => {
        txCampaigns.rollback();
        txTrends.rollback();
        txContent.rollback();
        txAdCampaigns.rollback();
        txMetrics.rollback();
      },
    };
  }

  /**
   * Execute a function within a transaction. Automatically commits on success
   * or rolls back on error.
   */
  async executeInTransaction<R>(fn: (dal: DataAccessLayer) => Promise<R>): Promise<R> {
    const tx = this.beginTransaction();
    try {
      const result = await fn(this);
      tx.commit();
      return result;
    } catch (error) {
      tx.rollback();
      throw error;
    }
  }

  /** Clear all repositories (useful for tests). */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.campaigns.clear(),
      this.trends.clear(),
      this.contentSuggestions.clear(),
      this.adCampaigns.clear(),
      this.engagementMetrics.clear(),
    ]);
  }
}
