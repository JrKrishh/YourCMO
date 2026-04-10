import { Platform, ContentTone } from './enums';
import { VisualSpecs } from './common';

/**
 * Model 3: ContentSuggestion
 * Generated content with text, caption, hashtags, CTA, target platforms,
 * tone, estimated engagement, visual requirements.
 */
export interface ContentSuggestion {
  contentId: string;
  text: string;
  caption: string;
  hashtags: string[];
  callToAction: string;
  targetPlatforms: Platform[];
  trendReferences: string[];
  tone: ContentTone;
  estimatedEngagement: number;
  visualRequirements: VisualSpecs;
}
