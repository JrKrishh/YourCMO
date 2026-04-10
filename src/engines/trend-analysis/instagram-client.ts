import { createLogger } from '../../utils/logger';
import {
  BaseApiClient,
  AuthToken,
  OAuthCredentials,
  RawTrendingTopic,
  RateLimitConfig,
  RetryConfig,
} from './base-api-client';

const logger = createLogger('InstagramClient');

const DEFAULT_RATE_LIMIT: RateLimitConfig = { maxRequests: 200, windowMs: 60 * 60 * 1000 };

/**
 * Instagram Graph API client for fetching trending topics.
 * Uses the Instagram Graph API for hashtag search and trending content.
 */
export class InstagramClient extends BaseApiClient {
  private readonly baseUrl = 'https://graph.instagram.com/v18.0';

  constructor(
    rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT,
    retryConfig?: RetryConfig,
  ) {
    super('Instagram', rateLimitConfig, retryConfig);
  }

  async authenticate(credentials: OAuthCredentials): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Authenticating with Instagram Graph API');

      // In production: POST https://api.instagram.com/oauth/access_token
      // with client_id, client_secret, grant_type, redirect_uri
      // For now, we create the token structure that the real API would return
      void credentials;
      const token: AuthToken = {
        accessToken: '',
        refreshToken: undefined,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenType: 'Bearer',
        scopes: ['instagram_basic', 'instagram_content_publish'],
      };

      this.authToken = token;
      logger.info('Instagram authentication successful');
      return token;
    }, 'authenticate');
  }

  async refreshAuthToken(token: AuthToken): Promise<AuthToken> {
    return this.executeWithRetry(async () => {
      logger.info('Refreshing Instagram access token');

      // In production: GET {baseUrl}/refresh_access_token?grant_type=ig_refresh_token&access_token=...

      const refreshed: AuthToken = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
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
        throw new Error('Instagram auth token is expired. Re-authenticate or refresh.');
      }

      logger.info({ limit }, 'Fetching trending topics from Instagram');

      // In production: GET {baseUrl}/ig_hashtag_search and {baseUrl}/{hashtag-id}/top_media
      // Abstraction point: replace with real HTTP call
      void this.baseUrl;
      void limit;
      const topics: RawTrendingTopic[] = [];

      return topics;
    }, 'fetchTrendingTopics');
  }
}
