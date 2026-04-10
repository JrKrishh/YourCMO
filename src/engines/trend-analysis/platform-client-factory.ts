import { Platform } from '../../models/enums';
import { EnvConfig } from '../../utils/env';
import { BaseApiClient, OAuthCredentials } from './base-api-client';
import { InstagramClient } from './instagram-client';
import { FacebookClient } from './facebook-client';
import { TwitterClient } from './twitter-client';
import { TikTokClient } from './tiktok-client';

/**
 * Creates a platform API client for the given platform.
 */
export function createPlatformClient(platform: Platform): BaseApiClient {
  switch (platform) {
    case Platform.INSTAGRAM:
      return new InstagramClient();
    case Platform.FACEBOOK:
      return new FacebookClient();
    case Platform.TWITTER:
      return new TwitterClient();
    case Platform.TIKTOK:
      return new TikTokClient();
    default:
      throw new Error(`Unsupported platform for trend analysis: ${platform}`);
  }
}

/**
 * Extracts OAuth credentials for a platform from the environment config.
 */
export function getCredentialsForPlatform(
  platform: Platform,
  envConfig: EnvConfig,
): OAuthCredentials {
  switch (platform) {
    case Platform.INSTAGRAM:
      return {
        clientId: envConfig.instagramClientId ?? '',
        clientSecret: envConfig.instagramClientSecret ?? '',
      };
    case Platform.FACEBOOK:
      return {
        clientId: envConfig.facebookAppId ?? '',
        clientSecret: envConfig.facebookAppSecret ?? '',
      };
    case Platform.TWITTER:
      return {
        clientId: envConfig.twitterApiKey ?? '',
        clientSecret: envConfig.twitterApiSecret ?? '',
      };
    case Platform.TIKTOK:
      return {
        clientId: envConfig.tiktokClientKey ?? '',
        clientSecret: envConfig.tiktokClientSecret ?? '',
      };
    default:
      throw new Error(`No credentials mapping for platform: ${platform}`);
  }
}
