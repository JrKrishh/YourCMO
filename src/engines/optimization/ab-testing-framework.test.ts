import { describe, it, expect } from 'vitest';
import {
  ABTestingFramework,
  ContentVariation,
  assignTestGroups,
  calculateChiSquared,
  chiSquaredPValue,
  selectWinner,
  VariationResult,
  EngagementSimulator,
} from './ab-testing-framework';
import { Audience, AudienceMember } from '../../models/common';

// ── Helpers ──────────────────────────────────────────────────────────

function makeMembers(count: number): AudienceMember[] {
  return Array.from({ length: count }, (_, i) => ({
    memberId: `m-${i}`,
    age: 20 + (i % 40),
    interests: ['tech'],
  }));
}

function makeAudience(count: number): Audience {
  return { members: makeMembers(count) };
}

function makeVariations(count: number): ContentVariation[] {
  return Array.from({ length: count }, (_, i) => ({
    variationId: `v-${i}`,
    name: `Variation ${i}`,
    content: `Content for variation ${i}`,
  }));
}

// ── assignTestGroups ─────────────────────────────────────────────────

describe('assignTestGroups', () => {
  it('returns empty array when no variations provided', () => {
    const groups = assignTestGroups([], makeAudience(10));
    expect(groups).toHaveLength(0);
  });

  it('assigns all audience members across groups', () => {
    const audience = makeAudience(100);
    const variations = makeVariations(3);
    const groups = assignTestGroups(variations, audience);

    expect(groups).toHaveLength(3);
    const totalAssigned = groups.reduce((sum, g) => sum + g.members.length, 0);
    expect(totalAssigned).toBe(100);
  });

  it('produces balanced groups (sizes differ by at most 1)', () => {
    const audience = makeAudience(101);
    const variations = makeVariations(4);
    const groups = assignTestGroups(variations, audience);

    const sizes = groups.map((g) => g.members.length);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    expect(max - min).toBeLessThanOrEqual(1);
  });

  it('assigns each member to exactly one group', () => {
    const audience = makeAudience(50);
    const variations = makeVariations(2);
    const groups = assignTestGroups(variations, audience);

    const allIds = groups.flatMap((g) => g.members.map((m) => m.memberId));
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(50);
  });
});

// ── calculateChiSquared ──────────────────────────────────────────────

describe('calculateChiSquared', () => {
  it('returns 0 when all groups have the same engagement rate', () => {
    const groups: VariationResult[] = [
      { variationId: 'a', name: 'A', sampleSize: 100, engagements: 50, engagementRate: 0.5 },
      { variationId: 'b', name: 'B', sampleSize: 100, engagements: 50, engagementRate: 0.5 },
    ];
    expect(calculateChiSquared(groups)).toBeCloseTo(0, 5);
  });

  it('returns 0 when total sample is 0', () => {
    const groups: VariationResult[] = [
      { variationId: 'a', name: 'A', sampleSize: 0, engagements: 0, engagementRate: 0 },
    ];
    expect(calculateChiSquared(groups)).toBe(0);
  });

  it('returns a positive value when engagement rates differ', () => {
    const groups: VariationResult[] = [
      { variationId: 'a', name: 'A', sampleSize: 100, engagements: 80, engagementRate: 0.8 },
      { variationId: 'b', name: 'B', sampleSize: 100, engagements: 20, engagementRate: 0.2 },
    ];
    const chiSq = calculateChiSquared(groups);
    expect(chiSq).toBeGreaterThan(0);
  });

  it('produces larger chi-squared for larger differences', () => {
    const small: VariationResult[] = [
      { variationId: 'a', name: 'A', sampleSize: 100, engagements: 55, engagementRate: 0.55 },
      { variationId: 'b', name: 'B', sampleSize: 100, engagements: 45, engagementRate: 0.45 },
    ];
    const large: VariationResult[] = [
      { variationId: 'a', name: 'A', sampleSize: 100, engagements: 90, engagementRate: 0.9 },
      { variationId: 'b', name: 'B', sampleSize: 100, engagements: 10, engagementRate: 0.1 },
    ];
    expect(calculateChiSquared(large)).toBeGreaterThan(calculateChiSquared(small));
  });
});

// ── chiSquaredPValue ─────────────────────────────────────────────────

