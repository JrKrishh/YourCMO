import { v4 as uuidv4 } from 'uuid';
import { AssetType, Platform } from '../../models/enums';
import { Dimensions, VisualSpecs } from '../../models/common';
import { VisualAsset } from '../../models/visual-asset';
import { createLogger } from '../../utils/logger';
import { getEnv, getEnvOrDefault } from '../../utils/env';
import { KlingImageClient } from './kling-client';

const log = createLogger('ImageGenerator');

/** Abstraction for image generation API clients */
export interface IImageGenerationClient {
  generate(prompt: string, width: number, height: number, referenceImageUrl?: string): Promise<{ url: string; fileSize: number }>;
}

/**
 * Google AI Studio image generation client — uses Gemini 2.5 Flash Image
 * directly via Google's Generative Language API.
 *
 * FREE: 500 images/day with a Google AI Studio API key.
 * Get your key at: https://aistudio.google.com/apikey
 *
 * This is the primary/recommended client for cost-efficient image generation.
 */
export class GoogleAIStudioImageClient implements IImageGenerationClient {
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(model?: string) {
    this.model = model ?? 'gemini-2.5-flash-image';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  async generate(prompt: string, width: number, height: number): Promise<{ url: string; fileSize: number }> {
    const apiKey = getEnv('GOOGLE_AI_STUDIO_API_KEY', true);

    log.info({ model: this.model, width, height }, 'Calling Google AI Studio for image generation');

    const response = await fetch(
      `${this.baseUrl}/models/${this.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }],
          }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Google AI Studio error: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    // Extract the base64 image from the response
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData);

    if (imagePart?.inlineData) {
      const dataUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      const fileSize = Math.round(imagePart.inlineData.data.length * 0.75); // base64 → bytes
      return { url: dataUrl, fileSize };
    }

    throw new Error('Google AI Studio did not return an image');
  }
}

/**
 * OpenRouter image generation client — fallback option.
 * Uses Gemini via OpenRouter (~$0.039/image).
 */
export class OpenRouterImageClient implements IImageGenerationClient {
  private readonly model: string;

  constructor(model?: string) {
    this.model = model ?? 'google/gemini-2.5-flash-image';
  }

  async generate(prompt: string, width: number, height: number): Promise<{ url: string; fileSize: number }> {
    const apiKey = getEnv('OPENROUTER_API_KEY', true);
    const aspectRatio = resolveAspectRatio(width, height);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': getEnvOrDefault('APP_URL', 'http://localhost:3000'),
        'X-Title': 'YourCMO Marketing Agent',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image'],
        image_config: { aspect_ratio: aspectRatio, image_size: '1K' },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter Image API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: { message: { images?: string[] } }[];
    };

    const imageUrl = data.choices[0]?.message?.images?.[0] ?? '';
    return { url: imageUrl, fileSize: 0 };
  }
}

/** DALL-E image generation client (paid fallback) */
export class DallEClient implements IImageGenerationClient {
  async generate(prompt: string, width: number, height: number): Promise<{ url: string; fileSize: number }> {
    const apiKey = getEnv('IMAGE_GENERATION_API_KEY', true);
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: `${width}x${height}` }),
    });

    if (!response.ok) {
      throw new Error(`DALL-E API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data: { url: string }[] };
    return { url: data.data[0].url, fileSize: 0 };
  }
}

/** Resolve aspect ratio string from dimensions */
function resolveAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
  if (Math.abs(ratio - 4 / 3) < 0.1) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.1) return '3:4';
  if (Math.abs(ratio - 4 / 5) < 0.1) return '4:5';
  return '1:1';
}

/**
 * Resizes dimensions to fit within a target while preserving aspect ratio.
 */
export function resizeDimensions(source: Dimensions, target: Dimensions): Dimensions {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  return { width: Math.round(source.width * scale), height: Math.round(source.height * scale) };
}

/**
 * Estimates compressed file size based on dimensions and format.
 */
export function estimateFileSize(dimensions: Dimensions, format: string): number {
  const pixels = dimensions.width * dimensions.height;
  return Math.round(pixels * (format === 'png' ? 1.5 : 0.5));
}

/**
 * Image generator — uses KLING V3 (via fal.ai, free $10 credits) as primary,
 * with Seedream 5.0 and Google AI Studio as fallbacks.
 *
 * Priority: KLING → Seedream → Google AI Studio → DALL-E
 */
export class ImageGenerator {
  constructor(private readonly client: IImageGenerationClient = new KlingImageClient()) {}

  async generateImage(
    prompt: string,
    specs: VisualSpecs,
    platform: Platform = Platform.INSTAGRAM,
  ): Promise<VisualAsset> {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Image prompt must not be empty');
    }
    if (specs.type !== 'IMAGE') {
      throw new Error('VisualSpecs type must be IMAGE for image generation');
    }

    log.info({ prompt: prompt.substring(0, 80), platform }, 'Generating image');

    const result = await this.client.generate(prompt, specs.dimensions.width, specs.dimensions.height);
    const fileSize = result.fileSize || estimateFileSize(specs.dimensions, specs.format);

    const asset: VisualAsset = {
      assetId: uuidv4(),
      assetType: AssetType.IMAGE,
      url: result.url,
      localPath: '',
      dimensions: { ...specs.dimensions },
      format: specs.format,
      fileSize,
      duration: 0,
      platform,
      metadata: { tags: [], createdAt: new Date() },
      brandingApplied: false,
    };

    log.info({ assetId: asset.assetId }, 'Image generated');
    return asset;
  }
}
