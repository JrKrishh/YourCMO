import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { UIFrameStore, FrameMetadata } from './ui-frame-store';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Frame name: alphanumeric with hyphens, 1-30 chars */
const frameNameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,29}$/)
  .filter((s) => s.length > 0 && !s.endsWith('-'));

/** Small image buffer (100-500 bytes) */
const imageBufferArb = fc
  .uint8Array({ minLength: 100, maxLength: 500 })
  .map((arr) => Buffer.from(arr));

/** Dimensions with positive width/height */
const dimensionsArb = fc.record({
  width: fc.integer({ min: 1, max: 4000 }),
  height: fc.integer({ min: 1, max: 4000 }),
});

/** Source type */
const sourceArb = fc.constantFrom('figma-api' as const, 'playwright' as const);

/** Source ID (node ID or URL) */
const sourceIdArb = fc
  .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 9999 }))
  .map(([a, b]) => `${a}:${b}`);

/** Format */
const formatArb = fc.constantFrom('png' as const, 'svg' as const);

/** Metadata without filePath and extractedAt (what save() accepts) */
const metadataInputArb = fc.record({
  frameName: frameNameArb,
  source: sourceArb,
  sourceId: sourceIdArb,
  dimensions: dimensionsArb,
  format: formatArb,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ui-frame-store-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});


// ─── Property 3: Save/Get Round Trip (Task 2.2) ─────────────────────────────
// **Validates: Requirements 3.1, 3.2**

describe('Property 3 — UI Frame Store save/get round trip', () => {
  it('for any frame name, buffer, and metadata, save then get returns identical buffer and complete metadata', async () => {
    await fc.assert(
      fc.asyncProperty(frameNameArb, imageBufferArb, metadataInputArb, async (name, buffer, metaInput) => {
        const dir = await createTempDir();
        const store = new UIFrameStore({ baseDir: dir, ttlMs: 60_000 });

        const input = { ...metaInput, frameName: name };
        const saved = await store.save(name, buffer, input);

        const result = await store.get(name);
        expect(result).not.toBeNull();
        expect(Buffer.compare(result!.buffer, buffer)).toBe(0);
        expect(result!.metadata.frameName).toBe(name);
        expect(result!.metadata.source).toBe(input.source);
        expect(result!.metadata.sourceId).toBe(input.sourceId);
        expect(result!.metadata.dimensions).toEqual(input.dimensions);
        expect(result!.metadata.format).toBe(input.format);
        expect(result!.metadata.filePath).toBeTruthy();
        expect(result!.metadata.extractedAt).toBeInstanceOf(Date);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: TTL Behavior (Task 2.3) ────────────────────────────────────
// **Validates: Requirements 3.3, 3.4**

describe('Property 4 — UI Frame Store TTL behavior', () => {
  it('for any frame and elapsed time T, isCached returns true iff T < TTL', async () => {
    const ttlMs = 1000; // 1 second TTL for fast testing

    await fc.assert(
      fc.asyncProperty(
        frameNameArb,
        imageBufferArb,
        metadataInputArb,
        fc.boolean(),
        async (name, buffer, metaInput, shouldExpire) => {
          const dir = await createTempDir();
          const store = new UIFrameStore({ baseDir: dir, ttlMs });

          const input = { ...metaInput, frameName: name };
          await store.save(name, buffer, input);

          if (shouldExpire) {
            // Manipulate the metadata to simulate an old extraction
            const { readFile, writeFile } = await import('fs/promises');
            const metaPath = join(dir, `${name}.meta.json`);
            const raw = await readFile(metaPath, 'utf-8');
            const meta = JSON.parse(raw);
            meta.extractedAt = new Date(Date.now() - ttlMs - 1).toISOString();
            await writeFile(metaPath, JSON.stringify(meta), 'utf-8');

            expect(await store.isCached(name)).toBe(false);
            expect(await store.get(name)).toBeNull();
          } else {
            // Frame was just saved, should be within TTL
            expect(await store.isCached(name)).toBe(true);
            expect(await store.get(name)).not.toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: List Completeness (Task 2.4) ───────────────────────────────
// **Validates: Requirements 3.5**

describe('Property 5 — UI Frame Store list completeness', () => {
  it('for any set of N saved frames, list returns exactly N entries with matching names', async () => {
    // Generate a set of 1-5 unique frame names
    const uniqueFrameNamesArb = fc
      .uniqueArray(frameNameArb, { minLength: 1, maxLength: 5 })
      .filter((arr) => arr.length > 0);

    await fc.assert(
      fc.asyncProperty(uniqueFrameNamesArb, imageBufferArb, metadataInputArb, async (names, buffer, metaInput) => {
        const dir = await createTempDir();
        const store = new UIFrameStore({ baseDir: dir, ttlMs: 60_000 });

        for (const name of names) {
          await store.save(name, buffer, { ...metaInput, frameName: name });
        }

        const listed = await store.list();
        expect(listed.length).toBe(names.length);

        const listedNames = new Set(listed.map((m) => m.frameName));
        const expectedNames = new Set(names);
        expect(listedNames).toEqual(expectedNames);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Invalidation (Task 2.5) ────────────────────────────────────
// **Validates: Requirements 3.6**

describe('Property 6 — UI Frame Store invalidation', () => {
  it('for any saved frame, invalidate then get returns null and isCached returns false', async () => {
    await fc.assert(
      fc.asyncProperty(frameNameArb, imageBufferArb, metadataInputArb, async (name, buffer, metaInput) => {
        const dir = await createTempDir();
        const store = new UIFrameStore({ baseDir: dir, ttlMs: 60_000 });

        const input = { ...metaInput, frameName: name };
        await store.save(name, buffer, input);

        // Verify it's cached first
        expect(await store.isCached(name)).toBe(true);

        // Invalidate
        await store.invalidate(name);

        // Verify it's gone
        expect(await store.get(name)).toBeNull();
        expect(await store.isCached(name)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
