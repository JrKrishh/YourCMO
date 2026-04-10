import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  validateApiKey,
  unauthorizedResponse,
  ApiRequest,
  ApiResponse,
} from './auth-middleware';
import {
  matchRoute,
  routeRequest,
  healthHandler,
  createCampaignHandler,
  listCampaignsHandler,
  getCampaignHandler,
  updateCampaignStatusHandler,
  getCampaignMetricsHandler,
  loadDashboardHtml,
  RouteHandlerDeps,
} from './route-handlers';
import { CampaignManager } from '../engines/campaign-manager';
import { CampaignStore } from '../engines/campaign-manager/campaign-store';
import { CampaignMetricsCollector } from '../engines/campaign-manager/campaign-metrics-collector';
import { CampaignType, CampaignStatus } from '../models';

// --- Test helpers ---

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/',
    headers: {},
    params: {},
    query: {},
    body: undefined,
    ...overrides,
  };
}

function makeDeps(): RouteHandlerDeps {
  const store = new CampaignStore();
  return {
    campaignManager: new CampaignManager(store),
    metricsCollector: new CampaignMetricsCollector(),
  };
}

// --- Auth middleware tests ---

describe('Auth Middleware', () => {
  const validKeys = ['test-key-123', 'another-key'];

  it('allows requests to public paths without API key', () => {
    const req = makeRequest({ path: '/health' });
    const result = validateApiKey(req, validKeys);
    expect(result.authenticated).toBe(true);
  });

  it('rejects requests without x-api-key header', () => {
    const req = makeRequest({ path: '/campaigns' });
    const result = validateApiKey(req, validKeys);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Missing');
  });

  it('rejects requests with invalid API key', () => {
    const req = makeRequest({
      path: '/campaigns',
      headers: { 'x-api-key': 'wrong-key' },
    });
    const result = validateApiKey(req, validKeys);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('accepts requests with valid API key', () => {
    const req = makeRequest({
      path: '/campaigns',
      headers: { 'x-api-key': 'test-key-123' },
    });
    const result = validateApiKey(req, validKeys);
    expect(result.authenticated).toBe(true);
  });

  it('rejects when no API keys are configured', () => {
    const req = makeRequest({
      path: '/campaigns',
      headers: { 'x-api-key': 'any-key' },
    });
    const result = validateApiKey(req, []);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('no API keys configured');
  });

  it('creates proper unauthorized response', () => {
    const res = unauthorizedResponse('test error');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', message: 'test error' });
  });
});

// --- Route matching tests ---

describe('matchRoute', () => {
  it('matches exact paths', () => {
    expect(matchRoute('/health', '/health')).toEqual({});
    expect(matchRoute('/campaigns', '/campaigns')).toEqual({});
  });

  it('extracts path parameters', () => {
    const params = matchRoute('/campaigns/abc-123', '/campaigns/:id');
    expect(params).toEqual({ id: 'abc-123' });
  });

  it('extracts multiple path parameters', () => {
    const params = matchRoute('/campaigns/abc/metrics', '/campaigns/:id/metrics');
    expect(params).toEqual({ id: 'abc' });
  });

  it('returns null for non-matching paths', () => {
    expect(matchRoute('/unknown', '/health')).toBeNull();
    expect(matchRoute('/campaigns/a/b/c', '/campaigns/:id')).toBeNull();
  });
});

// --- Route handler tests ---

describe('Health endpoint', () => {
  it('returns 200 with status ok', () => {
    const deps = makeDeps();
    const req = makeRequest({ path: '/health' });
    const res = healthHandler(req, deps);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.0.0');
    expect(body.timestamp).toBeDefined();
  });
});

describe('POST /campaigns', () => {
  let deps: RouteHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('creates a campaign with valid input', () => {
    const req = makeRequest({
      method: 'POST',
      path: '/campaigns',
      body: { name: 'Test Campaign', type: CampaignType.WHATSAPP },
    });
    const res = createCampaignHandler(req, deps);
    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.name).toBe('Test Campaign');
    expect(body.campaignId).toBeDefined();
    expect(body.status).toBe(CampaignStatus.DRAFT);
  });

  it('returns 400 when body is missing', () => {
    const req = makeRequest({ method: 'POST', path: '/campaigns' });
    const res = createCampaignHandler(req, deps);
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is missing', () => {
    const req = makeRequest({
      method: 'POST',
      path: '/campaigns',
      body: { type: CampaignType.WHATSAPP },
    });
    const res = createCampaignHandler(req, deps);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toContain('name');
  });

  it('returns 400 when type is invalid', () => {
    const req = makeRequest({
      method: 'POST',
      path: '/campaigns',
      body: { name: 'Test', type: 'INVALID' },
    });
    const res = createCampaignHandler(req, deps);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toContain('type');
  });
});

describe('GET /campaigns', () => {
  let deps: RouteHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('returns empty list when no campaigns exist', () => {
    const req = makeRequest({ path: '/campaigns' });
    const res = listCampaignsHandler(req, deps);
    expect(res.status).toBe(200);
    const body = res.body as { campaigns: unknown[]; total: number };
    expect(body.campaigns).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns campaigns after creation', () => {
    deps.campaignManager.createCampaign({ name: 'C1', type: CampaignType.WHATSAPP });
    deps.campaignManager.createCampaign({ name: 'C2', type: CampaignType.MULTI_PLATFORM });

    const req = makeRequest({ path: '/campaigns' });
    const res = listCampaignsHandler(req, deps);
    expect(res.status).toBe(200);
    const body = res.body as { campaigns: unknown[]; total: number };
    expect(body.total).toBe(2);
  });

  it('filters by status', () => {
    deps.campaignManager.createCampaign({ name: 'C1', type: CampaignType.WHATSAPP });
    const req = makeRequest({ path: '/campaigns', query: { status: CampaignStatus.ACTIVE } });
    const res = listCampaignsHandler(req, deps);
    expect(res.status).toBe(200);
    const body = res.body as { campaigns: unknown[]; total: number };
    expect(body.total).toBe(0); // DRAFT, not ACTIVE
  });

  it('returns 400 for invalid status filter', () => {
    const req = makeRequest({ path: '/campaigns', query: { status: 'INVALID' } });
    const res = listCampaignsHandler(req, deps);
    expect(res.status).toBe(400);
  });
});

describe('GET /campaigns/:id', () => {
  let deps: RouteHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('returns a campaign by ID', () => {
    const created = deps.campaignManager.createCampaign({
      name: 'Test',
      type: CampaignType.WHATSAPP,
    });
    const req = makeRequest({
      path: `/campaigns/${created.campaignId}`,
      params: { id: created.campaignId },
    });
    const res = getCampaignHandler(req, deps);
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).campaignId).toBe(created.campaignId);
  });

  it('returns 404 for non-existent campaign', () => {
    const req = makeRequest({
      path: '/campaigns/nonexistent',
      params: { id: 'nonexistent' },
    });
    const res = getCampaignHandler(req, deps);
    expect(res.status).toBe(404);
  });
});

