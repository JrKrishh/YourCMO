import { CMOPersona } from '../models/agent-config';
import { loadBrandConfig } from './brand-setup';

/**
 * Brand DNA — default brand identity configuration.
 * Reads from the dynamic brand config (data/brand.json) when available.
 * Falls back to generic defaults for backward compatibility.
 *
 * NOTE: This file is kept for backward compatibility with existing imports.
 * New code should use src/config/brand-setup.ts directly.
 */

export const REWOZ_BRAND_DNA = {
  name: 'YourCMO',
  tagline: 'Your AI Chief Marketing Officer',
  website: '',
  colors: {
    primary: '#6366F1',
    primaryDark: '#4F46E5',
    secondary: '#1E293B',
    accent: '#F59E0B',
    white: '#FFFFFF',
    background: '#F8FAFC',
  },
  imageRules: {
    mandatory: [
      'Use brand primary color as dominant accent',
      'Square format 1080x1080 for social media',
      'No AI-generated text in images',
    ],
    style: [
      'Professional, modern, engaging',
      'Authentic feel — not stock photo',
      'Social media optimized — eye-catching in feed scroll',
    ],
    avoid: [
      'No garbled or AI-generated text',
      'No competitor logos or branding',
      'No offensive or controversial imagery',
    ],
    watermark: 'Brand logo in bottom-right corner',
    humanDirection: [
      'Show real people using the product naturally',
      'Warm, inviting lighting',
      'Diverse representation',
    ],
  },
};

export function buildImagePromptEnhancement(): string {
  const brand = loadBrandConfig();
  const r = REWOZ_BRAND_DNA.imageRules;
  return [
    '',
    '=== BRAND IMAGE REQUIREMENTS (MANDATORY) ===',
    ...r.mandatory.map(s => `✅ ${s}`),
    '',
    'PHOTOGRAPHY STYLE:',
    ...r.style.map(s => `- ${s}`),
    '',
    'STRICT RULES — DO NOT VIOLATE:',
    ...r.avoid.map(s => `🚫 ${s}`),
    '',
    'WATERMARK: ' + r.watermark,
    '',
    brand.setupComplete ? `BRAND COLOR: ${brand.primaryColor} — use as dominant accent.` : '',
    brand.setupComplete ? `BRAND: ${brand.brandName}` : '',
    '',
    'Square format 1080x1080 pixels.',
  ].filter(Boolean).join('\n');
}

/** Build the system prompt for content generation */
export function buildContentSystemPrompt(): string {
  const brand = loadBrandConfig();
  if (brand.setupComplete) {
    return [
      `You are the world's best CMO and content creator for ${brand.brandName}.`,
      brand.website ? `Website: ${brand.website}` : '',
      brand.productPitch ? `Product: ${brand.productPitch}` : '',
      brand.targetUsers ? `Target: ${brand.targetUsers}` : '',
      `Voice: ${brand.brandVoice}. Tone: ${brand.contentTone}.`,
      'Write scroll-stopping social media content.',
    ].filter(Boolean).join('\n');
  }
  return 'You are a world-class social media marketing expert. Write engaging content.';
}

/** Build the default CMO persona from brand config */
export function buildDefaultCMOPersona(): CMOPersona {
  const brand = loadBrandConfig();
  if (brand.setupComplete) {
    return {
      role: `Chief Marketing Officer of ${brand.brandName}`,
      strategicPriorities: [
        `Grow ${brand.targetUsers} acquisition in ${brand.targetCities?.join(', ') || 'target markets'}`,
        'Increase conversion and engagement rates',
        `Build brand awareness in ${brand.targetDomain || 'the market'}`,
      ],
      decisionPrinciples: [
        'Prioritise organic growth over paid acquisition',
        'Lead with pain-point storytelling',
        `Maintain a ${brand.brandVoice} tone in all communications`,
      ],
      competitiveContext: brand.competitiveAdvantage || 'Differentiate through unique value proposition.',
      brandPositioning: brand.productPitch || `${brand.brandName} — ${brand.tagline}`,
    };
  }
  return {
    role: 'Chief Marketing Officer',
    strategicPriorities: [
      'Grow user acquisition',
      'Increase conversion rates',
      'Build brand awareness',
    ],
    decisionPrinciples: [
      'Prioritise organic growth',
      'Lead with value-driven storytelling',
      'Maintain consistent brand voice',
    ],
    competitiveContext: 'Differentiate through unique value proposition.',
    brandPositioning: 'Your AI-powered marketing agent.',
  };
}
