import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AgentMarketApi, ApiError } from './api-client.js';
import { configFromEnv, resolveIdentity } from './config.js';
import { createAgentMarketServer, SERVER_VERSION } from './server.js';

/**
 * 원격 MCP 서버 (Streamable HTTP, stateless).
 *
 * - 엔드포인트: POST /mcp  (GET/DELETE는 stateless라 405)
 * - 인증: 모든 요청에 Authorization: Bearer amk_... 필수. 토큰은 백엔드 /api/me 로 검증하고 짧게 캐시한다.
 * - 요청마다 토큰에 묶인 MCP 서버 인스턴스를 만들어 처리한다. 세션 상태를 서버에 두지 않아 수평 확장이 쉽다.
 * - 보호: 본문 크기 제한, 토큰별 분당 요청 제한, 백엔드 호출 타임아웃.
 */
const MAX_BODY_BYTES = 1_000_000;

function log(level, message, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
  (level === 'error' ? console.error : console.log)(line);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function rpcError(response, status, code, message) {
  sendJson(response, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

function readBody(request, response) {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;
    let overflow = false;
    request.on('data', chunk => {
      received += chunk.length;
      if (overflow) { if (received > MAX_BODY_BYTES * 8) request.destroy(new Error('PAYLOAD_TOO_LARGE')); return; }
      if (received > MAX_BODY_BYTES) {
        overflow = true; body = '';
        response.setHeader('Connection', 'close');
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (overflow) return reject(new Error('PAYLOAD_TOO_LARGE'));
      if (!body) return resolve(undefined);
      try { resolve(JSON.parse(body)); } catch { reject(new Error('INVALID_JSON')); }
    });
    request.on('error', reject);
  });
}

class IdentityCache {
  constructor(ttlMs) { this.ttlMs = ttlMs; this.entries = new Map(); }
  key(token) { return createHash('sha256').update(token).digest('hex'); }
  get(token) {
    const entry = this.entries.get(this.key(token));
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) { this.entries.delete(this.key(token)); return undefined; }
    return entry.identity;
  }
  set(token, identity) { this.entries.set(this.key(token), { identity, expiresAt: Date.now() + this.ttlMs }); }
  delete(token) { this.entries.delete(this.key(token)); }
}

class RateLimiter {
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.buckets = new Map(); }
  allow(key) {
    const now = Date.now();
    const bucket = this.buckets.get(key) || { start: now, count: 0 };
    if (now - bucket.start >= this.windowMs) { bucket.start = now; bucket.count = 0; }
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return bucket.count <= this.limit;
  }
}

export function createMcpHttpServer({
  apiUrl, webUrl = '', timeoutMs = 15_000,
  identityTtlMs = 60_000, rateLimitPerMinute = 120, path = '/mcp',
} = {}) {
  const cache = new IdentityCache(identityTtlMs);
  const limiter = new RateLimiter(rateLimitPerMinute, 60_000);

  async function authenticate(request) {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw Object.assign(new Error('Authorization: Bearer <agent token> 헤더가 필요합니다.'), { status: 401 });
    const api = new AgentMarketApi({ baseUrl: apiUrl, token, timeoutMs });
    let identity = cache.get(token);
    if (!identity) {
      try {
        identity = await resolveIdentity(api);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          throw Object.assign(new Error(error.message), { status: 401 });
        }
        throw Object.assign(new Error(`백엔드 인증 확인 실패: ${error.message}`), { status: 503 });
      }
      cache.set(token, identity);
    }
    return { api, identity, token };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const started = Date.now();

    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, { status: 'ok', service: 'agent-market-mcp', version: SERVER_VERSION, transport: 'streamable-http' });
      return;
    }
    if (url.pathname !== path) { sendJson(response, 404, { error: 'not_found' }); return; }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      rpcError(response, 405, -32000, 'stateless 서버입니다. POST만 지원합니다.');
      return;
    }

    let auth;
    try {
      auth = await authenticate(request);
    } catch (error) {
      log('warn', 'auth_failed', { status: error.status, reason: error.message, ip: request.socket.remoteAddress });
      response.setHeader('WWW-Authenticate', 'Bearer realm="agent-market"');
      rpcError(response, error.status || 401, -32001, error.message);
      return;
    }
    if (!limiter.allow(auth.identity.userId + ':' + auth.token.slice(-8))) {
      rpcError(response, 429, -32002, `분당 ${rateLimitPerMinute}회를 넘었습니다. 잠시 후 다시 시도하세요.`);
      return;
    }

    let body;
    try { body = await readBody(request, response); }
    catch (error) {
      rpcError(response, error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, -32700, error.message === 'PAYLOAD_TOO_LARGE' ? '요청 본문이 너무 큽니다.' : 'JSON 본문을 확인하세요.');
      return;
    }

    const mcp = createAgentMarketServer({ api: auth.api, webUrl, scopes: auth.identity.scopes });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on('close', () => { transport.close().catch(() => {}); mcp.close().catch(() => {}); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
      log('info', 'mcp_request', { user: auth.identity.userId, method: body?.method ?? 'batch', ms: Date.now() - started });
    } catch (error) {
      log('error', 'mcp_request_failed', { user: auth.identity.userId, error: error.message });
      if (!response.headersSent) rpcError(response, 500, -32603, '요청을 처리하지 못했습니다.');
    }
  });

  server.invalidateToken = token => cache.delete(token);
  return server;
}

export function startFromEnv(env = process.env) {
  const { apiUrl, webUrl, timeoutMs } = configFromEnv(env);
  const host = env.MCP_HOST || '127.0.0.1';
  const port = Number(env.MCP_PORT || 8090);
  const server = createMcpHttpServer({
    apiUrl, webUrl, timeoutMs,
    rateLimitPerMinute: Number(env.MCP_RATE_LIMIT_PER_MINUTE || 120),
    identityTtlMs: Number(env.MCP_IDENTITY_TTL_MS || 60_000),
  });
  server.listen(port, host, () => log('info', 'listening', { host, port, apiUrl, webUrl: webUrl || null }));

  const shutdown = signal => {
    log('info', 'shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startFromEnv();
