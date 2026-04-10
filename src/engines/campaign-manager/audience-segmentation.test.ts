import { describe, it, expect, beforeEach } from 'vitest';
import { CampaignManager } from './campaign-manager';
import {
  Audience,
  AudienceMember,
  SegmentationCriteria,
} from '../../models/common';

/** Helper to create audience members with sequential IDs */
function makeMember(overrides: Partial<AudienceMember> & { memberId: string }): AudienceMember {
  return {
    age: 30,
    gender: 'female',
    location: 'US',
    engagementLevel: 'medium',
    purchaseHistory: 5,
    ...overrides,
  };
}

function makeAudience(members: AudienceMember[]): Audience {
  return { members };
}

describe('CampaignManager.segmentAudience', () => {
  let manager: CampaignManager;

  beforeEach(() => {
    manager = new CampaignManager();
  });

  describe('validation', () => {
    it('should throw on empty audience', () => {
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'age', type: 'demographic', buckets: [18, 35, 50] }],
        minSegmentSize: 1,
      };
      expect(() => manager.segmentAudience({ members: [] }, criteria)).toThrow(
        'Audience must be non-empty',
      );
    });

    it('should throw on empty rules', () => {
      const audience = makeAudience([makeMember({ memberId: '1' })]);
      expect(() =>
        manager.segmentAudience(audience, { rules: [], minSegmentSize: 1 }),
      ).toThrow('Segmentation criteria must contain at least one rule');
    });

    it('should throw when minSegmentSize is 0', () => {
      const audience = makeAudience([makeMember({ memberId: '1' })]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'gender', type: 'demographic', groups: [['male'], ['female']] }],
        minSegmentSize: 0,
      };
      expect(() => manager.segmentAudience(audience, criteria)).toThrow(
        'minSegmentSize must be greater than 0',
      );
    });
  });

  describe('demographic-based segmentation', () => {
    it('should segment by age buckets', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', age: 20 }),
        makeMember({ memberId: '2', age: 22 }),
        makeMember({ memberId: '3', age: 40 }),
        makeMember({ memberId: '4', age: 42 }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'age', type: 'demographic', buckets: [18, 30, 50] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);

      // Should have 2 segments: 18-30 and 30-50
      expect(segments).toHaveLength(2);
      const allMemberIds = segments.flatMap((s) => s.members).sort();
      expect(allMemberIds).toEqual(['1', '2', '3', '4']);
    });

    it('should segment by gender groups', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', gender: 'male' }),
        makeMember({ memberId: '2', gender: 'male' }),
        makeMember({ memberId: '3', gender: 'female' }),
        makeMember({ memberId: '4', gender: 'female' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'gender', type: 'demographic', groups: [['male'], ['female']] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(2);

      const maleSegment = segments.find((s) => s.members.includes('1'));
      const femaleSegment = segments.find((s) => s.members.includes('3'));
      expect(maleSegment!.size).toBe(2);
      expect(femaleSegment!.size).toBe(2);
    });

    it('should segment by location using raw values', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', location: 'US' }),
        makeMember({ memberId: '2', location: 'US' }),
        makeMember({ memberId: '3', location: 'UK' }),
        makeMember({ memberId: '4', location: 'UK' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'location', type: 'demographic' }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(2);
    });
  });

  describe('behavior-based segmentation', () => {
    it('should segment by engagement level', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', engagementLevel: 'high' }),
        makeMember({ memberId: '2', engagementLevel: 'high' }),
        makeMember({ memberId: '3', engagementLevel: 'low' }),
        makeMember({ memberId: '4', engagementLevel: 'low' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [
          {
            field: 'engagementLevel',
            type: 'behavioral',
            groups: [['high'], ['medium'], ['low']],
          },
        ],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(2);
      const highSeg = segments.find((s) => s.members.includes('1'));
      expect(highSeg!.size).toBe(2);
    });

    it('should segment by purchase history buckets', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', purchaseHistory: 0 }),
        makeMember({ memberId: '2', purchaseHistory: 2 }),
        makeMember({ memberId: '3', purchaseHistory: 10 }),
        makeMember({ memberId: '4', purchaseHistory: 15 }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'purchaseHistory', type: 'behavioral', buckets: [0, 5, 20] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(2);
    });
  });

  describe('multi-rule segmentation', () => {
    it('should create composite segments from multiple rules', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', age: 20, gender: 'male' }),
        makeMember({ memberId: '2', age: 20, gender: 'female' }),
        makeMember({ memberId: '3', age: 40, gender: 'male' }),
        makeMember({ memberId: '4', age: 40, gender: 'female' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [
          { field: 'age', type: 'demographic', buckets: [18, 30, 50] },
          { field: 'gender', type: 'demographic', groups: [['male'], ['female']] },
        ],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      // 4 unique combos: young-male, young-female, older-male, older-female
      expect(segments).toHaveLength(4);
      expect(segments.every((s) => s.size === 1)).toBe(true);
    });
  });

  describe('minimum segment size enforcement', () => {
    it('should merge undersized segments into Other', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', location: 'US' }),
        makeMember({ memberId: '2', location: 'US' }),
        makeMember({ memberId: '3', location: 'US' }),
        makeMember({ memberId: '4', location: 'UK' }),
        makeMember({ memberId: '5', location: 'DE' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'location', type: 'demographic' }],
        minSegmentSize: 2,
      };

      const segments = manager.segmentAudience(audience, criteria);
      // US (3) is valid, UK (1) + DE (1) = Other (2) meets minimum
      expect(segments).toHaveLength(2);
      const allIds = segments.flatMap((s) => s.members).sort();
      expect(allIds).toEqual(['1', '2', '3', '4', '5']);
    });

    it('should distribute tiny overflow into nearest segment', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', location: 'US' }),
        makeMember({ memberId: '2', location: 'US' }),
        makeMember({ memberId: '3', location: 'US' }),
        makeMember({ memberId: '4', location: 'UK' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'location', type: 'demographic' }],
        minSegmentSize: 2,
      };

      const segments = manager.segmentAudience(audience, criteria);
      // US (3) valid, UK (1) too small for own segment, gets distributed
      const allIds = segments.flatMap((s) => s.members).sort();
      expect(allIds).toEqual(['1', '2', '3', '4']);
    });

    it('should create single segment when all buckets are undersized', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', location: 'US' }),
        makeMember({ memberId: '2', location: 'UK' }),
        makeMember({ memberId: '3', location: 'DE' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'location', type: 'demographic' }],
        minSegmentSize: 5,
      };

      const segments = manager.segmentAudience(audience, criteria);
      // All buckets too small, overflow (3) < minSegmentSize (5), but no valid segments exist
      // Falls back to single "All" segment
      expect(segments).toHaveLength(1);
      expect(segments[0].size).toBe(3);
      expect(segments[0].members.sort()).toEqual(['1', '2', '3']);
    });
  });

  describe('mutual exclusivity and completeness', () => {
    it('should assign every member to exactly one segment', () => {
      const members = Array.from({ length: 20 }, (_, i) =>
        makeMember({
          memberId: String(i),
          age: 18 + (i % 5) * 10,
          gender: i % 2 === 0 ? 'male' : 'female',
          engagementLevel: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low',
        }),
      );
      const audience = makeAudience(members);
      const criteria: SegmentationCriteria = {
        rules: [
          { field: 'age', type: 'demographic', buckets: [18, 30, 50, 70] },
          { field: 'gender', type: 'demographic', groups: [['male'], ['female']] },
        ],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      const allIds = segments.flatMap((s) => s.members).sort((a, b) => Number(a) - Number(b));
      const expectedIds = members.map((m) => m.memberId).sort((a, b) => Number(a) - Number(b));

      // Completeness: all members present
      expect(allIds).toEqual(expectedIds);

      // Mutual exclusivity: no duplicates
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  describe('segment metadata', () => {
    it('should include segment criteria summary with numeric stats', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', age: 20 }),
        makeMember({ memberId: '2', age: 25 }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'age', type: 'demographic', buckets: [18, 30] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(1);
      const ageCriteria = segments[0].criteria['age'] as { min: number; max: number; avg: number };
      expect(ageCriteria.min).toBe(20);
      expect(ageCriteria.max).toBe(25);
      expect(ageCriteria.avg).toBe(22.5);
    });

    it('should include segment criteria summary with value counts for strings', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', gender: 'male' }),
        makeMember({ memberId: '2', gender: 'male' }),
        makeMember({ memberId: '3', gender: 'male' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'gender', type: 'demographic', groups: [['male'], ['female']] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      const genderCriteria = segments[0].criteria['gender'] as Record<string, number>;
      expect(genderCriteria['male']).toBe(3);
    });

    it('should generate unique segment IDs', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', gender: 'male' }),
        makeMember({ memberId: '2', gender: 'female' }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'gender', type: 'demographic', groups: [['male'], ['female']] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      const ids = segments.map((s) => s.segmentId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('edge cases', () => {
    it('should handle members with missing field values', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', age: 25 }),
        { memberId: '2' } as AudienceMember, // no age
        makeMember({ memberId: '3', age: 25 }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'age', type: 'demographic', buckets: [18, 30] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      const allIds = segments.flatMap((s) => s.members).sort();
      expect(allIds).toEqual(['1', '2', '3']);
    });

    it('should handle single member audience', () => {
      const audience = makeAudience([makeMember({ memberId: '1' })]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'gender', type: 'demographic', groups: [['male'], ['female']] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(1);
      expect(segments[0].members).toEqual(['1']);
    });

    it('should handle age below first bucket boundary', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', age: 10 }),
        makeMember({ memberId: '2', age: 10 }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'age', type: 'demographic', buckets: [18, 30, 50] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(1);
      expect(segments[0].name).toContain('<18');
    });

    it('should handle age above last bucket boundary', () => {
      const audience = makeAudience([
        makeMember({ memberId: '1', age: 70 }),
        makeMember({ memberId: '2', age: 80 }),
      ]);
      const criteria: SegmentationCriteria = {
        rules: [{ field: 'age', type: 'demographic', buckets: [18, 30, 50] }],
        minSegmentSize: 1,
      };

      const segments = manager.segmentAudience(audience, criteria);
      expect(segments).toHaveLength(1);
      expect(segments[0].name).toContain('>=50');
    });
  });
});
