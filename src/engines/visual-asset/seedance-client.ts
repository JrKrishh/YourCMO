/**
 * ByteDance Seedance 2.0 Video Generation Client
 *
 * Uses fal.ai as the API gateway. Seedance 2.0 generates cinematic video
 * with native audio (dialogue, foley, music) — no post-production needed.
 *
 * Model: fal-ai/bytedance/seedance/v1.5/pro/text-to-video
 * Features: native audio, cinematic camera, 1080p, up to 12s
 * Cost: ~$0.18 per 5s clip at 720p
 *
 * Get your key at: https://fal.ai/dashboard/keys
 */

import { createLogger } from '../../utils/logger';
import { getEnv } from '../../utils/env';

const log = createLogger('SeedanceClient');

const FAL_BASE_URL = 'https://queue.fal.run';

export interface SeedanceVideoConfig {
  model?: string;
  defaultDuration?: number;
  defaultAspectRatio?: string;
  defaultResolution?: string;
  generateAudio?: boolean;
}

export class SeedanceVideoClient {
  private readonly model: string;
  private readonly defaultDuration: number;
  private readonly defaultAspectRatio: string;
  private readonly defaultResolution: string;
  private readonly generateAudio: boolean;

  constructor(config?: SeedanceVideoConfig) {
    this.model = config?.model ?? 'fal-ai/bytedance/seedance/v1.5/pro/text-to-video';
    this.defaultDuration = config?.defaultDuration ?? 5;
    this.defaultAspectRatio = config?.defaultAspectRatio ?? '9:16';
    this.defaultResolution = config?.defaultResolution ?? '720p';
    this.generateAudio = config?.generateAudio ?? true;
  }

  async generateVideo(
    prompt: string,
    duration?: number,
    referenceImageUrl?: string,
  ): Promise<{ url: string; fileSize: number }> {
    const apiKey = getEnv('FAL_KEY', true)!;
    const effectiveDuration = duration ?? this.defaultDuration;

    log.info({ model: this.model, duration: effectiveDuration }, 'Generating video via Seedance/fal.ai');

    const body: Record<string, unknown> = {
      prompt,
      duration: effectiveDuration,
      aspect_ratio: this.defaultAspectRatio,
      resolution: this.defaultResolution,
      generate_audio: this.generateAudio,
    };

    if (referenceImageUrl) {
      body.image_url = referenceImageUrl;
    }

    const submitRes = await fetch(`${FAL_BASE_URL}/${this.model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text().catch(() => '');
      throw new Error(`Seedance video submit error: ${submitRes.status} ${err}`);
    }

    const result = (await submitRes.json()) as {
      video?: { url: string };
      request_id?: string;
      status_url?: string;
      response_url?: string;
    };

    if (result.video?.url) {
      return { url: result.video.url, fileSize: 0 };
    }

    if (result.request_id) {
      return this.pollResult(result.request_id, apiKey, result.status_url, result.response_url);
    }

    throw new Error('Seedance video: no result');
  }

  private async pollResult(
    requestId: string,
    apiKey: string,
    statusUrlOverride?: string,
    responseUrlOverride?: string,
  ): Promise<{ url: string; fileSize: number }> {
    const statusUrl = statusUrlOverride ?? `${FAL_BASE_URL}/${this.model}/requests/${requestId}/status`;
    const resultUrl = responseUrlOverride ?? `${FAL_BASE_URL}/${this.model}/requests/${requestId}`;

    for (let i = 0; i < 90; i++) {
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
        throw new Error('Seedance video: completed but no video URL');
      }

      if (status.status === 'FAILED') {
        throw new Error('Seedance video: generation failed');
      }

      log.debug({ requestId, status: status.status, attempt: i }, 'Polling Seedance video...');
    }

    throw new Error('Seedance video: timeout');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
