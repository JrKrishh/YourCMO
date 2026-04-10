import { mkdir, readFile, writeFile, unlink, readdir } from 'fs/promises';
import { join } from 'path';
import { Dimensions } from '../../../models/common';

/** Metadata stored alongside each cached frame */
export interface FrameMetadata {
  frameName: string;
  source: 'figma-api' | 'playwright';
  sourceId: string;
  dimensions: Dimensions;
  extractedAt: Date;
  filePath: string;
  format: 'png' | 'svg';
}

/** Configuration for the UIFrameStore */
export interface UIFrameStoreConfig {
  baseDir?: string;
  ttlMs?: number;
}

const DEFAULT_BASE_DIR = 'output/ui-frames/';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Local file-system cache for extracted UI frames.
 * Stores PNG/SVG files with JSON metadata sidecars.
 */
export class UIFrameStore {
  private readonly baseDir: string;
  private readonly ttlMs: number;

  constructor(config?: UIFrameStoreConfig) {
    this.baseDir = config?.baseDir ?? DEFAULT_BASE_DIR;
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Save a frame image and its metadata to the store */
  async save(
    frameName: string,
    imageBuffer: Buffer,
    metadata: Omit<FrameMetadata, 'filePath' | 'extractedAt'>,
  ): Promise<FrameMetadata> {
    await mkdir(this.baseDir, { recursive: true });

    const ext = metadata.format === 'svg' ? 'svg' : 'png';
    const filePath = join(this.baseDir, `${frameName}.${ext}`);
    const metaPath = join(this.baseDir, `${frameName}.meta.json`);

    const fullMetadata: FrameMetadata = {
      ...metadata,
      filePath,
      extractedAt: new Date(),
    };

    await writeFile(filePath, imageBuffer);
    await writeFile(metaPath, JSON.stringify(fullMetadata, null, 2), 'utf-8');

    return fullMetadata;
  }

  /** Get a cached frame. Returns null if missing or expired. */
  async get(frameName: string): Promise<{ buffer: Buffer; metadata: FrameMetadata } | null> {
    try {
      const metaPath = join(this.baseDir, `${frameName}.meta.json`);
      const raw = await readFile(metaPath, 'utf-8');
      const metadata: FrameMetadata = JSON.parse(raw);
      metadata.extractedAt = new Date(metadata.extractedAt);

      if (Date.now() - metadata.extractedAt.getTime() >= this.ttlMs) {
        return null;
      }

      const buffer = await readFile(metadata.filePath);
      return { buffer, metadata };
    } catch {
      return null;
    }
  }

  /** List all cached frame metadata by reading .meta.json files */
  async list(): Promise<FrameMetadata[]> {
    try {
      const files = await readdir(this.baseDir);
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'));
      const results: FrameMetadata[] = [];

      for (const file of metaFiles) {
        try {
          const raw = await readFile(join(this.baseDir, file), 'utf-8');
          const metadata: FrameMetadata = JSON.parse(raw);
          metadata.extractedAt = new Date(metadata.extractedAt);
          results.push(metadata);
        } catch {
          // skip corrupt metadata files
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /** Invalidate (delete) a cached frame and its metadata */
  async invalidate(frameName: string): Promise<void> {
    const metaPath = join(this.baseDir, `${frameName}.meta.json`);

    try {
      const raw = await readFile(metaPath, 'utf-8');
      const metadata: FrameMetadata = JSON.parse(raw);
      await unlink(metadata.filePath).catch(() => {});
    } catch {
      // metadata file doesn't exist, try common extensions
      await unlink(join(this.baseDir, `${frameName}.png`)).catch(() => {});
      await unlink(join(this.baseDir, `${frameName}.svg`)).catch(() => {});
    }

    await unlink(metaPath).catch(() => {});
  }

  /** Check if a frame exists in the store and is within TTL */
  async isCached(frameName: string): Promise<boolean> {
    try {
      const metaPath = join(this.baseDir, `${frameName}.meta.json`);
      const raw = await readFile(metaPath, 'utf-8');
      const metadata: FrameMetadata = JSON.parse(raw);
      const extractedAt = new Date(metadata.extractedAt);
      return Date.now() - extractedAt.getTime() < this.ttlMs;
    } catch {
      return false;
    }
  }
}
