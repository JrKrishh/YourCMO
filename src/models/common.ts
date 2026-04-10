import { TrendLifecyclePhase } from './enums';

/** Brand profile for content generation */
export interface BrandProfile {
  name: string;
  voice: string;
  guidelines: string[];
  logoUrl?: string;
  colorPalette?: string[];
}

/** Target audience profile */
export interface AudienceProfile {
  ageRange: [number, number];
  interests: string[];
  locations?: string[];
  languages?: string[];
}

/** Budget configuration */
export interface BudgetConfig {
  dailyLimit: number;
  totalLimit: number;
  currency: string;
}

/** Budget tracking */
export interface Budget {
  dailyLimit: number;
  totalLimit: number;
  remaining: number;
  spent: number;
  currency: string;
}

/** Optimization goal */
export interface OptimizationGoal {
  metric: string;
  target: number;
  weight: number;
}

/** Image/video dimensions */
export interface Dimensions {
  width: number;
  height: number;
}

/** Asset metadata */
export interface AssetMetadata {
  altText?: string;
  captions?: string;
  tags?: string[];
  createdAt: Date;
}

/** Visual specifications for content */
export interface VisualSpecs {
  type: 'IMAGE' | 'VIDEO';
  dimensions: Dimensions;
  format: string;
  maxFileSize: number;
  duration?: number;
}

/** Geographic location */
export interface Location {
  latitude?: number;
  longitude?: number;
  name?: string;
}

/** Content reference for related content */
export interface ContentReference {
  contentId: string;
  url: string;
  platform: string;
}

/** Demographic data for trends */
export interface DemographicData {
  ageGroups: Record<string, number>;
  genderDistribution: Record<string, number>;
  topLocations: string[];
}

/** Trend lifecycle prediction */
export interface TrendLifecycle {
  currentPhase: TrendLifecyclePhase;
  estimatedPeakDate: Date;
  estimatedEndDate: Date;
  confidence: number;
}

/** Audience segment */
export interface Segment {
  segmentId: string;
  name: string;
  criteria: Record<string, unknown>;
  size: number;
  members: string[];
}

/** Campaign schedule */
export interface Schedule {
  startDate: Date;
  endDate: Date;
  timezone: string;
  sendTimes: Date[];
  engagementTrackingWindow?: number;
}

/** Ad targeting parameters */
export interface AdTargeting {
  ageRange?: [number, number];
  locations?: string[];
  interests?: string[];
  keywords?: string[];
  customAudiences?: string[];
}

/** Bid strategy for ad campaigns */
export interface BidStrategy {
  type: 'CPC' | 'CPM' | 'CPA' | 'ROAS';
  maxBid?: number;
  targetCost?: number;
}

/** Ad performance metrics */
export interface AdPerformance {
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  cpc: number;
  cpm: number;
  ctr: number;
  roi: number;
}

/** Campaign-level metrics */
export interface CampaignMetrics {
  totalReach: number;
  totalImpressions: number;
  totalEngagements: number;
  averageEngagementRate: number;
  totalSpend: number;
  roi: number;
}

/** Optimization rule for campaigns */
export interface OptimizationRule {
  metric: string;
  threshold: number;
  action: string;
}

/** A single audience member with demographic and behavioral data */
export interface AudienceMember {
  memberId: string;
  age?: number;
  gender?: string;
  location?: string;
  language?: string;
  engagementLevel?: 'low' | 'medium' | 'high';
  purchaseHistory?: number; // total purchases
  interests?: string[];
  [key: string]: unknown; // allow arbitrary demographic/behavior fields
}

/** A collection of audience members */
export interface Audience {
  members: AudienceMember[];
}

/** Segmentation type */
export type SegmentationType = 'demographic' | 'behavioral';

/** A single segmentation rule */
export interface SegmentationRule {
  field: string;
  type: SegmentationType;
  /** For numeric fields: bucket boundaries (e.g. [18, 25, 35, 50, 65]) */
  buckets?: number[];
  /** For string/enum fields: explicit groups (e.g. [['male'], ['female'], ['other']]) */
  groups?: string[][];
}

/** Criteria controlling how audience segmentation is performed */
export interface SegmentationCriteria {
  rules: SegmentationRule[];
  minSegmentSize: number;
}
