export {
  BaseApiClient,
  type RateLimitConfig,
  type RetryConfig,
  type AuthToken,
  type OAuthCredentials,
  type RawTrendingTopic,
  type ApiResponse,
} from './base-api-client';
export { InstagramClient } from './instagram-client';
export { FacebookClient } from './facebook-client';
export { TwitterClient } from './twitter-client';
export { TikTokClient } from './tiktok-client';
export { createPlatformClient, getCredentialsForPlatform } from './platform-client-factory';
export {
  TrendAnalysisEngine,
  parseTrend,
  calculateEngagementScore,
  calculateVelocity,
  calculateRelevance,
  predictTrendLifecycle,
  analyzeTrend,
} from './trend-analysis-engine';
