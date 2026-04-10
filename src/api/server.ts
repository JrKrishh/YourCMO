import http from 'node:http';
import { URL } from 'node:url';
import { createLogger } from '../utils/logger';
import { ApiRequest, validateApiKey, unauthorizedResponse } from './auth-middleware';
import { routeRequest, RouteHandlerDeps } from './route-handlers';

const log = createLogger('ApiServer');

/** Server configuration */
export interface ServerConfig {
  port: number;
  apiKeys: string[];
}

/**
 * Minimal HTTP server wrapping Node's http module.
 * Parses requests into ApiRequest, applies auth middleware,
 * and delegates to route handlers.
 */
export class ApiServer {
  private server: http.Server | null = null;
  private readonly config: ServerConfig;
  private readonly deps: RouteHandlerDeps;

  constructor(config: ServerConfig, deps: RouteHandlerDeps) {
    this.config = config;
    this.deps = deps;
  }

  /** Start listening on the configured port. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);
      this.server.listen(this.config.port, () => {
        log.info({ port: this.config.port }, 'API server started');
        resolve();
      });
    });
  }

  /** Stop the server. */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        log.info('API server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  /** Parse and handle an incoming HTTP request. */
  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        const apiReq = this.parseRequest(req, rawBody);

        // Auth check
        const authResult = validateApiKey(apiReq, this.config.apiKeys);
        if (!authResult.authenticated) {
          const authRes = unauthorizedResponse(authResult.error ?? 'Unauthorized');
          this.sendResponse(res, authRes.status, authRes.body, authRes.headers);
          return;
        }

        // Route
        const apiRes = routeRequest(apiReq, this.deps);
        if (apiRes instanceof Promise) {
          apiRes
            .then((resolved) => this.sendResponse(res, resolved.status, resolved.body, resolved.headers))
            .catch((err) => {
              log.error({ err }, 'Async route handler error');
              this.sendResponse(res, 500, { error: 'Internal server error' }, {
                'content-type': 'application/json',
              });
            });
        } else {
          this.sendResponse(res, apiRes.status, apiRes.body, apiRes.headers);
        }
      } catch (err) {
        log.error({ err }, 'Unhandled request error');
        this.sendResponse(res, 500, { error: 'Internal server error' }, {
          'content-type': 'application/json',
        });
      }
    });
  }

  /** Parse an http.IncomingMessage into our ApiRequest. */
  private parseRequest(req: http.IncomingMessage, rawBody: string): ApiRequest {
    const url = new URL(req.url ?? '/', `http://localhost:${this.config.port}`);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    let body: unknown = undefined;
    if (rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }

    return {
      method: (req.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      headers,
      params: {},
      query,
      body,
    };
  }

  /** Write the response. */
  private sendResponse(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string>,
  ): void {
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    res.writeHead(status);
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
}
