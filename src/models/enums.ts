/** Supported social media platforms */
export enum Platform {
  INSTAGRAM = 'INSTAGRAM',
  FACEBOOK = 'FACEBOOK',
  TWITTER = 'TWITTER',
  TIKTOK = 'TIKTOK',
  WHATSAPP = 'WHATSAPP',
}

/** Advertising platforms */
export enum AdPlatform {
  GOOGLE_ADS = 'GOOGLE_ADS',
  INSTAGRAM_ADS = 'INSTAGRAM_ADS',
}

/** Visual asset types */
export enum AssetType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

/** Campaign types */
export enum CampaignType {
  WHATSAPP = 'WHATSAPP',
  MULTI_PLATFORM = 'MULTI_PLATFORM',
  AD_CAMPAIGN = 'AD_CAMPAIGN',
}

/** Campaign lifecycle statuses */
export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
}

/** Ad campaign statuses */
export enum AdStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

/** Content tone options */
export enum ContentTone {
  PROFESSIONAL = 'professional',
  CASUAL = 'casual',
  HUMOROUS = 'humorous',
  INSPIRATIONAL = 'inspirational',
  EDUCATIONAL = 'educational',
  URGENT = 'urgent',
}

/** Trend lifecycle phases */
export enum TrendLifecyclePhase {
  EMERGING = 'EMERGING',
  GROWING = 'GROWING',
  PEAKING = 'PEAKING',
  DECLINING = 'DECLINING',
  EXPIRED = 'EXPIRED',
}
