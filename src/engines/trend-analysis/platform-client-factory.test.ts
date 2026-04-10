import { describe, it, expect } from 'vitest';
import { Platform } from '../../models/enums';
import { EnvConfig } from '../../utils/env';
import { createPlatformClient, getCredentialsForPlatform } from './platform-client-factory';
import { InstagramClient } from './instagram-client';
import { FacebookClient } from './facebook-client';
import { TwitterClient } from './twitter-client';
import { TikTokClient } from './tiktok-client';

describe('createPlatformClient', () => {
  it('creates InstagramClient for INSTAGRAM', () => {
    expect(createPlatformClient(Platform.INSTAGRAM)).toBeInstanceOf(InstagramClient);
  });

  it('creates FacebookClient for FACEBOOK', () => {
    expect(createPlatformClient(Platform.FACEBOOK)).toBeInstanceOf(FacebookClient);
  });

  it('creates TwitterClient for TWITTER', () => {
    expect(createPlatformClient(Platform.TWITTER)).toBeInstanceOf(TwitterClient);
  });

  it('creates TikTokClient for TIKTOK', () => {
    expect(createPlatformClient(Platform.TIKTOK)).toBeInstanceOf(TikTokClient);
  });

  it('throws for unsupported platform', () => {
    expect(() => createPlatformClient(Platform.WHATSAPP)).toThrow('Unsupported platform');
  });
});

describe('getCredentialsForPlatform', () => {
  const envConfig: EnvConfig = {
    agentFrameworkType: 'OpenClaw',
    llmProvider: 'OpenAI',
    instagramClientId: 'ig-id',
    instagramClientSecret: 'ig-secret',
    facebookAppId: 'fb-id',
    facebookAppSecret: 'fb-secret',
    twitterApiKey: 'tw-key',
    twitterApiSecret: 'tw-secret',
    tiktokClientKey: 'tt-key',
    tiktokClientSecret: 'tt-secret',
    logLevel: 'info',
    defaultDailyBudgetLimit: 100,
    defaultTotalBudgetLimit: 1000,
  };

  it('returns Instagram credentials', () => {
    const creds = getCredentialsForPlatform(Platform.INSTAGRAM, envConfig);
    expect(creds.clientId).toBe('ig-id');
    expect(creds.clientSecret).toBe('ig-secret');
  });

  it('returns Facebook credentials', () => {
    const creds = getCredentialsForPlatform(Platform.FACEBOOK, envConfig);
    expect(creds.clientId).toBe('fb-id');
    expect(creds.clientSecret).toBe('fb-secret');
  });

  it('returns Twitter credentials', () => {
    const creds = getCredentialsForPlatform(Platform.TWITTER, envConfig);
    expect(creds.clientId).toBe('tw-key');
    expect(creds.clientSecret).toBe('tw-secret');
  });

  it('returns TikTok credentials', () => {
    const creds = getCredentialsForPlatform(Platform.TIKTOK, envConfig);
    expect(creds.clientId).toBe('tt-key');
    expect(creds.clientSecret).toBe('tt-secret');
  });

  it('throws for unsupported platform', () => {
    expect(() => getCredentialsForPlatform(Platform.WHATSAPP, envConfig)).toThrow('No credentials mapping');
  });
});
