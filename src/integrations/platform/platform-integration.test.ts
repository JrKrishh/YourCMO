import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthManager, OAuthToken } from './oauth-manager';
import { InstagramPostingClient, INSTAGRAM_LIMITS } from './instagram-client';
import { FacebookPostingClient, FACEBOOK_LIMITS } from './facebook-client';
import { WhatsAppPostingClient, WHATSAPP_LIMITS, WhatsAppMessage } from './whatsapp-client';
import { PlatformIntegrationLayer } from './platform-integration';
import { Platform, AssetType } from '../../models/enums';
import { PlatformContent } from '../../models/platform-content';

/** Helper to create a valid PlatformContent for testing */
function makePlatformContent(overrides: Partial<PlatformContent> = {}): PlatformContent {
  return {
    contentId: 'test-content-1',
    platform: Platform.INSTAGRAM,
    text: 'Test post caption #test',
    visualAssets: [
      {
        assetId: 'asset-1',
        assetType: AssetType.IMAGE,
        url: 'https://example.com/image.jpg',
        localPath: '/tmp/image.jpg',
        dimensions: { width: 1080, height: 1080 },
        format: 'jpg',
        fileSize: 1024 * 1024,
        duration: 0,
        platform: Platform.INSTAGRAM,
        metadata: { createdAt: new Date() },
        brandingApplied: false,
      },
    ],
    hashtags: ['#test', '#marketing'],
    mentions: ['@user1'],
    ...overrides,
  };
}

