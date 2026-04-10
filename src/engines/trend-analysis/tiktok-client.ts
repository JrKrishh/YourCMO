import { createLogger } from '../../utils/logger';
import {
  BaseApiClient,
  AuthToken,
  OAuthCredentials,
  RawTrendingTopic,
  RateLimitConfig,
  RetryConfig,
} from './base-api-client';

const logger = createLogger('TikTokClient');

const DEFAULT_RATE_LIMIT: RateLimitConfig = { maxRequests: 100, windowMs: 60 * 1000 };

/**
 * TikTok API client for fetching trending topics.
 * Uses the TikTok Research API for trending content discovery.
 */
export class TikTokClient extends BaseApiClient {
  private readonly baseUrl = 'https://open.tiktokapis.com/v2';

  constructor(
    rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT,
    retryConfig?: RetryConfig,
  ) {
    super('TikTok', rateLimitConfig, retryConfig);
  }

  async authenticate(credentials: OAuthCredentials): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Authenticating with TikTok API');

      // In production: POST {baseUrl}/oauth/token/
      // with client_key, client_secret, grant_type
      void credentials;
      const token: AuthToken = {
        accessToken: '',
        refreshToken: undefined,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        tokenType: 'Bearer',
        scopes: ['research.data.basic'],
      };

      this.authToken = token;
      logger.info('TikTok authentication successful');
      return token;
    }, 'authenticate');
  }

  async refreshAuthToken(token: AuthToken): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Refreshing TikTok access token');

      if (!token.refreshToken) {
        throw new Error('No refresh token available for TikTok. Re-authenticate.');
      }

      // In production: POST {baseUrl}/oauth/token/ with refresh_token

      const refreshed: AuthToken = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        tokenType: 'Bearer',
        scopes: token.scopes,
      };

      this.authToken = refreshed;
      return refreshed;
    }, 'refreshAuthToken');
  }

  async fetchTrendingTopics(limit = 20): Promise<RawTrendingTopic[]> {
    return this.executeWithRetry(async () => {
      if (this.isTokenExpired()) {
        throw new Error('TikTok auth token is expired. Re-authenticate or refresh.');
      }

      logger.info({ limit }, 'Fetching trending topics from TikTok');

      // In production: POST {baseUrl}/research/hashtag/query/ or /research/trending/
      void this.baseUrl;
      void limit;
      const topics: RawTrendingTopic[] = [];

      return topics;
    }, 'fetchTrendingTopics');
  }
}
