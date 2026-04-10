#!/usr/bin/env npx tsx
/**
 * Standalone extraction script that reads the frame manifest,
 * routes entries to FigmaApiClient or PlaywrightCapturer,
 * stores results in UIFrameStore, and logs a summary.
 *
 * Usage: npx tsx scripts/extract-figma-frames.ts
 */
import 'dotenv/config';
import { loadFrameManifest, FrameManifest, FrameManifestEntry } from '../src/engines/visual-asset/figma/frame-manifest';
import { FigmaApiClient } from '../src/engines/visual-asset/figma/figma-api-client';
import { PlaywrightCapturer } from '../src/engines/visual-asset/figma/playwright-capturer';
import { UIFrameStore } from '../src/engines/visual-asset/figma/ui-frame-store';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('extract-figma-frames');

export interface ExtractFramesOptions {
  figmaAccessToken?: string;
  store?: UIFrameStore;
  figmaClient?: FigmaApiClient;
  playwrightCapturer?: PlaywrightCapturer;
}

export interface ExtractFramesResult {
  extracted: number;
  failures: { screenName: string; error: string }[];
  elapsedMs: number;
  skippedFigmaNoToken: number;
}

/**
 * Core extraction logic — exported so it can be tested.
 *
 * Routes each manifest entry to FigmaApiClient (if figmaNodeId present)
 * or PlaywrightCapturer (if playwrightSteps present).
 * If an entry has both, FigmaApiClient is preferred.
 */
export async function extractFrames(
  manifest: FrameManifest,
  options?: ExtractFramesOptions,
): Promise<ExtractFramesResult> {
  const start = Date.now();
  const token = options?.figmaAccessToken ?? process.env.FIGMA_ACCESS_TOKEN;
  const store = options?.store ?? new UIFrameStore();
  const capturer = options?.playwrightCapturer ?? new PlaywrightCapturer();

  let figmaClient: FigmaApiClient | null = null;
  if (token) {
    figmaClient = options?.figmaClient ?? new FigmaApiClient({
      accessToken: token,
      fileKey: manifest.figmaFileKey,
    });
  }

  let extracted = 0;
  let skippedFigmaNoToken = 0;
  const failures: { screenName: string; error: string }[] = [];

  // Categorise entries
  const figmaEntries: FrameManifestEntry[] = [];
  const playwrightEntries: FrameManifestEntry[] = [];

  for (const entry of manifest.frames) {
    if (entry.figmaNodeId) {
      // Prefer Figma API when entry has figmaNodeId (even if it also has playwrightSteps)
      figmaEntries.push(entry);
    } else if (entry.playwrightSteps && entry.playwrightSteps.length > 0) {
      playwrightEntries.push(entry);
    }
  }

  // --- Figma API entries ---
  if (figmaEntries.length > 0 && !figmaClient) {
    logger.warn(
      `FIGMA_ACCESS_TOKEN is not set — skipping ${figmaEntries.length} Figma API entries`,
    );
    skippedFigmaNoToken = figmaEntries.length;
  } else if (figmaEntries.length > 0 && figmaClient) {
    for (const entry of figmaEntries) {
      try {
        const results = await figmaClient.exportFrames([entry.figmaNodeId!]);
        for (const result of results) {
          await store.save(entry.screenName, result.imageBuffer, {
            frameName: entry.screenName,
            source: 'figma-api',
            sourceId: result.nodeId,
            dimensions: result.dimensions,
            format: result.format,
          });
          extracted++;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ screenName: entry.screenName, error: message });
      }
    }
  }

  // --- Playwright entries ---
  for (const entry of playwrightEntries) {
    try {
      const results = await capturer.capture(entry.playwrightSteps!);
      for (const result of results) {
        await store.save(result.screenName, result.imageBuffer, {
          frameName: result.screenName,
          source: 'playwright',
          sourceId: entry.playwrightSteps![0]?.url ?? 'unknown',
          dimensions: result.dimensions,
          format: 'png',
        });
        extracted++;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ screenName: entry.screenName, error: message });
    }
  }

  const elapsedMs = Date.now() - start;
  return { extracted, failures, elapsedMs, skippedFigmaNoToken };
}

// --- CLI entry point ---
async function main() {
  logger.info('Starting frame extraction…');
  const manifest = loadFrameManifest();
  const result = await extractFrames(manifest);

  logger.info(
    {
      extracted: result.extracted,
      failures: result.failures.length,
      skippedFigmaNoToken: result.skippedFigmaNoToken,
      elapsedMs: result.elapsedMs,
    },
    `Extraction complete: ${result.extracted} frames extracted, ${result.failures.length} failures, ${result.elapsedMs}ms elapsed`,
  );

  if (result.failures.length > 0) {
    for (const f of result.failures) {
      logger.error({ screenName: f.screenName, error: f.error }, 'Frame extraction failed');
    }
  }
}

main().catch((err) => {
  logger.error(err, 'Fatal error during frame extraction');
  process.exit(1);
});
