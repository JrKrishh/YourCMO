import dotenv from 'dotenv';

dotenv.config();

/**
 * Retrieves an environment variable value.
 * Throws if the variable is required and not set.
 */
export function getEnv(key: string, required = false): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Retrieves an environment variable with a default fallback.
 */
export function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/** Environment configuration for the agent */
export interface EnvConfig {
  agentFrameworkType: string;
  llmProvider: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  instagramClientId?: string;
  instagramClientSecret?: string;
  facebookAppId?: string;
  facebookAppSecret?: string;
  twitterApiKey?: string;
  twitterApiSecret?: string;
  tiktokClientKey?: string;
  tiktokClientSecret?: string;
  whatsappBusinessAccountId?: string;
  whatsappApiToken?: string;
  googleAdsClientId?: string;
  googleAdsClientSecret?: string;
  googleAdsDeveloperToken?: string;
  instagramAdsAccessToken?: string;
  imageGenerationApiKey?: string;
  videoGenerationApiKey?: string;
  logLevel: string;
  defaultDailyBudgetLimit: number;
  defaultTotalBudgetLimit: number;
}

/**
 * Loads all environment variables into a typed configuration object.
 */
export function loadEnvConfig(): EnvConfig {
  return {
    agentFrameworkType: getEnvOrDefault('AGENT_FRAMEWORK_TYPE', 'OpenClaw'),
    llmProvider: getEnvOrDefault('LLM_PROVIDER', 'OpenAI'),
    openaiApiKey: getEnv('OPENAI_API_KEY'),
    anthropicApiKey: getEnv('ANTHROPIC_API_KEY'),
    instagramClientId: getEnv('INSTAGRAM_CLIENT_ID'),
    instagramClientSecret: getEnv('INSTAGRAM_CLIENT_SECRET'),
    facebookAppId: getEnv('FACEBOOK_APP_ID'),
    facebookAppSecret: getEnv('FACEBOOK_APP_SECRET'),
    twitterApiKey: getEnv('TWITTER_API_KEY'),
    twitterApiSecret: getEnv('TWITTER_API_SECRET'),
    tiktokClientKey: getEnv('TIKTOK_CLIENT_KEY'),
    tiktokClientSecret: getEnv('TIKTOK_CLIENT_SECRET'),
    whatsappBusinessAccountId: getEnv('WHATSAPP_BUSINESS_ACCOUNT_ID'),
    whatsappApiToken: getEnv('WHATSAPP_API_TOKEN'),
    googleAdsClientId: getEnv('GOOGLE_ADS_CLIENT_ID'),
    googleAdsClientSecret: getEnv('GOOGLE_ADS_CLIENT_SECRET'),
    googleAdsDeveloperToken: getEnv('GOOGLE_ADS_DEVELOPER_TOKEN'),
    instagramAdsAccessToken: getEnv('INSTAGRAM_ADS_ACCESS_TOKEN'),
    imageGenerationApiKey: getEnv('IMAGE_GENERATION_API_KEY'),
    videoGenerationApiKey: getEnv('VIDEO_GENERATION_API_KEY'),
    logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
    defaultDailyBudgetLimit: Number(getEnvOrDefault('DEFAULT_DAILY_BUDGET_LIMIT', '100')),
    defaultTotalBudgetLimit: Number(getEnvOrDefault('DEFAULT_TOTAL_BUDGET_LIMIT', '1000')),
  };
}
