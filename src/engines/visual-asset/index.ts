export { ImageGenerator, GoogleAIStudioImageClient, OpenRouterImageClient, DallEClient, resizeDimensions, estimateFileSize } from './image-generator';
export type { IImageGenerationClient } from './image-generator';

export { KlingImageClient, KlingVideoClient } from './kling-client';
export { SeedreamImageClient } from './seedream-client';

export { VideoGenerator, DefaultVideoClient, parseVideoScript, estimateVideoFileSize } from './video-generator';
export type { IVideoGenerationClient, VideoScene } from './video-generator';

export {
  PLATFORM_SPECS,
  getPlatformSpec,
  getDefaultDimensions,
  validateAssetForPlatform,
} from './platform-specs';
export type { PlatformSpec } from './platform-specs';

export { VisualAssetCreator } from './visual-asset-creator';
export type { VisualAssetCreatorOptions } from './visual-asset-creator';

export { generateAltText, generateCaptions } from './accessibility';
