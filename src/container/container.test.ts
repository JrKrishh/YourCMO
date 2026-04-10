import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from './container';
import { AgentConfig, Platform } from '../models';

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    agentId: 'test-agent',
    frameworkType: 'OpenClaw',
    llmProvider: 'OpenAI',
    apiKeys: {},
    brandProfile: { name: 'TestBrand', voice: 'professional', guidelines: [] },
    targetAudience: { ageRange: [18, 45], interests: ['tech'] },
    platforms: [Platform.INSTAGRAM],
    budgetLimits: { dailyLimit: 50, totalLimit: 500, currency: 'USD' },
    optimizationGoals: [{ metric: 'engagementRate', target: 0.05, weight: 1 }],
    ...overrides,
  };
}

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  it('starts in "created" state', () => {
    expect(container.state).toBe('created');
  });

  it('wires all components and exposes them', () => {
    expect(container.agentCore).toBeDefined();
    expect(container.trendAnalysis).toBeDefined();
    expect(container.contentGeneration).toBeDefined();
    expect(container.visualAssetCreator).toBeDefined();
    expect(container.platformIntegration).toBeDefined();
    expect(container.campaignManager).toBeDefined();
    expect(container.engagementAnalyzer).toBeDefined();
    expect(container.boostRecommender).toBeDefined();
    expect(container.dataAccess).toBeDefined();
    expect(container.configLoader).toBeDefined();
    expect(container.apiKeyManager).toBeDefined();
  });

  describe('initializeWithConfig', () => {
    it('transitions to "ready" with valid config', () => {
      container.initializeWithConfig(makeConfig());
      expect(container.state).toBe('ready');
      expect(container.agentCore.isInitialized).toBe(true);
    });

    it('throws on invalid config', () => {
      expect(() =>
        container.initializeWithConfig(makeConfig({ agentId: '' })),
      ).toThrow();
    });
  });

  describe('shutdown', () => {
    it('transitions to "stopped"', async () => {
      container.initializeWithConfig(makeConfig());
      await container.shutdown();
      expect(container.state).toBe('stopped');
      expect(container.agentCore.isInitialized).toBe(false);
    });

    it('is idempotent', async () => {
      container.initializeWithConfig(makeConfig());
      await container.shutdown();
      await container.shutdown();
      expect(container.state).toBe('stopped');
    });
  });

  describe('healthCheck', () => {
    it('returns degraded when agent is not initialized', () => {
      const health = container.healthCheck();
      expect(health.status).toBe('degraded');
      const agentHealth = health.components.find((c) => c.name === 'AgentCore');
      expect(agentHealth?.status).toBe('degraded');
    });

    it('returns healthy when agent is initialized', () => {
      container.initializeWithConfig(makeConfig());
      const health = container.healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.components.every((c) => c.status === 'healthy')).toBe(true);
      expect(health.timestamp).toBeInstanceOf(Date);
    });

    it('includes all expected components', () => {
      const health = container.healthCheck();
      const names = health.components.map((c) => c.name);
      expect(names).toContain('AgentCore');
      expect(names).toContain('DataAccessLayer');
      expect(names).toContain('TrendAnalysisEngine');
      expect(names).toContain('ContentGenerationEngine');
      expect(names).toContain('VisualAssetCreator');
      expect(names).toContain('PlatformIntegrationLayer');
      expect(names).toContain('CampaignManager');
      expect(names).toContain('OptimizationEngine');
      expect(names).toContain('ConfigLoader');
    });
  });
});
