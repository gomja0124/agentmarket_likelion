import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../server/app.js';
import { hashToken, requiredScope } from '../server/auth.js';

const demoUser = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000099';
const WEB_SECRET = 'web-secret-for-tests-1234';

async function withApi(run, options = {}) {
  const server = createApiServer({ dbPath: ':memory:', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base, server); }
  finally {
    await new Promise(resolve => server.close(resolve));
    server.store.close();
  }
}

async function call(base, path, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, value: await response.json() };
}

const human = (userId = demoUser, extra = {}) => ({ 'X-User-Id': userId, 'X-Actor-Type': 'HUMAN', ...extra });
const bearer = token => ({ Authorization: `Bearer ${token}` });

test('human issues a token once, lists it without the secret, and revokes it', async () => {
  await withApi(async base => {
    const issued = await call(base, '/api/agent-tokens', { method: 'POST', headers: human(), body: { name: 'claude-desktop', scopes: ['listing:write', 'search'] } });
    assert.equal(issued.status, 201);
    assert.match(issued.value.token, /^amk_[A-Za-z0-9_-]{40,}$/);
    assert.deepEqual(issued.value.scopes, ['read', 'listing:write', 'search'], 'read는 항상 포함된다');
    assert.equal(issued.value.tokenPrefix, issued.value.token.slice(0, 10));

    const list = await call(base, '/api/agent-tokens', { headers: human() });
    assert.equal(list.value.length, 1);
    assert.equal(list.value[0].token, undefined, '목록에는 토큰 원문이 없다');
    assert.equal(list.value[0].tokenHash, undefined);

    const me = await call(base, '/api/me', { headers: bearer(issued.value.token) });
    assert.equal(me.status, 200);
    assert.equal(me.value.actorType, 'AGENT');
    assert.equal(me.value.userId, demoUser);
    assert.equal(me.value.tokenName, 'claude-desktop');

    const otherRevoke = await call(base, `/api/agent-tokens/${issued.value.id}`, { method: 'DELETE', headers: human(otherUser) });
    assert.equal(otherRevoke.status, 403, '남의 토큰은 폐기할 수 없다');
    const agentRevoke = await call(base, `/api/agent-tokens/${issued.value.id}`, { method: 'DELETE', headers: bearer(issued.value.token) });
    assert.equal(agentRevoke.status, 403, 'Agent는 토큰을 폐기할 수 없다');

    const revoked = await call(base, `/api/agent-tokens/${issued.value.id}`, { method: 'DELETE', headers: human() });
    assert.equal(revoked.status, 200);
    assert.ok(revoked.value.revokedAt);
    const after = await call(base, '/api/me', { headers: bearer(issued.value.token) });
    assert.equal(after.status, 401);
    assert.match(after.value.message, /폐기/);
  });
});

test('token scopes gate write routes and are enforced server-side', async () => {
  await withApi(async base => {
    const readOnly = (await call(base, '/api/agent-tokens', { method: 'POST', headers: human(), body: { name: 'ro' } })).value.token;
    const writer = (await call(base, '/api/agent-tokens', { method: 'POST', headers: human(), body: { name: 'w', scopes: ['listing:write', 'purchase:write', 'search'] } })).value.token;

    const listings = await call(base, '/api/listings?status=ACTIVE', { headers: bearer(readOnly) });
    assert.equal(listings.status, 200);
    const denied = await call(base, '/api/listing-drafts', { method: 'POST', headers: { ...bearer(readOnly), 'Idempotency-Key': 'k1' }, body: { category: 'PHONE' } });
    assert.equal(denied.status, 403);
    assert.match(denied.value.message, /listing:write/);

    const allowed = await call(base, '/api/listing-drafts', { method: 'POST', headers: { ...bearer(writer), 'Idempotency-Key': 'k2' }, body: { category: 'PHONE', model: 'iPhone 15', priceKrw: 100000 } });
    assert.equal(allowed.status, 201);
    assert.equal(allowed.value.source, 'AGENT');

    // 토큰 Agent도 사람 전용 행동은 403
    const publish = await call(base, `/api/listing-drafts/${allowed.value.id}/publish`, { method: 'POST', headers: { ...bearer(writer), 'Idempotency-Key': 'k3' } });
    assert.equal(publish.status, 403);

    const request = await call(base, '/api/purchase-requests', { method: 'POST', headers: { ...bearer(writer), 'Idempotency-Key': 'k4' }, body: { category: 'PHONE', maxBudgetKrw: 500000 } });
    assert.equal(request.status, 201);
    const searchDenied = await call(base, `/api/purchase-requests/${request.value.id}/search`, { method: 'POST', headers: { ...bearer(readOnly), 'Idempotency-Key': 'k5' } });
    assert.equal(searchDenied.status, 403);
  });
});

