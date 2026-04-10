import { describe, it, expect } from 'vitest';
import {
  AgentError,
  TrendAnalysisError,
  ContentGenerationError,
  VisualAssetError,
  PlatformIntegrationError,
  CampaignManagerError,
  OptimizationError,
  ConfigurationError,
} from './error-types';

describe('AgentError', () => {
  it('creates error with component context', () => {
    const err = new AgentError('something broke', { component: 'TestComponent', operation: 'testOp' });
    expect(err.message).toBe('something broke');
    expect(err.name).toBe('AgentError');
    expect(err.context.component).toBe('TestComponent');
    expect(err.context.operation).toBe('testOp');
    expect(err.context.timestamp).toBeInstanceOf(Date);
  });

  it('defaults operation to unknown', () => {
    const err = new AgentError('fail', { component: 'X' });
    expect(err.context.operation).toBe('unknown');
  });

  it('preserves cause error', () => {
    const cause = new Error('root cause');
    const err = new AgentError('wrapper', { component: 'X' }, cause);
    expect(err.cause).toBe(cause);
  });

  it('serializes to JSON', () => {
    const cause = new Error('root');
    const err = new AgentError('msg', { component: 'C', operation: 'op', metadata: { key: 'val' } }, cause);
    const json = err.toJSON();
    expect(json.name).toBe('AgentError');
    expect(json.message).toBe('msg');
    expect((json.context as Record<string, unknown>).component).toBe('C');
    expect((json.cause as Record<string, unknown>).message).toBe('root');
  });

  it('serializes to JSON without cause', () => {
    const err = new AgentError('msg', { component: 'C' });
    const json = err.toJSON();
    expect(json.cause).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const err = new AgentError('test', { component: 'C' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentError);
  });
});

describe('Component-specific errors', () => {
  const errorClasses = [
    { Cls: TrendAnalysisError, name: 'TrendAnalysisError', component: 'TrendAnalysisEngine' },
    { Cls: ContentGenerationError, name: 'ContentGenerationError', component: 'ContentGenerationEngine' },
    { Cls: VisualAssetError, name: 'VisualAssetError', component: 'VisualAssetCreator' },
    { Cls: PlatformIntegrationError, name: 'PlatformIntegrationError', component: 'PlatformIntegration' },
    { Cls: CampaignManagerError, name: 'CampaignManagerError', component: 'CampaignManager' },
    { Cls: OptimizationError, name: 'OptimizationError', component: 'OptimizationEngine' },
    { Cls: ConfigurationError, name: 'ConfigurationError', component: 'Configuration' },
  ] as const;

  for (const { Cls, name, component } of errorClasses) {
    it(`${name} sets correct name and component`, () => {
      const err = new Cls('test error', { operation: 'op' });
      expect(err.name).toBe(name);
      expect(err.context.component).toBe(component);
      expect(err).toBeInstanceOf(AgentError);
      expect(err).toBeInstanceOf(Error);
    });
  }

  it('component error preserves cause', () => {
    const cause = new TypeError('bad type');
    const err = new TrendAnalysisError('failed', { operation: 'fetch' }, cause);
    expect(err.cause).toBe(cause);
  });
});
