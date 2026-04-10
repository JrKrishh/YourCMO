import { AssetType, Platform } from './enums';
import { AssetMetadata, Dimensions } from './common';

/**
 * Model 4: VisualAsset
 * Image/video asset with type, URL, dimensions, format, file size,
 * duration, platform, metadata, branding status.
 */
export interface VisualAsset {
  assetId: string;
  assetType: AssetType;
  url: string;
  localPath: string;
  dimensions: Dimensions;
  format: string;
  fileSize: number;
  duration: number;
  platform: Platform;
  metadata: AssetMetadata;
  brandingApplied: boolean;
}
