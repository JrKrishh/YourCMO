/**
 * Tests for VideoAdComposer
 *
 * - Property 11: Starting frame passed as referenceImageUrl to KLING video client
 * - Property 12: Transition instructions for 2+ frames
 * - Property 13: Output tagging with source:figma-ui and frame:{name}, valid URL/duration/dimensions
 * - Property 14: Duration and aspect ratio configuration with defaults
 * - Unit test: Single-image camera movement vs multi-image transitions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { VideoAdComposer } from './video-ad-composer';
import { KlingVideoClient } from '../kling-client';
import { UIFrameStore } from './ui-frame-store';
import { Platform } from '../../../models/enums';
import { VisualSpecs } from '../../../models/common';

// Suppress logger output in tests
vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

/** Frame name generator: non-empty alphanumeric strings with hyphens */
const frameNameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,29}$/)
  .filter((s) => s.length > 0);

/** Non-empty prompt generator */
const promptArb = fc.string({ minLength: 1, maxLength: 200 });

/** Array of 1-5 frame names */
const frameNamesArb = fc.array(frameNameArb, { minLength: 1, maxLength: 5 });

/** Array of 2-5 frame names (multi-frame) */
const multiFrameNamesArb = fc.array(frameNameArb, { minLength: 2, maxLength: 5 });

/** Default specs for tests */
const defaultSpecs: VisualSpecs = {
  type: 'VIDEO',
  dimensions: { width: 1080, height: 1920 },
  format: 'mp4',
  maxFileSize: 50_000_000,
  duration: 10,
};

/** Helper to create a mock video client that captures calls */
function createMockVideoClient() {
  let capturedPrompt = '';
  let capturedDuration: number | undefined;
  let capturedRefUrl: string | undefined;

  const client = {
    generateVideo: vi.fn(async (prompt: string, duration?: number, referenceImageUrl?: string) => {
      capturedPrompt = prompt;
      capturedDuration = duration;
      capturedRefUrl = referenceImageUrl;
      return { url: 'https://fake.com/video.mp4', fileSize: 5000 };
    }),
  } as unknown as KlingVideoClient;

  return {
    client,
    getCapturedPrompt: () => capturedPrompt,
    getCapturedDuration: () => capturedDuration,
    getCapturedRefUrl: () => capturedRefUrl,
  };
}

/** Helper to create a mock frame store that returns a buffer for any frame */
function createMockFrameStore(frameNames: string[]) {
  const store = {
    get: vi.fn(async (name: string) => {
      if (frameNames.includes(name)) {
        return {
          buffer: Buffer.from(`fake-image-data-for-${name}`),
          metadata: {
            frameName: name,
            source: 'figma-api' as const,
            sourceId: '123:456',
            dimensions: { width: 390, height: 844 },
            extractedAt: new Date(),
            filePath: `output/ui-frames/${name}.png`,
            format: 'png' as const,
          },
        };
      }
      return null;
    }),
  } as unknown as UIFrameStore;

  return store;
}


/**
 * Property 11: Video ad composer starting frame
 *
 * **Validates: Requirements 6.2**
 *
 * For any sequence with at least one frame, the first frame is passed as
 * referenceImageUrl to the KLING video client.
 */
