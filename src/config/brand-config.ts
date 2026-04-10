/**
 * Brand Configuration — dynamic brand DNA that users set up via the setup page.
 * Replaces all hardcoded brand references. Every feature reads from this config.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface BrandConfig {
  // Core identity
  name: string;
  tagline: string;
  website: string;
  logoPath?: string; // relative path to logo file in assets/

  // Visual identity
  primaryColor: string;   // hex e.g. #E8692D
  secondaryColor: string; // hex
  accentColor: string;    // hex

  // Product details
  productType: string;       // e.g. "SaaS", "E-commerce", "App", "Service"
  productPitch: string;      // one-liner pitch
  productDescription: string; // detailed description
  pricing?: string;          // e.g. "$39/month", "Free", "$99 one-time"
  keyFeatures: string[];     // top 3-5 features
  uniqueSellingPoints: string[]; // what makes it different

  // Target audience
  targetDomain: string;      // e.g. "cafes", "fitness", "tech startups"
  targetUsers: string;       // e.g. "cafe owners aged 25-55"
  targetRegions: string[];   // cities/countries e.g. ["Adelaide", "Melbourne"]
  targetPlatforms: string[]; // e.g. ["instagram", "facebook", "tiktok"]

  // Brand voice
  brandVoice: string;        // e.g. "friendly, professional, witty"
  contentTone: string;       // e.g. "casual and approachable"

  // Stats/proof points (optional)
  proofPoints: string[];     // e.g. ["2x repeat visits", "30% revenue growth"]

  // Setup state
  isConfigured: boolean;
  configuredAt?: string;
}

const BRAND_PATH = path.join(process.cwd(), 'data', 'brand.json');

const DEFAULT_BRAND: BrandConfig = {
  name: '',
  tagline: '',
  website: '',
  primaryColor: '#6366F1',
  secondaryColor: '#1E293B',
  accentColor: '#F59E0B',
  productType: '',
  productPitch: '',
  productDescription: '',
  keyFeatures: [],
  uniqueSellingPoints: [],
  targetDomain: '',
  targetUsers: '',
  targetRegions: [],
  targetPlatforms: ['instagram'],
  brandVoice: 'friendly and professional',
  contentTone: 'casual and approachable',
  proofPoints: [],
  isConfigured: false,
};

let _cached: BrandConfig | null = null;

export function loadBrand(): BrandConfig {
  if (_cached) return _cached;
  try {
    if (fs.existsSync(BRAND_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BRAND_PATH, 'utf-8'));
      if (raw.name) {
        _cached = { ...DEFAULT_BRAND, ...raw };
        return _cached;
      }
    }
  } catch {}
  return DEFAULT_BRAND;
}

export function saveBrand(config: Partial<BrandConfig>): BrandConfig {
  const current = loadBrand();
  const updated: BrandConfig = {
    ...current,
    ...config,
    isConfigured: true,
    configuredAt: new Date().toISOString(),
  };
  const dir = path.dirname(BRAND_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BRAND_PATH, JSON.stringify(updated, null, 2));
  _cached = updated;
  return updated;
}

export function clearBrandCache() {
  _cached = null;
}

/** Build the system prompt for content generation from brand config */
export function buildBrandSystemPrompt(brand?: BrandConfig): string {
  const b = brand || loadBrand();
  if (!b.isConfigured) return 'You are a social media marketing expert.';

  return [
    `You are the world's best digital marketing CMO for ${b.name}.`,
    b.website ? `Website: ${b.website}` : '',
    b.productPitch ? `Product: ${b.productPitch}` : '',
    b.pricing ? `Pricing: ${b.pricing}` : '',
    b.keyFeatures.length ? `Key features: ${b.keyFeatures.join(', ')}` : '',
    b.uniqueSellingPoints.length ? `USPs: ${b.uniqueSellingPoints.join(', ')}` : '',
    b.targetUsers ? `Target audience: ${b.targetUsers}` : '',
    b.targetDomain ? `Industry: ${b.targetDomain}` : '',
    b.proofPoints.length ? `Proof points: ${b.proofPoints.join(', ')}` : '',
    b.brandVoice ? `Brand voice: ${b.brandVoice}` : '',
    `Write scroll-stopping captions that drive engagement and conversions.`,
  ].filter(Boolean).join('\n');
}

/** Build image prompt enhancement from brand config */
export function buildBrandImagePrompt(brand?: BrandConfig): string {
  const b = brand || loadBrand();
  if (!b.isConfigured) return '';

  return [
    `\nBRAND: ${b.name}`,
    `PRIMARY COLOR: ${b.primaryColor} — use as dominant accent`,
    `SECONDARY COLOR: ${b.secondaryColor}`,
    b.targetDomain ? `INDUSTRY: ${b.targetDomain}` : '',
    `STRICT: NO text, NO words, NO letters in the image. Pure visual only.`,
  ].filter(Boolean).join('\n');
}
