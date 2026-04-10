import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { extractFrames, ExtractFramesOptions } from '../../../../scripts/extract-figma-frames';
import type { FrameManifest, FrameManifestEntry, NavigationStep } from './frame-manifest';
import type { FigmaApiClient, FigmaExportResult } from './figma-api-client';
import type { PlaywrightCapturer, CaptureResult } from './playwright-capturer';
import type { UIFrameStore } from './ui-frame-store';

// ---------------------------------------------------------------------------
// Helpers — lightweight mock factories
// ---------------------------------------------------------------------------

function createMockStore(): UIFrameStore {
  return {
    save: vi.fn().mockResolvedValue({
      frameName: 'mock',
      source: 'figma-api',
      sourceId: '0:0',
      dimensions: { width: 390, height: 844 },
      extractedAt: new Date(),
      filePath: '/tmp/mock.png',
      format: 'png',
    }),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    invalidate: vi.fn().mockResolvedValue(undefined),
    isCached: vi.fn().mockResolvedValue(false),
  } as unknown as UIFrameStore;
}

function createMockFigmaClient(): FigmaApiClient & { exportFrames: ReturnType<typeof vi.fn> } {
  return {
    exportFrames: vi.fn().mockImplementation(async (nodeIds: string[]) => {
      return nodeIds.map((id) => ({
        nodeId: id,
        name: `node-${id}`,
        imageBuffer: Buffer.from('png-data'),
        dimensions: { width: 390, height: 844 },
        format: 'png' as const,
      }));
    }),
    getFileNodes: vi.fn().mockResolvedValue({}),
  } as unknown as FigmaApiClient & { exportFrames: ReturnType<typeof vi.fn> };
}

function createMockPlaywright(): PlaywrightCapturer & { capture: ReturnType<typeof vi.fn> } {
  return {
    capture: vi.fn().mockImplementation(async (steps: NavigationStep[]) => {
      const screenshots = steps.filter((s) => s.action === 'screenshot');
      return screenshots.map((s) => ({
        screenName: s.screenName,
        imageBuffer: Buffer.from('pw-data'),
        dimensions: { width: 390, height: 844 },
      }));
    }),
  } as unknown as PlaywrightCapturer & { capture: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const screenNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/).filter((s) => s.length > 0);
const nodeIdArb = fc.tuple(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 9999 }))
  .map(([a, b]) => `${a}:${b}`);

const playwrightStepsArb: fc.Arbitrary<NavigationStep[]> = fc.array(
  fc.record({
    action: fc.constant('screenshot' as const),
    screenName: screenNameArb,
    url: fc.constant('https://example.com'),
  }),
  { minLength: 1, maxLength: 3 },
);

/** Generate a manifest entry that has figmaNodeId only */
const figmaOnlyEntryArb: fc.Arbitrary<FrameManifestEntry> = fc.record({
  screenName: screenNameArb,
  figmaNodeId: nodeIdArb,
});

/** Generate a manifest entry that has playwrightSteps only */
const playwrightOnlyEntryArb: fc.Arbitrary<FrameManifestEntry> = fc.record({
  screenName: screenNameArb,
  playwrightSteps: playwrightStepsArb,
});

/** Generate a manifest entry that has both */
const bothEntryArb: fc.Arbitrary<FrameManifestEntry> = fc.record({
  screenName: screenNameArb,
  figmaNodeId: nodeIdArb,
  playwrightSteps: playwrightStepsArb,
});

/** Generate any valid manifest entry */
const anyEntryArb: fc.Arbitrary<FrameManifestEntry> = fc.oneof(
  figmaOnlyEntryArb,
  playwrightOnlyEntryArb,
  bothEntryArb,
);

// ---------------------------------------------------------------------------
// Property 16 — Extraction routing by manifest entry type
// ---------------------------------------------------------------------------

