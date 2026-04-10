import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { VisualAssetCreator } from '../visual-asset-creator';
import { ImageCompositor } from './image-compositor';
import { VideoAdComposer } from './video-ad-composer';
import { UIFrameStore } from './ui-frame-store';
import { IImageGenerationClient } from '../image-generator';
import { IVideoGenerationClient } from '../video-generator';
import { KlingVideoClient } from '../kling-client';
import { Platform, AssetType } from '../../../models/enums';
import { BrandProfile, VisualSpecs } from '../../../models/common';
import { VisualAsset } from '../../../models/visual-asset';

// ── Mock clients ──────────────────────────────────────────────

function makeMockImageClient(): IImageGenerationClient {
  return {
    generate: vi.fn().mockResolvedValue({
      url: 'https://example.com/image.png',
      fileSize: 500_000,
    }),
  };
}

function makeMockVideoClient(): IVideoGenerationClient {
  return {
    generate: vi.fn().mockResolvedValue({
      url: 'https://example.com/video.mp4',
      fileSize: 2_000_000,
    }),
  };
}

function makeMockKlingVideoClient(): KlingVideoClient {
  const client = {
    generateVideo: vi.fn().mockResolvedValue({
      url: 'https://example.com/video.mp4',
      fileSize: 2_000_000,
    }),
  } as unknown as KlingVideoClient;
  return client;
}

// ── Helpers ───────────────────────────────────────────────────

function makeImageSpecs(overrides: Partial<VisualSpecs> = {}): VisualSpecs {
  return {
    type: 'IMAGE',
    dimensions: { width: 1080, height: 1080 },
    format: 'png',
    maxFileSize: 30 * 1024 * 1024,
    ...overrides,
  };
}

function makeVideoSpecs(overrides: Partial<VisualSpecs> = {}): VisualSpecs {
  return {
    type: 'VIDEO',
    dimensions: { width: 1080, height: 1920 },
    format: 'mp4',
    maxFileSize: 650 * 1024 * 1024,
    duration: 10,
    ...overrides,
  };
}

function makeBrandProfile(): BrandProfile {
  return {
    name: 'TestBrand',
    voice: 'professional',
    guidelines: ['Be concise'],
    logoUrl: 'https://example.com/logo.png',
    colorPalette: ['#000', '#fff'],
  };
}

function makeAsset(overrides: Partial<VisualAsset> = {}): VisualAsset {
  return {
    assetId: 'test-id',
    assetType: AssetType.IMAGE,
    url: 'https://example.com/img.png',
    localPath: '',
    dimensions: { width: 1080, height: 1080 },
    format: 'png',
    fileSize: 500_000,
    duration: 0,
    platform: Platform.INSTAGRAM,
    metadata: { tags: ['source:figma-ui', 'frame:test-frame'], createdAt: new Date() },
    brandingApplied: false,
    ...overrides,
  };
}

function makeStandardAsset(overrides: Partial<VisualAsset> = {}): VisualAsset {
  return {
    assetId: 'standard-id',
    assetType: AssetType.IMAGE,
    url: 'https://example.com/standard.png',
    localPath: '',
    dimensions: { width: 1080, height: 1080 },
    format: 'png',
    fileSize: 500_000,
    duration: 0,
    platform: Platform.INSTAGRAM,
    metadata: { tags: [], createdAt: new Date() },
    brandingApplied: false,
    ...overrides,
  };
}

// ── Property Test: Property 15 — Branding consistency ─────────

