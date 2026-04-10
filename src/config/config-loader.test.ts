import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadRawConfig,
  validateConfig,
  ConfigLoader,
  type RawConfig,
} from './config-loader';
import { InMemorySecretsManager } from './secrets-manager';

describe('config-loader', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set minimal valid env for each test
    process.env.AGENT_FRAMEWORK_TYPE = 'OpenClaw';
    process.env.LLM_PROVIDER = 'MiMo';
    process.env.PLATFORMS = 'INSTAGRAM,FACEBOOK';
    process.env.LOG_LEVEL = 'info';
    process.env.DEFAULT_DAILY_BUDGET_LIMIT = '100';
    process.env.DEFAULT_TOTAL_BUDGET_LIMIT = '1000';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('loadRawConfig', () => {
    it('loads defaults when env vars are minimal', () => {
      delete process.env.AGENT_FRAMEWORK_TYPE;
      delete process.env.LLM_PROVIDER;
      const raw = loadRawConfig();
      expect(raw.frameworkType).toBe('OpenClaw');
      expect(raw.llmProvider).toBe('MiMo');
      expect(raw.logLevel).toBe('info');
      expect(raw.dailyBudgetLimit).toBe(100);
      expect(raw.totalBudgetLimit).toBe(1000);
    });

    it('reads API keys from env', () => {
      process.env.OPENAI_API_KEY = 'sk-test123';
      const raw = loadRawConfig();
      expect(raw.apiKeys['OPENAI_API_KEY']).toBe('sk-test123');
    });

    it('reads custom platforms', () => {
      process.env.PLATFORMS = 'TIKTOK,WHATSAPP';
      const raw = loadRawConfig();
      expect(raw.platforms).toBe('TIKTOK,WHATSAPP');
    });
  });

  describe('validateConfig', () => {
    const validRaw: RawConfig = {
      frameworkType: 'OpenClaw',
      llmProvider: 'OpenAI',
      platforms: 'INSTAGRAM,FACEBOOK',
      logLevel: 'info',
      dailyBudgetLimit: 100,
      totalBudgetLimit: 1000,
      budgetCurrency: 'USD',
      brandName: 'Test Brand',
      brandVoice: 'casual',
      audienceAgeMin: 18,
      audienceAgeMax: 65,
      audienceInterests: 'tech,fashion',
      apiKeys: {},
    };

    it('passes for valid config', () => {
      const result = validateConfig(validRaw);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects unsupported framework', () => {
      const result = validateConfig({ ...validRaw, frameworkType: 'BadFramework' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'frameworkType')).toBe(true);
    });

    it('rejects unsupported LLM provider', () => {
      const result = validateConfig({ ...validRaw, llmProvider: 'Unknown' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'llmProvider')).toBe(true);
    });

    it('rejects empty platforms', () => {
      const result = validateConfig({ ...validRaw, platforms: '' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'platforms')).toBe(true);
    });

    it('rejects invalid platform name', () => {
      const result = validateConfig({ ...validRaw, platforms: 'INSTAGRAM,MYSPACE' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('MYSPACE'))).toBe(true);
    });

    it('rejects negative daily budget', () => {
      const result = validateConfig({ ...validRaw, dailyBudgetLimit: -10 });
      expect(result.valid).toBe(false);
    });

    it('rejects daily budget exceeding total', () => {
      const result = validateConfig({ ...validRaw, dailyBudgetLimit: 2000, totalBudgetLimit: 1000 });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid log level', () => {
      const result = validateConfig({ ...validRaw, logLevel: 'verbose' });
      expect(result.valid).toBe(false);
    });

    it('rejects min age > max age', () => {
      const result = validateConfig({ ...validRaw, audienceAgeMin: 70, audienceAgeMax: 18 });
      expect(result.valid).toBe(false);
    });
  });

  describe('ConfigLoader', () => {
    it('loads a valid AgentConfig from env', async () => {
      const loader = new ConfigLoader();
      const config = await loader.load();
      expect(config.frameworkType).toBe('OpenClaw');
      expect(config.llmProvider).toBe('MiMo');
      expect(config.platforms).toContain('INSTAGRAM');
      expect(config.platforms).toContain('FACEBOOK');
      expect(config.budgetLimits.dailyLimit).toBe(100);
      expect(config.budgetLimits.totalLimit).toBe(1000);
      expect(config.agentId).toBeTruthy();
    });

    it('uses AGENT_ID from env when provided', async () => {
      process.env.AGENT_ID = 'custom-id-123';
      const loader = new ConfigLoader();
      const config = await loader.load();
      expect(config.agentId).toBe('custom-id-123');
    });

    it('throws on invalid configuration', async () => {
      process.env.AGENT_FRAMEWORK_TYPE = 'BadFramework';
      const loader = new ConfigLoader();
      await expect(loader.load()).rejects.toThrow('Configuration validation failed');
    });

    it('resolves secrets from SecretsManager', async () => {
      const sm = new InMemorySecretsManager();
      await sm.setSecret('SECRET_API_KEY', 'from-vault');

      const loader = new ConfigLoader(sm);
      const config = await loader.load();
      expect(config.apiKeys['SECRET_API_KEY']).toBe('from-vault');
    });

    it('validate() returns errors without throwing', () => {
      process.env.AGENT_FRAMEWORK_TYPE = 'BadFramework';
      const loader = new ConfigLoader();
      const result = loader.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
