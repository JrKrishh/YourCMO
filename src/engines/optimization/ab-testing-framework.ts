import { createLogger } from '../../utils/logger';
import { Audience, AudienceMember } from '../../models/common';

const logger = createLogger('ABTestingFramework');

/**
 * A content variation to be tested in an A/B test.
 */
export interface ContentVariation {
  variationId: string;
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Simulated engagement result for a single audience member exposed to a variation.
 */
export interface MemberEngagement {
  memberId: string;
  engaged: boolean;
}

/**
 * A test group: a variation paired with its assigned audience members and results.
 */
export interface TestGroup {
  variation: ContentVariation;
  members: AudienceMember[];
  engagements: MemberEngagement[];
}

/**
 * Statistical result for a single variation within an A/B test.
 */
export interface VariationResult {
  variationId: string;
  name: string;
  sampleSize: number;
  engagements: number;
  engagementRate: number;
}

/**
 * The overall result of an A/B test.
 */
export interface ABTestResult {
  testId: string;
  groups: VariationResult[];
  winner: VariationResult | null;
  isSignificant: boolean;
  pValue: number;
  confidenceLevel: number;
}

/**
 * Configuration for the A/B testing framework.
 */
export interface ABTestingConfig {
  /** Confidence level for statistical significance (default: 0.95) */
  confidenceLevel: number;
  /** Minimum sample size per group (default: 30) */
  minSampleSize: number;
}

const DEFAULT_CONFIG: ABTestingConfig = {
  confidenceLevel: 0.95,
  minSampleSize: 30,
};

/**
 * Assigns audience members to test groups in a balanced, deterministic-random way.
 *
 * Uses a simple round-robin shuffle: the audience is shuffled, then members are
 * distributed evenly across the variations. If the audience doesn't divide evenly,
 * the first groups receive one extra member.
 *
 * @returns An array of TestGroups (one per variation), each with its assigned members.
 */
export function assignTestGroups(
  variations: ContentVariation[],
  audience: Audience,
): TestGroup[] {
  if (variations.length === 0) {
    return [];
  }

  // Shuffle audience members using Fisher-Yates
  const shuffled = [...audience.members];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Distribute members across groups via round-robin
  const groups: TestGroup[] = variations.map((variation) => ({
    variation,
    members: [],
    engagements: [],
  }));

  for (let i = 0; i < shuffled.length; i++) {
    groups[i % variations.length].members.push(shuffled[i]);
  }

  return groups;
}

/**
 * Calculates the chi-squared statistic for a 2×k contingency table
 * (engaged vs not-engaged across k variations).
 *
 * This is used to test whether engagement rates differ significantly
 * across variations.
 *
 * @returns The chi-squared statistic value.
 */
export function calculateChiSquared(groups: VariationResult[]): number {
  const totalSample = groups.reduce((sum, g) => sum + g.sampleSize, 0);
  const totalEngaged = groups.reduce((sum, g) => sum + g.engagements, 0);

  if (totalSample === 0) {
    return 0;
  }

  const overallRate = totalEngaged / totalSample;

  let chiSquared = 0;
  for (const group of groups) {
    const expectedEngaged = group.sampleSize * overallRate;
    const expectedNotEngaged = group.sampleSize * (1 - overallRate);

    if (expectedEngaged > 0) {
      chiSquared += Math.pow(group.engagements - expectedEngaged, 2) / expectedEngaged;
    }
    const notEngaged = group.sampleSize - group.engagements;
    if (expectedNotEngaged > 0) {
      chiSquared += Math.pow(notEngaged - expectedNotEngaged, 2) / expectedNotEngaged;
    }
  }

  return chiSquared;
}

/**
 * Approximates the p-value from a chi-squared statistic with the given
 * degrees of freedom using the regularized incomplete gamma function.
 *
 * For the A/B test, df = k - 1 where k is the number of variations.
 */
export function chiSquaredPValue(chiSq: number, df: number): number {
  if (df <= 0 || chiSq <= 0) {
    return 1.0;
  }
  // Use the regularized upper incomplete gamma function: p = 1 - gammaLowerRegularized(df/2, chiSq/2)
  return 1 - gammaCDF(df / 2, chiSq / 2);
}

/**
 * Regularized lower incomplete gamma function P(a, x) = γ(a, x) / Γ(a).
 * Computed via series expansion (good for x < a + 1).
 * Falls back to continued fraction for large x.
 */
function gammaCDF(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    return gammaSeries(a, x);
  }
  return 1 - gammaContinuedFraction(a, x);
}

/** Series expansion for the regularized lower incomplete gamma function. */
function gammaSeries(a: number, x: number): number {
  const lnGammaA = lnGamma(a);
  let sum = 1 / a;
  let term = 1 / a;
  for (let n = 1; n < 200; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-10) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGammaA);
}

