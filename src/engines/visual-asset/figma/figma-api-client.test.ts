import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { FigmaApiClient, FigmaExportResult } from './figma-api-client';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Node ID: matches \d+:\d+ pattern */
const nodeIdArb = fc
  .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 9999 }))
  .map(([a, b]) => `${a}:${b}`);

/** Unique list of 1-5 node IDs */
const nodeIdListArb = fc.uniqueArray(nodeIdArb, { minLength: 1, maxLength: 5 });

/** Format */
const formatArb = fc.constantFrom('png' as const, 'svg' as const);

/** Frame name: alphanumeric with hyphens */
const frameNameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter((s) => s.length > 0 && !s.endsWith('-'));

/** Small image buffer (100-500 bytes) */
const imageBufferArb = fc
  .uint8Array({ minLength: 100, maxLength: 500 })
  .map((arr) => Buffer.from(arr));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createClient(overrides?: { maxRetries?: number }) {
  return new FigmaApiClient({
    accessToken: 'test-token',
    fileKey: 'test-file-key',
    ...overrides,
  });
}

/**
 * Build a mock fetch that simulates the Figma API for a given set of node IDs.
 * - /images/ endpoint returns image URLs for each node
 * - /files/ endpoint returns a document tree with node info
 * - Image download URLs return a buffer
 */
function buildMockFetch(
  nodeIds: string[],
  names: Map<string, string>,
  buffers: Map<string, Buffer>,
) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    // Figma images endpoint
    if (urlStr.includes('/images/')) {
      const images: Record<string, string> = {};
      for (const id of nodeIds) {
        images[id] = `https://figma-cdn.example.com/export/${encodeURIComponent(id)}.png`;
      }
      return new Response(JSON.stringify({ images }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Figma files endpoint
    if (urlStr.includes('/files/')) {
      const children = nodeIds.map((id) => ({
        id,
        name: names.get(id) ?? id,
        type: 'FRAME',
      }));
      return new Response(
        JSON.stringify({ document: { id: '0:0', name: 'Document', type: 'DOCUMENT', children } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Image download from CDN
    if (urlStr.includes('figma-cdn.example.com/export/')) {
      // Extract node ID from URL
      const match = urlStr.match(/export\/(.+?)\.png/);
      const nodeId = match ? decodeURIComponent(match[1]) : '';
      const buf = buffers.get(nodeId) ?? Buffer.from('default-image-data');
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }

    return new Response('Not Found', { status: 404 });
  });
}

// ─── Property 1: Export Result Completeness (Task 3.2) ───────────────────────
// **Validates: Requirements 1.2, 1.4, 1.5**

describe('Property 1 — Frame export result completeness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('for any list of node IDs and format, export returns one result per node with buffer, dimensions, name, and format', async () => {
    await fc.assert(
      fc.asyncProperty(
        nodeIdListArb,
        formatArb,
        fc.array(frameNameArb, { minLength: 5, maxLength: 5 }),
        fc.array(imageBufferArb, { minLength: 5, maxLength: 5 }),
        async (nodeIds, format, namePool, bufferPool) => {
          // Build name and buffer maps for the node IDs
          const names = new Map<string, string>();
          const buffers = new Map<string, Buffer>();
          nodeIds.forEach((id, i) => {
            names.set(id, namePool[i % namePool.length]);
            buffers.set(id, bufferPool[i % bufferPool.length]);
          });

          const mockFetch = buildMockFetch(nodeIds, names, buffers);
          vi.stubGlobal('fetch', mockFetch);

          const client = createClient();
          const results = await client.exportFrames(nodeIds, 2, format);

          // One result per node ID
          expect(results.length).toBe(nodeIds.length);

          for (let i = 0; i < nodeIds.length; i++) {
            const result = results[i];
            expect(result.nodeId).toBe(nodeIds[i]);
            // Non-empty buffer
            expect(result.imageBuffer).toBeInstanceOf(Buffer);
            expect(result.imageBuffer.length).toBeGreaterThan(0);
            // Valid dimensions
            expect(result.dimensions.width).toBeGreaterThan(0);
            expect(result.dimensions.height).toBeGreaterThan(0);
            // Name is present
            expect(typeof result.name).toBe('string');
            expect(result.name.length).toBeGreaterThan(0);
            // Format matches requested
            expect(result.format).toBe(format);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Missing Node ID Error (Task 3.3) ────────────────────────────
// **Validates: Requirements 1.3**

describe('Property 2 — Missing node ID error identification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('for any non-existent node ID, the error message contains that node ID', async () => {
    await fc.assert(
      fc.asyncProperty(nodeIdArb, async (missingNodeId) => {
        // Mock fetch: images endpoint returns empty images map (node not found)
        const mockFetch = vi.fn(async (url: string, _init?: RequestInit) => {
          const urlStr = typeof url === 'string' ? url : String(url);

          if (urlStr.includes('/images/')) {
            return new Response(JSON.stringify({ images: { [missingNodeId]: null } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          return new Response('Not Found', { status: 404 });
        });

        vi.stubGlobal('fetch', mockFetch);

        const client = createClient();

        try {
          await client.exportFrames([missingNodeId]);
          // Should not reach here
          expect.unreachable('Expected an error to be thrown');
        } catch (error: unknown) {
          const message = (error as Error).message;
          expect(message).toContain(missingNodeId);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Unit Tests (Task 3.4) ───────────────────────────────────────────────────

describe('FigmaApiClient — HTTP 429 retry behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on HTTP 429 and succeeds on subsequent 200', async () => {
    let callCount = 0;
    const nodeId = '100:200';

    const mockFetch = vi.fn(async (url: string, _init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : String(url);
      callCount++;

      // First call to /images/ returns 429, second returns 200
      if (urlStr.includes('/images/')) {
        if (callCount === 1) {
          return new Response('Rate Limited', {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(
          JSON.stringify({ images: { [nodeId]: 'https://figma-cdn.example.com/export/100%3A200.png' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('/files/')) {
        return new Response(
          JSON.stringify({
            document: {
              id: '0:0', name: 'Document', type: 'DOCUMENT',
              children: [{ id: nodeId, name: 'TestFrame', type: 'FRAME' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('figma-cdn.example.com')) {
        const buf = Buffer.from('image-data');
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    vi.stubGlobal('fetch', mockFetch);

    const client = createClient();
    const results = await client.exportFrames([nodeId]);

    expect(results.length).toBe(1);
    expect(results[0].nodeId).toBe(nodeId);
    // fetch was called at least twice for the /images/ endpoint (429 then 200)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

describe('FigmaApiClient — HTTP 403 error message', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws a descriptive error about invalid token/permissions on 403', async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response('Forbidden', { status: 403 });
    });

    vi.stubGlobal('fetch', mockFetch);

    const client = createClient();

    await expect(client.exportFrames(['100:200'])).rejects.toThrow(
      /invalid.*token|lacks.*permissions|403.*Forbidden/i,
    );
  });
});
