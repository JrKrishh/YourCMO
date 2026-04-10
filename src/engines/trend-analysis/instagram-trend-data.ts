/**
 * Instagram Trend Data — curated trend intelligence for marketing.
 *
 * This module provides current trend data (viral songs, hashtags, content formats,
 * cafe-specific trends) that feeds into the content generation pipeline.
 *
 * Updated: April 2026
 */
import { v4 as uuidv4 } from 'uuid';
import { Platform, TrendLifecyclePhase } from '../../models/enums';
import { Trend } from '../../models/trend';

export interface InstagramTrendEntry {
  name: string;
  category: 'reel_song' | 'viral_hashtag' | 'content_format' | 'cafe_trend';
  description: string;
  engagementLevel: 'high' | 'medium' | 'emerging';
  posts?: string;
  businessSafe: boolean;
  marketingAngle: string;
  hashtags: string[];
}

/** April 2026 Instagram trends relevant to the brand */
export const INSTAGRAM_TRENDS_APRIL_2026: InstagramTrendEntry[] = [
  {
    name: 'Titanium x Please Me — TRUE CHAD',
    category: 'reel_song',
    description: '#1 trending. Transformation/glow-up energy — slowed vocals + upbeat tempo.',
    engagementLevel: 'high',
    posts: '#1 trending',
    businessSafe: true,
    marketingAngle: 'Paper card → digital stamps transformation reel',
    hashtags: ['#YourBrand', '#CafeLoyalty', '#DigitalLoyalty', '#Transformation'],
  },
  {
    name: 'Who Is Me — Elle King',
    category: 'reel_song',
    description: 'Relaxed sunny-day vibe. Perfect for cafe morning routines.',
    engagementLevel: 'high',
    businessSafe: true,
    marketingAngle: 'Morning cafe routine: open shop → espresso → first the brand scan',
    hashtags: ['#YourBrand', '#CafeLife', '#MorningCoffee', '#CafeOwner'],
  },
  {
    name: 'Lucky — Britney Spears',
    category: 'reel_song',
    description: '"She\'s so lucky" trend. Spotlight someone special. 44k posts.',
    engagementLevel: 'high',
    posts: '44k',
    businessSafe: true,
    marketingAngle: '"So lucky to have regulars who come back 2x more"',
    hashtags: ['#YourBrand', '#LoyalCustomers', '#CafeOwner', '#RepeatCustomers'],
  },
  {
    name: 'Loving Life Again',
    category: 'reel_song',
    description: 'Stitch together happy moments. 13k posts.',
    engagementLevel: 'medium',
    posts: '13k',
    businessSafe: true,
    marketingAngle: 'Montage: latte art, stamp collection, happy customer, revenue up',
    hashtags: ['#YourBrand', '#CafeLife', '#SmallBusinessWins', '#CafeLoyalty'],
  },
  {
    name: '"Does he…? I do." format',
    category: 'content_format',
    description: 'Questions on screen, confident zoom-in response.',
    engagementLevel: 'high',
    businessSafe: true,
    marketingAngle: '"Track customer data? $0 commission? 5 min setup?" → "I do."',
    hashtags: ['#YourBrand', '#CafeOwner', '#ZeroCommission', '#CafeTech'],
  },
  {
    name: 'Floral-forward cafe drinks',
    category: 'cafe_trend',
    description: 'Rose lattes, pandan foam, hibiscus iced tea. Spring 2026 most photographed.',
    engagementLevel: 'high',
    businessSafe: true,
    marketingAngle: 'Beautiful floral latte + the brand stamp card on phone beside it',
    hashtags: ['#YourBrand', '#FloralLatte', '#CafeTrends', '#SpringMenu', '#CafeAustralia'],
  },
  {
    name: 'Signature drinks over standard menus',
    category: 'cafe_trend',
    description: 'Hero drinks, tiered pricing, premium origins. Australian cafe 2026.',
    engagementLevel: 'medium',
    businessSafe: true,
    marketingAngle: '"Reward regulars who try your signature" with the brand loyalty',
    hashtags: ['#YourBrand', '#SignatureDrink', '#IndependentCafe', '#CafeMenu'],
  },
  {
    name: '#CafeLoyalty + #DigitalLoyalty rising',
    category: 'viral_hashtag',
    description: 'Loyalty app content gaining traction. Competitors posting heavily.',
    engagementLevel: 'medium',
    businessSafe: true,
    marketingAngle: 'Own #CafeLoyalty. $0 commission differentiator.',
    hashtags: ['#YourBrand', '#CafeLoyalty', '#DigitalLoyalty', '#LoyaltyProgram', '#ZeroCommission'],
  },
];

/** Convert an InstagramTrendEntry to a Trend model for the pipeline */
export function toTrendModel(entry: InstagramTrendEntry): Trend {
  const engagementScore = entry.engagementLevel === 'high' ? 0.85
    : entry.engagementLevel === 'medium' ? 0.6 : 0.35;

  const velocity = entry.engagementLevel === 'high' ? 0.7
    : entry.engagementLevel === 'medium' ? 0.4 : 0.2;

  const phase = entry.engagementLevel === 'high' ? TrendLifecyclePhase.PEAKING
    : entry.engagementLevel === 'medium' ? TrendLifecyclePhase.GROWING
    : TrendLifecyclePhase.EMERGING;

  const now = new Date();

  return {
    trendId: uuidv4(),
    platform: Platform.INSTAGRAM,
    topic: entry.name,
    hashtags: entry.hashtags,
    engagementScore,
    velocity,
    timestamp: now,
    relatedContent: [],
    demographics: {
      ageGroups: { '25-35': 0.4, '35-45': 0.35, '45-55': 0.25 },
      genderDistribution: { male: 0.45, female: 0.55 },
      topLocations: ['Adelaide', 'Melbourne', 'Sydney', 'Brisbane'],
    },
    predictedLifecycle: {
      currentPhase: phase,
      estimatedPeakDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      estimatedEndDate: new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000),
      confidence: 0.75,
    },
  };
}

/** Get all current trends as Trend models */
export function getCurrentInstagramTrends(): Trend[] {
  return INSTAGRAM_TRENDS_APRIL_2026.map(toTrendModel);
}

/** Get top N trends by engagement level */
export function getTopTrends(n: number = 3): Trend[] {
  const sorted = [...INSTAGRAM_TRENDS_APRIL_2026].sort((a, b) => {
    const order = { high: 3, medium: 2, emerging: 1 };
    return order[b.engagementLevel] - order[a.engagementLevel];
  });
  return sorted.slice(0, n).map(toTrendModel);
}

/** Get reel song recommendations */
export function getReelSongRecommendations(): InstagramTrendEntry[] {
  return INSTAGRAM_TRENDS_APRIL_2026.filter(
    t => t.category === 'reel_song' && t.businessSafe,
  );
}