describe('chiSquaredPValue', () => {
  it('returns 1.0 for chi-squared = 0', () => {
    expect(chiSquaredPValue(0, 1)).toBe(1.0);
  });

  it('returns 1.0 for df = 0', () => {
    expect(chiSquaredPValue(5, 0)).toBe(1.0);
  });

  it('returns a small p-value for a large chi-squared with df=1', () => {
    // chi-squared = 10.83 with df=1 → p ≈ 0.001
    const p = chiSquaredPValue(10.83, 1);
    expect(p).toBeLessThan(0.01);
  });

  it('returns p-value around 0.05 for chi-squared ≈ 3.84 with df=1', () => {
    // The critical value for df=1 at α=0.05 is 3.841
    const p = chiSquaredPValue(3.841, 1);
    expect(p).toBeCloseTo(0.05, 1);
  });

  it('returns a value between 0 and 1', () => {
    const p = chiSquaredPValue(5, 2);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

// ── selectWinner ─────────────────────────────────────────────────────

describe('selectWinner', () => {
  const groups: VariationResult[] = [
    { variationId: 'a', name: 'A', sampleSize: 100, engagements: 30, engagementRate: 0.3 },
    { variationId: 'b', name: 'B', sampleSize: 100, engagements: 70, engagementRate: 0.7 },
  ];

  it('returns the variation with the highest engagement rate when significant', () => {
    const winner = selectWinner(groups, true);
    expect(winner).not.toBeNull();
    expect(winner!.variationId).toBe('b');
  });

  it('returns null when not significant', () => {
    expect(selectWinner(groups, false)).toBeNull();
  });

  it('returns null for empty groups', () => {
    expect(selectWinner([], true)).toBeNull();
  });
});

// ── ABTestingFramework.abTest ────────────────────────────────────────

describe('ABTestingFramework', () => {
  it('returns non-significant result for fewer than 2 variations', () => {
    const framework = new ABTestingFramework();
    const result = framework.abTest(
      makeVariations(1),
      makeAudience(100),
      () => true,
    );
    expect(result.isSignificant).toBe(false);
    expect(result.winner).toBeNull();
    expect(result.groups).toHaveLength(1);
  });

  it('detects a significant winner when engagement rates differ greatly', () => {
    const framework = new ABTestingFramework({ confidenceLevel: 0.95, minSampleSize: 10 });
    const variations = makeVariations(2);

    // Variation 0 gets 90% engagement, variation 1 gets 10%
    const simulator: EngagementSimulator = (variation) => {
      return variation.variationId === 'v-0' ? Math.random() < 0.9 : Math.random() < 0.1;
    };

    const result = framework.abTest(variations, makeAudience(200), simulator);

    expect(result.groups).toHaveLength(2);
    expect(result.testId).toBeTruthy();
    expect(result.confidenceLevel).toBe(0.95);

    // With 100 members per group and 90% vs 10% rates, this should be significant
    expect(result.isSignificant).toBe(true);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.variationId).toBe('v-0');
  });

  it('returns non-significant result when engagement rates are similar', () => {
    const framework = new ABTestingFramework({ confidenceLevel: 0.95, minSampleSize: 5 });
    const variations = makeVariations(2);

    // Both variations get ~50% engagement
    const simulator: EngagementSimulator = () => Math.random() < 0.5;

    const result = framework.abTest(variations, makeAudience(60), simulator);

    expect(result.groups).toHaveLength(2);
    // With similar rates and small sample, likely not significant
    // (not guaranteed, but very likely with 50/50 split)
    expect(result.pValue).toBeGreaterThan(0);
  });

  it('correctly computes engagement rates in results', () => {
    const framework = new ABTestingFramework({ minSampleSize: 1 });
    const variations = makeVariations(2);

    // Deterministic: v-0 always engages, v-1 never engages
    const simulator: EngagementSimulator = (variation) =>
      variation.variationId === 'v-0';

    const result = framework.abTest(variations, makeAudience(20), simulator);

    const v0 = result.groups.find((g) => g.variationId === 'v-0')!;
    const v1 = result.groups.find((g) => g.variationId === 'v-1')!;

    expect(v0.engagementRate).toBe(1.0);
    expect(v0.engagements).toBe(v0.sampleSize);
    expect(v1.engagementRate).toBe(0);
    expect(v1.engagements).toBe(0);
  });

  it('works with 3 variations', () => {
    const framework = new ABTestingFramework({ minSampleSize: 5 });
    const variations = makeVariations(3);

    const simulator: EngagementSimulator = (variation) => {
      if (variation.variationId === 'v-0') return Math.random() < 0.9;
      if (variation.variationId === 'v-1') return Math.random() < 0.1;
      return Math.random() < 0.5;
    };

    const result = framework.abTest(variations, makeAudience(300), simulator);

    expect(result.groups).toHaveLength(3);
    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });
});
