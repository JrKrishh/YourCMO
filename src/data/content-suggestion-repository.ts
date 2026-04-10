import { ContentSuggestion } from '../models/content-suggestion';
import { Platform, ContentTone } from '../models/enums';
import { InMemoryRepository } from './in-memory-repository';

type ContentRecord = ContentSuggestion & Record<string, unknown>;

export class ContentSuggestionRepository extends InMemoryRepository<ContentRecord> {
  constructor() {
    super('contentId');
  }

  async findByTone(tone: ContentTone): Promise<ContentSuggestion[]> {
    return this.query({ filter: { tone } as Partial<ContentRecord> });
  }

  async findByPlatform(platform: Platform): Promise<ContentSuggestion[]> {
    const all = await this.findAll();
    return all.filter((c) => c.targetPlatforms.includes(platform));
  }

  async findTopByEngagement(limit: number): Promise<ContentSuggestion[]> {
    return this.query({
      sortBy: 'estimatedEngagement' as keyof ContentRecord,
      sortOrder: 'desc',
      limit,
    });
  }
}
