import { IVisualAssetCreator } from '../../core/interfaces';
import { Platform, AssetType } from '../../models/enums';
import { BrandProfile, VisualSpecs } from '../../models/common';
import { VisualAsset } from '../../models/visual-asset';
import { createLogger } from '../../utils/logger';
import { ImageGenerator, IImageGenerationClient } from './image-generator';
import { VideoGenerator, IVideoGenerationClient } from './video-generator';
import {
  getPlatformSpec,
  getDefaultDimensions,
  validateAssetForPlatform,
} from './platform-specs';
import { generateAltText, generateCaptions } from './accessibility';
import { UIFrameStore } from './figma/ui-frame-store';
import { ImageCompositor } from './figma/image-compositor';
import { VideoAdComposer } from './figma/video-ad-composer';
import { loadFrameManifest, FrameManifestEntry } from './figma/frame-manifest';
import { FigmaApiClient } from './figma/figma-api-client';
import { PlaywrightCapturer } from './figma/playwright-capturer';

const log = createLogger('VisualAssetCreator');

export interface VisualAssetCreatorOptions {
  imageClient?: IImageGenerationClient;
  videoClient?: IVideoGenerationClient;
  defaultPlatform?: Platform;
  frameStore?: UIFrameStore;
  imageCompositor?: ImageCompositor;
  videoAdComposer?: VideoAdComposer;
}

/**
 * VisualAssetCreator — implements IVisualAssetCreator.
 * Orchestrates image/video generation, platform optimization,
 * branding, and accessibility features.
 */
export class VisualAssetCreator implements IVisualAssetCreator {
  private readonly imageGenerator: ImageGenerator;
  private readonly videoGenerator: VideoGenerator;
  private readonly defaultPlatform: Platform;
  private readonly frameStore?: UIFrameStore;
  private readonly imageCompositor?: ImageCompositor;
  private readonly videoAdComposer?: VideoAdComposer;

  constructor(options: VisualAssetCreatorOptions = {}) {
    this.imageGenerator = new ImageGenerator(options.imageClient);
    this.videoGenerator = new VideoGenerator(options.videoClient);
    this.defaultPlatform = options.defaultPlatform ?? Platform.INSTAGRAM;
    this.frameStore = options.frameStore;
    this.imageCompositor = options.imageCompositor;
    this.videoAdComposer = options.videoAdComposer;
  }

  async generateImage(prompt: string, specs: VisualSpecs): Promise<VisualAsset> {
    const asset = await this.imageGenerator.generateImage(prompt, specs, this.defaultPlatform);
    // Add alt text for accessibility
    asset.metadata.altText = generateAltText(prompt);
    return asset;
  }

  async generateVideo(prompt: string, specs: VisualSpecs): Promise<VisualAsset> {
    const asset = await this.videoGenerator.generateVideo(prompt, specs, this.defaultPlatform);
    // Add captions for accessibility
    asset.metadata.captions = generateCaptions(prompt, specs.duration);
    return asset;
  }

  async generateImageWithUIReference(
    prompt: string,
    specs: VisualSpecs,
    frameNames: string[],
  ): Promise<VisualAsset> {
    if (!this.imageCompositor) {
      throw new Error('VisualAssetCreator: no imageCompositor configured');
    }

    await this.ensureFramesExtracted(frameNames);

    const asset = await this.imageCompositor.generateWithReferences(
      prompt,
      specs,
      frameNames,
      this.defaultPlatform,
    );

    asset.metadata.altText = generateAltText(prompt);
    return asset;
  }

  async generateVideoAd(
    prompt: string,
    specs: VisualSpecs,
    frameNames: string[],
  ): Promise<VisualAsset> {
    if (!this.videoAdComposer) {
      throw new Error('VisualAssetCreator: no videoAdComposer configured');
    }

    await this.ensureFramesExtracted(frameNames);

    const asset = await this.videoAdComposer.generateVideoAd(
      prompt,
      specs,
      frameNames,
      this.defaultPlatform,
    );

    asset.metadata.captions = generateCaptions(prompt, specs.duration);
    return asset;
  }

