/**
 * Configuration loader and validator.
 * Loads configuration from environment variables, validates required fields
 * and formats, and optionally resolves secrets from a SecretsManager.
 */

import { v4 as uuidv4 } from 'uuid';
import { Platform } from '../models/enums';
import type { AgentConfig } from '../models/agent-config';
import type { BrandProfile, AudienceProfile, BudgetConfig, OptimizationGoal } from '../models/common';
import { getEnv, getEnvOrDefault } from '../utils/env';
import type { SecretsManager } from './secrets-manager';

/** Describes a single validation error. */
export interface ConfigValidationError {
  field: string;
  message: string;
}

/** Result of configuration validation. */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

/** Flat key-value representation loaded from env before mapping to AgentConfig. */
export interface RawConfig {
  agentId?: string;
  frameworkType: string;
  llmProvider: string;
  platforms: string;
  logLevel: string;
  dailyBudgetLimit: number;
  totalBudgetLimit: number;
  budgetCurrency: string;
  brandName: string;
  brandVoice: string;
  audienceAgeMin: number;
  audienceAgeMax: number;
  audienceInterests: string;
  /** All env vars that look like API keys (resolved later). */
  apiKeys: Record<string, string>;
}

const SUPPORTED_FRAMEWORKS = ['OpenClaw', 'LangChain', 'AutoGPT'];
const SUPPORTED_LLM_PROVIDERS = ['OpenRouter', 'MiMo', 'OpenAI', 'Anthropic', 'Google', 'Cohere'];
const VALID_PLATFORMS = new Set(Object.values(Platform));
const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];

/**
 * Loads a RawConfig from environment variables.
 */
export function loadRawConfig(): RawConfig {
  const apiKeys: Record<string, string> = {};
  const keyEnvNames = [
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET',
    'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET',
    'TWITTER_API_KEY', 'TWITTER_API_SECRET',
    'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
    'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_API_TOKEN',
    'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN',
    'INSTAGRAM_ADS_ACCESS_TOKEN',
    'IMAGE_GENERATION_API_KEY', 'VIDEO_GENERATION_API_KEY',
  ];
  for (const name of keyEnvNames) {
    const val = getEnv(name);
    if (val) apiKeys[name] = val;
  }

  return {
    agentId: getEnv('AGENT_ID') ?? undefined,
    frameworkType: getEnvOrDefault('AGENT_FRAMEWORK_TYPE', 'OpenClaw'),
    llmProvider: getEnvOrDefault('LLM_PROVIDER', 'MiMo'),
    platforms: getEnvOrDefault('PLATFORMS', 'INSTAGRAM,FACEBOOK'),
    logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
    dailyBudgetLimit: Number(getEnvOrDefault('DEFAULT_DAILY_BUDGET_LIMIT', '100')),
    totalBudgetLimit: Number(getEnvOrDefault('DEFAULT_TOTAL_BUDGET_LIMIT', '1000')),
    budgetCurrency: getEnvOrDefault('BUDGET_CURRENCY', 'USD'),
    brandName: getEnvOrDefault('BRAND_NAME', 'Default Brand'),
    brandVoice: getEnvOrDefault('BRAND_VOICE', 'professional'),
    audienceAgeMin: Number(getEnvOrDefault('AUDIENCE_AGE_MIN', '18')),
    audienceAgeMax: Number(getEnvOrDefault('AUDIENCE_AGE_MAX', '65')),
    audienceInterests: getEnvOrDefault('AUDIENCE_INTERESTS', ''),
    apiKeys,
  };
}

/**
 * Validates a RawConfig and returns any errors found.
 */