describe('PUT /campaigns/:id/status', () => {
  let deps: RouteHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('transitions campaign status', () => {
    const created = deps.campaignManager.createCampaign({
      name: 'Test',
      type: CampaignType.WHATSAPP,
    });
    const req = makeRequest({
      method: 'PUT',
      path: `/campaigns/${created.campaignId}/status`,
      params: { id: created.campaignId },
      body: { status: CampaignStatus.ACTIVE },
    });
    const res = updateCampaignStatusHandler(req, deps);
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe(CampaignStatus.ACTIVE);
  });

  it('returns 400 when status is missing', () => {
    const created = deps.campaignManager.createCampaign({
      name: 'Test',
      type: CampaignType.WHATSAPP,
    });
    const req = makeRequest({
      method: 'PUT',
      path: `/campaigns/${created.campaignId}/status`,
      params: { id: created.campaignId },
      body: {},
    });
    const res = updateCampaignStatusHandler(req, deps);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent campaign', () => {
    const req = makeRequest({
      method: 'PUT',
      path: '/campaigns/nonexistent/status',
      params: { id: 'nonexistent' },
      body: { status: CampaignStatus.ACTIVE },
    });
    const res = updateCampaignStatusHandler(req, deps);
    expect(res.status).toBe(404);
  });

  it('returns 409 for invalid status transition', () => {
    const created = deps.campaignManager.createCampaign({
      name: 'Test',
      type: CampaignType.WHATSAPP,
    });
    // DRAFT -> COMPLETED is not valid
    const req = makeRequest({
      method: 'PUT',
      path: `/campaigns/${created.campaignId}/status`,
      params: { id: created.campaignId },
      body: { status: CampaignStatus.COMPLETED },
    });
    const res = updateCampaignStatusHandler(req, deps);
    expect(res.status).toBe(409);
  });
});