describe('Property 15: Branding consistency for UI-reference assets', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any VisualAsset generated via generateImageWithUIReference or generateVideoAd,
   * applying addBranding() should produce the same branding result (brandingApplied === true,
   * brand tag in metadata) as applying it to a standard non-reference asset with the same properties.
   */
  it('addBranding produces the same result for UI-reference and standard assets', async () => {
    const creator = new VisualAssetCreator({
      imageClient: makeMockImageClient(),
      videoClient: makeMockVideoClient(),
    });

    const brandNameArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);
    const tagsArb = fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 });
    const assetTypeArb = fc.constantFrom(AssetType.IMAGE, AssetType.VIDEO);

    await fc.assert(
      fc.asyncProperty(brandNameArb, tagsArb, assetTypeArb, async (brandName, tags, assetType) => {
        const brandProfile: BrandProfile = {
          name: brandName,
          voice: 'professional',
          guidelines: ['test'],
        };

        const baseTags = ['source:figma-ui', 'frame:test-frame', ...tags];

        // UI-reference asset
        const uiRefAsset = makeAsset({
          assetType,
          metadata: { tags: [...baseTags], createdAt: new Date() },
          brandingApplied: false,
        });

        // Standard asset with the same properties
        const standardAsset = makeStandardAsset({
          assetType,
          metadata: { tags: [...baseTags], createdAt: new Date() },
          brandingApplied: false,
        });

        const brandedUIRef = await creator.addBranding(uiRefAsset, brandProfile);
        const brandedStandard = await creator.addBranding(standardAsset, brandProfile);

        // Both should have brandingApplied === true
        expect(brandedUIRef.brandingApplied).toBe(true);
        expect(brandedStandard.brandingApplied).toBe(true);

        // Both should have the brand tag
        expect(brandedUIRef.metadata.tags).toContain(`brand:${brandName}`);
        expect(brandedStandard.metadata.tags).toContain(`brand:${brandName}`);

        // The brand tag should be added in the same way
        const uiRefBrandTags = brandedUIRef.metadata.tags!.filter((t) => t.startsWith('brand:'));
        const standardBrandTags = brandedStandard.metadata.tags!.filter((t) => t.startsWith('brand:'));
        expect(uiRefBrandTags).toEqual(standardBrandTags);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Unit Tests: Auto-extraction and integration ───────────────

describe('VisualAssetCreator - generateImageWithUIReference', () => {
  it('throws when no imageCompositor is configured', async () => {
    const creator = new VisualAssetCreator({
      imageClient: makeMockImageClient(),
    });

    await expect(
      creator.generateImageWithUIReference('test prompt', makeImageSpecs(), ['loyalty-card']),
    ).rejects.toThrow('no imageCompositor configured');
  });

  it('delegates to ImageCompositor and returns asset', async () => {
    const mockImageClient = makeMockImageClient();
    const frameStore = {
      isCached: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue({
        buffer: Buffer.from('fake-image'),
        metadata: {
          frameName: 'loyalty-card',
          source: 'figma-api',
          sourceId: '123:456',
          dimensions: { width: 390, height: 844 },
          extractedAt: new Date(),
          filePath: 'output/ui-frames/loyalty-card.png',
          format: 'png',
        },
      }),
    } as unknown as UIFrameStore;

    const compositor = new ImageCompositor({
      imageClient: mockImageClient,
      frameStore,
    });

    const creator = new VisualAssetCreator({
      imageClient: mockImageClient,
      frameStore: frameStore,
      imageCompositor: compositor,
    });

    const asset = await creator.generateImageWithUIReference(
      'Cafe loyalty card promo',
      makeImageSpecs(),
      ['loyalty-card'],
    );

    expect(asset.assetType).toBe(AssetType.IMAGE);
    expect(asset.url).toBe('https://example.com/image.png');
    expect(asset.metadata.tags).toContain('source:figma-ui');
    expect(asset.metadata.tags).toContain('frame:loyalty-card');
    expect(asset.metadata.altText).toBeTruthy();
  });
});

describe('VisualAssetCreator - generateVideoAd', () => {
  it('throws when no videoAdComposer is configured', async () => {
    const creator = new VisualAssetCreator({
      videoClient: makeMockVideoClient(),
    });

    await expect(
      creator.generateVideoAd('test prompt', makeVideoSpecs(), ['loyalty-card']),
    ).rejects.toThrow('no videoAdComposer configured');
  });

  it('delegates to VideoAdComposer and returns asset', async () => {
    const mockKlingVideo = makeMockKlingVideoClient();
    const frameStore = {
      isCached: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue({
        buffer: Buffer.from('fake-image'),
        metadata: {
          frameName: 'loyalty-card',
          source: 'figma-api',
          sourceId: '123:456',
          dimensions: { width: 390, height: 844 },
          extractedAt: new Date(),
          filePath: 'output/ui-frames/loyalty-card.png',
          format: 'png',
        },
      }),
    } as unknown as UIFrameStore;

    const composer = new VideoAdComposer({
      videoClient: mockKlingVideo,
      frameStore,
    });

    const creator = new VisualAssetCreator({
      videoClient: makeMockVideoClient(),
      frameStore: frameStore,
      videoAdComposer: composer,
    });

    const asset = await creator.generateVideoAd(
      'App showcase video',
      makeVideoSpecs(),
      ['loyalty-card'],
    );

    expect(asset.assetType).toBe(AssetType.VIDEO);
    expect(asset.url).toBe('https://example.com/video.mp4');
    expect(asset.metadata.tags).toContain('source:figma-ui');
    expect(asset.metadata.tags).toContain('frame:loyalty-card');
  });
});

describe('VisualAssetCreator - auto-extraction on cache miss', () => {
  it('calls ensureFramesExtracted when frames are not cached', async () => {
    const mockImageClient = makeMockImageClient();

    // Frame store that reports cache miss
    const frameStore = {
      isCached: vi.fn().mockResolvedValue(false),
      get: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({}),
    } as unknown as UIFrameStore;

    const compositor = new ImageCompositor({
      imageClient: mockImageClient,
      frameStore,
    });

    const creator = new VisualAssetCreator({
      imageClient: mockImageClient,
      frameStore,
      imageCompositor: compositor,
    });

    // This will try to load the manifest and fail since the frame isn't in the manifest
    // or the manifest can't be loaded — we expect an error about auto-extraction
    await expect(
      creator.generateImageWithUIReference('test', makeImageSpecs(), ['nonexistent-frame']),
    ).rejects.toThrow(/Cannot auto-extract|not found in store or manifest/);

    // Verify isCached was called
    expect(frameStore.isCached).toHaveBeenCalledWith('nonexistent-frame');
  });

  it('skips extraction when all frames are cached', async () => {
    const mockImageClient = makeMockImageClient();

    const frameStore = {
      isCached: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue({
        buffer: Buffer.from('cached-image'),
        metadata: {
          frameName: 'loyalty-card',
          source: 'figma-api',
          sourceId: '123:456',
          dimensions: { width: 390, height: 844 },
          extractedAt: new Date(),
          filePath: 'output/ui-frames/loyalty-card.png',
          format: 'png',
        },
      }),
    } as unknown as UIFrameStore;

    const compositor = new ImageCompositor({
      imageClient: mockImageClient,
      frameStore,
    });

    const creator = new VisualAssetCreator({
      imageClient: mockImageClient,
      frameStore,
      imageCompositor: compositor,
    });

    const asset = await creator.generateImageWithUIReference(
      'Cafe promo',
      makeImageSpecs(),
      ['loyalty-card'],
    );

    expect(asset).toBeDefined();
    expect(frameStore.isCached).toHaveBeenCalledWith('loyalty-card');
  });
});

describe('VisualAssetCreator - branding and optimization integration', () => {
  it('addBranding works on UI-reference image assets', async () => {
    const creator = new VisualAssetCreator({
      imageClient: makeMockImageClient(),
    });

    const uiRefAsset = makeAsset({
      assetType: AssetType.IMAGE,
      metadata: {
        tags: ['source:figma-ui', 'frame:loyalty-card'],
        createdAt: new Date(),
        altText: 'Cafe loyalty card',
      },
    });

    const branded = await creator.addBranding(uiRefAsset, makeBrandProfile());

    expect(branded.brandingApplied).toBe(true);
    expect(branded.metadata.tags).toContain('brand:TestBrand');
    expect(branded.metadata.tags).toContain('source:figma-ui');
    expect(branded.metadata.tags).toContain('frame:loyalty-card');
  });

  it('addBranding works on UI-reference video assets', async () => {
    const creator = new VisualAssetCreator({
      videoClient: makeMockVideoClient(),
    });

    const uiRefAsset = makeAsset({
      assetType: AssetType.VIDEO,
      metadata: {
        tags: ['source:figma-ui', 'frame:loyalty-card', 'frame:order-ahead'],
        createdAt: new Date(),
      },
    });

    const branded = await creator.addBranding(uiRefAsset, makeBrandProfile());

    expect(branded.brandingApplied).toBe(true);
    expect(branded.metadata.tags).toContain('brand:TestBrand');
    expect(branded.metadata.tags).toContain('source:figma-ui');
  });

  it('optimizeForPlatform works on UI-reference assets', () => {
    const creator = new VisualAssetCreator({
      imageClient: makeMockImageClient(),
    });

    const uiRefAsset = makeAsset({
      metadata: {
        tags: ['source:figma-ui', 'frame:loyalty-card'],
        createdAt: new Date(),
      },
    });

    const optimized = creator.optimizeForPlatform(uiRefAsset, Platform.FACEBOOK);

    expect(optimized.platform).toBe(Platform.FACEBOOK);
    expect(optimized.dimensions).toEqual({ width: 1200, height: 630 });
    // UI reference tags should be preserved
    expect(optimized.metadata.tags).toContain('source:figma-ui');
    expect(optimized.metadata.tags).toContain('frame:loyalty-card');
  });
});
