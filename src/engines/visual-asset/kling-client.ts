/**
 * KLING AI Image & Video Generation Client
 *
 * Uses fal.ai as the API gateway to access KLING models.
 * Free tier: $10 credits on signup (~100+ images).
 *
 * Image: fal-ai/kling-image/v3/text-to-image (~$0.08/image)
 * Video: fal-ai/kling-video/v2.6/pro/text-to-video (~$0.07/sec)
 *
 * Get your key at: https://fal.ai/dashboard/keys
 */

import { createLogger } from '../../utils/logger';
import { getEnv } from '../../utils/env';
import { IImageGenerationClient } from './image-generator';

const log = createLogger('KlingClient');

const FAL_BASE_URL = 'https://queue.fal.run';

/** KLING image generation via fal.ai */
export class KlingImageClient implements IImageGenerationClient {
  private readonly model: string;

  constructor(model?: string) {
    this.model = model ?? 'fal-ai/kling-image/v3/text-to-image';
  }

  async generate(prompt: string, width: number, height: number, referenceImageUrl?: string): Promise<{ url: string; fileSize: number }> {
    const apiKey = getEnv('FAL_KEY', true);
    const aspectRatio = resolveAspectRatio(width, height);

    log.info({ model: this.model, aspectRatio }, 'Generating image via KLING/fal.ai');

    // Build request body, conditionally including image_url for reference images
    const requestBody: Record<string, unknown> = {
      prompt,
      aspect_ratio: aspectRatio,
      image_count: 1,
    };
    if (referenceImageUrl) {
      requestBody.image_url = referenceImageUrl;
    }

    // Submit the request
    const submitRes = await fetch(`${FAL_BASE_URL}/${this.model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await submitRes.text().catch(() => '');

    if (!submitRes.ok) {
      throw new Error(`KLING submit error: ${submitRes.status} ${responseText.substring(0, 300)}`);
    }

    if (!responseText || responseText.trim().length === 0) {
      throw new Error(`KLING: empty response from fal.ai (status ${submitRes.status})`);
    }

    log.debug({ status: submitRes.status, bodyLength: responseText.length }, 'KLING raw response');

    let result: {
      images?: Array<{ url: string; content_type?: string }>;
      request_id?: string;
      status?: string;
      status_url?: string;
      response_url?: string;
    };
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`KLING: invalid JSON response (status ${submitRes.status}): ${responseText.substring(0, 300)}`);
    }

    // fal.ai queue mode returns images directly for sync calls
    if (result.images && result.images.length > 0) {
      log.info({ url: result.images[0].url.substring(0, 60) }, 'KLING image generated');
      return { url: result.images[0].url, fileSize: 0 };
    }

    // If queued, poll for result using the URLs from the response
    if (result.request_id) {
      return this.pollResult(result.request_id, apiKey, result.status_url, result.response_url);
    }

    throw new Error('KLING: no images in response and no request_id for polling');
  }

  private async pollResult(
    requestId: string,
    apiKey: string,
    statusUrlOverride?: string,
    responseUrlOverride?: string,
  ): Promise<{ url: string; fileSize: number }> {
    const statusUrl = statusUrlOverride ?? `https://queue.fal.run/${this.model}/requests/${requestId}/status`;
    const resultUrl = responseUrlOverride ?? `https://queue.fal.run/${this.model}/requests/${requestId}`;

    for (let i = 0; i < 60; i++) {
      await sleep(2000);

      const statusRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      const statusText = await statusRes.text();
      let status: { status: string };
      try {
        status = JSON.parse(statusText);
      } catch {
        log.warn({ requestId, body: statusText.substring(0, 200) }, 'KLING: invalid status response');
        continue;
      }

      log.debug({ requestId, status: status.status, attempt: i }, 'Polling KLING...');

      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${apiKey}` },
        });
        const data = (await resultRes.json()) as { images?: Array<{ url: string }> };
        if (data.images && data.images.length > 0) {
          return { url: data.images[0].url, fileSize: 0 };
        }
        throw new Error('KLING: completed but no images in result');
      }

      if (status.status === 'FAILED') {
        throw new Error('KLING: image generation failed');
      }
    }

    throw new Error('KLING: timeout waiting for image generation');
  }
}

/** KLING video generation via fal.ai */
export class KlingVideoClient {
  private readonly model: string;

  constructor(model?: string) {
    this.model = model ?? 'fal-ai/kling-video/v2.6/pro/text-to-video';
  }

  async generateVideo(prompt: string, duration?: number, referenceImageUrl?: string): Promise<{ url: string; fileSize: number }> {
    const effectiveDuration = duration ?? 5;
    const apiKey = getEnv('FAL_KEY', true);

    log.info({ model: this.model, duration: effectiveDuration }, 'Generating video via KLING/fal.ai');

    // Build request body, conditionally including image_url for reference images
    const requestBody: Record<string, unknown> = {
      prompt,
      duration: String(effectiveDuration),
      aspect_ratio: '1:1',
    };
    if (referenceImageUrl) {
      requestBody.image_url = referenceImageUrl;
    }

    const submitRes = await fetch(`${FAL_BASE_URL}/${this.model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text().catch(() => '');
      throw new Error(`KLING video submit error: ${submitRes.status} ${err}`);
    }

    const result = (await submitRes.json()) as {
      video?: { url: string };
      request_id?: string;
    };

    if (result.video?.url) {
      return { url: result.video.url, fileSize: 0 };
    }

    if (result.request_id) {
      return this.pollVideoResult(result.request_id, apiKey);
    }

    throw new Error('KLING video: no result');
  }

  private async pollVideoResult(requestId: string, apiKey: string): Promise<{ url: string; fileSize: number }> {
    const resultUrl = `https://queue.fal.run/${this.model}/requests/${requestId}`;
    const statusUrl = `${resultUrl}/status`;

    for (let i = 0; i < 120; i++) {
      await sleep(3000);

      const statusRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      const status = (await statusRes.json()) as { status: string };

      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${apiKey}` },
        });
        const data = (await resultRes.json()) as { video?: { url: string } };
        if (data.video?.url) {
          return { url: data.video.url, fileSize: 0 };
        }
        throw new Error('KLING video: completed but no video URL');
      }

      if (status.status === 'FAILED') {
        throw new Error('KLING video: generation failed');
      }

      log.debug({ requestId, status: status.status, attempt: i }, 'Polling KLING video...');
    }

    throw new Error('KLING video: timeout');
  }
}

function resolveAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
  if (Math.abs(ratio - 4 / 3) < 0.1) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.1) return '3:4';
  return '1:1';
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
