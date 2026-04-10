import { describe, it, expect, vi } from 'vitest';
import { VisualAssetCreator } from './visual-asset-creator';
import { ImageGenerator, IImageGenerationClient } from './image-generator';
import { VideoGenerator, IVideoGenerationClient } from './video-generator';
import {
  PLATFORM_SPECS,
  getPlatformSpec,
  getDefaultDimensions,
  validateAssetForPlatform,
} from './platform-specs';
import {
  resizeDimensions,
  estimateFileSize,
} from './image-generator';
import {
  parseVideoScript,
  estimateVideoFileSize,
} from './video-generator';
import { generateAltText, generateCaptions } from './accessibility';
import { Platform, AssetType } from '../../models/enums';
import { VisualSpecs, BrandProfile } from '../../models/common';
import { VisualAsset } from '../../models/visual-asset';

// ── Mock clients ──────────────────────────────────────────────

const mockImageClient: IImageGenerationClient = {
  generate: vi.fn().mockResolvedValue({
    url: 'https://example.com/image.png',
    fileSize: 500_000,
  }),
};

const mockVideoClient: IVideoGenerationClient = {
  generate: vi.fn().mockResolvedValue({
    url: 'https://example.com/video.mp4',
    fileSize: 2_000_000,
  }),
};

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
    duration: 15,
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
    metadata: { tags: [], createdAt: new Date() },
    brandingApplied: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('ImageGenerator', () => {
  it('generates an image asset from a prompt', async () => {
    const gen = new ImageGenerator(mockImageClient);
    const specs = makeImageSpecs();
    const asset = await gen.generateImage('A sunset over mountains', specs, Platform.INSTAGRAM);

    expect(asset.assetType).toBe(AssetType.IMAGE);
    expect(asset.url).toBe('https://example.com/image.png');
    expect(asset.dimensions).toEqual({ width: 1080, height: 1080 });
    expect(asset.format).toBe('png');
    expect(asset.fileSize).toBe(500_000);
    expect(asset.brandingApplied).toBe(false);
    expect(asset.assetId).toBeTruthy();
  });

  it('throws on empty prompt', async () => {
    const gen = new ImageGenerator(mockImageClient);
    await expect(gen.generateImage('', makeImageSpecs())).rejects.toThrow('Image prompt must not be empty');
  });

  it('throws on wrong spec type', async () => {
    const gen = new ImageGenerator(mockImageClient);
    await expect(gen.generateImage('test', makeVideoSpecs())).rejects.toThrow('VisualSpecs type must be IMAGE');
  });
});

describe('VideoGenerator', () => {
  it('generates a video asset from a prompt', async () => {
    const gen = new VideoGenerator(mockVideoClient);
    const specs = makeVideoSpecs();
    const asset = await gen.generateVideo('Product showcase', specs, Platform.TIKTOK);

    expect(asset.assetType).toBe(AssetType.VIDEO);
    expect(asset.url).toBe('https://example.com/video.mp4');
    expect(asset.duration).toBe(15);
    expect(asset.format).toBe('mp4');
    expect(asset.platform).toBe(Platform.TIKTOK);
  });

  it('throws on empty prompt', async () => {
    const gen = new VideoGenerator(mockVideoClient);
    await expect(gen.generateVideo('', makeVideoSpecs())).rejects.toThrow('Video prompt must not be empty');
  });

  it('throws on wrong spec type', async () => {
    const gen = new VideoGenerator(mockVideoClient);
    await expect(gen.generateVideo('test', makeImageSpecs())).rejects.toThrow('VisualSpecs type must be VIDEO');
  });
});

describe('parseVideoScript', () => {
  it('parses a multi-scene script', () => {
    const script = [
      'Scene 1: Opening shot of the city',
      'Duration: 3',
      'Narration: Welcome to our brand',
      'Scene 2: Product close-up',
      'Duration: 5',
    ].join('\n');

    const scenes = parseVideoScript(script);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].sceneNumber).toBe(1);
    expect(scenes[0].duration).toBe(3);
    expect(scenes[0].narration).toBe('Welcome to our brand');
    expect(scenes[1].sceneNumber).toBe(2);
    expect(scenes[1].duration).toBe(5);
  });

  it('returns empty array for empty input', () => {
    expect(parseVideoScript('')).toEqual([]);
  });
});

