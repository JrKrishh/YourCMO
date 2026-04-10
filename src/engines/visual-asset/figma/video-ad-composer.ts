/**
 * Video Ad Composer — generates video ads using Figma UI frames as reference keyframes.
 *
 * Uses the first frame as a starting reference image for KLING video generation.
 * For multi-frame sequences, adds transition instructions (swipe, zoom between screens).
 * For single frames, adds camera movement instructions (orbit around phone mockup).
 */
import { v4 as uuidv4 } from 'uuid';
import { AssetType, Platform } from '../../../models/enums';
import { VisualSpecs } from '../../../models/common';
import { VisualAsset } from '../../../models/visual-asset';
import { KlingVideoClient } from '../kling-client';
import { UIFrameStore } from './ui-frame-store';
import { createLogger } from '../../../utils/logger';

const log = createLogger('VideoAdComposer');

export interface VideoAdComposerConfig {
  videoClient?: KlingVideoClient;
  frameStore?: UIFrameStore;
}

/** Default duration in seconds */
const DEFAULT_DURATION = 10;

/** Default dimensions for 9:16 vertical video */
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

export class VideoAdComposer {
  private readonly videoClient: KlingVideoClient | undefined;
  private readonly frameStore: UIFrameStore | undefined;

  constructor(config?: VideoAdComposerConfig) {
    this.videoClient = config?.videoClient;
    this.frameStore = config?.frameStore;
  }

  /**
   * Enhance a video prompt with transition or camera movement instructions.
   * Exposed as a separate method for testability.
   */
  enhanceVideoPrompt(prompt: string, frameNames: string[]): string {
    if (frameNames.length >= 2) {
      const transitionList = frameNames
        .map((name, i) => (i < frameNames.length - 1 ? `swipe from "${name}" to "${frameNames[i + 1]}"` : ''))
        .filter(Boolean)
        .join(', then ');
      return `${prompt}\n\nTransition instructions: Show a phone mockup with app screens. ${transitionList}. Use smooth swipe and zoom transitions between each app screen.`;
    }

    // Single frame — camera movement around phone mockup
    return `${prompt}\n\nCamera movement: Slowly orbit around a phone mockup showing the "${frameNames[0]}" app screen. Use a smooth cinematic camera movement — gentle rotation and subtle zoom to showcase the UI.`;
  }

  /**
   * Generate a video ad using UI frames as keyframes.
   */
  async generateVideoAd(
    prompt: string,
    specs: VisualSpecs,
    frameNames: string[],
    platform?: Platform,
  ): Promise<VisualAsset> {
    const client = this.videoClient;
    if (!client) {
      throw new Error('VideoAdComposer: no video client configured');
    }
    if (frameNames.length === 0) {
      throw new Error('VideoAdComposer: at least one frame name is required');
    }

    const duration = specs.duration ?? DEFAULT_DURATION;
    const width = specs.dimensions?.width ?? DEFAULT_WIDTH;
    const height = specs.dimensions?.height ?? DEFAULT_HEIGHT;

    const enhancedPrompt = this.enhanceVideoPrompt(prompt, frameNames);
    let referenceImageUrl: string | undefined;

    // Load the first frame as the starting reference image
    if (this.frameStore) {
      try {
        const frame = await this.frameStore.get(frameNames[0]);
        if (frame) {
          const base64 = frame.buffer.toString('base64');
          const mimeType = frame.metadata.format === 'svg' ? 'image/svg+xml' : 'image/png';
          referenceImageUrl = `data:${mimeType};base64,${base64}`;
        } else {
          log.warn({ frameName: frameNames[0] }, 'Frame not found in store');
        }
      } catch (err) {
        log.warn({ frameName: frameNames[0], error: err }, 'Failed to load reference frame');
      }
    }

    const result = await client.generateVideo(enhancedPrompt, duration, referenceImageUrl);

    // Build metadata tags
    const tags: string[] = ['source:figma-ui'];
    for (const name of frameNames) {
      tags.push(`frame:${name}`);
    }

    const asset: VisualAsset = {
      assetId: uuidv4(),
      assetType: AssetType.VIDEO,
      url: result.url,
      localPath: '',
      dimensions: { width, height },
      format: specs.format || 'mp4',
      fileSize: result.fileSize,
      duration,
      platform: platform ?? Platform.INSTAGRAM,
      metadata: { tags, createdAt: new Date() },
      brandingApplied: false,
    };

    log.info({ assetId: asset.assetId, frameNames, duration }, 'Video ad generated with UI references');
    return asset;
  }
}
