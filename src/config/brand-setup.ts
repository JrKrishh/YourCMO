/**
 * Brand Setup — dynamic brand configuration for YourCMO.
 * Users configure their brand via the setup page. All content generation
 * reads from this config instead of hardcoded brand references.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface BrandConfig {
  // Core identity
  brandName: string;
  tagline: string;
  website: string;
  logoPath?: string;
  instagram?: string;
  facebook?: string;
  email?: string;
  foundedInfo?: string;

  // Visual identity
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  brandColors?: { primary: string; secondary: string };

  // Product
  productType: string;
  productPitch: string;
  productDescription: string;
  pricing: string;
  freeTrial?: string;
  keyFeatures: string[];
  uniqueSellingPoints: string[];
  proofPoints: string[];
  provenStats?: string[];

  // Target
  targetDomain: string;
  domain?: string;
  subCategory?: string;
  targetUsers: string;
  targetAudience?: string;
  targetCities: string[];
  targetCountries?: string[];
  targetPlatforms: string[];
  platforms?: string[];
  originCountry?: string;
  originCity?: string;
  ageRange?: string;
  interests?: string[];
  painPoints?: string[];
  competitors?: string[];
  competitiveAdvantage?: string;

  // Voice
  brandVoice: string;
  contentTone: string;
  agentRole?: string;
  avoidTopics?: string[];

  // Derived
  hashtagPrefix: string;

  // State
  setupComplete: boolean;
  configuredAt?: string;
}

const BRAND_PATH = path.join(process.cwd(), 'data', 'brand.json');

const DEFAULTS: BrandConfig = {
  brandName: '',
  tagline: '',
  website: '',
  primaryColor: '#6366F1',
  secondaryColor: '#1E293B',
  accentColor: '#F59E0B',
  productType: '',
  productPitch: '',
  productDescription: '',
  pricing: '',
  keyFeatures: [],
  uniqueSellingPoints: [],
  proofPoints: [],
  targetDomain: '',
  targetUsers: '',
  targetCities: [],
  targetPlatforms: ['instagram'],
  brandVoice: 'friendly and professional',
  contentTone: 'casual and approachable',
  hashtagPrefix: '',
  setupComplete: false,
};

export function loadBrandConfig(): BrandConfig {
  try {
    if (fs.existsSync(BRAND_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BRAND_PATH, 'utf-8'));
      if (raw.brandName || raw.name) {
        return { ...DEFAULTS, ...raw, brandName: raw.brandName || raw.name };
      }
    }
  } catch {}
  return { ...DEFAULTS };
}

export function saveBrandConfig(input: any): BrandConfig {
  const name = input.name || input.brandName || '';
  const config: any = {
    brandName: name,
    tagline: input.tagline || '',
    website: input.website || '',
    logoPath: input.logoPath || '',
    instagram: input.instagram || '',
    facebook: input.facebook || '',
    email: input.email || '',
    foundedInfo: input.foundedInfo || '',
    primaryColor: input.brandColors?.primary || input.primaryColor || '#6366F1',
    secondaryColor: input.brandColors?.secondary || input.secondaryColor || '#1E293B',
    accentColor: input.accentColor || '#F59E0B',
    brandColors: input.brandColors || { primary: input.primaryColor || '#6366F1', secondary: input.secondaryColor || '#1E293B' },
    productType: input.productType || '',
    productPitch: input.productPitch || input.productDescription?.slice(0, 120) || '',
    productDescription: input.productDescription || '',
    pricing: input.pricing || '',
    freeTrial: input.freeTrial || '',
    keyFeatures: input.keyFeatures || [],
    uniqueSellingPoints: input.uniqueSellingPoints || [],
    proofPoints: input.proofPoints || input.provenStats || [],
    provenStats: input.provenStats || input.proofPoints || [],
    targetDomain: input.domain || input.targetDomain || '',
    domain: input.domain || input.targetDomain || '',
    subCategory: input.subCategory || '',
    targetUsers: input.targetAudience || input.targetUsers || '',
    targetAudience: input.targetAudience || input.targetUsers || '',
    targetCities: input.targetCities || input.targetRegions || [],
    targetCountries: input.targetCountries || [],
    targetPlatforms: input.platforms || input.targetPlatforms || ['instagram'],
    platforms: input.platforms || input.targetPlatforms || ['instagram'],
    originCountry: input.originCountry || '',
    originCity: input.originCity || '',
    ageRange: input.ageRange || '',
    interests: input.interests || [],
    painPoints: input.painPoints || [],
    competitors: input.competitors || [],
    competitiveAdvantage: input.competitiveAdvantage || '',
    brandVoice: Array.isArray(input.brandVoice) ? input.brandVoice.join(', ') : (input.brandVoice || 'friendly and professional'),
    contentTone: input.contentTone || 'casual and approachable',
    agentRole: input.agentRole || 'Chief Marketing Officer & Content Creator',
    avoidTopics: input.avoidTopics || [],
    hashtagPrefix: input.hashtagPrefix || `#${name.replace(/\\s+/g, '')}`,
    setupComplete: true,
    configuredAt: new Date().toISOString(),
  } as BrandConfig;

  // Save logo if base64 provided
  if (input.logoBase64) {
    const match = input.logoBase64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (match) {
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const logoDir = path.join(process.cwd(), 'assets');
      if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
      const logoFile = `brand-logo.${ext}`;
      fs.writeFileSync(path.join(logoDir, logoFile), Buffer.from(match[2], 'base64'));
      config.logoPath = `assets/${logoFile}`;
    }
  }

  const dir = path.dirname(BRAND_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BRAND_PATH, JSON.stringify(config, null, 2));
  return config;
}

export function isBrandSetupComplete(): boolean {
  return loadBrandConfig().setupComplete;
}

// ── Prompt Builders (used by dashboard-server + autopilot) ───────

export function buildCaptionSystemPrompt(b: BrandConfig): string {
  if (!b.setupComplete) return 'You are a world-class social media marketing expert and CMO.';
  return [
    `You are the world's best ${b.agentRole || 'CMO and content creator'} for ${b.brandName}.`,
    b.website ? `Website: ${b.website}` : '',
    b.productPitch ? `Product: ${b.productPitch}` : '',
    b.productDescription ? `Description: ${b.productDescription}` : '',
    b.pricing ? `Pricing: ${b.pricing}` : '',
    b.freeTrial ? `Free trial: ${b.freeTrial}` : '',
    b.keyFeatures?.length ? `Key features: ${b.keyFeatures.join(', ')}` : '',
    b.uniqueSellingPoints?.length ? `USPs: ${b.uniqueSellingPoints.join(', ')}` : '',
    b.proofPoints?.length ? `Proof points: ${b.proofPoints.join(', ')}` : '',
    b.targetUsers ? `Target audience: ${b.targetUsers}` : '',
    b.targetDomain ? `Industry: ${b.targetDomain}` : '',
    b.painPoints?.length ? `Pain points we solve: ${b.painPoints.join(', ')}` : '',
    b.competitors?.length ? `Competitors: ${b.competitors.join(', ')}` : '',
    b.competitiveAdvantage ? `Our advantage: ${b.competitiveAdvantage}` : '',
    `Brand voice: ${b.brandVoice}. Tone: ${b.contentTone}.`,
    b.avoidTopics?.length ? `NEVER mention: ${b.avoidTopics.join(', ')}` : '',
    `Write scroll-stopping captions that drive engagement and conversions. Follow current trends in ${b.targetDomain || 'the industry'}.`,
  ].filter(Boolean).join('\n');
}

export function buildCaptionUserPrompt(b: BrandConfig, city: string, trend?: string): string {
  const platform = b.targetPlatforms[0] || 'instagram';
  return [
    `${platform} post for ${b.brandName} targeting ${b.targetUsers} in ${city}.`,
    trend ? `Trend: "${trend}".` : '',
    `CAPTION: <100-150 chars with engaging hook, 1 stat or benefit, emoji>`,
    `HASHTAGS: ${b.hashtagPrefix} <8-10 more trending + local hashtags>`,
    `CTA: <short compelling CTA>`,
  ].filter(Boolean).join('\n');
}

export function buildTrendSystemPrompt(b: BrandConfig): string {
  return [
    `You are a social media trend analyst specializing in ${b.targetDomain} marketing.`,
    `You research trends for ${b.brandName} targeting ${b.targetUsers}.`,
    `Respond in the exact format requested, no extra text.`,
  ].join('\n');
}

export function buildTrendResearchPrompt(b: BrandConfig): string {
  const now = new Date();
  const regions = b.targetCities.join(', ') || 'globally';
  const platforms = b.targetPlatforms.join(', ') || 'Instagram';
  return `What is trending on ${platforms} right now for ${b.targetDomain} content in ${regions}? Today is ${now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.

TREND: <one trending topic or format right now for ${b.targetDomain}>
REEL_AUDIO: <one trending reel song that works for ${b.targetDomain} content, include artist>
TAGS: <10 trending hashtags for ${b.targetDomain} marketing in ${regions}, comma separated>
ANGLE: <how ${b.brandName} (${b.productPitch}) should ride this trend>`;
}

export function buildImagePrompt(
  b: BrandConfig,
  caption: string,
  trend: string,
  city: string,
  styleName: string,
  stylePrompt: string,
): string {
  const captionCore = caption
    .replace(/#\w+/g, '').replace(/[☕✨🔥💪🎉📱🚀]/g, '')
    .replace(new RegExp(b.website?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'NOMATCH', 'gi'), '')
    .trim().slice(0, 120);

  return [
    `Marketing image for ${b.brandName}${b.tagline ? ` — ${b.tagline}` : ''}.`,
    '',
    `CONTENT THEME: ${captionCore || `${b.brandName} in ${city}`}`,
    trend ? `TREND: "${trend}" — incorporate this trend's energy and mood.` : '',
    `SETTING: ${city}, targeting ${b.targetDomain} / ${b.targetUsers}`,
    '',
    `VISUAL STYLE: ${stylePrompt}`,
    '',
    `BRAND COLOR: ${b.primaryColor} — use as dominant accent throughout.`,
    `SECONDARY: ${b.secondaryColor}. ACCENT: ${b.accentColor}.`,
    `INDUSTRY: ${b.targetDomain}. Feel: ${b.brandVoice}.`,
    `COMPOSITION: 1080x1080 square. Strong focal point. Social media optimized.`,
    '',
    `STRICT: NO text, NO words, NO letters, NO numbers in the image. Pure visual only.`,
    `Must feel authentic and engaging for ${b.targetUsers}.`,
  ].filter(Boolean).join('\n');
}
