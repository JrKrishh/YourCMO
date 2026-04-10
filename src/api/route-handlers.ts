import fs from 'node:fs';
import path from 'node:path';
import { CampaignManager, CampaignSpec } from '../engines/campaign-manager';
import { CampaignMetricsCollector } from '../engines/campaign-manager/campaign-metrics-collector';
import { CampaignStatus, CampaignType } from '../models';
import { createLogger } from '../utils/logger';
import { ApiRequest, ApiResponse } from './auth-middleware';
import {
  DashboardHandlerDeps,
  generateContentHandler,
  generateImageHandler,
  costSummaryHandler,
  schedulePostHandler,
} from './dashboard-handlers';

const log = createLogger('RouteHandlers');

/** Cached dashboard HTML content, loaded once at startup */
let dashboardHtml: string | null = null;

/**
 * Read and cache `public/dashboard.html` from disk.
 * Call once at server startup before handling requests.
 */
export function loadDashboardHtml(): void {
  const filePath = path.join(process.cwd(), 'public', 'dashboard.html');
  try {
    dashboardHtml = fs.readFileSync(filePath, 'utf-8');
    log.info('Dashboard HTML loaded and cached');
  } catch (err) {
    log.warn({ err }, 'Failed to load dashboard HTML — /dashboard will return 500');
    dashboardHtml = null;
  }
}

/** Dependencies injected into route handlers */
export interface RouteHandlerDeps {
  campaignManager: CampaignManager;
  metricsCollector: CampaignMetricsCollector;
}

/** Route definition — handler may return sync or async response */
export interface Route {
  method: string;
  pattern: string;
  handler: (req: ApiRequest, deps: RouteHandlerDeps) => ApiResponse | Promise<ApiResponse>;
}

/**
 * Match a URL path against a route pattern.
 * Supports :param style path parameters.
 * Returns extracted params or null if no match.
 */
export function matchRoute(
  path: string,
  pattern: string,
): Record<string, string> | null {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  if (pathParts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// --- Individual route handlers ---

/** GET /health */
export function healthHandler(_req: ApiRequest, _deps: RouteHandlerDeps): ApiResponse {
  return jsonResponse(200, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}

/** POST /campaigns — create a new campaign */
export function createCampaignHandler(req: ApiRequest, deps: RouteHandlerDeps): ApiResponse {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      return jsonResponse(400, { error: 'Request body is required' });
    }

    const { name, type, startDate, endDate, budget } = body as Record<string, unknown>;

    if (!name || typeof name !== 'string') {
      return jsonResponse(400, { error: 'name is required and must be a string' });
    }

    if (!type || !Object.values(CampaignType).includes(type as CampaignType)) {
      return jsonResponse(400, {
        error: `type must be one of: ${Object.values(CampaignType).join(', ')}`,
      });
    }

    const spec: CampaignSpec = {
      name,
      type: type as CampaignType,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      budget: budget as CampaignSpec['budget'],
    };

    const campaign = deps.campaignManager.createCampaign(spec);
    log.info({ campaignId: campaign.campaignId }, 'Campaign created via API');
    return jsonResponse(201, campaign);
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /campaigns — list campaigns, optionally filtered by status */
export function listCampaignsHandler(req: ApiRequest, deps: RouteHandlerDeps): ApiResponse {
  try {
    const statusFilter = req.query.status as string | undefined;
    let status: CampaignStatus | undefined;

    if (statusFilter) {
      if (!Object.values(CampaignStatus).includes(statusFilter as CampaignStatus)) {
        return jsonResponse(400, {
          error: `Invalid status filter. Must be one of: ${Object.values(CampaignStatus).join(', ')}`,
        });
      }
      status = statusFilter as CampaignStatus;
    }

    const campaigns = deps.campaignManager.listCampaigns(status);
    return jsonResponse(200, { campaigns, total: campaigns.length });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /campaigns/:id — get a single campaign */
export function getCampaignHandler(req: ApiRequest, deps: RouteHandlerDeps): ApiResponse {
  try {
    const campaign = deps.campaignManager.getCampaign(req.params.id);
    return jsonResponse(200, campaign);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return jsonResponse(404, { error: err.message });
    }
    return errorResponse(err);
  }
}

/** PUT /campaigns/:id/status — update campaign status */
export function updateCampaignStatusHandler(
  req: ApiRequest,
  deps: RouteHandlerDeps,
): ApiResponse {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      return jsonResponse(400, { error: 'Request body is required' });
    }

    const { status } = body;
    if (!status || !Object.values(CampaignStatus).includes(status as CampaignStatus)) {
      return jsonResponse(400, {
        error: `status must be one of: ${Object.values(CampaignStatus).join(', ')}`,
      });
    }

    const campaign = deps.campaignManager.transitionStatus(
      req.params.id,
      status as CampaignStatus,
    );
    log.info({ campaignId: req.params.id, status }, 'Campaign status updated via API');
    return jsonResponse(200, campaign);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return jsonResponse(404, { error: err.message });
    }
    if (err instanceof Error && err.message.includes('Invalid status transition')) {
      return jsonResponse(409, { error: err.message });
    }
    return errorResponse(err);
  }
}

/** GET /campaigns/:id/metrics — get campaign metrics */
export function getCampaignMetricsHandler(
  req: ApiRequest,
  deps: RouteHandlerDeps,
): ApiResponse {
  try {
    const campaign = deps.campaignManager.getCampaign(req.params.id);
    const metrics = deps.metricsCollector.aggregateMetrics(campaign);
    return jsonResponse(200, { campaignId: req.params.id, metrics });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return jsonResponse(404, { error: err.message });
    }
    return errorResponse(err);
  }
}