  async addBranding(asset: VisualAsset, brandProfile: BrandProfile): Promise<VisualAsset> {
    log.info({ assetId: asset.assetId, brand: brandProfile.name }, 'Applying branding');

    const branded: VisualAsset = {
      ...asset,
      metadata: {
        ...asset.metadata,
        tags: [
          ...(asset.metadata.tags ?? []),
          `brand:${brandProfile.name}`,
        ],
      },
      brandingApplied: true,
    };

    // Update alt text to include brand name
    if (branded.assetType === AssetType.IMAGE && branded.metadata.altText) {
      branded.metadata.altText = generateAltText(branded.metadata.altText, brandProfile.name);
    }

    log.info({ assetId: branded.assetId }, 'Branding applied');
    return branded;
  }

  /**
   * Optimizes an asset for a specific platform by adjusting dimensions,
   * format, and validating against platform constraints.
   */
  optimizeForPlatform(asset: VisualAsset, platform: Platform): VisualAsset {
    const spec = getPlatformSpec(platform);
    const assetType = asset.assetType;

    // Pick the best dimensions for the platform
    const targetDimensions = getDefaultDimensions(platform, assetType);

    // Pick a supported format
    const supportedFormats =
      assetType === AssetType.IMAGE ? spec.imageFormats : spec.videoFormats;
    const format = supportedFormats.includes(asset.format)
      ? asset.format
      : supportedFormats[0];

    const optimized: VisualAsset = {
      ...asset,
      dimensions: targetDimensions,
      format,
      platform,
    };

    // Validate the optimized asset
    const errors = validateAssetForPlatform(
      platform,
      assetType,
      optimized.format,
      optimized.fileSize,
      assetType === AssetType.VIDEO ? optimized.duration : undefined,
    );

    if (errors.length > 0) {
      log.warn({ assetId: asset.assetId, platform, errors }, 'Asset validation warnings after optimization');
    }

    return optimized;
  }

  /**
   * Ensure all requested frames are extracted and available in the UIFrameStore.
   * If any are missing, loads the frame manifest and extracts them using
   * FigmaApiClient or PlaywrightCapturer as appropriate.
   */
  private async ensureFramesExtracted(frameNames: string[]): Promise<void> {
    if (!this.frameStore) {
      return;
    }

    const missingFrames: string[] = [];
    for (const name of frameNames) {
      const cached = await this.frameStore.isCached(name);
      if (!cached) {
        missingFrames.push(name);
      }
    }

    if (missingFrames.length === 0) {
      return;
    }

    log.info({ missingFrames }, 'Frames not in cache, attempting auto-extraction');

    let manifest;
    try {
      manifest = loadFrameManifest();
    } catch (err) {
      throw new Error(
        `Cannot auto-extract frames [${missingFrames.join(', ')}]: failed to load frame manifest: ${err}`,
      );
    }

    const entryMap = new Map<string, FrameManifestEntry>();
    for (const entry of manifest.frames) {
      entryMap.set(entry.screenName, entry);
    }

    const notInManifest = missingFrames.filter((name) => !entryMap.has(name));
    if (notInManifest.length > 0) {
      throw new Error(
        `Frame names not found in store or manifest: ${notInManifest.join(', ')}`,
      );
    }

    for (const name of missingFrames) {
      const entry = entryMap.get(name)!;

      if (entry.figmaNodeId) {
        try {
          const figmaToken = process.env.FIGMA_ACCESS_TOKEN;
          if (!figmaToken) {
            log.warn({ frameName: name }, 'FIGMA_ACCESS_TOKEN not set, skipping Figma API extraction');
            continue;
          }
          const client = new FigmaApiClient({
            accessToken: figmaToken,
            fileKey: manifest.figmaFileKey,
          });
          const results = await client.exportFrames([entry.figmaNodeId]);
          if (results.length > 0) {
            await this.frameStore.save(name, results[0].imageBuffer, {
              frameName: name,
              source: 'figma-api',
              sourceId: entry.figmaNodeId,
              dimensions: results[0].dimensions,
              format: results[0].format,
            });
          }
        } catch (err) {
          log.warn({ frameName: name, error: err }, 'Figma API extraction failed');
        }
      } else if (entry.playwrightSteps && entry.playwrightSteps.length > 0) {
        try {
          const capturer = new PlaywrightCapturer();
          const results = await capturer.capture(entry.playwrightSteps);
          const match = results.find((r) => r.screenName === name);
          if (match) {
            await this.frameStore.save(name, match.imageBuffer, {
              frameName: name,
              source: 'playwright',
              sourceId: entry.playwrightSteps[0]?.url ?? name,
              dimensions: match.dimensions,
              format: 'png',
            });
          }
        } catch (err) {
          log.warn({ frameName: name, error: err }, 'Playwright extraction failed');
        }
      }
    }
  }
}
