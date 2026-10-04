import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApiServer } from '../server/app.js';
import { createMcpHttpServer } from '../mcp/http.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoUser = '00000000-0000-4000-8000-000000000001';
const WEB_SECRET = 'web-secret-for-tests-1234';

/** strict 모드 백엔드 + 원격 MCP(HTTP). 배포 구성과 같은 조합. */
async function withStack(run) {
  const api = createApiServer({ dbPath: ':memory:', auth: { mode: 'strict', webSecret: WEB_SECRET } });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  const mcp = createMcpHttpServer({ apiUrl, webUrl: 'https://web.example', rateLimitPerMinute: 30, identityTtlMs: 200 });
  await new Promise(resolve => mcp.listen(0, '127.0.0.1', resolve));
  const mcpUrl = new URL(`http://127.0.0.1:${mcp.address().port}/mcp`);

  const human = async (method, route, body) => {
    const response = await fetch(`${apiUrl}${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-User-Id': demoUser, 'X-Actor-Type': 'HUMAN', 'X-Web-Secret': WEB_SECRET },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  const issue = async (name, scopes) => (await human('POST', '/api/agent-tokens', { name, scopes })).value;
  const connect = async token => {
    const client = new Client({ name: 'remote-e2e', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      return { isError: Boolean(result.isError), value: result.structuredContent, text: result.content?.[0]?.text };
    };
    return { client, call };
  };
  try { await run({ apiUrl, mcpUrl, human, issue, connect, mcp }); }
  finally {
    await new Promise(resolve => mcp.close(resolve));
    await new Promise(resolve => api.close(resolve));
    api.store.close();
  }
}

test('remote MCP rejects anonymous, malformed and revoked tokens', async () => {
  await withStack(async ({ mcpUrl, issue, human }) => {
    const anonymous = await fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate') || '', /Bearer/);

    const bogus = await fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer amk_nope' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(bogus.status, 401);

    const token = await issue('revoke-me', ['read']);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token.token}` } } }));
    assert.ok((await client.listTools()).tools.length > 0);
    await client.close();

    await human('DELETE', `/api/agent-tokens/${token.id}`);
    await new Promise(resolve => setTimeout(resolve, 250)); // identity 캐시 만료 대기
    const afterRevoke = await fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(afterRevoke.status, 401);

    const health = await fetch(new URL('/healthz', mcpUrl));
    assert.equal(health.status, 200);
    const wrongMethod = await fetch(mcpUrl, { method: 'GET', headers: { Authorization: `Bearer ${token.token}` } });
    assert.equal(wrongMethod.status, 405);
  });
});

test('tool list follows token scopes; backend still enforces them', async () => {
  await withStack(async ({ issue, connect }) => {
    const readOnly = await issue('read-only', ['read']);
    const ro = await connect(readOnly.token);
    const roTools = (await ro.client.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(roTools, ['browse_listings', 'get_category_schema', 'get_listing', 'get_market_guide', 'list_my_listing_drafts', 'list_my_listings', 'list_my_purchase_requests', 'whoami']);
    const me = await ro.call('whoami');
    assert.equal(me.value.userId, demoUser);
    assert.deepEqual(me.value.scopes, ['read']);
    assert.equal(me.value.tokenName, 'read-only');
    assert.equal(me.value.webUrl, 'https://web.example');
    await ro.client.close();

    const seller = await issue('seller-agent', ['listing:write']);
    const s = await connect(seller.token);
    const sellerTools = (await s.client.listTools()).tools.map(t => t.name);
    assert.ok(sellerTools.includes('create_listing_draft'));
    assert.ok(!sellerTools.includes('search_listings'));
    assert.ok(!sellerTools.includes('create_purchase_request_draft'));
    const draft = await s.call('create_listing_draft', { category: 'PHONE', model: 'iPhone 16', priceKrw: 1100000 });
    assert.equal(draft.isError, false);
    assert.equal(draft.value.publishable, true);
    assert.equal(draft.value.humanApprovalRequired, true);
    assert.match(draft.value.nextAction, /https:\/\/web\.example/);
    await s.client.close();
  });
});

test('full buyer flow over remote transport with human confirmation in between', async () => {
  await withStack(async ({ issue, connect, human }) => {
    const buyer = await issue('buyer-agent', ['purchase:write', 'search']);
    const b = await connect(buyer.token);
    const request = await b.call('create_purchase_request_draft', { naturalLanguageRequest: '70만원 이하 태블릿', knownConstraints: { category: 'TABLET', maxBudgetKrw: 700000, conditionPreferences: ['LIKE_NEW', 'GOOD'] } });
    assert.equal(request.isError, false);
    const id = request.value.requestId;
    const early = await b.call('search_listings', { purchaseRequestId: id });
    assert.equal(early.isError, true);
    assert.equal(early.value.code, 'INVALID_STATE');

    assert.equal((await human('POST', `/api/purchase-requests/${id}/confirm`)).status, 200);
    const search = await b.call('search_listings', { purchaseRequestId: id });
    assert.equal(search.isError, false);
    assert.equal(search.value.summary.total, 12);
    assert.ok(search.value.results.every(r => r.matchStatus !== 'MATCH' || r.listing.category === 'TABLET'));
    await b.client.close();
  });
});

test('rate limit returns 429 after the per-token budget', async () => {
  await withStack(async ({ issue, mcpUrl }) => {
    const token = (await issue('busy', ['read'])).token;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    let last = 200;
    for (let i = 0; i < 35 && last !== 429; i += 1) last = (await fetch(mcpUrl, { method: 'POST', headers, body })).status;
    assert.equal(last, 429);
  });
});

test('stdio mode also works with a bearer token against a strict backend', async () => {
  const api = createApiServer({ dbPath: ':memory:', auth: { mode: 'strict', webSecret: WEB_SECRET } });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  try {
    const issued = await fetch(`${apiUrl}/api/agent-tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': demoUser, 'X-Actor-Type': 'HUMAN', 'X-Web-Secret': WEB_SECRET }, body: JSON.stringify({ name: 'desktop', scopes: ['search'] }) });
    const token = (await issued.json()).token;
    const env = { ...process.env, AGENT_MARKET_API_URL: apiUrl, AGENT_MARKET_TOKEN: token };
    delete env.AGENT_MARKET_USER_ID;
    const client = new Client({ name: 'stdio-token', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repoRoot, 'mcp/index.js')], cwd: repoRoot, env, stderr: 'pipe' }));
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('search_listings') && !names.includes('create_listing_draft'));
    await client.close();

    // 잘못된 토큰이면 프로세스가 바로 종료되어 연결이 실패한다.
    const bad = new Client({ name: 'stdio-bad', version: '0' });
    await assert.rejects(bad.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repoRoot, 'mcp/index.js')], cwd: repoRoot, env: { ...env, AGENT_MARKET_TOKEN: 'amk_bad' }, stderr: 'pipe' })));
  } finally {
    await new Promise(resolve => api.close(resolve));
    api.store.close();
  }
});
