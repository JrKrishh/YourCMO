import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnv, getEnvOrDefault, loadEnvConfig } from './env';

describe('env utilities', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getEnv', () => {
    it('returns the value when the variable is set', () => {
      process.env.TEST_VAR = 'hello';
      expect(getEnv('TEST_VAR')).toBe('hello');
    });

    it('returns undefined for unset non-required variable', () => {
      delete process.env.MISSING_VAR;
      expect(getEnv('MISSING_VAR')).toBeUndefined();
    });

    it('throws for missing required variable', () => {
      delete process.env.MISSING_VAR;
      expect(() => getEnv('MISSING_VAR', true)).toThrow(
        'Missing required environment variable: MISSING_VAR'
      );
    });
  });

  describe('getEnvOrDefault', () => {
    it('returns env value when set', () => {
      process.env.TEST_VAR = 'value';
      expect(getEnvOrDefault('TEST_VAR', 'default')).toBe('value');
    });

    it('returns default when variable is not set', () => {
      delete process.env.UNSET_VAR;
      expect(getEnvOrDefault('UNSET_VAR', 'fallback')).toBe('fallback');
    });
  });

  describe('loadEnvConfig', () => {
    it('loads config with defaults when no env vars are set', () => {
      const config = loadEnvConfig();
      expect(config.agentFrameworkType).toBe('OpenClaw');
      expect(config.llmProvider).toBe('MiMo');
      expect(config.logLevel).toBe('info');
      expect(config.defaultDailyBudgetLimit).toBe(50);
      expect(config.defaultTotalBudgetLimit).toBe(500);
    });

    it('loads config from environment variables', () => {
      process.env.AGENT_FRAMEWORK_TYPE = 'LangChain';
      process.env.LLM_PROVIDER = 'Anthropic';
      process.env.LOG_LEVEL = 'debug';
      process.env.DEFAULT_DAILY_BUDGET_LIMIT = '200';

      const config = loadEnvConfig();
      expect(config.agentFrameworkType).toBe('LangChain');
      expect(config.llmProvider).toBe('Anthropic');
      expect(config.logLevel).toBe('debug');
      expect(config.defaultDailyBudgetLimit).toBe(200);
    });
  });
});
