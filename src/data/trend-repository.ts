import { Trend } from '../models/trend';
import { Platform } from '../models/enums';
import { InMemoryRepository } from './in-memory-repository';

type TrendRecord = Trend & Record<string, unknown>;

export class TrendRepository extends InMemoryRepository<TrendRecord> {
  constructor() {
    super('trendId');
  }

  async findByPlatform(platform: Platform): Promise<Trend[]> {
    return this.query({ filter: { platform } as Partial<TrendRecord> });
  }

  async findByDateRange(start: Date, end: Date): Promise<Trend[]> {
    const all = await this.findAll();
    return all.filter(
      (t) => t.timestamp >= start && t.timestamp <= end,
    );
  }

  async findTopByEngagement(limit: number): Promise<Trend[]> {
    return this.query({
      sortBy: 'engagementScore' as keyof TrendRecord,
      sortOrder: 'desc',
      limit,
    });
  }

  async findByTopic(topic: string): Promise<Trend[]> {
    const all = await this.findAll();
    return all.filter((t) =>
      t.topic.toLowerCase().includes(topic.toLowerCase()),
    );
  }
}
