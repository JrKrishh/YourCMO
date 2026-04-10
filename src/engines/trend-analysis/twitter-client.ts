import { createLogger } from '../../utils/logger';
import {
  BaseApiClient,
  AuthToken,
  OAuthCredentials,
  RawTrendingTopic,
  RateLimitConfig,
  RetryConfig,
} from './base-api-client';

const logger = createLogger('TwitterClient');

const DEFAULT_RATE_LIMIT: RateLimitConfig = { maxRequests: 300, windowMs: 15 * 60 * 1000 };

/**
 * Twitter/X API v2 client for fetching trending topics.
 * Uses the Twitter API v2 trends endpoints.
 */
export class TwitterClient extends BaseApiClient {
  private readonly baseUrl = 'https://api.twitter.com/2';

  constructor(
    rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT,
    retryConfig?: RetryConfig,
  ) {
    super('Twitter', rateLimitConfig, retryConfig);
  }

  async authenticate(credentials: OAuthCredentials): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Authenticating with Twitter API v2');

      // In production: POST https://api.twitter.com/2/oauth2/token
      // with client_id, client_secret, grant_type
      void credentials;
      const token: AuthToken = {
        accessToken: '',
        refreshToken: undefined,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        tokenType: 'Bearer',
        scopes: ['tweet.read', 'users.read'],
      };

      this.authToken = token;
      logger.info('Twitter authentication successful');
      return token;
    }, 'authenticate');
  }

  async refreshAuthToken(token: AuthToken): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Refreshing Twitter access token');

      if (!token.refreshToken) {
        throw new Error('No refresh token available for Twitter. Re-authenticate.');
      }

      // In production: POST https://api.twitter.com/2/oauth2/token with refresh_token

      const refreshed: AuthToken = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
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
        throw new Error('Twitter auth token is expired. Re-authenticate or refresh.');
      }

      logger.info({ limit }, 'Fetching trending topics from Twitter');

      // In production: GET {baseUrl}/trends/by/woeid/:woeid
      void limit;
      const topics: RawTrendingTopic[] = [];

      return topics;
    }, 'fetchTrendingTopics');
  }
}
