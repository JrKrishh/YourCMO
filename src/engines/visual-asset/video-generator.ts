import { v4 as uuidv4 } from 'uuid';
import { AssetType, Platform } from '../../models/enums';
import { VisualSpecs } from '../../models/common';
import { VisualAsset } from '../../models/visual-asset';
import { createLogger } from '../../utils/logger';

const log = createLogger('VideoGenerator');

/** Parsed video script with scenes */
export interface VideoScene {
  sceneNumber: number;
  description: string;
  duration: number; // seconds
  narration?: string;
}

/** Abstraction for video generation API clients */
export interface IVideoGenerationClient {
  generate(
    prompt: string,
    width: number,
    height: number,
    durationSeconds: number,
  ): Promise<{ url: string; fileSize: number }>;
}

/** Default video generation client (placeholder for real API integration) */
export class DefaultVideoClient implements IVideoGenerationClient {
  async generate(
    prompt: string,
    width: number,
    height: number,
    durationSeconds: number,
  ): Promise<{ url: string; fileSize: number }> {
    log.info({ prompt: prompt.substring(0, 80), width, height, durationSeconds }, 'Calling video generation API');
    // In production, this would call a real video generation API
    throw new Error('Video generation API not configured. Provide a custom IVideoGenerationClient.');
  }
}

/**
 * Parses a text script into individual scenes.
 * Expected format: lines starting with "Scene N:" followed by description.
 * Optional "Narration:" lines within a scene.
 * Optional "Duration:" lines (in seconds).
 */
export function parseVideoScript(script: string): VideoScene[] {
  if (!script || script.trim().length === 0) {
    return [];
  }

  const scenes: VideoScene[] = [];
  const lines = script.split('\n').map((l) => l.trim()).filter(Boolean);
  let current: Partial<VideoScene> | null = null;

  for (const line of lines) {
    const sceneMatch = line.match(/^Scene\s+(\d+)\s*:\s*(.*)$/i);
    if (sceneMatch) {
      if (current && current.sceneNumber !== undefined) {
        scenes.push({
          sceneNumber: current.sceneNumber,
          description: current.description ?? '',
          duration: current.duration ?? 5,
          narration: current.narration,
        });
      }
      current = {
        sceneNumber: parseInt(sceneMatch[1], 10),
        description: sceneMatch[2],
        duration: 5,
      };
      continue;
    }

    if (current) {
      const narrationMatch = line.match(/^Narration\s*:\s*(.*)$/i);
      if (narrationMatch) {
        current.narration = narrationMatch[1];
        continue;
      }
      const durationMatch = line.match(/^Duration\s*:\s*(\d+)\s*s?$/i);
      if (durationMatch) {
        current.duration = parseInt(durationMatch[1], 10);
        continue;
      }
      // Append to description
      current.description = (current.description ?? '') + ' ' + line;
    }
  }

  // Push last scene
  if (current && current.sceneNumber !== undefined) {
    scenes.push({
      sceneNumber: current.sceneNumber,
      description: current.description ?? '',
      duration: current.duration ?? 5,
      narration: current.narration,
    });
  }

  return scenes;
}

/**
 * Estimates video file size based on dimensions, duration, and a bitrate heuristic.
 */
export function estimateVideoFileSize(
  width: number,
  height: number,
  durationSeconds: number,
): number {
  // Rough estimate: ~2 Mbps for 1080p, scaled by resolution
  const pixels = width * height;
  const referencePx = 1920 * 1080;
  const bitrate = 2_000_000 * (pixels / referencePx);
  return Math.round((bitrate * durationSeconds) / 8);
}

/**
 * Video generator — wraps a video generation client and produces VisualAsset objects.
 */
export class VideoGenerator {
  constructor(private readonly client: IVideoGenerationClient = new DefaultVideoClient()) {}

  async generateVideo(
    prompt: string,
    specs: VisualSpecs,
    platform: Platform = Platform.INSTAGRAM,
  ): Promise<VisualAsset> {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Video prompt must not be empty');
    }
    if (specs.type !== 'VIDEO') {
      throw new Error('VisualSpecs type must be VIDEO for video generation');
    }

    const duration = specs.duration ?? 15;

    log.info({ prompt: prompt.substring(0, 80), platform, duration }, 'Generating video');

    const result = await this.client.generate(
      prompt,
      specs.dimensions.width,
      specs.dimensions.height,
      duration,
    );

    const fileSize =
      result.fileSize || estimateVideoFileSize(specs.dimensions.width, specs.dimensions.height, duration);

    const asset: VisualAsset = {
      assetId: uuidv4(),
      assetType: AssetType.VIDEO,
      url: result.url,
      localPath: '',
      dimensions: { ...specs.dimensions },
      format: specs.format || 'mp4',
      fileSize,
      duration,
      platform,
      metadata: {
        tags: [],
        createdAt: new Date(),
      },
      brandingApplied: false,
    };

    log.info({ assetId: asset.assetId }, 'Video generated');
    return asset;
  }
}
