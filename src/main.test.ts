import { describe, it, expect } from 'vitest';
import { Container } from './container';
import { buildDashboardDeps } from './main';

describe('buildDashboardDeps', () => {
  it('builds DashboardHandlerDeps from container instances', () => {
    const container = new Container();
    const deps = buildDashboardDeps(container);

    expect(deps.campaignManager).toBe(container.campaignManager);
    expect(deps.contentEngine).toBe(container.contentGeneration);
    expect(deps.imageGenerator).toBe(container.imageGenerator);
    expect(deps.costGuard).toBe(container.costGuard);
    expect(deps.campaignScheduler).toBe(container.campaignScheduler);
    expect(deps.mimoBrain).toBe(container.mimoBrain);
    expect(deps.metricsCollector).toBeDefined();
  });

  it('returns deps that satisfy DashboardHandlerDeps interface', () => {
    const container = new Container();
    const deps = buildDashboardDeps(container);

    // All required properties exist and are not null/undefined
    const requiredKeys = [
      'campaignManager',
      'metricsCollector',
      'contentEngine',
      'imageGenerator',
      'costGuard',
      'campaignScheduler',
      'mimoBrain',
    ] as const;

    for (const key of requiredKeys) {
      expect(deps[key]).toBeDefined();
      expect(deps[key]).not.toBeNull();
    }
  });
});
