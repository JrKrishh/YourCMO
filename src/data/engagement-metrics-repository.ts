import { EngagementMetrics } from '../models/engagement-metrics';
import { Platform } from '../models/enums';
import { InMemoryRepository } from './in-memory-repository';

type MetricsRecord = EngagementMetrics & Record<string, unknown>;

export class EngagementMetricsRepository extends InMemoryRepository<MetricsRecord> {
  constructor() {
    super('postId');
  }

  async findByPlatform(platform: Platform): Promise<EngagementMetrics[]> {
    return this.query({ filter: { platform } as Partial<MetricsRecord> });
  }

  async findByDateRange(start: Date, end: Date): Promise<EngagementMetrics[]> {
    const all = await this.findAll();
    return all.filter(
      (m) => m.timestamp >= start && m.timestamp <= end,
    );
  }

  async getAverageEngagementRate(platform?: Platform): Promise<number> {
    let metrics: EngagementMetrics[];
    if (platform) {
      metrics = await this.findByPlatform(platform);
    } else {
      metrics = await this.findAll();
    }
    if (metrics.length === 0) return 0;
    const total = metrics.reduce((sum, m) => sum + m.engagementRate, 0);
    return total / metrics.length;
  }

  async getTopPerforming(limit: number): Promise<EngagementMetrics[]> {
    return this.query({
      sortBy: 'engagementRate' as keyof MetricsRecord,
      sortOrder: 'desc',
      limit,
    });
  }
}
