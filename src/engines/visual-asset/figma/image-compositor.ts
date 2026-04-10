/**
 * Image Compositor — generates marketing images using Figma UI frames as references.
 *
 * Loads cached frames from UIFrameStore, enhances prompts with brand DNA
 * and phone mockup placement instructions, then delegates to a KLING image client
 * with the first frame as a reference image.
 */
import { v4 as uuidv4 } from 'uuid';
import { AssetType, Platform } from '../../../models/enums';
import { VisualSpecs } from '../../../models/common';
import { VisualAsset } from '../../../models/visual-asset';
import { IImageGenerationClient } from '../image-generator';
import { UIFrameStore } from './ui-frame-store';
import { buildImagePromptEnhancement } from '../../../config/rewoz-brand-dna';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ImageCompositor');

export interface ImageCompositorConfig {
  imageClient?: IImageGenerationClient;
  frameStore?: UIFrameStore;
}

const PHONE_MOCKUP_INSTRUCTION =
  'Place the app UI on a phone mockup in the scene. The phone should be held naturally or resting on a cafe table, showing the app screen clearly.';

export class ImageCompositor {
  private readonly imageClient: IImageGenerationClient | undefined;
  private readonly frameStore: UIFrameStore | undefined;

  constructor(config?: ImageCompositorConfig) {
    this.imageClient = config?.imageClient;
    this.frameStore = config?.frameStore;
  }

  /**
   * Enhance a prompt with brand DNA rules and phone mockup instructions.
   * Exposed as a separate method for testability.
   */
  enhancePrompt(prompt: string, _frameNames: string[]): string {
    const brandEnhancement = buildImagePromptEnhancement();
    return `${prompt}\n\n${PHONE_MOCKUP_INSTRUCTION}\n${brandEnhancement}`;
  }

  /**
   * Generate a marketing image using UI frames as references.
   * Falls back to text-only generation if frame loading fails.
   */
  async generateWithReferences(
    prompt: string,
    specs: VisualSpecs,
    frameNames: string[],
    platform?: Platform,
  ): Promise<VisualAsset> {
    const client = this.imageClient;
    if (!client) {
      throw new Error('ImageCompositor: no image client configured');
    }

    const enhancedPrompt = this.enhancePrompt(prompt, frameNames);
    let referenceImageUrl: string | undefined;

    // Try to load the first frame as a reference image
    if (this.frameStore && frameNames.length > 0) {
      try {
        const frame = await this.frameStore.get(frameNames[0]);
        if (frame) {
          // Convert buffer to a data URL for the KLING client
          const base64 = frame.buffer.toString('base64');
          const mimeType = frame.metadata.format === 'svg' ? 'image/svg+xml' : 'image/png';
          referenceImageUrl = `data:${mimeType};base64,${base64}`;
        } else {
          log.warn({ frameName: frameNames[0] }, 'Frame not found in store, falling back to text-only generation');
        }
      } catch (err) {
        log.warn({ frameName: frameNames[0], error: err }, 'Failed to load reference frame, falling back to text-only generation');
      }
    }

    const result = await client.generate(
      enhancedPrompt,
      specs.dimensions.width,
      specs.dimensions.height,
      referenceImageUrl,
    );

    // Build metadata tags
    const tags: string[] = ['source:figma-ui'];
    for (const name of frameNames) {
      tags.push(`frame:${name}`);
    }

    const asset: VisualAsset = {
      assetId: uuidv4(),
      assetType: AssetType.IMAGE,
      url: result.url,
      localPath: '',
      dimensions: { ...specs.dimensions },
      format: specs.format,
      fileSize: result.fileSize,
      duration: 0,
      platform: platform ?? Platform.INSTAGRAM,
      metadata: { tags, createdAt: new Date() },
      brandingApplied: false,
    };

    log.info({ assetId: asset.assetId, frameNames }, 'Image generated with UI references');
    return asset;
  }
}