test('invalid, malformed and expired tokens are rejected', async () => {
  await withApi(async (base, server) => {
    assert.equal((await call(base, '/api/me', { headers: bearer('amk_doesnotexist') })).status, 401);
    assert.equal((await call(base, '/api/me', { headers: bearer('not-a-token') })).status, 401);
    const short = await call(base, '/api/agent-tokens', { method: 'POST', headers: human(), body: { name: 'x', expiresInDays: 1 } });
    assert.ok(short.value.expiresAt);
    server.store.db.prepare('UPDATE agent_tokens SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', short.value.id);
    const expired = await call(base, '/api/me', { headers: bearer(short.value.token) });
    assert.equal(expired.status, 401);
    assert.match(expired.value.message, /만료/);
    const bad = await call(base, '/api/agent-tokens', { method: 'POST', headers: human(), body: { name: 'x', scopes: ['admin'] } });
    assert.equal(bad.status, 422);
  });
});

test('strict mode: agents need bearer tokens, humans need the web secret', async () => {
  await withApi(async base => {
    const noSecret = await call(base, '/api/listings/mine', { headers: human() });
    assert.equal(noSecret.status, 401);
    const wrongSecret = await call(base, '/api/listings/mine', { headers: human(demoUser, { 'X-Web-Secret': 'nope' }) });
    assert.equal(wrongSecret.status, 401);
    const headerAgent = await call(base, '/api/listings', { headers: { 'X-User-Id': demoUser, 'X-Actor-Type': 'AGENT' } });
    assert.equal(headerAgent.status, 401, 'strict에서는 헤더 Agent를 믿지 않는다');
    const anonymous = await call(base, '/api/listings');
    assert.equal(anonymous.status, 401, 'strict에서는 익명 요청도 거부');
    assert.equal((await call(base, '/api/health')).status, 200, 'health는 열려 있다');

    const issued = await call(base, '/api/agent-tokens', { method: 'POST', headers: human(demoUser, { 'X-Web-Secret': WEB_SECRET }), body: { name: 'prod', scopes: ['search'] } });
    assert.equal(issued.status, 201);
    const unknownUser = await call(base, '/api/agent-tokens', { method: 'POST', headers: human('00000000-0000-4000-8000-0000000000aa', { 'X-Web-Secret': WEB_SECRET }), body: { name: 'x' } });
    assert.equal(unknownUser.status, 401, 'strict에서는 모르는 사용자를 자동 생성하지 않는다');

    const viaToken = await call(base, '/api/listings?status=ACTIVE', { headers: bearer(issued.value.token) });
    assert.equal(viaToken.status, 200);
  }, { auth: { mode: 'strict', webSecret: WEB_SECRET } });
});

test('route to scope mapping', () => {
  assert.equal(requiredScope('GET', '/api/listings'), 'read');
  assert.equal(requiredScope('POST', '/api/listing-drafts'), 'listing:write');
  assert.equal(requiredScope('PATCH', '/api/listing-drafts/abc'), 'listing:write');
  assert.equal(requiredScope('POST', '/api/listings/abc/drafts'), 'listing:write');
  assert.equal(requiredScope('POST', '/api/purchase-requests'), 'purchase:write');
  assert.equal(requiredScope('POST', '/api/purchase-requests/abc/search'), 'search');
  assert.equal(hashToken('a').length, 64);
});