describe('GET /campaigns/:id/metrics', () => {
  let deps: RouteHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('returns metrics for a campaign', () => {
    const created = deps.campaignManager.createCampaign({
      name: 'Test',
      type: CampaignType.WHATSAPP,
    });
    const req = makeRequest({
      path: `/campaigns/${created.campaignId}/metrics`,
      params: { id: created.campaignId },
    });
    const res = getCampaignMetricsHandler(req, deps);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.campaignId).toBe(created.campaignId);
    expect(body.metrics).toBeDefined();
  });

  it('returns 404 for non-existent campaign', () => {
    const req = makeRequest({
      path: '/campaigns/nonexistent/metrics',
      params: { id: 'nonexistent' },
    });
    const res = getCampaignMetricsHandler(req, deps);
    expect(res.status).toBe(404);
  });
});

// --- Router integration tests ---

describe('routeRequest', () => {
  let deps: RouteHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('routes GET /health correctly', () => {
    const req = makeRequest({ method: 'GET', path: '/health' });
    const res = routeRequest(req, deps);
    expect(res.status).toBe(200);
  });

  it('routes POST /campaigns correctly', () => {
    const req = makeRequest({
      method: 'POST',
      path: '/campaigns',
      body: { name: 'Test', type: CampaignType.WHATSAPP },
    });
    const res = routeRequest(req, deps);
    expect(res.status).toBe(201);
  });

  it('routes GET /campaigns correctly', () => {
    const req = makeRequest({ method: 'GET', path: '/campaigns' });
    const res = routeRequest(req, deps);
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown paths', () => {
    const req = makeRequest({ method: 'GET', path: '/unknown' });
    const res = routeRequest(req, deps);
    expect(res.status).toBe(404);
  });

  it('returns 405 for wrong method on known path', () => {
    const req = makeRequest({ method: 'DELETE', path: '/campaigns' });
    const res = routeRequest(req, deps);
    expect(res.status).toBe(405);
  });

  it('handles full campaign CRUD flow', () => {
    // Create
    const createReq = makeRequest({
      method: 'POST',
      path: '/campaigns',
      body: { name: 'Flow Test', type: CampaignType.MULTI_PLATFORM },
    });
    const createRes = routeRequest(createReq, deps);
    expect(createRes.status).toBe(201);
    const campaignId = (createRes.body as Record<string, unknown>).campaignId as string;

    // Get
    const getReq = makeRequest({ method: 'GET', path: `/campaigns/${campaignId}` });
    const getRes = routeRequest(getReq, deps);
    expect(getRes.status).toBe(200);

    // Update status
    const statusReq = makeRequest({
      method: 'PUT',
      path: `/campaigns/${campaignId}/status`,
      body: { status: CampaignStatus.ACTIVE },
    });
    const statusRes = routeRequest(statusReq, deps);
    expect(statusRes.status).toBe(200);

    // Get metrics
    const metricsReq = makeRequest({
      method: 'GET',
      path: `/campaigns/${campaignId}/metrics`,
    });
    const metricsRes = routeRequest(metricsReq, deps);
    expect(metricsRes.status).toBe(200);

    // List
    const listReq = makeRequest({ method: 'GET', path: '/campaigns' });
    const listRes = routeRequest(listReq, deps);
    expect(listRes.status).toBe(200);
    expect((listRes.body as { total: number }).total).toBe(1);
  });
});

// --- Dashboard static file serving tests ---

describe('GET /dashboard', () => {
  let deps: RouteHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 when dashboard HTML is not loaded', () => {
    const req = makeRequest({ method: 'GET', path: '/dashboard' });
    const res = routeRequest(req, deps) as ApiResponse;
    expect(res.status).toBe(500);
    expect(res.body).toBe('Dashboard not found');
    expect(res.headers['content-type']).toBe('text/plain');
  });

  it('returns 200 with HTML content after loadDashboardHtml succeeds', () => {
    const fs = require('node:fs');
    vi.spyOn(fs, 'readFileSync').mockReturnValue('<html><body>Dashboard</body></html>');

    loadDashboardHtml();

    const req = makeRequest({ method: 'GET', path: '/dashboard' });
    const res = routeRequest(req, deps) as ApiResponse;
    expect(res.status).toBe(200);
    expect(res.body).toBe('<html><body>Dashboard</body></html>');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('returns 500 when loadDashboardHtml fails to read file', () => {
    const fs = require('node:fs');
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    loadDashboardHtml();

    const req = makeRequest({ method: 'GET', path: '/dashboard' });
    const res = routeRequest(req, deps) as ApiResponse;
    expect(res.status).toBe(500);
    expect(res.body).toBe('Dashboard not found');
    expect(res.headers['content-type']).toBe('text/plain');
  });
});
