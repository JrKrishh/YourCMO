/**
 * Server entry point.
 *
 * Creates the DI Container, builds the ApiServer with all dashboard
 * handler dependencies, loads the dashboard HTML, and starts listening.
 */

import { Container } from './container';
import { ApiServer, ServerConfig } from './api/server';
import { CampaignMetricsCollector } from './engines/campaign-manager/campaign-metrics-collector';
import { loadDashboardHtml } from './api/route-handlers';
import { DashboardHandlerDeps } from './api/dashboard-handlers';
import { createLogger } from './utils/logger';

const log = createLogger('Main');

export function buildDashboardDeps(container: Container): DashboardHandlerDeps {
  return {
    campaignManager: container.campaignManager,
    metricsCollector: new CampaignMetricsCollector(),
    contentEngine: container.contentGeneration,
    imageGenerator: container.imageGenerator,
    costGuard: container.costGuard,
    campaignScheduler: container.campaignScheduler,
    mimoBrain: container.mimoBrain,
  };
}

export async function startServer(): Promise<{ server: ApiServer; container: Container }> {
  const container = new Container();
  await container.initialize();

  const deps = buildDashboardDeps(container);

  // Cache dashboard HTML before the server starts accepting requests
  loadDashboardHtml();

  const serverConfig: ServerConfig = {
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiKeys: (process.env.API_KEYS ?? '').split(',').filter(Boolean),
  };

  const server = new ApiServer(serverConfig, deps);
  await server.start();

  log.info({ port: serverConfig.port }, 'Server started with dashboard dependencies');
  return { server, container };
}

// Run when executed directly
startServer().catch((err) => {
  log.error({ err }, 'Failed to start server');
  process.exit(1);
});
