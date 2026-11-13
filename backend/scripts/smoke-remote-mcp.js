import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../server/database.js';

const dbPath = process.env.AGENT_MARKET_DB_PATH;
const origin = process.env.AGENT_MARKET_WEB_URL;
if (!dbPath || !origin) throw new Error('AGENT_MARKET_DB_PATH와 AGENT_MARKET_WEB_URL이 필요합니다.');
const base = new URL(origin);
const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
if ((base.protocol !== 'https:' && !localHttp) || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('공개 HTTPS 또는 로컬 HTTP 서비스의 origin만 점검할 수 있습니다.');
}

const store = new Store({ dbPath, seed: false });
const loginName = `smoke-${randomUUID()}`;
const password = randomBytes(24).toString('base64url');
const mcpUrl = new URL('/mcp', base);
const client = new Client({ name: 'agent-market-production-smoke', version: '1.0.0' });
let connected = false;
let cookie;
let csrf;
let userId;
let agentToken;
let agentTokenId;

try {
  const registration = await fetch(new URL('/web/register', base), {
    method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginName, nickname: '운영 연결 점검', password }),
  });
  assert.equal(registration.status, 200, '공개 회원가입에 실패했습니다.');
  cookie = registration.headers.get('set-cookie')?.split(';')[0];
  const session = await registration.json();
  userId = session.userId;
  csrf = session.csrfToken;
  assert.ok(cookie && userId && csrf);

  const home = await fetch(base, { headers: { Cookie: cookie } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /src\/app\.js/, '로그인 후 앱 화면이 열리지 않습니다.');
  const me = await fetch(new URL('/api/me', base), { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).userId, userId);

  const issued = await fetch(new URL('/api/agent-tokens', base), {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'production-smoke', scopes: ['read'], expiresInDays: 1 }),
  });
  assert.equal(issued.status, 201, 'Agent 토큰 발급에 실패했습니다.');
  const record = await issued.json();
  agentToken = record.token;
  agentTokenId = record.id;
  assert.ok(agentToken && agentTokenId);

  await client.connect(new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${agentToken}` } },
  }));
  connected = true;
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(tools.includes('whoami') && tools.includes('get_market_guide'));
  assert.ok(!tools.includes('create_listing_draft'), '읽기 전용 토큰에 쓰기 도구가 노출됐습니다.');

  const identity = await client.callTool({ name: 'whoami', arguments: {} });
  assert.ok(!identity.isError);
  assert.equal(identity.structuredContent?.userId, userId);
  const guide = await client.callTool({ name: 'get_market_guide', arguments: {} });
  assert.ok(!guide.isError);
  const listings = await client.callTool({ name: 'browse_listings', arguments: {} });
  assert.ok(!listings.isError);
  if (process.env.AGENT_MARKET_EXPECT_STEP2 === '1') {
    assert.ok(tools.includes('list_my_public_demands'));
    assert.ok(tools.includes('browse_matching_public_demands'));
    assert.equal(guide.structuredContent?.step2Enabled, true);
  }
  console.log(`Public Web signup, session and remote MCP OK: ${tools.length} read-only tools; Step 2 ${guide.structuredContent?.step2Enabled ? 'on' : 'off'}.`);

  const revoked = await fetch(new URL(`/api/agent-tokens/${agentTokenId}`, base), {
    method: 'DELETE', headers: { Cookie: cookie, Origin: base.origin, 'X-CSRF-Token': csrf },
  });
  assert.equal(revoked.status, 200, 'Agent 토큰 폐기에 실패했습니다.');
  const afterRevoke = await fetch(mcpUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(afterRevoke.status, 401, '폐기한 토큰이 즉시 거부되지 않았습니다.');
  console.log('Revoked token rejected immediately.');
} finally {
  if (connected) await client.close().catch(() => {});
  const testUserId = store.getWebCredential(loginName)?.userId;
  if (testUserId && (!userId || testUserId === userId)) {
    store.db.exec('BEGIN');
    try {
      store.db.prepare('DELETE FROM agent_tokens WHERE user_id = ?').run(testUserId);
      store.db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(testUserId);
      store.db.prepare('DELETE FROM web_credentials WHERE user_id = ?').run(testUserId);
      store.db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  }
  store.close();
  if (testUserId) console.log('Temporary test account removed.');
}
