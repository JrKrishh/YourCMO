import { v4 as uuidv4 } from 'uuid';
import { ApiRequest, ApiResponse } from './auth-middleware';
import { RouteHandlerDeps } from './route-handlers';
import { ContentGenerationEngine } from '../engines/content-generation/content-generation-engine';
import { ImageGenerator } from '../engines/visual-asset/image-generator';
import { CostGuard } from '../utils/cost-guard';
import { CampaignScheduler } from '../engines/campaign-manager/campaign-scheduler';
import { MiMoAgentBrain } from '../core/mimo-agent-brain';
import { Platform, CampaignStatus, TrendLifecyclePhase } from '../models/enums';
import { BrandProfile, Trend } from '../models';
import { CMOPersona } from '../models/agent-config';
import { buildDefaultCMOPersona } from '../config/rewoz-brand-dna';
import { createLogger } from '../utils/logger';

const log = createLogger('DashboardHandlers');

/** Extended dependencies for dashboard route handlers */
export interface DashboardHandlerDeps extends RouteHandlerDeps {
  contentEngine: ContentGenerationEngine;
  imageGenerator: ImageGenerator;
  costGuard: CostGuard;
  campaignScheduler: CampaignScheduler;
  mimoBrain: MiMoAgentBrain;
  cmoPersona?: CMOPersona;
}

// --- Helpers ---

function jsonResponse(status: number, body: unknown): ApiResponse {
  return {
    status,
    body,
    headers: { 'content-type': 'application/json' },
  };
}

function errorResponse(err: unknown): ApiResponse {
  const message = err instanceof Error ? err.message : 'Internal server error';
  log.error({ err }, 'Dashboard handler error');
  return jsonResponse(500, { error: message });
}

// --- Handlers ---

/** POST /api/generate-content */
export async function generateContentHandler(
  req: ApiRequest,
  deps: DashboardHandlerDeps,
): Promise<ApiResponse> {
  try {
    const body = req.body as Record<string, unknown> | undefined;

    if (!body || typeof body !== 'object') {
      return jsonResponse(400, { error: 'Request body is required' });
    }

    const { campaignName, platforms, tone, topic } = body as Record<string, unknown>;

    if (!campaignName || typeof campaignName !== 'string' || campaignName.trim().length === 0) {
      return jsonResponse(400, { error: 'campaignName is required and must be a non-empty string' });
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return jsonResponse(400, { error: 'platforms is required and must be a non-empty array' });
    }

    // Check cost guard before calling LLM
    const check = deps.costGuard.canSpend('llm', 0.01);
    if (!check.allowed) {
      return jsonResponse(429, { error: `Spending limit reached: ${check.reason}` });
    }

    // Build brand profile from env vars
    const brandProfile: BrandProfile = {
      name: process.env.BRAND_NAME ?? 'YourCMO',
      voice: process.env.BRAND_VOICE ?? 'friendly, approachable, cafe-focused',
      guidelines: [
        'Target Australian cafe owners',
        'Highlight $0 commission and 90-day free trial',
        'Keep tone friendly and approachable',
      ],
    };

    // Build a synthetic trend from the request context
    const trend: Trend = {
      trendId: uuidv4(),
      platform: platforms[0] as Platform,
      topic: (topic as string) ?? `${brandProfile.name} marketing`,
      hashtags: ['#marketing', '#growth', '#business'],
      engagementScore: 0.7,
      velocity: 0.5,
      timestamp: new Date(),
      relatedContent: [],
      demographics: { ageGroups: {}, genderDistribution: {}, topLocations: ['Australia'] },
      predictedLifecycle: {
        currentPhase: TrendLifecyclePhase.GROWING,
        estimatedPeakDate: new Date(),
        estimatedEndDate: new Date(),
        confidence: 0.8,
      },
    };

    // Resolve CMO persona from deps or build default
    const persona: CMOPersona = deps.cmoPersona ?? buildDefaultCMOPersona();

    const suggestions = await deps.contentEngine.generateSuggestions(trend, brandProfile, {
      count: 3,
      tones: tone ? [tone as string] as unknown as import('../models/enums').ContentTone[] : undefined,
    }, persona);

    return jsonResponse(200, {
      suggestions,
      tokensUsed: suggestions.length * 200,
      estimatedCost: 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
}


/** POST /api/generate-image */
export async function generateImageHandler(
  req: ApiRequest,
  deps: DashboardHandlerDeps,
): Promise<ApiResponse> {
  try {
    const body = req.body as Record<string, unknown> | undefined;

    if (!body || typeof body !== 'object') {
      return jsonResponse(400, { error: 'Request body is required' });
    }

    const { prompt, platform } = body as Record<string, unknown>;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return jsonResponse(400, { error: 'prompt is required and must be a non-empty string' });
    }

    // Check cost guard before calling image generation
    const check = deps.costGuard.canSpend('image_generation', 0);
    if (!check.allowed) {
      return jsonResponse(429, { error: `Spending limit reached: ${check.reason}` });
    }

    // Resolve platform dimensions
    const platformStr = (platform as string) ?? Platform.INSTAGRAM;
    let width = 1080;
    let height = 1080;

    if (platformStr === Platform.FACEBOOK) {
      width = 1200;
      height = 630;
    }

    const asset = await deps.imageGenerator.generateImage(
      prompt as string,
      {
        type: 'IMAGE',
        dimensions: { width, height },
        format: 'jpg',
        maxFileSize: 5_000_000,
      },
      platformStr as Platform,
    );

    return jsonResponse(200, { asset });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /api/cost-summary */
export function costSummaryHandler(
  _req: ApiRequest,
  deps: DashboardHandlerDeps,
): ApiResponse {
  const summary = deps.costGuard.getSummary();
  return jsonResponse(200, summary);
}

/** POST /api/campaigns/:id/schedule */
export async function schedulePostHandler(
  req: ApiRequest,
  deps: DashboardHandlerDeps,
): Promise<ApiResponse> {
  try {
    const campaignId = req.params.id;

    // Validate campaign exists
    let campaign;
    try {
      campaign = deps.campaignManager.getCampaign(campaignId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return jsonResponse(404, { error: err.message });
      }
      throw err;
    }

    // Validate campaign status allows scheduling
    if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.ACTIVE) {
      return jsonResponse(409, {
        error: `Campaign status '${campaign.status}' does not allow scheduling. Must be DRAFT or ACTIVE.`,
      });
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      return jsonResponse(400, { error: 'Request body is required' });
    }

    const { scheduledTime, timezone } = body as Record<string, unknown>;

    // Validate scheduledTime is in the future
    const scheduledDate = new Date(scheduledTime as string);
    if (isNaN(scheduledDate.getTime())) {
      return jsonResponse(400, { error: 'scheduledTime must be a valid ISO 8601 date string' });
    }

    if (scheduledDate.getTime() <= Date.now()) {
      return jsonResponse(400, { error: 'scheduledTime must be in the future' });
    }

    // Convert to UTC using CampaignScheduler
    const tz = (timezone as string) ?? 'Australia/Sydney';
    const utcTime = deps.campaignScheduler.convertToUtc(scheduledDate, tz);

    return jsonResponse(200, {
      scheduled: true,
      utcTime: utcTime.toISOString(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
