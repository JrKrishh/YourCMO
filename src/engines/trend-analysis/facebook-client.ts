import { createLogger } from '../../utils/logger';
import {
  BaseApiClient,
  AuthToken,
  OAuthCredentials,
  RawTrendingTopic,
  RateLimitConfig,
  RetryConfig,
} from './base-api-client';

const logger = createLogger('FacebookClient');

const DEFAULT_RATE_LIMIT: RateLimitConfig = { maxRequests: 200, windowMs: 60 * 60 * 1000 };

/**
 * Facebook Graph API client for fetching trending topics.
 * Uses the Facebook Graph API for trending content and page insights.
 */
export class FacebookClient extends BaseApiClient {
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  constructor(
    rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT,
    retryConfig?: RetryConfig,
  ) {
    super('Facebook', rateLimitConfig, retryConfig);
  }

  async authenticate(credentials: OAuthCredentials): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Authenticating with Facebook Graph API');

      // In production: POST {baseUrl}/oauth/access_token
      // with client_id, client_secret, grant_type
      void credentials;
      const token: AuthToken = {
        accessToken: '',
        refreshToken: undefined,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenType: 'Bearer',
        scopes: ['pages_read_engagement', 'pages_manage_posts'],
      };

      this.authToken = token;
      logger.info('Facebook authentication successful');
      return token;
    }, 'authenticate');
  }

  async refreshAuthToken(token: AuthToken): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Refreshing Facebook access token');

      // In production: GET {baseUrl}/oauth/access_token?grant_type=fb_exchange_token&fb_exchange_token=...

      const refreshed: AuthToken = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 1000),
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
        throw new Error('Facebook auth token is expired. Re-authenticate or refresh.');
      }

      logger.info({ limit }, 'Fetching trending topics from Facebook');

      // In production: GET {baseUrl}/trending or page insights endpoint
      void this.baseUrl;
      void limit;
      const topics: RawTrendingTopic[] = [];

      return topics;
    }, 'fetchTrendingTopics');
  }
}
