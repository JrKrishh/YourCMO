import { createLogger } from '../../utils/logger';
import { Platform } from '../../models/enums';

const logger = createLogger('OAuthManager');

/** OAuth 2.0 credentials for platform authentication */
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

/** Token returned by OAuth flows */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
  scopes?: string[];
  platform: Platform;
}

/** Token storage entry with metadata */
interface StoredToken {
  token: OAuthToken;
  credentials: OAuthCredentials;
  createdAt: Date;
}

/** Platform-specific OAuth endpoint configuration */
interface OAuthEndpoints {
  authorizationUrl: string;
  tokenUrl: string;
  refreshUrl: string;
  scopes: string[];
}

const PLATFORM_ENDPOINTS: Record<string, OAuthEndpoints> = {
  [Platform.INSTAGRAM]: {
    authorizationUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    refreshUrl: 'https://graph.instagram.com/refresh_access_token',
    scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments'],
  },
  [Platform.FACEBOOK]: {
    authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    refreshUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
  },
  [Platform.WHATSAPP]: {
    authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    refreshUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
  },
};

/** Buffer time before expiration to trigger refresh (5 minutes) */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Manages OAuth 2.0 authentication flows, token storage, and automatic refresh
 * for all supported social media platforms.
 */
export class OAuthManager {
  private tokenStore: Map<Platform, StoredToken> = new Map();

  /**
   * Authenticate with a platform using OAuth 2.0 flow.
   * In production, this would redirect the user and handle the callback.
   * Here we simulate the token exchange step.
   */
  async authenticate(platform: Platform, credentials: OAuthCredentials): Promise<OAuthToken> {
    const endpoints = PLATFORM_ENDPOINTS[platform];
    if (!endpoints) {
      throw new Error(`Unsupported platform for OAuth: ${platform}`);
    }

    logger.info({ platform }, 'Starting OAuth authentication');

    // Simulate OAuth token exchange (in production: POST to tokenUrl with auth code)
    const token: OAuthToken = {
      accessToken: `${platform.toLowerCase()}_access_${Date.now()}`,
      refreshToken: `${platform.toLowerCase()}_refresh_${Date.now()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      tokenType: 'Bearer',
      scopes: endpoints.scopes,
      platform,
    };

    this.storeToken(platform, token, credentials);
    logger.info({ platform }, 'OAuth authentication successful');
    return token;
  }

  /**
   * Refresh an expired or near-expired token.
   * Uses the stored refresh token to obtain a new access token.
   */
  async refreshToken(platform: Platform): Promise<OAuthToken> {
    const stored = this.tokenStore.get(platform);
    if (!stored) {
      throw new Error(`No token stored for platform: ${platform}`);
    }

    if (!stored.token.refreshToken) {
      throw new Error(`No refresh token available for platform: ${platform}`);
    }

    logger.info({ platform }, 'Refreshing OAuth token');

    // Simulate token refresh (in production: POST to refreshUrl with refresh_token)
    const refreshed: OAuthToken = {
      accessToken: `${platform.toLowerCase()}_access_${Date.now()}`,
      refreshToken: stored.token.refreshToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenType: 'Bearer',
      scopes: stored.token.scopes,
      platform,
    };

    this.storeToken(platform, refreshed, stored.credentials);
    logger.info({ platform }, 'Token refresh successful');
    return refreshed;
  }

  /**
   * Get a valid token for a platform, automatically refreshing if expired or near-expired.
   */
  async getValidToken(platform: Platform): Promise<OAuthToken> {
    const stored = this.tokenStore.get(platform);
    if (!stored) {
      throw new Error(`Not authenticated with platform: ${platform}`);
    }

    if (this.isTokenExpired(stored.token) || this.isTokenNearExpiry(stored.token)) {
      return this.refreshToken(platform);
    }

    return stored.token;
  }

  /** Check if a token is expired */
  isTokenExpired(token: OAuthToken): boolean {
    return new Date() >= token.expiresAt;
  }

  /** Check if a token is near expiry (within buffer window) */
  isTokenNearExpiry(token: OAuthToken): boolean {
    return new Date().getTime() + TOKEN_REFRESH_BUFFER_MS >= token.expiresAt.getTime();
  }

  /** Check if a platform is authenticated */
  isAuthenticated(platform: Platform): boolean {
    const stored = this.tokenStore.get(platform);
    return stored !== undefined && !this.isTokenExpired(stored.token);
  }

  /** Remove stored token for a platform */
  revokeToken(platform: Platform): void {
    this.tokenStore.delete(platform);
    logger.info({ platform }, 'Token revoked');
  }

  /** Get OAuth endpoints for a platform */
  getEndpoints(platform: Platform): OAuthEndpoints | undefined {
    return PLATFORM_ENDPOINTS[platform];
  }

  private storeToken(platform: Platform, token: OAuthToken, credentials: OAuthCredentials): void {
    this.tokenStore.set(platform, {
      token,
      credentials,
      createdAt: new Date(),
    });
  }
}
