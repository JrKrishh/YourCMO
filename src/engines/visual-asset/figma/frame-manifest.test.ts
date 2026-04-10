import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolve } from 'path';
import {
  loadFrameManifest,
  validateFrameManifest,
  FrameManifest,
  FrameManifestEntry,
} from './frame-manifest';

// ─── Unit Tests (Task 1.3) ───────────────────────────────────────────────────

describe('frame-manifest unit tests', () => {
  it('valid entries pass validation', () => {
    const manifest: FrameManifest = {
      figmaFileKey: 'abc123',
      frames: [
        { screenName: 'loyalty-card', figmaNodeId: '1:2' },
        {
          screenName: 'order-ahead',
          playwrightSteps: [
            { action: 'navigate', url: 'https://example.com', screenName: 'order-ahead' },
          ],
        },
        {
          screenName: 'dashboard',
          figmaNodeId: '3:4',
          playwrightSteps: [
            { action: 'screenshot', screenName: 'dashboard' },
          ],
        },
      ],
    };
    expect(() => validateFrameManifest(manifest)).not.toThrow();
  });

  it('entries missing both figmaNodeId and playwrightSteps throw with entry name', () => {
    const manifest: FrameManifest = {
      figmaFileKey: 'abc123',
      frames: [
        { screenName: 'broken-screen' },
      ],
    };
    expect(() => validateFrameManifest(manifest)).toThrow('broken-screen');
    expect(() => validateFrameManifest(manifest)).toThrow(
      'must have at least one of figmaNodeId or playwrightSteps',
    );
  });

  it('loadFrameManifest loads the default manifest with all required screens', () => {
    const manifest = loadFrameManifest(
      resolve(__dirname, '../../../config/figma-frame-manifest.json'),
    );
    const names = manifest.frames.map((f) => f.screenName);
    expect(names).toContain('loyalty-card');
    expect(names).toContain('order-ahead');
    expect(names).toContain('dashboard');
    expect(names).toContain('stamp-collection');
    expect(names).toContain('rewards-screen');
  });

  it('entries with empty screenName throw', () => {
    const manifest: FrameManifest = {
      figmaFileKey: 'abc',
      frames: [{ screenName: '', figmaNodeId: '1:2' }],
    };
    expect(() => validateFrameManifest(manifest)).toThrow('missing a screenName');
  });
});

// ─── Property Test: Property 7 (Task 1.4) ───────────────────────────────────
// **Validates: Requirements 4.2, 4.3, 4.4**

describe('Property 7 — Frame manifest validation', () => {
  // Generator for a non-empty screen name
  const nonEmptyScreenName = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

  // Generator for an empty-ish screen name (empty string or whitespace-only)
  const emptyScreenName = fc.constantFrom('', '   ', '\t', '\n');

  // Generator for a figma node ID (digits:digits pattern)
  const figmaNodeId = fc
    .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 9999 }))
    .map(([a, b]) => `${a}:${b}`);

  // Generator for playwright steps (at least one step)
  const playwrightSteps = fc
    .array(
      fc.record({
        action: fc.constantFrom('navigate' as const, 'click' as const, 'wait' as const, 'screenshot' as const),
        screenName: fc.string({ minLength: 1 }),
      }),
      { minLength: 1, maxLength: 3 },
    );

  it('validation passes when screenName is non-empty AND figmaNodeId is present', () => {
    fc.assert(
      fc.property(nonEmptyScreenName, figmaNodeId, (name, nodeId) => {
        const manifest: FrameManifest = {
          figmaFileKey: 'test',
          frames: [{ screenName: name, figmaNodeId: nodeId }],
        };
        expect(() => validateFrameManifest(manifest)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('validation passes when screenName is non-empty AND playwrightSteps is present', () => {
    fc.assert(
      fc.property(nonEmptyScreenName, playwrightSteps, (name, steps) => {
        const manifest: FrameManifest = {
          figmaFileKey: 'test',
          frames: [{ screenName: name, playwrightSteps: steps }],
        };
        expect(() => validateFrameManifest(manifest)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('validation passes when screenName is non-empty AND both figmaNodeId and playwrightSteps are present', () => {
    fc.assert(
      fc.property(nonEmptyScreenName, figmaNodeId, playwrightSteps, (name, nodeId, steps) => {
        const manifest: FrameManifest = {
          figmaFileKey: 'test',
          frames: [{ screenName: name, figmaNodeId: nodeId, playwrightSteps: steps }],
        };
        expect(() => validateFrameManifest(manifest)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('validation fails when screenName is non-empty but NEITHER figmaNodeId nor playwrightSteps is present', () => {
    fc.assert(
      fc.property(nonEmptyScreenName, (name) => {
        const manifest: FrameManifest = {
          figmaFileKey: 'test',
          frames: [{ screenName: name }],
        };
        expect(() => validateFrameManifest(manifest)).toThrow(name);
      }),
      { numRuns: 100 },
    );
  });

  it('validation fails when screenName is empty regardless of other fields', () => {
    fc.assert(
      fc.property(
        emptyScreenName,
        fc.option(figmaNodeId, { nil: undefined }),
        fc.option(playwrightSteps, { nil: undefined }),
        (name, nodeId, steps) => {
          const entry: FrameManifestEntry = { screenName: name };
          if (nodeId !== undefined) entry.figmaNodeId = nodeId;
          if (steps !== undefined) entry.playwrightSteps = steps;

          const manifest: FrameManifest = {
            figmaFileKey: 'test',
            frames: [entry],
          };
          expect(() => validateFrameManifest(manifest)).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});
