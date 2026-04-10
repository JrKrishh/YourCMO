/**
 * ByteDance Seedream Image Generation Client
 *
 * Uses fal.ai as the API gateway to access Seedream 4.5/5.0 models.
 * Key advantage: native text rendering — can write brand text clearly in images.
 *
 * Seedream 5.0 Lite: fal-ai/seedream/v5-lite (~$0.035/image, up to 3K)
 * Seedream 4.5: fal-ai/seedream/v4.5 (~$0.04/image, up to 4K)
 *
 * Get your key at: https://fal.ai/dashboard/keys
 */

import { createLogger } from '../../utils/logger';
import { getEnv } from '../../utils/env';
import { IImageGenerationClient } from './image-generator';

const log = createLogger('SeedreamClient');

const FAL_BASE_URL = 'https://queue.fal.run';

/** Seedream image generation via fal.ai */
export class SeedreamImageClient implements IImageGenerationClient {
  private readonly model: string;

  constructor(model?: string) {
    // Seedream 5.0 Lite is the best balance of speed/quality/price
    this.model = model ?? 'fal-ai/seedream/v5-lite';
  }

  async generate(prompt: string, width: number, height: number): Promise<{ url: string; fileSize: number }> {
    const apiKey = getEnv('FAL_KEY', true);
    const size = resolveSize(width, height);

    log.info({ model: this.model, size }, 'Generating image via Seedream/fal.ai');

    const submitRes = await fetch(`${FAL_BASE_URL}/${this.model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        image_size: size,
        num_images: 1,
      }),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text().catch(() => '');
      throw new Error(`Seedream submit error: ${submitRes.status} ${err}`);
    }

    const result = (await submitRes.json()) as {
      images?: Array<{ url: string; content_type?: string }>;
      request_id?: string;
    };

    if (result.images && result.images.length > 0) {
      log.info({ url: result.images[0].url.substring(0, 60) }, 'Seedream image generated');
      return { url: result.images[0].url, fileSize: 0 };
    }

    if (result.request_id) {
      return this.pollResult(result.request_id, apiKey);
    }

    throw new Error('Seedream: no images in response');
  }

  private async pollResult(requestId: string, apiKey: string): Promise<{ url: string; fileSize: number }> {
    const statusUrl = `https://queue.fal.run/${this.model}/requests/${requestId}/status`;
    const resultUrl = `https://queue.fal.run/${this.model}/requests/${requestId}`;

    for (let i = 0; i < 60; i++) {
      await sleep(2000);

      const statusRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      const status = (await statusRes.json()) as { status: string };

      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${apiKey}` },
        });
        const data = (await resultRes.json()) as { images?: Array<{ url: string }> };
        if (data.images && data.images.length > 0) {
          return { url: data.images[0].url, fileSize: 0 };
        }
        throw new Error('Seedream: completed but no images');
      }

      if (status.status === 'FAILED') {
        throw new Error('Seedream: image generation failed');
      }

      log.debug({ requestId, status: status.status, attempt: i }, 'Polling Seedream...');
    }

    throw new Error('Seedream: timeout');
  }
}

function resolveSize(width: number, height: number): string {
  // Seedream uses descriptive sizes
  if (width >= 2048 || height >= 2048) return '2K';
  return '1K';
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
