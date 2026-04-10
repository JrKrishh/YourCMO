import { Platform, AssetType } from '../../models/enums';
import { Dimensions } from '../../models/common';

/** Supported image/video formats per platform */
export interface PlatformSpec {
  platform: Platform;
  /** Recommended dimensions for images (first entry is default) */
  imageDimensions: Dimensions[];
  /** Recommended dimensions for videos (first entry is default) */
  videoDimensions: Dimensions[];
  /** Supported image formats */
  imageFormats: string[];
  /** Supported video formats */
  videoFormats: string[];
  /** Max image file size in bytes */
  maxImageSize: number;
  /** Max video file size in bytes */
  maxVideoSize: number;
  /** Max video duration in seconds */
  maxVideoDuration: number;
}

/** Platform specification database */
export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  [Platform.INSTAGRAM]: {
    platform: Platform.INSTAGRAM,
    imageDimensions: [
      { width: 1080, height: 1080 },
      { width: 1080, height: 1350 },
    ],
    videoDimensions: [{ width: 1080, height: 1080 }],
    imageFormats: ['jpg', 'png'],
    videoFormats: ['mp4'],
    maxImageSize: 30 * 1024 * 1024,
    maxVideoSize: 650 * 1024 * 1024,
    maxVideoDuration: 60,
  },
  [Platform.FACEBOOK]: {
    platform: Platform.FACEBOOK,
    imageDimensions: [{ width: 1200, height: 630 }],
    videoDimensions: [{ width: 1200, height: 630 }],
    imageFormats: ['jpg', 'png'],
    videoFormats: ['mp4'],
    maxImageSize: 10 * 1024 * 1024,
    maxVideoSize: 10 * 1024 * 1024 * 1024,
    maxVideoDuration: 240 * 60,
  },
  [Platform.TWITTER]: {
    platform: Platform.TWITTER,
    imageDimensions: [{ width: 1200, height: 675 }],
    videoDimensions: [{ width: 1200, height: 675 }],
    imageFormats: ['jpg', 'png', 'gif'],
    videoFormats: ['mp4'],
    maxImageSize: 5 * 1024 * 1024,
    maxVideoSize: 512 * 1024 * 1024,
    maxVideoDuration: 140,
  },
  [Platform.TIKTOK]: {
    platform: Platform.TIKTOK,
    imageDimensions: [{ width: 1080, height: 1920 }],
    videoDimensions: [{ width: 1080, height: 1920 }],
    imageFormats: ['jpg', 'png'],
    videoFormats: ['mp4'],
    maxImageSize: 10 * 1024 * 1024,
    maxVideoSize: 287.6 * 1024 * 1024,
    maxVideoDuration: 10 * 60,
  },
  [Platform.WHATSAPP]: {
    platform: Platform.WHATSAPP,
    imageDimensions: [{ width: 800, height: 800 }],
    videoDimensions: [{ width: 800, height: 800 }],
    imageFormats: ['jpg', 'png'],
    videoFormats: ['mp4'],
    maxImageSize: 16 * 1024 * 1024,
    maxVideoSize: 16 * 1024 * 1024,
    maxVideoDuration: 3 * 60,
  },
};

/**
 * Returns the platform spec for a given platform.
 */
export function getPlatformSpec(platform: Platform): PlatformSpec {
  const spec = PLATFORM_SPECS[platform];
  if (!spec) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return spec;
}

/**
 * Returns the default dimensions for a given platform and asset type.
 */
export function getDefaultDimensions(platform: Platform, assetType: AssetType): Dimensions {
  const spec = getPlatformSpec(platform);
  const dims = assetType === AssetType.IMAGE ? spec.imageDimensions : spec.videoDimensions;
  return dims[0];
}

/**
 * Validates that an asset meets platform requirements.
 * Returns a list of validation errors (empty if valid).
 */
export function validateAssetForPlatform(
  platform: Platform,
  assetType: AssetType,
  format: string,
  fileSize: number,
  duration?: number,
): string[] {
  const spec = getPlatformSpec(platform);
  const errors: string[] = [];

  if (assetType === AssetType.IMAGE) {
    if (!spec.imageFormats.includes(format)) {
      errors.push(`Format '${format}' not supported. Allowed: ${spec.imageFormats.join(', ')}`);
    }
    if (fileSize > spec.maxImageSize) {
      errors.push(`File size ${fileSize} exceeds max ${spec.maxImageSize} bytes`);
    }
  } else {
    if (!spec.videoFormats.includes(format)) {
      errors.push(`Format '${format}' not supported. Allowed: ${spec.videoFormats.join(', ')}`);
    }
    if (fileSize > spec.maxVideoSize) {
      errors.push(`File size ${fileSize} exceeds max ${spec.maxVideoSize} bytes`);
    }
    if (duration !== undefined && duration > spec.maxVideoDuration) {
      errors.push(`Duration ${duration}s exceeds max ${spec.maxVideoDuration}s`);
    }
  }

  return errors;
}