/**
 * Continued fraction for the regularized upper incomplete gamma function Q(a,x).
 * Uses the modified Lentz algorithm (Numerical Recipes §6.2).
 */
function gammaContinuedFraction(a: number, x: number): number {
  const lnGammaA = lnGamma(a);
  const TINY = 1e-30;

  // b_0 = x + 1 - a, a_0 = 1 (implicit)
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-10) break;
  }

  return Math.exp(-x + a * Math.log(x) - lnGammaA) * h;
}

/** Lanczos approximation for ln(Gamma(x)). */
function lnGamma(x: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  x -= 1;
  let a = coef[0];
  const t = x + g + 0.5;
  for (let i = 1; i < coef.length; i++) {
    a += coef[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Selects the winning variation from the test results.
 *
 * The winner is the variation with the highest engagement rate,
 * but only if the overall test is statistically significant.
 * Returns null if the test is not significant or there are no groups.
 */
export function selectWinner(
  groups: VariationResult[],
  isSignificant: boolean,
): VariationResult | null {
  if (!isSignificant || groups.length === 0) {
    return null;
  }

  let best: VariationResult | null = null;
  for (const group of groups) {
    if (best === null || group.engagementRate > best.engagementRate) {
      best = group;
    }
  }
  return best;
}

/**
 * Engagement simulator function type.
 * Given a variation and a member, returns whether the member engaged.
 */
export type EngagementSimulator = (
  variation: ContentVariation,
  member: AudienceMember,
) => boolean;

/**
 * ABTestingFramework runs A/B tests across content variations for a given audience.
 *
 * It assigns audience members to balanced test groups, simulates (or collects)
 * engagement data, calculates statistical significance using a chi-squared test,
 * and selects a winner if the result is significant.
 */
export class ABTestingFramework {
  private readonly config: ABTestingConfig;

  constructor(config?: Partial<ABTestingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run an A/B test across the given content variations and audience.
   *
   * @param variations - The content variations to test.
   * @param audience - The audience to test against.
   * @param simulator - A function that determines whether a member engages with a variation.
   *                    In production this would be replaced by real engagement tracking.
   * @returns The ABTestResult with statistical analysis and optional winner.
   */
  abTest(
    variations: ContentVariation[],
    audience: Audience,
    simulator: EngagementSimulator,
  ): ABTestResult {
    logger.info(
      { variationCount: variations.length, audienceSize: audience.members.length },
      'Starting A/B test',
    );

    if (variations.length < 2) {
      logger.warn('A/B test requires at least 2 variations');
      return this.buildEmptyResult(variations);
    }

    if (audience.members.length < variations.length * this.config.minSampleSize) {
      logger.warn(
        {
          audienceSize: audience.members.length,
          required: variations.length * this.config.minSampleSize,
        },
        'Audience too small for reliable A/B test',
      );
    }

    // 1. Assign audience to test groups
    const groups = assignTestGroups(variations, audience);

    // 2. Simulate / collect engagement for each group
    for (const group of groups) {
      for (const member of group.members) {
        const engaged = simulator(group.variation, member);
        group.engagements.push({ memberId: member.memberId, engaged });
      }
    }

    // 3. Build variation results
    const variationResults: VariationResult[] = groups.map((g) => {
      const engagedCount = g.engagements.filter((e) => e.engaged).length;
      const sampleSize = g.members.length;
      return {
        variationId: g.variation.variationId,
        name: g.variation.name,
        sampleSize,
        engagements: engagedCount,
        engagementRate: sampleSize > 0 ? engagedCount / sampleSize : 0,
      };
    });

    // 4. Statistical significance via chi-squared test
    const chiSq = calculateChiSquared(variationResults);
    const df = variations.length - 1;
    const pValue = chiSquaredPValue(chiSq, df);
    const significanceThreshold = 1 - this.config.confidenceLevel;
    const isSignificant = pValue < significanceThreshold;

    // 5. Select winner
    const winner = selectWinner(variationResults, isSignificant);

    const testId = `ab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info(
      { testId, pValue, isSignificant, winnerId: winner?.variationId ?? 'none' },
      'A/B test complete',
    );

    return {
      testId,
      groups: variationResults,
      winner,
      isSignificant,
      pValue,
      confidenceLevel: this.config.confidenceLevel,
    };
  }

  private buildEmptyResult(variations: ContentVariation[]): ABTestResult {
    return {
      testId: `ab-${Date.now()}-empty`,
      groups: variations.map((v) => ({
        variationId: v.variationId,
        name: v.name,
        sampleSize: 0,
        engagements: 0,
        engagementRate: 0,
      })),
      winner: null,
      isSignificant: false,
      pValue: 1.0,
      confidenceLevel: this.config.confidenceLevel,
    };
  }
}