describe('Property 16: Extraction routing by manifest entry type', () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any manifest entry, Figma API is used for entries with figmaNodeId,
   * Playwright for entries with playwrightSteps. If entry has both, Figma API
   * is preferred.
   */
  it('routes figmaNodeId entries to FigmaApiClient', async () => {
    await fc.assert(
      fc.asyncProperty(figmaOnlyEntryArb, async (entry) => {
        const store = createMockStore();
        const figmaClient = createMockFigmaClient();
        const pwCapturer = createMockPlaywright();

        const manifest: FrameManifest = {
          figmaFileKey: 'test-key',
          frames: [entry],
        };

        await extractFrames(manifest, {
          figmaAccessToken: 'tok',
          store,
          figmaClient: figmaClient as unknown as FigmaApiClient,
          playwrightCapturer: pwCapturer as unknown as PlaywrightCapturer,
        });

        expect(figmaClient.exportFrames).toHaveBeenCalledWith([entry.figmaNodeId]);
        expect(pwCapturer.capture).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('routes playwrightSteps-only entries to PlaywrightCapturer', async () => {
    await fc.assert(
      fc.asyncProperty(playwrightOnlyEntryArb, async (entry) => {
        const store = createMockStore();
        const figmaClient = createMockFigmaClient();
        const pwCapturer = createMockPlaywright();

        const manifest: FrameManifest = {
          figmaFileKey: 'test-key',
          frames: [entry],
        };

        await extractFrames(manifest, {
          figmaAccessToken: 'tok',
          store,
          figmaClient: figmaClient as unknown as FigmaApiClient,
          playwrightCapturer: pwCapturer as unknown as PlaywrightCapturer,
        });

        expect(pwCapturer.capture).toHaveBeenCalledWith(entry.playwrightSteps);
        expect(figmaClient.exportFrames).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('prefers FigmaApiClient when entry has both figmaNodeId and playwrightSteps', async () => {
    await fc.assert(
      fc.asyncProperty(bothEntryArb, async (entry) => {
        const store = createMockStore();
        const figmaClient = createMockFigmaClient();
        const pwCapturer = createMockPlaywright();

        const manifest: FrameManifest = {
          figmaFileKey: 'test-key',
          frames: [entry],
        };

        await extractFrames(manifest, {
          figmaAccessToken: 'tok',
          store,
          figmaClient: figmaClient as unknown as FigmaApiClient,
          playwrightCapturer: pwCapturer as unknown as PlaywrightCapturer,
        });

        expect(figmaClient.exportFrames).toHaveBeenCalledWith([entry.figmaNodeId]);
        expect(pwCapturer.capture).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit test — missing FIGMA_ACCESS_TOKEN behaviour
// ---------------------------------------------------------------------------

describe('Missing FIGMA_ACCESS_TOKEN behaviour', () => {
  it('skips Figma API entries, logs warning, and continues with Playwright entries', async () => {
    const store = createMockStore();
    const pwCapturer = createMockPlaywright();

    const manifest: FrameManifest = {
      figmaFileKey: 'test-key',
      frames: [
        { screenName: 'figma-screen', figmaNodeId: '1:2' },
        {
          screenName: 'pw-screen',
          playwrightSteps: [
            { action: 'screenshot', screenName: 'pw-screen', url: 'https://example.com' },
          ],
        },
      ],
    };

    // No figmaAccessToken and no env var → Figma entries should be skipped
    const result = await extractFrames(manifest, {
      figmaAccessToken: undefined,
      store,
      playwrightCapturer: pwCapturer as unknown as PlaywrightCapturer,
    });

    // Figma entry was skipped
    expect(result.skippedFigmaNoToken).toBe(1);

    // Playwright entry was still processed
    expect(pwCapturer.capture).toHaveBeenCalledTimes(1);
    expect(result.extracted).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('processes all entries when FIGMA_ACCESS_TOKEN is provided', async () => {
    const store = createMockStore();
    const figmaClient = createMockFigmaClient();
    const pwCapturer = createMockPlaywright();

    const manifest: FrameManifest = {
      figmaFileKey: 'test-key',
      frames: [
        { screenName: 'figma-screen', figmaNodeId: '1:2' },
        {
          screenName: 'pw-screen',
          playwrightSteps: [
            { action: 'screenshot', screenName: 'pw-screen', url: 'https://example.com' },
          ],
        },
      ],
    };

    const result = await extractFrames(manifest, {
      figmaAccessToken: 'my-token',
      store,
      figmaClient: figmaClient as unknown as FigmaApiClient,
      playwrightCapturer: pwCapturer as unknown as PlaywrightCapturer,
    });

    expect(result.skippedFigmaNoToken).toBe(0);
    expect(figmaClient.exportFrames).toHaveBeenCalledTimes(1);
    expect(pwCapturer.capture).toHaveBeenCalledTimes(1);
    expect(result.extracted).toBe(2);
  });
});
