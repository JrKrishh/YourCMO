/**
 * Tests for ImageCompositor
 *
 * - Property 9: Prompt enhancement contains brand DNA and phone mockup instructions
 * - Property 10: Output tagging with source:figma-ui and frame:{name}
 * - Unit test: Fallback to text-only generation when reference image load fails
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ImageCompositor } from './image-compositor';
import { buildImagePromptEnhancement } from '../../../config/rewoz-brand-dna';
import { IImageGenerationClient } from '../image-generator';
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

/** Default specs for tests */
const defaultSpecs: VisualSpecs = {
  type: 'IMAGE',
  dimensions: { width: 1080, height: 1080 },
  format: 'png',
  maxFileSize: 5_000_000,
};

/**
 * Property 9: Image compositor prompt enhancement
 *
 * **Validates: Requirements 5.4**
 *
 * For any prompt and frame names, the enhanced prompt contains brand DNA rules
 * and phone mockup instructions.
 */
describe('Property 9: Image compositor prompt enhancement', () => {
  it('enhanced prompt contains brand DNA rules and phone mockup instructions for any prompt and frame names', () => {
    const compositor = new ImageCompositor();
    const brandDNA = buildImagePromptEnhancement();

    fc.assert(
      fc.property(promptArb, frameNamesArb, (prompt, frameNames) => {
        const enhanced = compositor.enhancePrompt(prompt, frameNames);

        // Must contain the original prompt
        expect(enhanced).toContain(prompt);

        // Must contain brand DNA enhancement content
        expect(enhanced).toContain('BRAND IMAGE REQUIREMENTS');
        expect(enhanced).toContain(brandDNA);

        // Must contain phone mockup placement instructions
        expect(enhanced).toContain('phone mockup');
        expect(enhanced).toContain('Place the app UI on a phone mockup in the scene');
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Property 10: Image compositor output tagging
 *
 * **Validates: Requirements 5.5, 7.5**
 *
 * For any successful generation with frame names, metadata.tags contains
 * "source:figma-ui" and "frame:{name}" for each frame.
 */
describe('Property 10: Image compositor output tagging', () => {
  it('output tags contain source:figma-ui and frame:{name} for each frame name', async () => {
    const mockClient: IImageGenerationClient = {
      generate: async () => ({ url: 'https://fake.com/img.png', fileSize: 1234 }),
    };

    const compositor = new ImageCompositor({ imageClient: mockClient });

    await fc.assert(
      fc.asyncProperty(promptArb, frameNamesArb, async (prompt, frameNames) => {
        const asset = await compositor.generateWithReferences(prompt, defaultSpecs, frameNames);

        const tags = asset.metadata.tags ?? [];

        // Must contain source tag
        expect(tags).toContain('source:figma-ui');

        // Must contain a frame tag for each frame name
        for (const name of frameNames) {
          expect(tags).toContain(`frame:${name}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Unit test: Fallback to text-only generation when reference image load fails
 *
 * When the UIFrameStore.get() throws an error, the compositor should still
 * generate an image (text-only, no reference) and return a valid VisualAsset.
 */
describe('ImageCompositor fallback behavior', () => {
  let capturedRefUrl: string | undefined;

  const mockClient: IImageGenerationClient = {
    generate: async (_prompt, _w, _h, refUrl) => {
      capturedRefUrl = refUrl;
      return { url: 'https://fake.com/fallback.png', fileSize: 500 };
    },
  };

  beforeEach(() => {
    capturedRefUrl = undefined;
  });

  it('falls back to text-only generation when frame store get() throws', async () => {
    const failingStore = {
      get: vi.fn().mockRejectedValue(new Error('disk read error')),
    } as unknown as UIFrameStore;

    const compositor = new ImageCompositor({
      imageClient: mockClient,
      frameStore: failingStore,
    });

    const asset = await compositor.generateWithReferences(
      'A cafe scene',
      defaultSpecs,
      ['loyalty-card'],
      Platform.INSTAGRAM,
    );

    // Should still produce a valid asset
    expect(asset).toBeDefined();
    expect(asset.url).toBe('https://fake.com/fallback.png');
    expect(asset.assetType).toBe('IMAGE');

    // Reference URL should NOT have been passed (fallback to text-only)
    expect(capturedRefUrl).toBeUndefined();

    // Tags should still be present
    expect(asset.metadata.tags).toContain('source:figma-ui');
    expect(asset.metadata.tags).toContain('frame:loyalty-card');
  });

  it('falls back to text-only generation when frame store returns null', async () => {
    const emptyStore = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as UIFrameStore;

    const compositor = new ImageCompositor({
      imageClient: mockClient,
      frameStore: emptyStore,
    });

    const asset = await compositor.generateWithReferences(
      'A cafe scene',
      defaultSpecs,
      ['missing-frame'],
      Platform.INSTAGRAM,
    );

    expect(asset).toBeDefined();
    expect(asset.url).toBe('https://fake.com/fallback.png');
    expect(capturedRefUrl).toBeUndefined();
  });
});