export function validateConfig(raw: RawConfig): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];

  // Framework type
  if (!SUPPORTED_FRAMEWORKS.includes(raw.frameworkType)) {
    errors.push({ field: 'frameworkType', message: `Unsupported framework: ${raw.frameworkType}. Must be one of: ${SUPPORTED_FRAMEWORKS.join(', ')}` });
  }

  // LLM provider
  if (!SUPPORTED_LLM_PROVIDERS.includes(raw.llmProvider)) {
    errors.push({ field: 'llmProvider', message: `Unsupported LLM provider: ${raw.llmProvider}. Must be one of: ${SUPPORTED_LLM_PROVIDERS.join(', ')}` });
  }

  // Platforms
  const platformNames = raw.platforms.split(',').map(p => p.trim()).filter(Boolean);
  if (platformNames.length === 0) {
    errors.push({ field: 'platforms', message: 'At least one platform must be configured' });
  }
  for (const p of platformNames) {
    if (!VALID_PLATFORMS.has(p as Platform)) {
      errors.push({ field: 'platforms', message: `Invalid platform: ${p}` });
    }
  }

  // Budget
  if (isNaN(raw.dailyBudgetLimit) || raw.dailyBudgetLimit <= 0) {
    errors.push({ field: 'dailyBudgetLimit', message: 'Daily budget limit must be a positive number' });
  }
  if (isNaN(raw.totalBudgetLimit) || raw.totalBudgetLimit <= 0) {
    errors.push({ field: 'totalBudgetLimit', message: 'Total budget limit must be a positive number' });
  }
  if (raw.dailyBudgetLimit > raw.totalBudgetLimit) {
    errors.push({ field: 'dailyBudgetLimit', message: 'Daily budget limit cannot exceed total budget limit' });
  }

  // Log level
  if (!VALID_LOG_LEVELS.includes(raw.logLevel)) {
    errors.push({ field: 'logLevel', message: `Invalid log level: ${raw.logLevel}. Must be one of: ${VALID_LOG_LEVELS.join(', ')}` });
  }

  // Audience age
  if (isNaN(raw.audienceAgeMin) || raw.audienceAgeMin < 0) {
    errors.push({ field: 'audienceAgeMin', message: 'Audience minimum age must be a non-negative number' });
  }
  if (isNaN(raw.audienceAgeMax) || raw.audienceAgeMax < 0) {
    errors.push({ field: 'audienceAgeMax', message: 'Audience maximum age must be a non-negative number' });
  }
  if (raw.audienceAgeMin > raw.audienceAgeMax) {
    errors.push({ field: 'audienceAgeMin', message: 'Audience min age cannot exceed max age' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * ConfigLoader: loads, validates, and optionally enriches configuration
 * with secrets from a SecretsManager.
 */
export class ConfigLoader {
  private secretsManager?: SecretsManager;

  constructor(secretsManager?: SecretsManager) {
    this.secretsManager = secretsManager;
  }

  /**
   * Load configuration from environment variables, validate it,
   * and resolve any secrets from the SecretsManager.
   * Throws if validation fails.
   */
  async load(): Promise<AgentConfig> {
    const raw = loadRawConfig();

    // Resolve secrets if a manager is provided
    if (this.secretsManager) {
      const secretKeys = await this.secretsManager.listKeys();
      for (const sk of secretKeys) {
        const secret = await this.secretsManager.getSecret(sk);
        if (secret) {
          raw.apiKeys[sk] = secret.value;
        }
      }
    }

    const validation = validateConfig(raw);
    if (!validation.valid) {
      const messages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
      throw new Error(`Configuration validation failed: ${messages}`);
    }

    return this.mapToAgentConfig(raw);
  }

  /**
   * Validate the current environment without fully loading.
   */
  validate(): ConfigValidationResult {
    return validateConfig(loadRawConfig());
  }

  private mapToAgentConfig(raw: RawConfig): AgentConfig {
    const platforms = raw.platforms.split(',').map(p => p.trim() as Platform);

    const brandProfile: BrandProfile = {
      name: raw.brandName,
      voice: raw.brandVoice,
      guidelines: [],
    };

    const targetAudience: AudienceProfile = {
      ageRange: [raw.audienceAgeMin, raw.audienceAgeMax],
      interests: raw.audienceInterests ? raw.audienceInterests.split(',').map(i => i.trim()).filter(Boolean) : [],
    };

    const budgetLimits: BudgetConfig = {
      dailyLimit: raw.dailyBudgetLimit,
      totalLimit: raw.totalBudgetLimit,
      currency: raw.budgetCurrency,
    };

    const optimizationGoals: OptimizationGoal[] = [
      { metric: 'engagementRate', target: 0.05, weight: 0.5 },
      { metric: 'reach', target: 10000, weight: 0.3 },
      { metric: 'roi', target: 2.0, weight: 0.2 },
    ];

    return {
      agentId: raw.agentId ?? uuidv4(),
      frameworkType: raw.frameworkType,
      llmProvider: raw.llmProvider,
      apiKeys: raw.apiKeys,
      brandProfile,
      targetAudience,
      platforms,
      budgetLimits,
      optimizationGoals,
    };
  }
}
