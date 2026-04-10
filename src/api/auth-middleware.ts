import { createLogger } from '../utils/logger';

const log = createLogger('AuthMiddleware');

/** Incoming HTTP request representation */
export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

/** Outgoing HTTP response representation */
export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** Result of authentication check */
export interface AuthResult {
  authenticated: boolean;
  error?: string;
}

/** Paths that don't require authentication */
const PUBLIC_PATHS = ['/health', '/dashboard', '/favicon.ico'];

/**
 * Validate an API key from the request headers.
 * Expects `x-api-key` header matching the configured key.
 */
export function validateApiKey(
  req: ApiRequest,
  validApiKeys: string[],
): AuthResult {
  // Public paths skip auth
  if (PUBLIC_PATHS.includes(req.path)) {
    return { authenticated: true };
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    log.warn({ path: req.path }, 'Missing API key');
    return { authenticated: false, error: 'Missing x-api-key header' };
  }

  if (validApiKeys.length === 0) {
    log.warn('No API keys configured');
    return { authenticated: false, error: 'Server has no API keys configured' };
  }

  if (!validApiKeys.includes(apiKey)) {
    log.warn({ path: req.path }, 'Invalid API key');
    return { authenticated: false, error: 'Invalid API key' };
  }

  return { authenticated: true };
}

/**
 * Create an unauthorized response.
 */
export function unauthorizedResponse(message: string): ApiResponse {
  return {
    status: 401,
    body: { error: 'Unauthorized', message },
    headers: { 'content-type': 'application/json' },
  };
}
