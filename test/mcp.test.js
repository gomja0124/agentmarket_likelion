/**
 * 05 Acceptance Spec — Step 1 을 MCP 경로로 검증한다.
 * 인메모리 API + stdio로 띄운 실제 MCP 프로세스 + SDK 클라이언트. Claude Desktop이 하는 것과 같은 경로다.
 * AC-05(매칭 규칙 자체)는 지후 영역이라 결과 형식만 확인하고, AC-06(결과 화면)은 Web 영역이라 여기 없다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApiServer } from '../server/app.js';
import { listingQuestions, nextActionFor, purchaseQuestions } from '../mcp/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoUser = '00000000-0000-4000-8000-000000000001';

const SPEC_TOOLS = ['get_category_schema', 'create_listing_draft', 'update_listing_draft', 'create_purchase_request_draft', 'update_purchase_request_draft', 'search_listings', 'get_listing'];
const HELPER_TOOLS = ['whoami', 'get_market_guide', 'browse_listings', 'list_my_listing_drafts', 'list_my_listings', 'list_my_purchase_requests'];

async function withMcp(run, { userId = demoUser, token = '', apiOptions = {} } = {}) {
  const api = createApiServer({ dbPath: ':memory:', ...apiOptions });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${api.address().port}`;
  const client = new Client({ name: 'e2e-test', version: '0.0.0' });
  const env = { ...process.env, AGENT_MARKET_API_URL: base, AGENT_MARKET_WEB_URL: 'http://web.local' };
  delete env.AGENT_MARKET_TOKEN;
  if (token) env.AGENT_MARKET_TOKEN = token; else env.AGENT_MARKET_USER_ID = userId;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repoRoot, 'mcp/index.js')], cwd: repoRoot, env, stderr: 'pipe' }));
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
  const agentRaw = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-Actor-Type': 'AGENT', 'Idempotency-Key': randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  try { await run({ call, human, agentRaw, client, store: api.store }); }
  finally {
    await client.close();
    await new Promise(resolve => api.close(resolve));
    api.store.close();
  }
}

test('tool set matches 03 MCP Tools Spec and exposes no publish/confirm', async () => {
  await withMcp(async ({ call, client }) => {
    const names = (await client.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(names, [...SPEC_TOOLS, ...HELPER_TOOLS].sort());
    assert.ok(!names.some(n => /publish|confirm|deactivate|token/.test(n)), '사람 전용 행동은 tool로 노출되지 않는다');
    assert.match(client.getInstructions() || '', /게시.*사람/);
    const guide = await call('get_market_guide');
    assert.equal(guide.value.apiHealth.step, 1);
    assert.equal(guide.value.webUrl, 'http://web.local');
    const schema = await call('get_category_schema', { category: 'PHONE' });
    assert.deepEqual(schema.value.requiredFields, ['category', 'model', 'priceKrw']);
    assert.deepEqual(schema.value.minimumPurchaseConditions, ['category', 'maxBudgetKrw']);
    assert.ok(schema.value.questionHints.length > 0);
  });
});

test('AC-01 seller info becomes a structured ListingDraft; unknown values stay in missingFields', async () => {
  await withMcp(async ({ call }) => {
    const r = await call('create_listing_draft', { category: 'PHONE', productName: 'iPhone 15 Pro', freeText: '생활기스 조금 있음, 박스 있음' });
    assert.equal(r.isError, false);
    assert.equal(r.value.structuredFields.model, 'iPhone 15 Pro', 'productName은 model로 저장된다');
    assert.equal(r.value.structuredFields.description, '생활기스 조금 있음, 박스 있음', 'freeText는 description으로 저장된다');
    assert.equal(r.value.structuredFields.storageGb, null, '모르는 값은 추정하지 않는다');
    assert.equal(r.value.structuredFields.condition, null);
    assert.deepEqual(r.value.missingFields, ['priceKrw']);
    assert.equal(r.value.reviewRequired, true);
    assert.equal(r.value.humanApprovalRequired, true);
    assert.equal(r.value.publishable, false);
    assert.equal(r.value.draft.source, 'AGENT', 'Web이 "Agent 초안" 표시를 할 수 있도록 source가 AGENT다');
    assert.equal(r.value.nextQuestions[0], '판매 가격은 얼마인가요?', '필수 항목 질문이 먼저 온다');
    assert.ok(r.value.nextQuestions.some(q => q.includes('용량')));
    assert.match(r.value.nextAction, /priceKrw/);
  });
});

test('AC-02 agent cannot publish; human publishes only when required fields are present', async () => {
  await withMcp(async ({ call, human, agentRaw, client }) => {
    const created = await call('create_listing_draft', { category: 'TABLET', model: 'iPad Air', priceKrw: 650000 });
    const draftId = created.value.draftId;

    // Agent에게는 게시 수단이 없다: tool 목록에 없고, 어댑터를 우회해 API를 직접 쳐도 403이다.
    assert.ok(!(await client.listTools()).tools.some(t => t.name.includes('publish')));
    const agentPublish = await agentRaw('POST', `/api/listing-drafts/${draftId}/publish`);
    assert.equal(agentPublish.status, 403);
    assert.match(agentPublish.value.message, /사람의 승인/);
    assert.equal((await call('list_my_listings')).value.listings.length, 0, 'ACTIVE Listing이 생기지 않는다');

    // 필수 값을 비우면 사람도 게시할 수 없다 → 422
    await call('update_listing_draft', { draftId, patch: { priceKrw: null } });

    // 필수 값(priceKrw) 없이 사람이 게시 → 422, ACTIVE Listing 없음
    const tooEarly = await human('POST', `/api/listing-drafts/${draftId}/publish`);
    assert.equal(tooEarly.status, 422);
    assert.deepEqual(tooEarly.value.details.missingFields, ['priceKrw']);
    assert.equal((await call('list_my_listings')).value.listings.length, 0);

    const ready = await call('update_listing_draft', { draftId, patch: { priceKrw: 650000, storageGb: 256, condition: 'LIKE_NEW' } });
    assert.equal(ready.value.publishable, true);
    assert.equal(ready.value.updatedDraft.status, 'READY_FOR_REVIEW');
    assert.match(ready.value.nextAction, /http:\/\/web\.local.*직접 게시/);

    const published = await human('POST', `/api/listing-drafts/${draftId}/publish`);
    assert.equal(published.status, 201);
    assert.equal(published.value.status, 'ACTIVE');
    assert.equal((await call('list_my_listings')).value.listings[0].id, published.value.id);
    const detail = await call('get_listing', { listingId: published.value.id });
    assert.equal(detail.value.model, 'iPad Air');
    assert.ok((await call('browse_listings', { query: 'iPad Air' })).value.listings.some(l => l.id === published.value.id));

    // 게시된 초안은 더 수정할 수 없다(새 초안으로 처리). 구조화된 오류로 돌아온다.
    const blocked = await call('update_listing_draft', { draftId, patch: { priceKrw: 1 } });
    assert.equal(blocked.isError, true);
    assert.equal(blocked.value.code, 'INVALID_STATE');
  });
});

test('AC-03 minimal buyer request is structured and missing conditions come back as prioritized questions', async () => {
  await withMcp(async ({ call }) => {
    const r = await call('create_purchase_request_draft', { naturalLanguageRequest: '100만 원 이하 태블릿 찾아줘', knownConstraints: { category: 'TABLET', maxBudgetKrw: 1000000 } });
    assert.equal(r.isError, false);
    assert.equal(r.value.structuredConditions.category, 'TABLET');
    assert.equal(r.value.structuredConditions.maxBudgetKrw, 1000000);
    assert.deepEqual(r.value.missingFields, [], 'category와 maxBudgetKrw가 있으면 필수는 충족');
    assert.deepEqual(r.value.nextQuestions, [
      '원하는 모델이나 모델군이 있나요? (예: iPhone 15, Galaxy Tab)',
      '최소 저장 용량이 필요하신가요?',
    ], '결과에 영향이 큰 누락 조건을 모델 → 용량 순으로 묻는다');
    assert.equal(r.value.readyForConfirmation, true);
    assert.equal(r.value.humanApprovalRequired, true);
    assert.equal(r.value.purchaseRequest.source, 'AGENT');

    const vague = await call('create_purchase_request_draft', { naturalLanguageRequest: '싼 거 하나 찾아줘' });
    assert.deepEqual(vague.value.missingFields, ['category', 'maxBudgetKrw']);
    assert.equal(vague.value.nextQuestions[0], '찾으시는 게 핸드폰인가요, 태블릿인가요?', '카테고리 → 예산 순');
    assert.equal(vague.value.nextQuestions[1], '최대 예산은 얼마까지 생각하시나요?');
    assert.equal(vague.value.readyForConfirmation, false);
  });
});

test('AC-04 search is refused while DRAFT; after human confirmation it runs', async () => {
  await withMcp(async ({ call, human }) => {
    const created = await call('create_purchase_request_draft', { knownConstraints: { category: 'PHONE', maxBudgetKrw: 1000000, modelQuery: 'iPhone 15' } });
    const id = created.value.requestId;
    const early = await call('search_listings', { purchaseRequestId: id });
    assert.equal(early.isError, true);
    assert.equal(early.value.code, 'INVALID_STATE');
    assert.match(early.value.suggestedAction, /Web/);

    const confirmed = await human('POST', `/api/purchase-requests/${id}/confirm`);
    assert.equal(confirmed.value.status, 'CONFIRMED');
    const listed = await call('list_my_purchase_requests');
    assert.equal(listed.value.purchaseRequests[0].humanApprovalRequired, false);
    assert.match(listed.value.purchaseRequests[0].nextAction, /search_listings/);

    const search = await call('search_listings', { purchaseRequestId: id });
    assert.equal(search.isError, false);
    assert.equal(search.value.purchaseRequestId, id);

    // 확정 후 수정하면 DRAFT로 돌아가 다시 확정이 필요하다 (02 State Rules).
    const edited = await call('update_purchase_request_draft', { requestId: id, patch: { storageGb: 256 } });
    assert.equal(edited.value.updatedRequest.status, 'DRAFT');
    assert.equal(edited.value.readyForConfirmation, true);
    assert.equal((await call('search_listings', { purchaseRequestId: id })).value.code, 'INVALID_STATE');
  });
});

test('AC-05 result shape: EXCLUDED has unmet fields, MATCH has no missing fields, ruleVersion present', async () => {
  await withMcp(async ({ call, human }) => {
    const created = await call('create_purchase_request_draft', { knownConstraints: { category: 'PHONE', maxBudgetKrw: 1000000, conditionPreferences: ['LIKE_NEW', 'GOOD'] } });
    const id = created.value.requestId;
    await human('POST', `/api/purchase-requests/${id}/confirm`);
    const search = await call('search_listings', { purchaseRequestId: id });
    const { summary, results } = search.value;
    assert.equal(summary.total, 12, '시드 ACTIVE 매물 12개가 모두 평가된다');
    assert.equal(summary.total, summary.MATCH + summary.NEEDS_CONFIRMATION + summary.EXCLUDED);
    assert.equal(summary.ruleVersion, 'step1-rule-v1');
    for (const r of results) {
      assert.ok(['MATCH', 'NEEDS_CONFIRMATION', 'EXCLUDED'].includes(r.matchStatus));
      if (r.matchStatus === 'MATCH') { assert.equal(r.missingFields.length, 0); assert.equal(r.listing.category, 'PHONE'); }
      if (r.matchStatus === 'NEEDS_CONFIRMATION') assert.ok(r.missingFields.length > 0, '정보 부족은 MATCH로 추정하지 않는다');
      if (r.matchStatus === 'EXCLUDED') assert.ok(r.unmetFields.length > 0);
      assert.ok(r.listing && typeof r.listing.priceKrw === 'number');
    }
  });
});

test('AC-07 no Step 2 or photo-analysis tools on the Step 1 code path', async () => {
  await withMcp(async ({ client }) => {
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const banned of ['public_demand', 'browse_buyer_demand', 'watch_listings', 'notify_match', 'offer', 'reservation', 'analyze']) {
      assert.ok(!names.some(n => n.includes(banned)), `${banned} 계열 tool이 없어야 한다`);
    }
  });
});

test('writes are idempotent with the same requestId and are audit-logged', async () => {
  await withMcp(async ({ call, store }) => {
    const requestId = randomUUID();
    const first = await call('create_listing_draft', { category: 'TABLET', model: 'iPad Air', priceKrw: 500000, requestId });
    const retry = await call('create_listing_draft', { category: 'TABLET', model: 'iPad Air', priceKrw: 500000, requestId });
    assert.equal(first.value.draftId, retry.value.draftId, '같은 requestId는 같은 초안을 돌려준다');
    const fresh = await call('create_listing_draft', { category: 'TABLET', model: 'iPad Air', priceKrw: 500000 });
    assert.notEqual(fresh.value.draftId, first.value.draftId);
    assert.equal((await call('list_my_listing_drafts')).value.drafts.length, 2);
    const logs = store.db.prepare('SELECT action_type, status FROM agent_action_logs').all();
    assert.ok(logs.length >= 2 && logs.every(l => l.status === 'SUCCEEDED'));
  });
});

test('errors come back structured as tool results with the spec error codes', async () => {
  await withMcp(async ({ call }) => {
    const missing = await call('get_listing', { listingId: randomUUID() });
    assert.equal(missing.isError, true);
    assert.equal(missing.value.code, 'NOT_FOUND');
    const bad = await call('create_purchase_request_draft', { knownConstraints: { category: 'PHONE', maxBudgetKrw: 100, modelQuery: 'x'.repeat(201) } });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /modelQuery/);
  });
});

test('question and nextAction helpers follow the spec priority', () => {
  assert.deepEqual(purchaseQuestions({}), [
    '찾으시는 게 핸드폰인가요, 태블릿인가요?', '최대 예산은 얼마까지 생각하시나요?',
    '원하는 모델이나 모델군이 있나요? (예: iPhone 15, Galaxy Tab)', '최소 저장 용량이 필요하신가요?',
  ]);
  assert.deepEqual(purchaseQuestions({ category: 'PHONE', maxBudgetKrw: 1, modelQuery: 'x', storageGb: 1 }), []);
  assert.equal(listingQuestions({ category: 'PHONE', model: 'x', priceKrw: 1 })[0], '저장 용량은 몇 GB인가요?');
  assert.match(nextActionFor('ListingDraft', { status: 'READY_FOR_REVIEW', missingFields: [] }, 'http://w'), /http:\/\/w.*직접 게시/);
  assert.match(nextActionFor('PurchaseRequest', { status: 'CONFIRMED', missingFields: [] }), /search_listings/);
});
