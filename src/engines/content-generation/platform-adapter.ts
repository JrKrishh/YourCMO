import { v4 as uuidv4 } from 'uuid';
import { ContentSuggestion, PlatformContent, Platform } from '../../models';
import { createLogger } from '../../utils/logger';

const log = createLogger('PlatformAdapter');

/** Platform-specific content constraints */
export interface PlatformConstraints {
  maxCharacters: number;
  maxHashtags: number;
  supportsHashtags: boolean;
  supportsMentions: boolean;
}

/** Platform constraints lookup */
export const PLATFORM_CONSTRAINTS: Record<Platform, PlatformConstraints> = {
  [Platform.INSTAGRAM]: {
    maxCharacters: 2200,
    maxHashtags: 30,
    supportsHashtags: true,
    supportsMentions: true,
  },
  [Platform.FACEBOOK]: {
    maxCharacters: 63206,
    maxHashtags: Infinity,
    supportsHashtags: true,
    supportsMentions: true,
  },
  [Platform.TWITTER]: {
    maxCharacters: 280,
    maxHashtags: Infinity,
    supportsHashtags: true,
    supportsMentions: true,
  },
  [Platform.TIKTOK]: {
    maxCharacters: 2200,
    maxHashtags: Infinity,
    supportsHashtags: true,
    supportsMentions: true,
  },
  [Platform.WHATSAPP]: {
    maxCharacters: 4096,
    maxHashtags: 0,
    supportsHashtags: false,
    supportsMentions: false,
  },
};

/**
 * Truncates text to fit within a character limit, appending an ellipsis
 * if truncation occurs.
 */
export function enforceCharacterLimit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3).trimEnd() + '...';
}

/**
 * Validates and normalises hashtags. Each must start with # and contain
 * no spaces. Returns only valid hashtags up to the platform limit.
 */
export function validateHashtags(hashtags: string[], maxHashtags: number): string[] {
  const valid = hashtags
    .map((h) => h.trim())
    .filter((h) => h.length > 1)
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .filter((h) => /^#[^\s#]+$/.test(h));

  return valid.slice(0, maxHashtags);
}

/**
 * Generates additional hashtags from the content text by extracting
 * capitalised or notable words.
 */
export function generateHashtagsFromText(text: string, existing: string[], max: number): string[] {
  if (existing.length >= max) return existing;

  const words = text.match(/\b[A-Z][a-z]{3,}\b/g) ?? [];
  const unique = [...new Set(words)]
    .map((w) => `#${w}`)
    .filter((h) => !existing.includes(h));

  return [...existing, ...unique].slice(0, max);
}

/**
 * Adapts a ContentSuggestion to a specific platform, enforcing character
 * limits, hashtag rules, and platform-specific formatting.
 */
export function adaptToPlatform(content: ContentSuggestion, platform: Platform): PlatformContent {
  const constraints = PLATFORM_CONSTRAINTS[platform];
  log.debug({ platform, maxChars: constraints.maxCharacters }, 'Adapting content to platform');

  let hashtags: string[] = [];
  if (constraints.supportsHashtags) {
    hashtags = validateHashtags(content.hashtags, constraints.maxHashtags);
  }

  // Build the full text: main text + caption + CTA
  let fullText = content.text;
  if (content.caption && platform !== Platform.TWITTER) {
    fullText += `\n\n${content.caption}`;
  }
  if (content.callToAction) {
    fullText += `\n\n${content.callToAction}`;
  }

  // For platforms with hashtags in the body (Instagram, TikTok), append them
  if (constraints.supportsHashtags && hashtags.length > 0 && platform !== Platform.TWITTER) {
    const hashtagStr = hashtags.join(' ');
    const available = constraints.maxCharacters - fullText.length - 2; // 2 for \n\n
    if (available >= hashtagStr.length) {
      fullText += `\n\n${hashtagStr}`;
    }
  }

  fullText = enforceCharacterLimit(fullText, constraints.maxCharacters);

  return {
    contentId: uuidv4(),
    platform,
    text: fullText,
    visualAssets: [],
    hashtags,
    mentions: [],
  };
}

/**
 * Generates content variations for A/B testing by adjusting tone,
 * CTA, and hashtag selection.
 */
export function generateVariations(
  content: ContentSuggestion,
  count: number,
): ContentSuggestion[] {
  const variations: ContentSuggestion[] = [];

  for (let i = 0; i < count; i++) {
    const variation: ContentSuggestion = {
      ...content,
      contentId: uuidv4(),
      // Rotate hashtags — shift by i+1 positions
      hashtags: [
        ...content.hashtags.slice(i + 1),
        ...content.hashtags.slice(0, i + 1),
      ],
      // Slightly adjust estimated engagement for variation tracking
      estimatedEngagement: Math.max(0, Math.min(1, content.estimatedEngagement + (Math.random() - 0.5) * 0.1)),
    };
    variations.push(variation);
  }

  return variations;
}
