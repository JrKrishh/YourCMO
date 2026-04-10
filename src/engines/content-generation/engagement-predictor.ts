import { Trend } from '../../models';

/**
 * Heuristic weights for engagement prediction.
 */
const WEIGHTS = {
  trendEngagement: 0.35,
  trendVelocity: 0.15,
  hashtagRelevance: 0.20,
  textQuality: 0.15,
  ctaPresence: 0.05,
  lengthScore: 0.10,
};

/**
 * Scores hashtag relevance by checking overlap with trend hashtags.
 */
function scoreHashtagRelevance(hashtags: string[], trend: Trend): number {
  if (hashtags.length === 0) return 0;
  const trendSet = new Set(trend.hashtags.map((h) => h.toLowerCase()));
  const matching = hashtags.filter((h) => trendSet.has(h.toLowerCase())).length;
  return Math.min(1, matching / Math.max(1, trendSet.size));
}

/**
 * Scores text quality based on simple heuristics:
 * - Has question (engagement driver)
 * - Has emoji
 * - Reasonable length
 */
function scoreTextQuality(text: string): number {
  let score = 0.3; // baseline
  if (/\?/.test(text)) score += 0.2; // questions drive engagement
  if (/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/u.test(text)) score += 0.15; // emoji
  if (text.length >= 50 && text.length <= 500) score += 0.2; // good length
  if (/!/.test(text)) score += 0.15; // excitement
  return Math.min(1, score);
}

/**
 * Scores content length — medium-length posts tend to perform best.
 */
function scoreLengthOptimality(text: string): number {
  const len = text.length;
  if (len >= 100 && len <= 300) return 1.0;
  if (len >= 50 && len <= 500) return 0.7;
  if (len < 50) return 0.3;
  return 0.5;
}

/**
 * Predicts engagement score (0-1) for generated content using
 * heuristic-based analysis. Falls back to trend engagement score
 * if content data is insufficient.
 *
 * Factors considered:
 * - Trend engagement score and velocity
 * - Hashtag overlap with trend
 * - Text quality signals (questions, emoji, length)
 * - Presence of call-to-action
 */
export function predictEngagement(
  text: string,
  hashtags: string[],
  trend: Trend,
): number {
  // Fallback: if no text, return a fraction of the trend score
  if (!text || text.trim().length === 0) {
    return trend.engagementScore * 0.5;
  }

  const trendScore = trend.engagementScore;
  const velocityScore = Math.min(1, trend.velocity / 100); // normalise velocity
  const hashtagScore = scoreHashtagRelevance(hashtags, trend);
  const textScore = scoreTextQuality(text);
  const ctaScore = text.toLowerCase().includes('click') ||
    text.toLowerCase().includes('learn more') ||
    text.toLowerCase().includes('shop now') ||
    text.toLowerCase().includes('sign up') ||
    text.toLowerCase().includes('link in bio')
    ? 1.0
    : 0.3;
  const lengthScore = scoreLengthOptimality(text);

  const predicted =
    trendScore * WEIGHTS.trendEngagement +
    velocityScore * WEIGHTS.trendVelocity +
    hashtagScore * WEIGHTS.hashtagRelevance +
    textScore * WEIGHTS.textQuality +
    ctaScore * WEIGHTS.ctaPresence +
    lengthScore * WEIGHTS.lengthScore;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, predicted));
}
