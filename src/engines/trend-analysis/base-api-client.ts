import { createLogger } from '../../utils/logger';

const logger = createLogger('BaseApiClient');

/** Rate limit configuration per platform */
export interface RateLimitConfig {
  /** Maximum requests allowed in the time window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/** Retry configuration */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
}

/** Authentication token returned by OAuth flows */
export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
  scopes?: string[];
}

/** OAuth credentials for platform authentication */
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

/** Raw trending topic data from a platform API */
export interface RawTrendingTopic {
  name: string;
  volume?: number;
  url?: string;
  hashtags?: string[];
  category?: string;
}

/** API response wrapper */
export interface ApiResponse<T> {
  data: T;
  status: number;
  headers?: Record<string, string>;
}

/** Rate limiter state tracker */
interface RateLimiterState {
  requestTimestamps: number[];
}

/**
 * Base API client with rate limiting and exponential backoff retry logic.
 * Platform-specific clients extend this class.
 */
export abstract class BaseApiClient {
  protected readonly platformName: string;
  protected readonly rateLimitConfig: RateLimitConfig;
  protected readonly retryConfig: RetryConfig;
  private rateLimiterState: RateLimiterState;
  protected authToken: AuthToken | null = null;

  constructor(
    platformName: string,
    rateLimitConfig: RateLimitConfig,
    retryConfig: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
  ) {
    this.platformName = platformName;
    this.rateLimitConfig = rateLimitConfig;
    this.retryConfig = retryConfig;
    this.rateLimiterState = { requestTimestamps: [] };
  }

  /**
   * Authenticate with the platform using OAuth credentials.
   * Must be implemented by each platform client.
   */
  abstract authenticate(credentials: OAuthCredentials): Promise<AuthToken>;

  /**
   * Refresh an expired auth token.
   * Must be implemented by each platform client.
   */
  abstract refreshAuthToken(token: AuthToken): Promise<AuthToken>;

  /**
   * Fetch trending topics from the platform.
   * Must be implemented by each platform client.
   */
  abstract fetchTrendingTopics(limit?: number): Promise<RawTrendingTopic[]>;

  /** Returns the current auth token, or null if not authenticated */
  getAuthToken(): AuthToken | null {
    return this.authToken;
  }

  /** Sets the auth token directly (useful for testing or pre-configured tokens) */
  setAuthToken(token: AuthToken): void {
    this.authToken = token;
  }

  /** Check if the current token is expired */
  isTokenExpired(): boolean {
    if (!this.authToken) return true;
    return new Date() >= this.authToken.expiresAt;
  }

  /**
   * Execute a request with rate limiting and retry logic.
   * Wraps any async operation with rate limit checks and exponential backoff.
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    await this.waitForRateLimit();

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        this.recordRequest();
        const result = await operation();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          logger.warn(
            { platform: this.platformName, operation: operationName, attempt: attempt + 1, delay },
            `Request failed, retrying in ${delay}ms`,
          );
          await this.sleep(delay);
        }
      }
    }

    logger.error(
      { platform: this.platformName, operation: operationName },
      `All ${this.retryConfig.maxRetries + 1} attempts failed`,
    );
    throw lastError ?? new Error(`${operationName} failed after all retries`);
  }

  /**
   * Wait if we've hit the rate limit for this window.
   */
  private async waitForRateLimit(): Promise<void> {
    this.pruneOldTimestamps();

    if (this.rateLimiterState.requestTimestamps.length >= this.rateLimitConfig.maxRequests) {
      const oldestTimestamp = this.rateLimiterState.requestTimestamps[0];
      const waitTime = oldestTimestamp + this.rateLimitConfig.windowMs - Date.now();

      if (waitTime > 0) {
        logger.info(
          { platform: this.platformName, waitTime },
          'Rate limit reached, waiting',
        );
        await this.sleep(waitTime);
        this.pruneOldTimestamps();
      }
    }
  }

  /** Record a request timestamp for rate limiting */
  private recordRequest(): void {
    this.rateLimiterState.requestTimestamps.push(Date.now());
  }

  /** Remove timestamps outside the current rate limit window */
  private pruneOldTimestamps(): void {
    const cutoff = Date.now() - this.rateLimitConfig.windowMs;
    this.rateLimiterState.requestTimestamps =
      this.rateLimiterState.requestTimestamps.filter((ts) => ts > cutoff);
  }

  /** Calculate exponential backoff delay with jitter */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.retryConfig.baseDelayMs;
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
  }

  /** Promise-based sleep utility */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
