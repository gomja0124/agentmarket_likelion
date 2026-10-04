import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApiServer } from '../server/app.js';
import { nextStepFor } from '../mcp/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoUser = '00000000-0000-4000-8000-000000000001';

/** 인메모리 API + stdio로 띄운 MCP 서버 + SDK 클라이언트. 실제 Claude Desktop이 하는 것과 같은 경로로 호출한다. */
async function withMcp(run, { userId = demoUser } = {}) {
  const api = createApiServer({ dbPath: ':memory:' });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${api.address().port}`;
  const client = new Client({ name: 'e2e-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'mcp/index.js')],
    cwd: repoRoot,
    env: { ...process.env, AGENT_MARKET_API_URL: base, AGENT_MARKET_USER_ID: userId, AGENT_MARKET_WEB_URL: 'http://web.local' },
    stderr: 'pipe',
  });
  await client.connect(transport);
  // 사람 역할: Web이 하는 일(게시·확정)을 HUMAN 헤더로 직접 호출한다.
  const human = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-Actor-Type': 'HUMAN' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: Boolean(result.isError), value: result.structuredContent, text: result.content?.[0]?.text };
  };
  try { await run({ call, human, client, store: api.store }); }
  finally {
    await client.close();
    await new Promise(resolve => api.close(resolve));
    api.store.close();
  }
}

test('server exposes the Step 1 tool set and instructions', async () => {
  await withMcp(async ({ call, client }) => {
    const names = (await client.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(names, [
      'create_listing_draft', 'create_purchase_request', 'get_category_schema', 'get_listing', 'get_market_guide',
      'list_my_listing_drafts', 'list_my_listings', 'list_my_purchase_requests', 'run_search', 'search_listings',
      'update_listing_draft', 'update_purchase_request',
    ]);
    assert.ok(!names.some(n => /publish|confirm|deactivate/.test(n)), '사람 전용 행동은 tool로 노출되지 않는다');
    assert.match(client.getInstructions() || '', /게시.*사람/);
    const guide = await call('get_market_guide');
    assert.equal(guide.isError, false);
    assert.equal(guide.value.apiHealth.step, 1);
    assert.equal(guide.value.webUrl, 'http://web.local');
  });
});

test('seller flow: agent drafts, human publishes, agent cannot publish', async () => {
  await withMcp(async ({ call, human }) => {
    const schema = await call('get_category_schema', { category: 'PHONE' });
    assert.deepEqual(schema.value.requiredFields, ['category', 'model', 'priceKrw']);

    const partial = await call('create_listing_draft', { category: 'PHONE', model: 'iPhone 15 Pro', description: '생활기스 조금' });
    assert.equal(partial.isError, false);
    assert.equal(partial.value.draft.status, 'DRAFT');
    assert.deepEqual(partial.value.draft.missingFields, ['priceKrw']);
    assert.match(partial.value.nextStep, /priceKrw/);
    assert.equal(partial.value.draft.source, 'AGENT');

    const ready = await call('update_listing_draft', { draftId: partial.value.draft.id, priceKrw: 950000, storageGb: 256, condition: 'GOOD' });
    assert.equal(ready.value.draft.status, 'READY_FOR_REVIEW');
    assert.deepEqual(ready.value.draft.missingFields, []);
    assert.match(ready.value.nextStep, /Web.*직접 게시/);

    const drafts = await call('list_my_listing_drafts');
    assert.equal(drafts.value.drafts.length, 1);
    assert.match(drafts.value.drafts[0].nextStep, /게시/);

    // 승인 지점: 사람이 Web에서 게시한다.
    const published = await human('POST', `/api/listing-drafts/${ready.value.draft.id}/publish`);
    assert.equal(published.status, 201);
    assert.equal(published.value.status, 'ACTIVE');

    const mine = await call('list_my_listings');
    assert.equal(mine.value.listings[0].id, published.value.id);
    const detail = await call('get_listing', { listingId: published.value.id });
    assert.equal(detail.value.model, 'iPhone 15 Pro');
    const found = await call('search_listings', { query: '15 Pro' });
    assert.ok(found.value.listings.some(l => l.id === published.value.id));

    // 게시된 초안은 Agent가 수정할 수 없다 → 상태 오류가 구조화되어 돌아온다.
    const blocked = await call('update_listing_draft', { draftId: ready.value.draft.id, priceKrw: 1 });
    assert.equal(blocked.isError, true);
    assert.equal(blocked.value.code, 'INVALID_STATE');
    assert.match(blocked.value.suggestedAction, /Web/);
  });
});

test('buyer flow: agent structures request, search refused until human confirms', async () => {
  await withMcp(async ({ call, human }) => {
    const draft = await call('create_purchase_request', { modelQuery: 'iPhone 15', maxBudgetKrw: 1000000 });
    assert.equal(draft.isError, false);
    assert.deepEqual(draft.value.purchaseRequest.missingFields, ['category']);
    assert.match(draft.value.nextStep, /category/);

    const id = draft.value.purchaseRequest.id;
    const filled = await call('update_purchase_request', { purchaseRequestId: id, category: 'PHONE', conditionPreferences: ['LIKE_NEW', 'GOOD'] });
    assert.deepEqual(filled.value.purchaseRequest.missingFields, []);
    assert.equal(filled.value.purchaseRequest.status, 'DRAFT');
    assert.match(filled.value.nextStep, /직접 확정/);

    // 확정 전 검색은 거부된다.
    const early = await call('run_search', { purchaseRequestId: id });
    assert.equal(early.isError, true);
    assert.equal(early.value.code, 'INVALID_STATE');

    // 승인 지점: 사람이 Web에서 확정한다.
    const confirmed = await human('POST', `/api/purchase-requests/${id}/confirm`);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.value.status, 'CONFIRMED');
    const listed = await call('list_my_purchase_requests');
    assert.match(listed.value.purchaseRequests[0].nextStep, /run_search/);

    const search = await call('run_search', { purchaseRequestId: id });
    assert.equal(search.isError, false);
    assert.equal(search.value.summary.total, 12, '시드 ACTIVE 매물 전체가 평가된다');
    assert.equal(search.value.summary.total, search.value.summary.MATCH + search.value.summary.NEEDS_CONFIRMATION + search.value.summary.EXCLUDED);
    for (const r of search.value.results) {
      assert.ok(['MATCH', 'NEEDS_CONFIRMATION', 'EXCLUDED'].includes(r.matchStatus));
      if (r.matchStatus === 'MATCH') assert.equal(r.missingFields.length, 0, 'MATCH는 정보 누락이 없어야 한다');
      if (r.matchStatus === 'EXCLUDED') assert.ok(r.unmetFields.length > 0);
    }
  });
});

test('agent writes are idempotent when the same requestId is retried', async () => {
  await withMcp(async ({ call, store }) => {
    const requestId = randomUUID();
    const first = await call('create_listing_draft', { category: 'TABLET', model: 'iPad Air', priceKrw: 500000, requestId });
    const retry = await call('create_listing_draft', { category: 'TABLET', model: 'iPad Air', priceKrw: 500000, requestId });
    assert.equal(first.value.draft.id, retry.value.draft.id, '같은 requestId는 같은 초안을 돌려준다');
    const fresh = await call('create_listing_draft', { category: 'TABLET', model: 'iPad Air', priceKrw: 500000 });
    assert.notEqual(fresh.value.draft.id, first.value.draft.id, 'requestId가 없으면 어댑터가 새 키를 만든다');
    const drafts = await call('list_my_listing_drafts');
    assert.equal(drafts.value.drafts.length, 2);
    const logs = store.db.prepare('SELECT action_type, status FROM agent_action_logs').all();
    assert.ok(logs.length >= 2 && logs.every(l => l.status === 'SUCCEEDED'), 'Agent 행동이 감사 로그에 남는다');
  });
});

test('validation and not-found errors come back structured, not as transport failures', async () => {
  await withMcp(async ({ call }) => {
    const missing = await call('get_listing', { listingId: randomUUID() });
    assert.equal(missing.isError, true);
    assert.equal(missing.value.code, 'NOT_FOUND');
    assert.equal(missing.value.retryable, false);

    // 스키마에 맞지 않는 입력은 서버에 닿기 전에 MCP 입력 검증에서 걸린다.
    const bad = await call('create_purchase_request', { category: 'PHONE', maxBudgetKrw: 100, modelQuery: 'x'.repeat(201) });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /modelQuery/);
  });
});

test('nextStepFor describes the human approval point', () => {
  assert.match(nextStepFor('ListingDraft', { status: 'READY_FOR_REVIEW', missingFields: [] }, 'http://w'), /http:\/\/w.*직접 게시/);
  assert.match(nextStepFor('ListingDraft', { status: 'DRAFT', missingFields: ['model'] }), /model/);
  assert.match(nextStepFor('PurchaseRequest', { status: 'CONFIRMED', missingFields: [] }), /run_search/);
  assert.match(nextStepFor('PurchaseRequest', { status: 'DRAFT', missingFields: [] }), /직접 확정/);
});