describe('Property 11: Video ad composer starting frame', () => {
  it('first frame is passed as referenceImageUrl to KLING video client', async () => {
    await fc.assert(
      fc.asyncProperty(promptArb, frameNamesArb, async (prompt, frameNames) => {
        const mock = createMockVideoClient();
        const store = createMockFrameStore(frameNames);

        const composer = new VideoAdComposer({
          videoClient: mock.client,
          frameStore: store,
        });

        await composer.generateVideoAd(prompt, defaultSpecs, frameNames);

        // The store should have been called with the first frame name
        expect(store.get).toHaveBeenCalledWith(frameNames[0]);

        // The reference URL should be a base64 data URL containing the first frame's data
        const refUrl = mock.getCapturedRefUrl();
        expect(refUrl).toBeDefined();
        expect(refUrl).toContain('data:image/png;base64,');

        // Decode and verify it contains the first frame's data
        const base64Part = refUrl!.split(',')[1];
        const decoded = Buffer.from(base64Part, 'base64').toString();
        expect(decoded).toContain(frameNames[0]);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 12: Video ad composer transition instructions
 *
 * **Validates: Requirements 6.3**
 *
 * For any prompt with 2+ frames, the enhanced prompt contains transition instructions.
 */
describe('Property 12: Video ad composer transition instructions', () => {
  it('enhanced prompt contains transition instructions for 2+ frames', () => {
    const composer = new VideoAdComposer();

    fc.assert(
      fc.property(promptArb, multiFrameNamesArb, (prompt, frameNames) => {
        const enhanced = composer.enhanceVideoPrompt(prompt, frameNames);

        // Must contain the original prompt
        expect(enhanced).toContain(prompt);

        // Must contain transition-related keywords
        expect(enhanced.toLowerCase()).toContain('transition');
        expect(enhanced.toLowerCase()).toContain('swipe');
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 13: Video ad composer output tagging
 *
 * **Validates: Requirements 6.4**
 *
 * For any successful video generation with frame names, metadata.tags contains
 * "source:figma-ui" and "frame:{name}" for each frame, and asset has valid URL,
 * duration > 0, and non-zero dimensions.
 */
describe('Property 13: Video ad composer output tagging', () => {
  it('output has correct tags, valid URL, positive duration, and non-zero dimensions', async () => {
    await fc.assert(
      fc.asyncProperty(promptArb, frameNamesArb, async (prompt, frameNames) => {
        const mock = createMockVideoClient();
        const store = createMockFrameStore(frameNames);

        const composer = new VideoAdComposer({
          videoClient: mock.client,
          frameStore: store,
        });

        const asset = await composer.generateVideoAd(prompt, defaultSpecs, frameNames);

        const tags = asset.metadata.tags ?? [];

        // Must contain source tag
        expect(tags).toContain('source:figma-ui');

        // Must contain a frame tag for each frame name
        for (const name of frameNames) {
          expect(tags).toContain(`frame:${name}`);
        }

        // Must have a valid URL
        expect(asset.url).toBeTruthy();
        expect(typeof asset.url).toBe('string');

        // Must have positive duration
        expect(asset.duration).toBeGreaterThan(0);

        // Must have non-zero dimensions
        expect(asset.dimensions.width).toBeGreaterThan(0);
        expect(asset.dimensions.height).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 14: Video ad composer duration and aspect ratio configuration
 *
 * **Validates: Requirements 6.5**
 *
 * For any valid duration and aspect ratio, the output VisualAsset reflects those values.
 * Defaults are 10s and 9:16 (1080x1920).
 */
describe('Property 14: Video ad composer duration and aspect ratio configuration', () => {
  it('output reflects configured duration and dimensions', async () => {
    const durationArb = fc.integer({ min: 1, max: 60 });
    const widthArb = fc.integer({ min: 100, max: 4000 });
    const heightArb = fc.integer({ min: 100, max: 4000 });

    await fc.assert(
      fc.asyncProperty(
        promptArb,
        frameNamesArb,
        durationArb,
        widthArb,
        heightArb,
        async (prompt, frameNames, duration, width, height) => {
          const mock = createMockVideoClient();
          const store = createMockFrameStore(frameNames);

          const composer = new VideoAdComposer({
            videoClient: mock.client,
            frameStore: store,
          });

          const specs: VisualSpecs = {
            type: 'VIDEO',
            dimensions: { width, height },
            format: 'mp4',
            maxFileSize: 50_000_000,
            duration,
          };

          const asset = await composer.generateVideoAd(prompt, specs, frameNames);

          expect(asset.duration).toBe(duration);
          expect(asset.dimensions.width).toBe(width);
          expect(asset.dimensions.height).toBe(height);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('uses default duration (10s) and 9:16 aspect ratio (1080x1920) when not specified', async () => {
    const mock = createMockVideoClient();
    const store = createMockFrameStore(['loyalty-card']);

    const composer = new VideoAdComposer({
      videoClient: mock.client,
      frameStore: store,
    });

    const specsNoDefaults: VisualSpecs = {
      type: 'VIDEO',
      dimensions: { width: 1080, height: 1920 },
      format: 'mp4',
      maxFileSize: 50_000_000,
      // no duration — should default to 10
    };

    const asset = await composer.generateVideoAd('A cafe ad', specsNoDefaults, ['loyalty-card']);

    expect(asset.duration).toBe(10);
    expect(asset.dimensions.width).toBe(1080);
    expect(asset.dimensions.height).toBe(1920);
  });
});

/**
 * Unit test: Single-image camera movement vs multi-image transitions
 *
 * Verifies that:
 * - Single frame → camera movement instructions (orbit around phone mockup)
 * - Multiple frames → transition instructions (swipe, zoom between screens)
 */
describe('VideoAdComposer single vs multi-frame behavior', () => {
  const composer = new VideoAdComposer();

  it('single frame produces camera movement instructions', () => {
    const enhanced = composer.enhanceVideoPrompt('Cafe ad', ['loyalty-card']);

    expect(enhanced).toContain('Camera movement');
    expect(enhanced).toContain('orbit');
    expect(enhanced).toContain('loyalty-card');
    // Should NOT contain transition instructions
    expect(enhanced).not.toContain('Transition instructions');
  });

  it('multiple frames produce transition instructions', () => {
    const enhanced = composer.enhanceVideoPrompt('Cafe ad', ['loyalty-card', 'order-ahead', 'dashboard']);

    expect(enhanced).toContain('Transition instructions');
    expect(enhanced).toContain('swipe');
    expect(enhanced).toContain('loyalty-card');
    expect(enhanced).toContain('order-ahead');
    expect(enhanced).toContain('dashboard');
    // Should NOT contain camera movement instructions
    expect(enhanced).not.toContain('Camera movement');
    expect(enhanced).not.toContain('orbit');
  });

  it('two frames produce transition between them', () => {
    const enhanced = composer.enhanceVideoPrompt('Cafe ad', ['loyalty-card', 'order-ahead']);

    expect(enhanced).toContain('Transition instructions');
    expect(enhanced).toContain('swipe from "loyalty-card" to "order-ahead"');
  });

  it('single frame generates video with camera movement via client', async () => {
    const mock = createMockVideoClient();
    const store = createMockFrameStore(['loyalty-card']);

    const composerWithClient = new VideoAdComposer({
      videoClient: mock.client,
      frameStore: store,
    });

    const asset = await composerWithClient.generateVideoAd('Cafe ad', defaultSpecs, ['loyalty-card']);

    expect(asset.assetType).toBe('VIDEO');
    expect(mock.getCapturedPrompt()).toContain('Camera movement');
    expect(mock.getCapturedPrompt()).toContain('orbit');
  });

  it('multiple frames generate video with transition instructions via client', async () => {
    const mock = createMockVideoClient();
    const store = createMockFrameStore(['loyalty-card', 'order-ahead']);

    const composerWithClient = new VideoAdComposer({
      videoClient: mock.client,
      frameStore: store,
    });

    const asset = await composerWithClient.generateVideoAd('Cafe ad', defaultSpecs, [
      'loyalty-card',
      'order-ahead',
    ]);

    expect(asset.assetType).toBe('VIDEO');
    expect(mock.getCapturedPrompt()).toContain('Transition instructions');
    expect(mock.getCapturedPrompt()).toContain('swipe');
  });
});
