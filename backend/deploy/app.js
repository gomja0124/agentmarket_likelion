import { createServer, request as httpRequest } from 'node:http';
import { createApiServer } from '../server/app.js';
import { createWebServer } from '../web/app.js';
import { createMcpHttpServer } from '../mcp/http.js';

const listen = (server, port, host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => { server.off('error', reject); resolve(); });
});
const close = server => new Promise(resolve => {
  if (!server?.listening) { resolve(); return; }
  server.close(resolve);
});

function forward(request, response, port) {
  const upstream = httpRequest({
    hostname: '127.0.0.1', port, method: request.method, path: request.url,
    headers: { ...request.headers, host: `127.0.0.1:${port}` },
    timeout: 20_000,
  }, result => {
    response.writeHead(result.statusCode || 502, result.headers);
    result.pipe(response);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('UPSTREAM_TIMEOUT')));
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ code: 'BAD_GATEWAY', message: '내부 서비스를 연결하지 못했습니다.' }));
    }
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
}

/** One public HTTP port; Web, strict API and MCP share one persistent SQLite volume. */
export async function startDeployment(options = {}) {
  const host = options.host || process.env.DEPLOY_HOST || '0.0.0.0';
  const port = options.port ?? Number(process.env.PORT || 8080);
  const dbPath = options.dbPath || process.env.AGENT_MARKET_DB_PATH || '/data/agent-market.sqlite';
  const webSecret = options.webSecret || process.env.AGENT_MARKET_WEB_SECRET || '';
  const seed = options.seed ?? true;
  const configuredOrigin = options.origin || process.env.AGENT_MARKET_WEB_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  if (webSecret.length < 16) throw new Error('AGENT_MARKET_WEB_SECRET은 16자 이상이어야 합니다.');
  if (process.env.RAILWAY_PROJECT_ID && process.env.RAILWAY_VOLUME_MOUNT_PATH !== '/data') {
    throw new Error('Railway 영속 볼륨을 /data에 마운트해야 합니다.');
  }
  if (!configuredOrigin && host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('공개 주소가 필요합니다. AGENT_MARKET_WEB_URL 또는 RAILWAY_PUBLIC_DOMAIN을 설정하세요.');
  }

  let webPort = 0;
  let mcpPort = 0;
  let ready = false;
  const gateway = createServer((request, response) => {
    if (!ready) { response.writeHead(503); response.end(); return; }
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400); response.end(); return; }
    if (path === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok', services: ['web', 'api', 'mcp'] }));
      return;
    }
    forward(request, response, path === '/mcp' ? mcpPort : webPort);
  });
  let api;
  let web;
  let mcp;
  try {
    await listen(gateway, port, host);
    const origin = configuredOrigin || `http://127.0.0.1:${gateway.address().port}`;
    api = createApiServer({ dbPath, seed, auth: { mode: 'strict', webSecret }, corsOrigin: origin });
    await listen(api, 0, '127.0.0.1');
    const apiUrl = `http://127.0.0.1:${api.address().port}`;
    web = createWebServer({ dbPath, seed, origin, webSecret, apiUrl });
    await listen(web, 0, '127.0.0.1');
    webPort = web.address().port;
    mcp = createMcpHttpServer({ apiUrl, webUrl: origin,
      rateLimitPerMinute: Number(process.env.MCP_RATE_LIMIT_PER_MINUTE || 120) });
    await listen(mcp, 0, '127.0.0.1');
    mcpPort = mcp.address().port;
    ready = true;
    return {
      gateway, api, web, mcp, origin,
      async close() {
        ready = false;
        await close(gateway);
        await Promise.all([close(mcp), close(web), close(api)]);
        web.store.close(); api.store.close();
      },
    };
  } catch (error) {
    await Promise.all([close(gateway), close(mcp), close(web), close(api)]);
    web?.store.close(); api?.store.close();
    throw error;
  }
}
