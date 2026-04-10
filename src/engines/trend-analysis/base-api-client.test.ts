import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BaseApiClient,
  AuthToken,
  OAuthCredentials,
  RawTrendingTopic,
  RateLimitConfig,
} from './base-api-client';

/** Concrete test implementation of the abstract BaseApiClient */
class TestApiClient extends BaseApiClient {
  public authenticateFn = vi.fn<(creds: OAuthCredentials) => Promise<AuthToken>>();
  public refreshFn = vi.fn<(token: AuthToken) => Promise<AuthToken>>();
  public fetchFn = vi.fn<(limit?: number) => Promise<RawTrendingTopic[]>>();

  constructor(rateLimit?: RateLimitConfig) {
    super(
      'TestPlatform',
      rateLimit ?? { maxRequests: 5, windowMs: 1000 },
      { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 },
    );
  }

  async authenticate(credentials: OAuthCredentials): Promise<AuthToken> {
    return this.authenticateFn(credentials);
  }

  async refreshAuthToken(token: AuthToken): Promise<AuthToken> {
    return this.refreshFn(token);
  }

  async fetchTrendingTopics(limit?: number): Promise<RawTrendingTopic[]> {
    return this.fetchFn(limit);
  }

  /** Expose executeWithRetry for testing */
  async testExecuteWithRetry<T>(op: () => Promise<T>, name: string): Promise<T> {
    return this.executeWithRetry(op, name);
  }
}

describe('BaseApiClient', () => {
  let client: TestApiClient;

  beforeEach(() => {
    client = new TestApiClient();
  });

  describe('auth token management', () => {
    it('starts with no auth token', () => {
      expect(client.getAuthToken()).toBeNull();
      expect(client.isTokenExpired()).toBe(true);
    });

    it('stores and retrieves auth token', () => {
      const token: AuthToken = {
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 60000),
        tokenType: 'Bearer',
      };
      client.setAuthToken(token);
      expect(client.getAuthToken()).toBe(token);
      expect(client.isTokenExpired()).toBe(false);
    });

    it('detects expired token', () => {
      const token: AuthToken = {
        accessToken: 'expired',
        expiresAt: new Date(Date.now() - 1000),
        tokenType: 'Bearer',
      };
      client.setAuthToken(token);
      expect(client.isTokenExpired()).toBe(true);
    });
  });

  describe('retry logic', () => {
    it('returns result on first success', async () => {
      const op = vi.fn().mockResolvedValue('ok');
      const result = await client.testExecuteWithRetry(op, 'test-op');
      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds', async () => {
      const op = vi.fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockResolvedValue('recovered');

      const result = await client.testExecuteWithRetry(op, 'test-op');
      expect(result).toBe('recovered');
      expect(op).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retries', async () => {
      const op = vi.fn().mockRejectedValue(new Error('persistent failure'));

      await expect(client.testExecuteWithRetry(op, 'test-op'))
        .rejects.toThrow('persistent failure');
      // 1 initial + 2 retries = 3 total
      expect(op).toHaveBeenCalledTimes(3);
    });
  });

  describe('rate limiting', () => {
    it('allows requests within the rate limit', async () => {
      const op = vi.fn().mockResolvedValue('ok');

      // 5 requests within the window should all succeed immediately
      for (let i = 0; i < 5; i++) {
        await client.testExecuteWithRetry(op, 'test-op');
      }
      expect(op).toHaveBeenCalledTimes(5);
    });
  });
});
