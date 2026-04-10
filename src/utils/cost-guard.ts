/**
 * Cost Guard — centralized spending tracker and limiter.
 *
 * Tracks cumulative costs across all paid API calls (LLM, image gen,
 * video gen, WhatsApp messaging, ad spend) and enforces configurable
 * daily and total spending limits. Provides a response cache to avoid
 * duplicate API calls for identical inputs.
 */

import { createLogger } from './logger';

const log = createLogger('CostGuard');

/** Cost categories tracked by the guard */
export type CostCategory =
  | 'llm'
  | 'image_generation'
  | 'video_generation'
  | 'whatsapp_messaging'
  | 'ad_spend'
  | 'trend_api';

/** A single cost event */
export interface CostEvent {
  category: CostCategory;
  amount: number;
  currency: string;
  description: string;
  timestamp: Date;
}

/** Spending limits configuration */
export interface CostGuardConfig {
  /** Maximum daily spend across all categories (default: 50) */
  dailyLimitUsd: number;
  /** Maximum total spend before hard stop (default: 500) */
  totalLimitUsd: number;
  /** Per-category daily limits (optional overrides) */
  categoryLimits: Partial<Record<CostCategory, number>>;
  /** Enable response caching to avoid duplicate API calls (default: true) */
  enableCache: boolean;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs: number;
}

const DEFAULT_CONFIG: CostGuardConfig = {
  dailyLimitUsd: 50,
  totalLimitUsd: 500,
  categoryLimits: {
    llm: 20,
    image_generation: 15,
    video_generation: 15,
    whatsapp_messaging: 30,
    ad_spend: 100,
    trend_api: 5,
  },
  enableCache: true,
  cacheTtlMs: 5 * 60 * 1000,
};

/** Spending summary for reporting */
export interface SpendingSummary {
  totalSpent: number;
  dailySpent: number;
  byCategory: Record<CostCategory, number>;
  dailyLimitRemaining: number;
  totalLimitRemaining: number;
  eventCount: number;
}

/** Cache entry */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CostGuard {
  private readonly config: CostGuardConfig;
  private readonly events: CostEvent[] = [];
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private dailyResetDate: string;

  constructor(config?: Partial<CostGuardConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      categoryLimits: { ...DEFAULT_CONFIG.categoryLimits, ...config?.categoryLimits },
      ...config,
    };
    this.dailyResetDate = this.todayKey();
  }

  /**
   * Check if a spend of the given amount is allowed.
   * Returns { allowed, reason } — call this BEFORE making an API call.
   */
  canSpend(category: CostCategory, amount: number): { allowed: boolean; reason?: string } {
    this.resetDailyIfNeeded();

    const dailySpent = this.getDailySpent();
    if (dailySpent + amount > this.config.dailyLimitUsd) {
      return { allowed: false, reason: `Daily limit exceeded: $${dailySpent.toFixed(2)} + $${amount.toFixed(2)} > $${this.config.dailyLimitUsd}` };
    }

    const totalSpent = this.getTotalSpent();
    if (totalSpent + amount > this.config.totalLimitUsd) {
      return { allowed: false, reason: `Total limit exceeded: $${totalSpent.toFixed(2)} + $${amount.toFixed(2)} > $${this.config.totalLimitUsd}` };
    }

    const categoryLimit = this.config.categoryLimits[category];
    if (categoryLimit !== undefined) {
      const categoryDailySpent = this.getDailyCategorySpent(category);
      if (categoryDailySpent + amount > categoryLimit) {
        return { allowed: false, reason: `${category} daily limit exceeded: $${categoryDailySpent.toFixed(2)} + $${amount.toFixed(2)} > $${categoryLimit}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a cost event after a successful API call.
   */
  recordCost(category: CostCategory, amount: number, description: string): void {
    this.resetDailyIfNeeded();
    const event: CostEvent = {
      category,
      amount,
      currency: 'USD',
      description,
      timestamp: new Date(),
    };
    this.events.push(event);
    log.info({ category, amount: amount.toFixed(4), description }, 'Cost recorded');
  }

  /**
   * Get a cached response, or undefined if not cached / expired.
   */
  getCached<T>(key: string): T | undefined {
    if (!this.config.enableCache) return undefined;
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    log.debug({ key }, 'Cache hit — avoiding duplicate API call');
    return entry.value as T;
  }

  /**
   * Store a response in the cache.
   */
  setCache<T>(key: string, value: T): void {
    if (!this.config.enableCache) return;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  /**
   * Get a full spending summary.
   */
  getSummary(): SpendingSummary {
    this.resetDailyIfNeeded();
    const totalSpent = this.getTotalSpent();
    const dailySpent = this.getDailySpent();
    const byCategory = {} as Record<CostCategory, number>;
    const categories: CostCategory[] = ['llm', 'image_generation', 'video_generation', 'whatsapp_messaging', 'ad_spend', 'trend_api'];
    for (const cat of categories) {
      byCategory[cat] = this.getDailyCategorySpent(cat);
    }
    return {
      totalSpent,
      dailySpent,
      byCategory,
      dailyLimitRemaining: Math.max(0, this.config.dailyLimitUsd - dailySpent),
      totalLimitRemaining: Math.max(0, this.config.totalLimitUsd - totalSpent),
      eventCount: this.events.length,
    };
  }

  /** Total spent across all time */
  getTotalSpent(): number {
    return this.events.reduce((sum, e) => sum + e.amount, 0);
  }

  /** Total spent today */
  getDailySpent(): number {
    const today = this.todayKey();
    return this.events
      .filter((e) => this.dateKey(e.timestamp) === today)
      .reduce((sum, e) => sum + e.amount, 0);
  }

  /** Daily spend for a specific category */
  getDailyCategorySpent(category: CostCategory): number {
    const today = this.todayKey();
    return this.events
      .filter((e) => e.category === category && this.dateKey(e.timestamp) === today)
      .reduce((sum, e) => sum + e.amount, 0);
  }

  /** Clear cache entries */
  clearCache(): void {
    this.cache.clear();
  }

  /** Reset all tracking (useful for tests) */
  reset(): void {
    this.events.length = 0;
    this.cache.clear();
    this.dailyResetDate = this.todayKey();
  }

  private resetDailyIfNeeded(): void {
    const today = this.todayKey();
    if (this.dailyResetDate !== today) {
      this.dailyResetDate = today;
      log.info('Daily cost counters reset');
    }
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