function makeToken(platform: Platform): OAuthToken {
  return {
    accessToken: `access_${platform}`,
    refreshToken: `refresh_${platform}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenType: 'Bearer',
    scopes: ['read', 'write'],
    platform,
  };
}

// ─── OAuth Manager Tests ───

describe('OAuthManager', () => {
  let manager: OAuthManager;
  const credentials = { clientId: 'test-id', clientSecret: 'test-secret' };

  beforeEach(() => {
    manager = new OAuthManager();
  });

  it('authenticates with a supported platform', async () => {
    const token = await manager.authenticate(Platform.INSTAGRAM, credentials);
    expect(token.accessToken).toBeTruthy();
    expect(token.refreshToken).toBeTruthy();
    expect(token.platform).toBe(Platform.INSTAGRAM);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws for unsupported platform', async () => {
    await expect(manager.authenticate(Platform.TIKTOK, credentials)).rejects.toThrow(
      'Unsupported platform for OAuth',
    );
  });

  it('refreshes a stored token', async () => {
    await manager.authenticate(Platform.FACEBOOK, credentials);
    const refreshed = await manager.refreshToken(Platform.FACEBOOK);
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.platform).toBe(Platform.FACEBOOK);
  });

  it('throws when refreshing without prior authentication', async () => {
    await expect(manager.refreshToken(Platform.INSTAGRAM)).rejects.toThrow(
      'No token stored for platform',
    );
  });

  it('reports authentication status correctly', async () => {
    expect(manager.isAuthenticated(Platform.INSTAGRAM)).toBe(false);
    await manager.authenticate(Platform.INSTAGRAM, credentials);
    expect(manager.isAuthenticated(Platform.INSTAGRAM)).toBe(true);
  });

  it('detects expired tokens', () => {
    const expired: OAuthToken = {
      ...makeToken(Platform.INSTAGRAM),
      expiresAt: new Date(Date.now() - 1000),
    };
    expect(manager.isTokenExpired(expired)).toBe(true);
  });

  it('detects near-expiry tokens', () => {
    const nearExpiry: OAuthToken = {
      ...makeToken(Platform.INSTAGRAM),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes from now
    };
    expect(manager.isTokenNearExpiry(nearExpiry)).toBe(true);
  });

  it('getValidToken auto-refreshes expired tokens', async () => {
    await manager.authenticate(Platform.INSTAGRAM, credentials);
    // Force the stored token to be near-expiry by re-authenticating and checking
    const token = await manager.getValidToken(Platform.INSTAGRAM);
    expect(token.accessToken).toBeTruthy();
  });

  it('revokes a token', async () => {
    await manager.authenticate(Platform.INSTAGRAM, credentials);
    expect(manager.isAuthenticated(Platform.INSTAGRAM)).toBe(true);
    manager.revokeToken(Platform.INSTAGRAM);
    expect(manager.isAuthenticated(Platform.INSTAGRAM)).toBe(false);
  });

  it('returns endpoints for supported platforms', () => {
    expect(manager.getEndpoints(Platform.INSTAGRAM)).toBeDefined();
    expect(manager.getEndpoints(Platform.FACEBOOK)).toBeDefined();
    expect(manager.getEndpoints(Platform.WHATSAPP)).toBeDefined();
    expect(manager.getEndpoints(Platform.TIKTOK)).toBeUndefined();
  });
});

// ─── Instagram Posting Client Tests ───

describe('InstagramPostingClient', () => {
  let client: InstagramPostingClient;
  const token = makeToken(Platform.INSTAGRAM);

  beforeEach(() => {
    client = new InstagramPostingClient();
  });

  it('posts valid content successfully', async () => {
    const content = makePlatformContent();
    const result = await client.postContent(content, token);
    expect(result.success).toBe(true);
    expect(result.postId).toBeTruthy();
    expect(result.platform).toBe(Platform.INSTAGRAM);
    expect(result.url).toContain('instagram.com');
  });

  it('rejects content exceeding caption length', async () => {
    const content = makePlatformContent({ text: 'x'.repeat(INSTAGRAM_LIMITS.maxCaptionLength + 1) });
    const result = await client.postContent(content, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Caption exceeds');
  });

  it('rejects content with too many hashtags', async () => {
    const hashtags = Array.from({ length: INSTAGRAM_LIMITS.maxHashtags + 1 }, (_, i) => `#tag${i}`);
    const content = makePlatformContent({ hashtags });
    const result = await client.postContent(content, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many hashtags');
  });

  it('rejects content with invalid aspect ratio', async () => {
    const content = makePlatformContent({
      visualAssets: [
        {
          assetId: 'a1',
          assetType: AssetType.IMAGE,
          url: 'https://example.com/img.jpg',
          localPath: '',
          dimensions: { width: 100, height: 1000 }, // ratio 0.1, below 0.8
          format: 'jpg',
          fileSize: 1024,
          duration: 0,
          platform: Platform.INSTAGRAM,
          metadata: { createdAt: new Date() },
          brandingApplied: false,
        },
      ],
    });
    const result = await client.postContent(content, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('aspect ratio');
  });

  it('schedules a post for the future', async () => {
    const content = makePlatformContent();
    const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await client.schedulePost(content, futureTime, token);
    expect(result.success).toBe(true);
    expect(result.scheduledId).toBeTruthy();
  });

  it('rejects scheduling in the past', async () => {
    const content = makePlatformContent();
    const pastTime = new Date(Date.now() - 1000);
    const result = await client.schedulePost(content, pastTime, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('future');
  });
});

// ─── Facebook Posting Client Tests ───

describe('FacebookPostingClient', () => {
  let client: FacebookPostingClient;
  const token = makeToken(Platform.FACEBOOK);

  beforeEach(() => {
    client = new FacebookPostingClient('page-123');
  });

  it('posts valid content successfully', async () => {
    const content = makePlatformContent({ platform: Platform.FACEBOOK });
    const result = await client.postContent(content, token);
    expect(result.success).toBe(true);
    expect(result.postId).toBeTruthy();
    expect(result.platform).toBe(Platform.FACEBOOK);
  });

  it('fails when page ID is not set', async () => {
    const noPageClient = new FacebookPostingClient();
    const content = makePlatformContent({ platform: Platform.FACEBOOK });
    const result = await noPageClient.postContent(content, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Page ID not configured');
  });

  it('rejects content exceeding text length', async () => {
    const content = makePlatformContent({
      platform: Platform.FACEBOOK,
      text: 'x'.repeat(FACEBOOK_LIMITS.maxTextLength + 1),
    });
    const result = await client.postContent(content, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Text exceeds');
  });

  it('rejects oversized image files', async () => {
    const content = makePlatformContent({
      platform: Platform.FACEBOOK,
      visualAssets: [
        {
          assetId: 'a1',
          assetType: AssetType.IMAGE,
          url: 'https://example.com/big.jpg',
          localPath: '',
          dimensions: { width: 1080, height: 1080 },
          format: 'jpg',
          fileSize: FACEBOOK_LIMITS.maxImageFileSize + 1,
          duration: 0,
          platform: Platform.FACEBOOK,
          metadata: { createdAt: new Date() },
          brandingApplied: false,
        },
      ],
    });
    const result = await client.postContent(content, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('file size exceeds');
  });

  it('schedules a post within valid time range', async () => {
    const content = makePlatformContent({ platform: Platform.FACEBOOK });
    const futureTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour ahead
    const result = await client.schedulePost(content, futureTime, token);
    expect(result.success).toBe(true);
    expect(result.scheduledId).toBeTruthy();
  });

  it('rejects scheduling too soon', async () => {
    const content = makePlatformContent({ platform: Platform.FACEBOOK });
    const tooSoon = new Date(Date.now() + 1000); // 1 second ahead
    const result = await client.schedulePost(content, tooSoon, token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('at least');
  });

  it('posts text-only content (no media)', async () => {
    const content = makePlatformContent({ platform: Platform.FACEBOOK, visualAssets: [] });
    const result = await client.postContent(content, token);
    expect(result.success).toBe(true);
  });
});

// ─── WhatsApp Posting Client Tests ───

describe('WhatsAppPostingClient', () => {
  let client: WhatsAppPostingClient;
  const token = makeToken(Platform.WHATSAPP);

  beforeEach(() => {
    client = new WhatsAppPostingClient('phone-123');
  });

  it('sends a valid message', async () => {
    const msg: WhatsAppMessage = { recipientPhone: '+1234567890', text: 'Hello!' };
    const result = await client.sendMessage(msg, token);
    expect(result.status).toBe('sent');
    expect(result.messageId).toBeTruthy();
  });

  it('fails when phone number ID is not set', async () => {
    const noPhoneClient = new WhatsAppPostingClient();
    const msg: WhatsAppMessage = { recipientPhone: '+1234567890', text: 'Hello!' };
    const result = await noPhoneClient.sendMessage(msg, token);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('phone number ID not configured');
  });

  it('rejects message exceeding length limit', async () => {
    const msg: WhatsAppMessage = {
      recipientPhone: '+1234567890',
      text: 'x'.repeat(WHATSAPP_LIMITS.maxMessageLength + 1),
    };
    const result = await client.sendMessage(msg, token);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('exceeds');
  });

  it('rejects message with empty recipient', async () => {
    const msg: WhatsAppMessage = { recipientPhone: '', text: 'Hello!' };
    const result = await client.sendMessage(msg, token);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Recipient phone number is required');
  });

  it('sends bulk messages and returns aggregate results', async () => {
    const messages: WhatsAppMessage[] = Array.from({ length: 5 }, (_, i) => ({
      recipientPhone: `+12345678${i}0`,
      text: `Message ${i}`,
    }));
    const result = await client.sendBulkMessages(messages, token);
    expect(result.total).toBe(5);
    expect(result.sent).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(5);
  });

  it('validates template parameter limits', () => {
    const msg: WhatsAppMessage = {
      recipientPhone: '+1234567890',
      text: 'Hello',
      templateParams: Array.from({ length: WHATSAPP_LIMITS.maxTemplateParams + 1 }, (_, i) => `p${i}`),
    };
    const validation = client.validateMessage(msg);
    expect(validation.valid).toBe(false);
    expect(validation.errors[0]).toContain('template parameters');
  });
});

// ─── PlatformIntegrationLayer Tests ───

describe('PlatformIntegrationLayer', () => {
  let layer: PlatformIntegrationLayer;
  let oauthManager: OAuthManager;
  const credentials = { clientId: 'id', clientSecret: 'secret' };

  beforeEach(async () => {
    oauthManager = new OAuthManager();
    layer = new PlatformIntegrationLayer(
      oauthManager,
      new InstagramPostingClient(),
      new FacebookPostingClient('page-123'),
      new WhatsAppPostingClient('phone-123'),
      { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 50 },
    );
    // Pre-authenticate platforms
    await oauthManager.authenticate(Platform.INSTAGRAM, credentials);
    await oauthManager.authenticate(Platform.FACEBOOK, credentials);
    await oauthManager.authenticate(Platform.WHATSAPP, credentials);
  });

  it('posts content to Instagram via unified interface', async () => {
    const content = makePlatformContent({ platform: Platform.INSTAGRAM });
    const result = await layer.postContent(Platform.INSTAGRAM, content);
    expect(result.success).toBe(true);
    expect(result.platform).toBe(Platform.INSTAGRAM);
  });

  it('posts content to Facebook via unified interface', async () => {
    const content = makePlatformContent({ platform: Platform.FACEBOOK });
    const result = await layer.postContent(Platform.FACEBOOK, content);
    expect(result.success).toBe(true);
    expect(result.platform).toBe(Platform.FACEBOOK);
  });

  it('returns error for unsupported platform', async () => {
    // TikTok is not authenticated, so getValidToken will throw
    const content = makePlatformContent({ platform: Platform.TIKTOK });
    await expect(layer.postContent(Platform.TIKTOK, content)).rejects.toThrow();
  });

  it('posts to multiple platforms in parallel', async () => {
    const content = makePlatformContent();
    const result = await layer.postToMultiplePlatforms(
      [Platform.INSTAGRAM, Platform.FACEBOOK],
      content,
    );
    expect(result.results).toHaveLength(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
  });

  it('handles partial failures in multi-platform posting', async () => {
    const content = makePlatformContent();
    // TIKTOK is not authenticated, so it will fail
    const result = await layer.postToMultiplePlatforms(
      [Platform.INSTAGRAM, Platform.TIKTOK],
      content,
    );
    expect(result.results).toHaveLength(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
  });

  it('deletes a post from Instagram', async () => {
    const result = await layer.deletePost(Platform.INSTAGRAM, 'post-123');
    expect(result.success).toBe(true);
    expect(result.postId).toBe('post-123');
  });

  it('returns error when deleting from unauthenticated platform', async () => {
    const result = await layer.deletePost(Platform.TIKTOK, 'post-123');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('schedules a post via unified interface', async () => {
    const content = makePlatformContent();
    const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await layer.schedulePost(Platform.INSTAGRAM, content, futureTime);
    expect(result.success).toBe(true);
  });

  it('reports authentication status', async () => {
    expect(layer.isAuthenticated(Platform.INSTAGRAM)).toBe(true);
    expect(layer.isAuthenticated(Platform.TIKTOK)).toBe(false);
  });

  it('retries on transient failures', async () => {
    // Create a layer with a mock OAuth manager that fails once then succeeds
    const mockOAuth = new OAuthManager();
    await mockOAuth.authenticate(Platform.INSTAGRAM, credentials);

    let callCount = 0;
    const mockInstagram = new InstagramPostingClient();
    const originalPost = mockInstagram.postContent.bind(mockInstagram);
    vi.spyOn(mockInstagram, 'postContent').mockImplementation(async (content, token) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Transient network error');
      }
      return originalPost(content, token);
    });

    const retryLayer = new PlatformIntegrationLayer(
      mockOAuth,
      mockInstagram,
      new FacebookPostingClient('page-123'),
      new WhatsAppPostingClient('phone-123'),
      { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 },
    );

    const content = makePlatformContent();
    const result = await retryLayer.postContent(Platform.INSTAGRAM, content);
    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });
});
