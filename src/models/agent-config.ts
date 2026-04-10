import { Platform } from './enums';
import { AudienceProfile, BrandProfile, BudgetConfig, OptimizationGoal } from './common';

/**
 * CMO (Chief Marketing Officer) persona configuration.
 * Carries strategic priorities, decision-making principles, competitive context,
 * and brand positioning that shape every LLM reasoning request.
 */
export interface CMOPersona {
  /** The executive role title, e.g. "Chief Marketing Officer" */
  role: string;
  /** Ordered list of strategic priorities guiding all decisions */
  strategicPriorities: string[];
  /** Principles that constrain every reasoning request */
  decisionPrinciples: string[];
  /** Description of the competitive landscape */
  competitiveContext: string;
  /** Brand positioning statement */
  brandPositioning: string;
}

/**
 * Model 1: AgentConfig
 * Agent configuration with UUID, framework type, LLM provider, API keys,
 * brand profile, target audience, platforms, budget limits, optimization goals.
 */
export interface AgentConfig {
  agentId: string;
  frameworkType: string;
  llmProvider: string;
  apiKeys: Record<string, string>;
  brandProfile: BrandProfile;
  targetAudience: AudienceProfile;
  platforms: Platform[];
  budgetLimits: BudgetConfig;
  optimizationGoals: OptimizationGoal[];
  /** Optional CMO persona. When not provided, a default derived from Brand DNA is used. */
  cmoPersona?: CMOPersona;
}

const CMO_PERSONA_REQUIRED_FIELDS: (keyof CMOPersona)[] = [
  'role',
  'strategicPriorities',
  'decisionPrinciples',
  'competitiveContext',
  'brandPositioning',
];

/**
 * Serialise a CMOPersona to a JSON string.
 */
export function serializeCMOPersona(persona: CMOPersona): string {
  return JSON.stringify(persona);
}

/**
 * Deserialise a JSON string into a CMOPersona.
 * Throws a descriptive error listing all missing required fields.
 */
export function deserializeCMOPersona(json: string): CMOPersona {
  const parsed = JSON.parse(json);

  const missing = CMO_PERSONA_REQUIRED_FIELDS.filter(
    (field) => parsed[field] === undefined || parsed[field] === null,
  );

  if (missing.length > 0) {
    throw new Error(`Missing required CMOPersona fields: ${missing.join(', ')}`);
  }

  return parsed as CMOPersona;
}
