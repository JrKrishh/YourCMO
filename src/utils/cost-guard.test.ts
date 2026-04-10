import { describe, it, expect, beforeEach } from 'vitest';
import { CostGuard } from './cost-guard';

describe('CostGuard', () => {
  let guard: CostGuard;

  beforeEach(() => {
    guard = new CostGuard({
      dailyLimitUsd: 100,
      totalLimitUsd: 500,
      categoryLimits: { llm: 30, image_generation: 20 },
    });
  });

  describe('canSpend', () => {
    it('allows spend within limits', () => {
      const result = guard.canSpend('llm', 5);
      expect(result.allowed).toBe(true);
    });

    it('rejects spend exceeding daily limit', () => {
      guard.recordCost('llm', 95, 'big call');
      const result = guard.canSpend('llm', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily limit');
    });

    it('rejects spend exceeding total limit', () => {
      const g = new CostGuard({ dailyLimitUsd: 1000, totalLimitUsd: 50 });
      g.recordCost('llm', 45, 'call');
      const result = g.canSpend('llm', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Total limit');
    });

    it('rejects spend exceeding category daily limit', () => {
      guard.recordCost('llm', 28, 'call 1');
      const result = guard.canSpend('llm', 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('llm daily limit');
    });

    it('allows spend in different category even if one is maxed', () => {
      guard.recordCost('llm', 30, 'maxed llm');
      const result = guard.canSpend('image_generation', 10);
      expect(result.allowed).toBe(true);
    });

    it('allows spend when no category limit is set', () => {
      guard.recordCost('ad_spend', 50, 'ads');
      const result = guard.canSpend('ad_spend', 10);
      expect(result.allowed).toBe(true);
    });
  });

  describe('recordCost', () => {
    it('tracks cumulative spending', () => {
      guard.recordCost('llm', 5, 'call 1');
      guard.recordCost('llm', 3, 'call 2');
      guard.recordCost('image_generation', 2, 'image');
      expect(guard.getTotalSpent()).toBeCloseTo(10);
      expect(guard.getDailySpent()).toBeCloseTo(10);
    });

    it('tracks per-category spending', () => {
      guard.recordCost('llm', 5, 'call');
      guard.recordCost('image_generation', 3, 'image');
      expect(guard.getDailyCategorySpent('llm')).toBeCloseTo(5);
      expect(guard.getDailyCategorySpent('image_generation')).toBeCloseTo(3);
    });
  });

  describe('cache', () => {
    it('stores and retrieves cached values', () => {
      guard.setCache('key1', { data: 'hello' });
      const cached = guard.getCached<{ data: string }>('key1');
      expect(cached).toEqual({ data: 'hello' });
    });

    it('returns undefined for missing keys', () => {
      expect(guard.getCached('nope')).toBeUndefined();
    });

    it('returns undefined for expired entries', () => {
      const g = new CostGuard({ cacheTtlMs: 1 });
      g.setCache('key', 'val');
      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(g.getCached('key')).toBeUndefined();
    });

    it('does not cache when disabled', () => {
      const g = new CostGuard({ enableCache: false });
      g.setCache('key', 'val');
      expect(g.getCached('key')).toBeUndefined();
    });

    it('clears cache', () => {
      guard.setCache('k', 'v');
      guard.clearCache();
      expect(guard.getCached('k')).toBeUndefined();
    });
  });

  describe('getSummary', () => {
    it('returns complete spending summary', () => {
      guard.recordCost('llm', 10, 'call');
      guard.recordCost('image_generation', 5, 'image');
      const summary = guard.getSummary();
      expect(summary.totalSpent).toBeCloseTo(15);
      expect(summary.dailySpent).toBeCloseTo(15);
      expect(summary.byCategory.llm).toBeCloseTo(10);
      expect(summary.byCategory.image_generation).toBeCloseTo(5);
      expect(summary.dailyLimitRemaining).toBeCloseTo(85);
      expect(summary.totalLimitRemaining).toBeCloseTo(485);
      expect(summary.eventCount).toBe(2);
    });

    it('returns zeros when no spending', () => {
      const summary = guard.getSummary();
      expect(summary.totalSpent).toBe(0);
      expect(summary.dailySpent).toBe(0);
      expect(summary.eventCount).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all events and cache', () => {
      guard.recordCost('llm', 10, 'call');
      guard.setCache('k', 'v');
      guard.reset();
      expect(guard.getTotalSpent()).toBe(0);
      expect(guard.getCached('k')).toBeUndefined();
    });
  });
});
