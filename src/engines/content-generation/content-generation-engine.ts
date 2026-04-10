import { v4 as uuidv4 } from 'uuid';
import { IContentGenerationEngine } from '../../core/interfaces';
import { ContentSuggestion, PlatformContent, Trend, Platform, ContentTone } from '../../models';
import { BrandProfile } from '../../models/common';
import { CMOPersona } from '../../models/agent-config';
import { createLogger } from '../../utils/logger';
import {
  LLMService,
  LLMServiceConfig,
  ILLMClient,
  PromptMessage,
  PROMPT_TEMPLATES,
} from './llm-service';
import { adaptToPlatform } from './platform-adapter';
import { predictEngagement } from './engagement-predictor';
import type { CostGuard } from '../../utils/cost-guard';

const log = createLogger('ContentGenerationEngine');

/** Options for content generation */
export interface ContentGenerationOptions {
  count?: number;
  tones?: ContentTone[];
}

const DEFAULT_COUNT = 3;
const DEFAULT_TONES: ContentTone[] = [ContentTone.PROFESSIONAL, ContentTone.CASUAL, ContentTone.INSPIRATIONAL];

/**
 * Builds the LLM prompt context from a trend and brand profile.
 * When a CMOPersona is provided, the system message is enhanced with
 * strategic direction, brand positioning, and content constraints.
 */
export function buildContext(
  trend: Trend,
  brandProfile: BrandProfile,
  tone: ContentTone,
  persona?: CMOPersona,
): PromptMessage[] {
  const rendered = PROMPT_TEMPLATES.contentGeneration.render({
    brandName: brandProfile.name,
    brandVoice: brandProfile.voice,
    brandGuidelines: brandProfile.guidelines.join('; '),
    trendTopic: trend.topic,
    trendHashtags: trend.hashtags.join(', '),
    engagementScore: trend.engagementScore.toFixed(2),
    tone,
  });

  let systemContent: string;
  if (persona) {
    const priorities = persona.strategicPriorities.map((p) => `- ${p}`).join('\n');
    const principles = persona.decisionPrinciples.map((p) => `- ${p}`).join('\n');
    systemContent = [
      `You are a creative social media marketing assistant operating under the direction of the ${persona.role}.`,
      '',
      'STRATEGIC DIRECTION:',
      priorities,
      '',
      'BRAND POSITIONING:',
      persona.brandPositioning,
      '',
      'CONTENT CONSTRAINTS (from CMO):',
      principles,
    ].join('\n');
  } else {
    systemContent = 'You are a creative social media marketing assistant.';
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: rendered },
  ];
}

/**
 * Parses LLM-generated text into ContentSuggestion fields.
 * Expects format: TEXT: ...\nCAPTION: ...\nHASHTAGS: ...\nCTA: ...\nTONE: ...
 */
export function parseGeneratedContent(raw: string): {
  text: string;
  caption: string;
  hashtags: string[];
  callToAction: string;
  tone: ContentTone;
} {
  const extract = (label: string): string => {
    const regex = new RegExp(`${label}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 's');
    const match = raw.match(regex);
    return match?.[1]?.trim() ?? '';
  };

  const hashtagsRaw = extract('HASHTAGS');
  const hashtags = hashtagsRaw
    .split(/[,\s]+/)
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) => (h.startsWith('#') ? h : `#${h}`));

  const toneRaw = extract('TONE').toLowerCase();
  const tone = Object.values(ContentTone).includes(toneRaw as ContentTone)
    ? (toneRaw as ContentTone)
    : ContentTone.PROFESSIONAL;

  return {
    text: extract('TEXT'),
    caption: extract('CAPTION'),
    hashtags,
    callToAction: extract('CTA'),
    tone,
  };
}

/**
 * Validates that content complies with brand guidelines.
 * When brandPositioning is provided, includes the positioning statement
 * in the compliance context.
 * Returns true if compliant, false otherwise.
 */
export function validateBrandCompliance(
  text: string,
  brandProfile: BrandProfile,
  brandPositioning?: string,
): boolean {
  if (!text || text.trim().length === 0) return false;

  // Check for forbidden words/phrases from guidelines
  for (const guideline of brandProfile.guidelines) {
    const lower = guideline.toLowerCase();
    if (lower.startsWith('avoid:')) {
      const forbidden = lower.replace('avoid:', '').trim();
      if (text.toLowerCase().includes(forbidden)) {
        log.warn({ forbidden }, 'Brand compliance violation: forbidden term found');
        return false;
      }
    }
  }

  // When brand positioning is provided, log it as part of compliance context
  if (brandPositioning) {
    log.debug({ brandPositioning }, 'Brand compliance check includes persona positioning');
  }

  return true;
}

/**
 * Content Generation Engine — creates content suggestions from trends
 * using an LLM service, validates brand compliance, and predicts engagement.
 */
export class ContentGenerationEngine implements IContentGenerationEngine {
  private readonly llmService: LLMService;

  constructor(config: LLMServiceConfig, llmClient?: ILLMClient, costGuard?: CostGuard) {
    this.llmService = new LLMService(config, llmClient, costGuard);
  }

  async generateSuggestions(
    trend: Trend,
    brandProfile: BrandProfile,
    options?: ContentGenerationOptions,
    persona?: CMOPersona,
  ): Promise<ContentSuggestion[]> {
    const count = options?.count ?? DEFAULT_COUNT;
    const tones = options?.tones ?? DEFAULT_TONES;
    const suggestions: ContentSuggestion[] = [];

    log.info({ topic: trend.topic, count }, 'Generating content suggestions');

    for (let i = 0; i < count; i++) {
      const tone = tones[i % tones.length];
      const messages = buildContext(trend, brandProfile, tone, persona);

      try {
        const response = await this.llmService.generate(messages);
        const parsed = parseGeneratedContent(response.text);

        if (!validateBrandCompliance(parsed.text, brandProfile, persona?.brandPositioning)) {
          log.warn({ iteration: i }, 'Content failed brand compliance, skipping');
          continue;
        }

        const suggestion: ContentSuggestion = {
          contentId: uuidv4(),
          text: parsed.text,
          caption: parsed.caption,
          hashtags: parsed.hashtags,
          callToAction: parsed.callToAction,
          targetPlatforms: [trend.platform],
          trendReferences: [trend.trendId],
          tone: parsed.tone,
          estimatedEngagement: predictEngagement(parsed.text, parsed.hashtags, trend),
          visualRequirements: {
            type: 'IMAGE',
            dimensions: { width: 1080, height: 1080 },
            format: 'jpg',
            maxFileSize: 5_000_000,
          },
        };

        suggestions.push(suggestion);
      } catch (err) {
        log.error({ err, iteration: i }, 'Failed to generate content');
      }
    }

    // Sort by estimated engagement descending
    suggestions.sort((a, b) => b.estimatedEngagement - a.estimatedEngagement);

    log.info({ generated: suggestions.length }, 'Content generation complete');
    return suggestions;
  }

  adaptToPlatform(content: ContentSuggestion, platform: Platform): PlatformContent {
    return adaptToPlatform(content, platform);
  }
}