// --- Route table ---

/** All registered routes */
export const routes: Route[] = [
  { method: 'GET', pattern: '/health', handler: healthHandler },
  { method: 'POST', pattern: '/campaigns', handler: createCampaignHandler },
  { method: 'GET', pattern: '/campaigns', handler: listCampaignsHandler },
  { method: 'GET', pattern: '/campaigns/:id', handler: getCampaignHandler },
  { method: 'PUT', pattern: '/campaigns/:id/status', handler: updateCampaignStatusHandler },
  { method: 'GET', pattern: '/campaigns/:id/metrics', handler: getCampaignMetricsHandler },
  // Dashboard API routes
  {
    method: 'POST',
    pattern: '/api/generate-content',
    handler: (req, deps) => generateContentHandler(req, deps as DashboardHandlerDeps),
  },
  {
    method: 'POST',
    pattern: '/api/generate-image',
    handler: (req, deps) => generateImageHandler(req, deps as DashboardHandlerDeps),
  },
  {
    method: 'GET',
    pattern: '/api/cost-summary',
    handler: (req, deps) => costSummaryHandler(req, deps as DashboardHandlerDeps),
  },
  {
    method: 'POST',
    pattern: '/api/campaigns/:id/schedule',
    handler: (req, deps) => schedulePostHandler(req, deps as DashboardHandlerDeps),
  },
  // Dashboard static file route
  {
    method: 'GET',
    pattern: '/dashboard',
    handler: (_req, _deps) => {
      if (!dashboardHtml) {
        return {
          status: 500,
          body: 'Dashboard not found',
          headers: { 'content-type': 'text/plain' },
        };
      }
      return {
        status: 200,
        body: dashboardHtml,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      };
    },
  },
];

// --- Router ---

/**
 * Route an incoming request to the appropriate handler.
 * Returns a 404 response if no route matches, or 405 if the method is wrong.
 * May return a Promise for async handlers (e.g. dashboard routes).
 */
export function routeRequest(req: ApiRequest, deps: RouteHandlerDeps): ApiResponse | Promise<ApiResponse> {
  // Find matching routes by pattern
  const matchingRoutes: Array<{ route: Route; params: Record<string, string> }> = [];

  for (const route of routes) {
    const params = matchRoute(req.path, route.pattern);
    if (params !== null) {
      matchingRoutes.push({ route, params });
    }
  }

  if (matchingRoutes.length === 0) {
    return jsonResponse(404, { error: 'Not found' });
  }

  // Find the one with matching method
  const match = matchingRoutes.find(
    (m) => m.route.method === req.method.toUpperCase(),
  );

  if (!match) {
    const allowedMethods = matchingRoutes.map((m) => m.route.method).join(', ');
    return {
      status: 405,
      body: { error: 'Method not allowed', allowedMethods },
      headers: {
        'content-type': 'application/json',
        allow: allowedMethods,
      },
    };
  }

  req.params = match.params;
  return match.route.handler(req, deps);
}

// --- Helpers ---

function jsonResponse(status: number, body: unknown): ApiResponse {
  return {
    status,
    body,
    headers: { 'content-type': 'application/json' },
  };
}

function errorResponse(err: unknown): ApiResponse {
  const message = err instanceof Error ? err.message : 'Internal server error';
  log.error({ err }, 'Route handler error');
  return jsonResponse(500, { error: message });
}
