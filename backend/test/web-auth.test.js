import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApiServer } from '../server/app.js';
import { createWebServer } from '../web/app.js';
import { provisionWebUser } from '../web/auth.js';
import { createMcpHttpServer } from '../mcp/http.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const secret = 'strict-web-secret-for-tests-123456';
const origin = 'http://127.0.0.1:4173';

async function withServers(run) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-market-web-'));
  const dbPath = join(dir, 'market.sqlite');
  const api = createApiServer({ dbPath, seed: false, auth: { mode: 'strict', webSecret: secret } });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  const web = createWebServer({ dbPath, seed: false, apiUrl, webSecret: secret, origin });
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  const webUrl = `http://127.0.0.1:${web.address().port}`;
  try { await run({ apiUrl, webUrl, web }); }
  finally {
    await new Promise(resolve => web.close(resolve)); web.store.close();
    await new Promise(resolve => api.close(resolve)); api.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Web login creates a server session and forwards only its verified identity to strict API', async () => {
  await withServers(async ({ apiUrl, webUrl, web }) => {
    const user = await provisionWebUser(web.store, { loginName: 'Buyer_One', nickname: '구매자', password: 'this-is-a-strong-password' });
    const landing = await fetch(`${webUrl}/`);
    assert.equal(landing.status, 200);
    const landingHtml = await landing.text();
    assert.match(landingHtml, /Agent와 함께 찾고/);
    assert.match(landingHtml, /href="\/register"/);
    assert.match(landingHtml, /href="\/login"/);
    assert.doesNotMatch(landingHtml, /src\/app\.js/);
    assert.equal((await fetch(`${webUrl}/src/landing.css`)).status, 200);
    assert.equal((await fetch(`${webUrl}/index.html`)).url, `${webUrl}/login`);
    assert.equal((await fetch(`${webUrl}/api/me`)).status, 401);
    assert.equal((await fetch(`${apiUrl}/api/me`)).status, 401);

    const wrong = await fetch(`${webUrl}/web/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: 'Buyer_One', password: 'wrong-password' }) });
    assert.equal(wrong.status, 401);
    const crossSite = await fetch(`${webUrl}/web/login`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: 'Buyer_One', password: 'this-is-a-strong-password' }) });
    assert.equal(crossSite.status, 403);

    const login = await fetch(`${webUrl}/web/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: 'Buyer_One', password: 'this-is-a-strong-password' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const token = cookie.split('=')[1];
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.ok(!web.store.db.prepare('SELECT session_hash FROM web_sessions').get().session_hash.includes(token));
    const { csrfToken, userId } = await login.json();
    assert.equal(userId, user.id);
    assert.match(await (await fetch(`${webUrl}/`, { headers: { Cookie: cookie } })).text(), /src\/app\.js/);

    const me = await fetch(`${webUrl}/api/me`, { headers: { Cookie: cookie, 'X-User-Id': '00000000-0000-4000-8000-000000000099',
      'X-Web-Secret': 'spoofed', Authorization: 'Bearer spoofed' } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).userId, user.id);
    const session = await (await fetch(`${webUrl}/web/session`, { headers: { Cookie: cookie } })).json();
    assert.equal(session.csrfToken, csrfToken);

    const noCsrf = await fetch(`${webUrl}/api/purchase-requests`, { method: 'POST', headers: { Cookie: cookie, Origin: origin,
      'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'TABLET', maxBudgetKrw: 700000 }) });
    assert.equal(noCsrf.status, 403);
    const crossOrigin = await fetch(`${webUrl}/api/purchase-requests`, { method: 'POST', headers: { Cookie: cookie,
      Origin: 'https://attacker.example', 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'TABLET', maxBudgetKrw: 700000 }) });
    assert.equal(crossOrigin.status, 403);
    const created = await fetch(`${webUrl}/api/purchase-requests`, { method: 'POST', headers: { Cookie: cookie, Origin: origin,
      'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json', 'X-User-Id': '00000000-0000-4000-8000-000000000099' },
      body: JSON.stringify({ category: 'TABLET', maxBudgetKrw: 700000 }) });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).buyerId, user.id);

    const issued = await fetch(`${webUrl}/api/agent-tokens`, { method: 'POST', headers: { Cookie: cookie, Origin: origin,
      'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '외부 Agent 테스트', scopes: ['read', 'purchase:write'] }) });
    assert.equal(issued.status, 201);
    const agentToken = (await issued.json()).token;
    const agent = await fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${agentToken}` } });
    assert.equal(agent.status, 200);
    assert.equal((await agent.json()).userId, user.id);
    const mcp = createMcpHttpServer({ apiUrl, identityTtlMs: 0 });
    await new Promise(resolve => mcp.listen(0, '127.0.0.1', resolve));
    const client = new Client({ name: 'web-issued-token-test', version: '0.0.0' });
    try {
      const mcpUrl = new URL(`http://127.0.0.1:${mcp.address().port}/mcp`);
      await client.connect(new StreamableHTTPClientTransport(mcpUrl,
        { requestInit: { headers: { Authorization: `Bearer ${agentToken}` } } }));
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === 'create_purchase_request_draft'));
    } finally { await client.close(); await new Promise(resolve => mcp.close(resolve)); }

    const badLogout = await fetch(`${webUrl}/web/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
    assert.equal(badLogout.status, 403);
    const logout = await fetch(`${webUrl}/web/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrfToken } });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${webUrl}/api/me`, { headers: { Cookie: cookie } })).status, 401);
  });
});

test('public registration creates an account and session while rejecting invalid or duplicate signups', async () => {
  await withServers(async ({ webUrl, web }) => {
    const page = await fetch(`${webUrl}/register`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /회원가입/);
    const register = (body, requestOrigin = origin) => fetch(`${webUrl}/web/register`, {
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const details = { loginName: 'New_Buyer', nickname: '새 구매자', password: 'secure-signup-password' };
    assert.equal((await register(details, 'https://other.example')).status, 403);
    assert.equal((await register({ ...details, password: 'short' })).status, 400);
    assert.equal((await register({ ...details, nickname: '   ' })).status, 400);
    assert.equal(web.store.db.prepare('SELECT COUNT(*) AS count FROM web_credentials').get().count, 0);

    const created = await register(details);
    assert.equal(created.status, 200);
    const cookie = created.headers.get('set-cookie').split(';')[0];
    const session = await created.json();
    assert.equal(session.nickname, details.nickname);
    assert.ok(session.csrfToken);
    assert.equal((await (await fetch(`${webUrl}/api/me`, { headers: { Cookie: cookie } })).json()).userId, session.userId);
    assert.equal((await fetch(`${webUrl}/register`, { headers: { Cookie: cookie } })).url, `${webUrl}/`);
    assert.equal((await register(details)).status, 409);
    assert.equal(web.store.db.prepare('SELECT COUNT(*) AS count FROM web_credentials').get().count, 1);
    const login = await fetch(`${webUrl}/web/login`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: details.loginName, password: details.password }) });
    assert.equal(login.status, 200);
  });
});

test('password reissue revokes existing sessions and expired sessions cannot access the API', async () => {
  await withServers(async ({ webUrl, web }) => {
    const user = await provisionWebUser(web.store, { loginName: 'buyer2', nickname: '구매자 2', password: 'first-strong-password' });
    const login = async password => fetch(`${webUrl}/web/login`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: 'buyer2', password }) });
    const first = await login('first-strong-password');
    assert.equal(first.status, 200);
    const firstCookie = first.headers.get('set-cookie').split(';')[0];
    await provisionWebUser(web.store, { loginName: 'buyer2', nickname: '구매자 2', userId: user.id, password: 'second-strong-password' });
    assert.equal((await fetch(`${webUrl}/api/me`, { headers: { Cookie: firstCookie } })).status, 401);
    assert.equal((await login('first-strong-password')).status, 401);
    const second = await login('second-strong-password');
    assert.equal(second.status, 200);
    const secondCookie = second.headers.get('set-cookie').split(';')[0];
    web.store.db.prepare('UPDATE web_sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
    assert.equal((await fetch(`${webUrl}/api/me`, { headers: { Cookie: secondCookie } })).status, 401);
  });
});

test('HTTPS Web session cookie uses Secure and the host prefix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-market-web-'));
  const web = createWebServer({ dbPath: join(dir, 'market.sqlite'), seed: false,
    apiUrl: 'http://127.0.0.1:8080', webSecret: secret, origin: 'https://market.example' });
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  try {
    await provisionWebUser(web.store, { loginName: 'seller', nickname: '판매자', password: 'this-is-a-strong-password' });
    const response = await fetch(`http://127.0.0.1:${web.address().port}/web/login`, { method: 'POST',
      headers: { Origin: 'https://market.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: 'seller', password: 'this-is-a-strong-password' }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /^__Host-am-session=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
  } finally {
    await new Promise(resolve => web.close(resolve)); web.store.close(); rmSync(dir, { recursive: true, force: true });
  }
});
