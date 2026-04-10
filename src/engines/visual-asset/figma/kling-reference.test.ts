/**
 * Property test for Property 8: KLING client reference image passthrough
 *
 * Validates: Requirements 5.3
 *
 * For any text prompt and any reference image URL, when KlingImageClient.generate()
 * is called with a referenceImageUrl, the request body sent to fal.ai should contain
 * the image_url field set to that URL. When called without a reference URL, the
 * request body should not contain image_url.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { KlingImageClient, KlingVideoClient } from '../kling-client';

// Mock getEnv to return a fake FAL_KEY
vi.mock('../../../utils/env', () => ({
  getEnv: () => 'fake-fal-key',
  getEnvOrDefault: (key: string, def: string) => def,
}));

// Suppress logger output in tests
vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

describe('Property 8: KLING client reference image passthrough', () => {
  let capturedBodies: Record<string, unknown>[] = [];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    capturedBodies = [];
    originalFetch = globalThis.fetch;

    // Mock global fetch to capture request bodies and return a valid KLING response
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBodies.push(JSON.parse(init.body as string));
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ images: [{ url: 'https://fake.com/img.png' }] }),
        json: async () => ({ images: [{ url: 'https://fake.com/img.png' }] }),
      } as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property 8a (Image client): When referenceImageUrl is provided, request body
   * contains image_url; when not provided, request body does NOT contain image_url.
   */
  it('KlingImageClient includes image_url when referenceImageUrl is provided', async () => {
    const client = new KlingImageClient();

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.webUrl(),
        async (prompt, refUrl) => {
          capturedBodies = [];
          await client.generate(prompt, 1080, 1080, refUrl);

          expect(capturedBodies).toHaveLength(1);
          expect(capturedBodies[0].image_url).toBe(refUrl);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property 8b (Image client): When referenceImageUrl is NOT provided,
   * request body does NOT contain image_url.
   */
  it('KlingImageClient omits image_url when referenceImageUrl is not provided', async () => {
    const client = new KlingImageClient();

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (prompt) => {
          capturedBodies = [];
          await client.generate(prompt, 1080, 1080);

          expect(capturedBodies).toHaveLength(1);
          expect(capturedBodies[0]).not.toHaveProperty('image_url');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property 8c (Video client): When referenceImageUrl is provided, request body
   * contains image_url; when not provided, request body does NOT contain image_url.
   */
  it('KlingVideoClient includes image_url when referenceImageUrl is provided', async () => {
    const client = new KlingVideoClient();

    // Mock fetch for video — returns video URL directly
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBodies.push(JSON.parse(init.body as string));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ video: { url: 'https://fake.com/video.mp4' } }),
        text: async () => JSON.stringify({ video: { url: 'https://fake.com/video.mp4' } }),
      } as Response;
    });

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.webUrl(),
        async (prompt, refUrl) => {
          capturedBodies = [];
          await client.generateVideo(prompt, 5, refUrl);

          expect(capturedBodies).toHaveLength(1);
          expect(capturedBodies[0].image_url).toBe(refUrl);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property 8d (Video client): When referenceImageUrl is NOT provided,
   * request body does NOT contain image_url.
   */
  it('KlingVideoClient omits image_url when referenceImageUrl is not provided', async () => {
    const client = new KlingVideoClient();

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBodies.push(JSON.parse(init.body as string));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ video: { url: 'https://fake.com/video.mp4' } }),
        text: async () => JSON.stringify({ video: { url: 'https://fake.com/video.mp4' } }),
      } as Response;
    });

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (prompt) => {
          capturedBodies = [];
          await client.generateVideo(prompt, 5);

          expect(capturedBodies).toHaveLength(1);
          expect(capturedBodies[0]).not.toHaveProperty('image_url');
        },
      ),
      { numRuns: 100 },
    );
  });
});