describe('Platform Specs', () => {
  it('has specs for all platforms', () => {
    const platforms = [Platform.INSTAGRAM, Platform.FACEBOOK, Platform.TWITTER, Platform.TIKTOK, Platform.WHATSAPP];
    for (const p of platforms) {
      const spec = getPlatformSpec(p);
      expect(spec.platform).toBe(p);
      expect(spec.imageDimensions.length).toBeGreaterThan(0);
      expect(spec.imageFormats.length).toBeGreaterThan(0);
    }
  });

  it('returns correct Instagram specs', () => {
    const spec = PLATFORM_SPECS[Platform.INSTAGRAM];
    expect(spec.imageDimensions[0]).toEqual({ width: 1080, height: 1080 });
    expect(spec.maxImageSize).toBe(30 * 1024 * 1024);
    expect(spec.maxVideoDuration).toBe(60);
  });

  it('returns correct TikTok specs', () => {
    const spec = PLATFORM_SPECS[Platform.TIKTOK];
    expect(spec.videoDimensions[0]).toEqual({ width: 1080, height: 1920 });
    expect(spec.maxVideoDuration).toBe(600);
  });

  it('getDefaultDimensions returns first entry', () => {
    const dims = getDefaultDimensions(Platform.INSTAGRAM, AssetType.IMAGE);
    expect(dims).toEqual({ width: 1080, height: 1080 });
  });

  it('validates asset format correctly', () => {
    const errors = validateAssetForPlatform(Platform.TWITTER, AssetType.IMAGE, 'bmp', 1000, undefined);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('not supported');
  });

  it('validates asset file size', () => {
    const errors = validateAssetForPlatform(Platform.TWITTER, AssetType.IMAGE, 'png', 10 * 1024 * 1024, undefined);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('exceeds max');
  });

  it('validates video duration', () => {
    const errors = validateAssetForPlatform(Platform.TWITTER, AssetType.VIDEO, 'mp4', 1000, 200);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Duration');
  });

  it('returns no errors for valid asset', () => {
    const errors = validateAssetForPlatform(Platform.INSTAGRAM, AssetType.IMAGE, 'jpg', 1_000_000, undefined);
    expect(errors).toEqual([]);
  });
});

describe('VisualAssetCreator', () => {
  const creator = new VisualAssetCreator({
    imageClient: mockImageClient,
    videoClient: mockVideoClient,
    defaultPlatform: Platform.INSTAGRAM,
  });

  it('generateImage returns asset with alt text', async () => {
    const asset = await creator.generateImage('A beautiful landscape', makeImageSpecs());
    expect(asset.assetType).toBe(AssetType.IMAGE);
    expect(asset.metadata.altText).toBeTruthy();
    expect(asset.metadata.altText).toContain('landscape');
  });

  it('generateVideo returns asset with captions', async () => {
    const asset = await creator.generateVideo('Product demo showing features.', makeVideoSpecs());
    expect(asset.assetType).toBe(AssetType.VIDEO);
    expect(asset.metadata.captions).toBeTruthy();
  });

  it('addBranding marks asset as branded and adds tag', async () => {
    const asset = makeAsset();
    const branded = await creator.addBranding(asset, makeBrandProfile());
    expect(branded.brandingApplied).toBe(true);
    expect(branded.metadata.tags).toContain('brand:TestBrand');
  });

  it('optimizeForPlatform adjusts dimensions and format', () => {
    const asset = makeAsset({ format: 'bmp', dimensions: { width: 2000, height: 2000 } });
    const optimized = creator.optimizeForPlatform(asset, Platform.FACEBOOK);
    expect(optimized.dimensions).toEqual({ width: 1200, height: 630 });
    expect(optimized.format).toBe('jpg'); // bmp not supported, falls back to first
    expect(optimized.platform).toBe(Platform.FACEBOOK);
  });

  it('optimizeForPlatform keeps supported format', () => {
    const asset = makeAsset({ format: 'png' });
    const optimized = creator.optimizeForPlatform(asset, Platform.INSTAGRAM);
    expect(optimized.format).toBe('png');
  });
});

describe('Accessibility', () => {
  it('generateAltText creates text from prompt', () => {
    const alt = generateAltText('A colorful sunset over the ocean');
    expect(alt).toBe('A colorful sunset over the ocean');
  });

  it('generateAltText includes brand name', () => {
    const alt = generateAltText('Sunset photo', 'MyBrand');
    expect(alt.startsWith('MyBrand: ')).toBe(true);
  });

  it('generateAltText truncates long text to 125 chars', () => {
    const longPrompt = 'A'.repeat(200);
    const alt = generateAltText(longPrompt);
    expect(alt.length).toBeLessThanOrEqual(125);
  });

  it('generateAltText returns empty for empty input', () => {
    expect(generateAltText('')).toBe('');
  });

  it('generateCaptions produces SRT-style output', () => {
    const captions = generateCaptions('Hello world. This is a test.', 6);
    expect(captions).toContain('1');
    expect(captions).toContain('-->');
    expect(captions).toContain('Hello world');
    expect(captions).toContain('This is a test');
  });

  it('generateCaptions returns empty for empty input', () => {
    expect(generateCaptions('')).toBe('');
  });
});

describe('Utility functions', () => {
  it('resizeDimensions preserves aspect ratio', () => {
    const result = resizeDimensions({ width: 2000, height: 1000 }, { width: 1000, height: 1000 });
    expect(result.width).toBe(1000);
    expect(result.height).toBe(500);
  });

  it('estimateFileSize returns positive number', () => {
    const size = estimateFileSize({ width: 1080, height: 1080 }, 'jpg');
    expect(size).toBeGreaterThan(0);
  });

  it('estimateVideoFileSize returns positive number', () => {
    const size = estimateVideoFileSize(1080, 1920, 15);
    expect(size).toBeGreaterThan(0);
  });
});
