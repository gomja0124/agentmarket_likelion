import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../server/app.js';
import { RULE_VERSION } from '../server/matching.js';

const demoUser = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000099';

async function withApi(run) {
  const server = createApiServer({ dbPath: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try { await run(base, server); }
  finally {
    await new Promise(resolve => server.close(resolve));
    server.store.close();
  }
}

async function call(base, path, { method = 'GET', body, userId, actorType, requestId } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (userId) headers['X-User-Id'] = userId;
  if (actorType) headers['X-Actor-Type'] = actorType;
  if (requestId) headers['Idempotency-Key'] = requestId;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  return { status: response.status, value };
}

test('health and seed expose at least 12 active phone/tablet listings', async () => {
  await withApi(async base => {
    assert.deepEqual((await call(base, '/api/health')).value, { status: 'ok', database: 'sqlite', step: 1, authMode: 'demo' });
    const listings = await call(base, '/api/listings?status=ACTIVE');
    assert.equal(listings.status, 200);
    assert.equal(listings.value.length, 12);
    assert.deepEqual([...new Set(listings.value.map(item => item.category))].sort(), ['PHONE', 'TABLET']);
  });
});

test('Agent draft writes are idempotent, and only the owner can publish it', async () => {
  await withApi(async (base, server) => {
    const createBody = { source: 'AGENT', category: 'PHONE', priceKrw: 500000, missingFields: ['model'] };
    const first = await call(base, '/api/listing-drafts', {
      method: 'POST', body: createBody, actorType: 'AGENT', requestId: 'seller-draft-1',
    });
    const retry = await call(base, '/api/listing-drafts', {
      method: 'POST', body: createBody, actorType: 'AGENT', requestId: 'seller-draft-1',
    });
    assert.equal(first.status, 201);
    assert.equal(first.value.status, 'DRAFT');
    assert.deepEqual(first.value.missingFields, ['model']);
    assert.equal(retry.value.id, first.value.id);
    assert.equal(server.store.db.prepare('SELECT COUNT(*) AS n FROM listing_drafts WHERE seller_id=?').get(demoUser).n, 1);

    const patched = await call(base, `/api/listing-drafts/${first.value.id}`, {
      method: 'PATCH', body: { ...first.value, model: 'iPhone 15' }, actorType: 'AGENT', requestId: 'seller-draft-2',
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.value.status, 'READY_FOR_REVIEW');
    const agentPublish = await call(base, `/api/listing-drafts/${first.value.id}/publish`, { method: 'POST', actorType: 'AGENT' });
    assert.equal(agentPublish.status, 403);
    assert.equal(server.store.db.prepare('SELECT COUNT(*) AS n FROM listings WHERE draft_id=?').get(first.value.id).n, 0);

    const humanPublish = await call(base, `/api/listing-drafts/${first.value.id}/publish`, { method: 'POST' });
    assert.equal(humanPublish.status, 201);
    assert.equal(humanPublish.value.status, 'ACTIVE');
    assert.equal(humanPublish.value.model, 'iPhone 15');

    const revision = await call(base, `/api/listings/${humanPublish.value.id}/drafts`, { method: 'POST' });
    assert.equal(revision.status, 201);
    assert.notEqual(revision.value.id, first.value.id);
    assert.equal(revision.value.sourceListingId, humanPublish.value.id);
    assert.equal((await call(base, `/api/listings/${humanPublish.value.id}`)).value.status, 'ACTIVE');
    const revisedDraft = await call(base, `/api/listing-drafts/${revision.value.id}`, {
      method: 'PATCH', body: { ...revision.value, model: 'iPhone 15 Plus' },
    });
    const republished = await call(base, `/api/listing-drafts/${revision.value.id}/publish`, { method: 'POST' });
    assert.equal(republished.status, 201);
    assert.equal(republished.value.id, humanPublish.value.id);
    assert.equal(republished.value.model, 'iPhone 15 Plus');
    assert.equal(republished.value.draftId, revisedDraft.value.id);
  });
});

test('purchase requests stay private, require human confirmation, and search is repeatable', async () => {
  await withApi(async (base, server) => {
    const draft = await call(base, '/api/purchase-requests', {
      method: 'POST', actorType: 'AGENT', requestId: 'buyer-request-1',
      body: { source: 'AGENT', category: 'TABLET', modelQuery: 'iPad', maxBudgetKrw: 1000000, storageGb: 128 },
    });
    assert.equal(draft.status, 201);
    assert.equal(draft.value.status, 'DRAFT');

    const privateList = await call(base, '/api/purchase-requests/mine', { userId: otherUser });
    assert.equal(privateList.value.length, 0);
    const forbiddenPatch = await call(base, `/api/purchase-requests/${draft.value.id}`, {
      method: 'PATCH', userId: otherUser, body: { category: 'PHONE', maxBudgetKrw: 500000 },
    });
    assert.equal(forbiddenPatch.status, 403);

    const prematureAgentSearch = await call(base, `/api/purchase-requests/${draft.value.id}/search`, {
      method: 'POST', actorType: 'AGENT', requestId: 'buyer-search-early',
    });
    assert.equal(prematureAgentSearch.status, 409);
    const agentConfirm = await call(base, `/api/purchase-requests/${draft.value.id}/confirm`, { method: 'POST', actorType: 'AGENT' });
    assert.equal(agentConfirm.status, 403);

    const confirmed = await call(base, `/api/purchase-requests/${draft.value.id}/confirm`, { method: 'POST' });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.value.status, 'CONFIRMED');
    const results = await call(base, `/api/purchase-requests/${draft.value.id}/search`, {
      method: 'POST', actorType: 'AGENT', requestId: 'buyer-search-1',
    });
    assert.equal(results.status, 200);
    assert.ok(results.value.length > 0);
    assert.ok(results.value.some(result => result.matchStatus === 'MATCH'));
    assert.ok(results.value.some(result => result.matchStatus === 'EXCLUDED'));
    assert.ok(results.value.every(result => result.ruleVersion === RULE_VERSION));
    const retry = await call(base, `/api/purchase-requests/${draft.value.id}/search`, {
      method: 'POST', actorType: 'AGENT', requestId: 'buyer-search-1',
    });
    assert.deepEqual(retry.value.map(result => result.id), results.value.map(result => result.id));
    assert.equal(server.store.db.prepare("SELECT COUNT(*) AS n FROM agent_action_logs WHERE action_type='SEARCH_LISTINGS'").get().n, 2);
    assert.equal(server.store.db.prepare("SELECT COUNT(*) AS n FROM agent_action_logs WHERE action_type='SEARCH_LISTINGS' AND status='SUCCEEDED'").get().n, 1);
    assert.equal(server.store.db.prepare("SELECT COUNT(*) AS n FROM agent_action_logs WHERE action_type='SEARCH_LISTINGS' AND status='FAILED'").get().n, 1);
  });
});

test('missing required values and invalid categories return 422', async () => {
  await withApi(async base => {
    const invalidCategory = await call(base, '/api/listing-drafts', { method: 'POST', body: { category: 'LAPTOP' } });
    assert.equal(invalidCategory.status, 422);
    assert.equal(invalidCategory.value.code, 'VALIDATION_ERROR');
    const incompleteDraft = await call(base, '/api/listing-drafts', { method: 'POST', body: { category: 'PHONE', priceKrw: 300000 } });
    const prematurePublish = await call(base, `/api/listing-drafts/${incompleteDraft.value.id}/publish`, { method: 'POST' });
    assert.equal(prematurePublish.status, 422);
    assert.deepEqual(prematurePublish.value.details.missingFields, ['model']);
    const partial = await call(base, '/api/purchase-requests', { method: 'POST', body: { category: 'PHONE' } });
    assert.equal(partial.status, 201);
    const confirm = await call(base, `/api/purchase-requests/${partial.value.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 422);
    assert.deepEqual(confirm.value.details.missingFields, ['maxBudgetKrw']);
  });
});

test('Agent natural-language purchase drafts persist extracted conditions and require human confirmation', async () => {
  await withApi(async base => {
    const options = { method: 'POST', actorType: 'AGENT', requestId: 'natural-purchase-1',
      body: { naturalLanguageRequest: '100만 원 이하 태블릿 찾아줘' } };
    const created = await call(base, '/api/purchase-requests', options);
    assert.equal(created.status, 201);
    assert.equal(created.value.category, 'TABLET');
    assert.equal(created.value.maxBudgetKrw, 1000000);
    assert.equal(created.value.status, 'DRAFT');
    assert.equal((await call(base, '/api/purchase-requests', options)).value.id, created.value.id);
    assert.equal((await call(base, `/api/purchase-requests/${created.value.id}/search`, {
      method: 'POST', actorType: 'AGENT', requestId: 'natural-search-early',
    })).status, 409);
    assert.equal((await call(base, '/api/purchase-requests/mine')).value[0].maxBudgetKrw, 1000000);
    await call(base, `/api/purchase-requests/${created.value.id}/confirm`, { method: 'POST' });
    const patched = await call(base, `/api/purchase-requests/${created.value.id}`, {
      method: 'PATCH', actorType: 'AGENT', requestId: 'natural-purchase-2',
      body: { naturalLanguageRequest: '256GB 이상' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.value.storageGb, 256);
    assert.equal(patched.value.maxBudgetKrw, 1000000);
    assert.equal(patched.value.status, 'DRAFT');
    const unclear = await call(base, '/api/purchase-requests', {
      method: 'POST', body: { naturalLanguageRequest: '저렴한 태블릿' },
    });
    assert.ok(unclear.value.nextQuestions.length);
    assert.equal((await call(base, `/api/purchase-requests/${unclear.value.id}/confirm`, { method: 'POST' })).status, 422);
  });
});

test('HTTP search uses Korean model aliases and preserves exclusion diagnostics', async () => {
  await withApi(async base => {
    const draft = await call(base, '/api/purchase-requests', {
      method: 'POST', body: { category: 'PHONE', modelQuery: '갤럭시 s23', maxBudgetKrw: 600000, storageGb: 256 },
    });
    await call(base, `/api/purchase-requests/${draft.value.id}/confirm`, { method: 'POST' });
    const response = await call(base, `/api/purchase-requests/${draft.value.id}/search`, { method: 'POST' });
    assert.equal(response.status, 200);
    const candidates = response.value.filter(value => value.matchStatus !== 'EXCLUDED');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].listing.model, 'Galaxy S23');
    assert.equal(candidates[0].ruleVersion, RULE_VERSION);
    assert.ok(response.value.some(value => value.unmetFields.includes('category')));
  });
});

test('purchase API shares review guidance, owner-only detail and approval reset with Agents and Web', async () => {
  await withApi(async base => {
    const draftOptions = { method: 'POST', actorType: 'AGENT', requestId: 'api-link-create',
      body: { naturalLanguageRequest: '저렴한 태블릿' } };
    const created = await call(base, '/api/purchase-requests', draftOptions);
    assert.equal(created.status, 201);
    assert.equal(created.value.humanApprovalRequired, true);
    assert.equal(created.value.readyForConfirmation, false);
    assert.equal(created.value.nextAction.action, 'COMPLETE_CONDITIONS');
    assert.deepEqual((await call(base, '/api/purchase-requests', draftOptions)).value, created.value);
    const path = `/api/purchase-requests/${created.value.id}`;
    assert.deepEqual((await call(base, path)).value, created.value);
    assert.equal((await call(base, path, { userId: otherUser })).status, 403);
    assert.equal((await call(base, '/api/purchase-requests/00000000-0000-4000-8000-000000009999')).status, 404);
    const edited = await call(base, path, { method: 'PATCH', actorType: 'AGENT', requestId: 'api-link-edit',
      body: { knownConstraints: { maxBudgetKrw: 1000000 } } });
    assert.equal(edited.value.readyForConfirmation, true);
    assert.equal(edited.value.nextAction.action, 'REVIEW_AND_CONFIRM');
    assert.equal(edited.value.nextAction.actor, 'HUMAN');
    assert.ok(!edited.value.nextQuestions.some(question => question.includes('예산')));
    assert.equal((await call(base, `${path}/confirm`, { method: 'POST', actorType: 'AGENT' })).status, 403);
    assert.equal((await call(base, `${path}/search`, { method: 'POST' })).status, 409);
    const confirmed = await call(base, `${path}/confirm`, { method: 'POST' });
    assert.equal(confirmed.value.humanApprovalRequired, false);
    assert.equal(confirmed.value.readyForConfirmation, false);
    assert.equal(confirmed.value.nextAction.action, 'SEARCH_LISTINGS');
    assert.equal((await call(base, `${path}/search`, { method: 'POST', body: { maxBudgetKrw: 2000000 } })).status, 422);
    const results = await call(base, `${path}/search`, { method: 'POST', actorType: 'AGENT', requestId: 'api-link-search' });
    assert.equal(results.status, 200);
    assert.ok(results.value.some(result => result.matchStatus === 'MATCH'));
    const patched = await call(base, path, { method: 'PATCH', body: { storageGb: 256 } });
    assert.equal(patched.value.status, 'DRAFT');
    assert.equal(patched.value.humanApprovalRequired, true);
    assert.equal((await call(base, `${path}/search`, { method: 'POST' })).status, 409);
    const schema = await call(base, '/api/categories/TABLET/schema');
    assert.deepEqual(schema.value.purchaseRequiredFields, ['category', 'maxBudgetKrw']);
    assert.deepEqual(schema.value.requiredFields, ['category', 'model', 'priceKrw']);
  });
});

test('Agent API rejects missing request IDs and invalid intent without saving partial drafts', async () => {
  await withApi(async (base, server) => {
    const initial = server.store.db.prepare('SELECT COUNT(*) AS n FROM purchase_requests').get().n;
    for (const options of [
      { method: 'POST', actorType: 'AGENT', body: { naturalLanguageRequest: '태블릿 100만원 이하' } },
      { method: 'POST', actorType: 'AGENT', requestId: 'bad-intent', body: { naturalLanguageRequest: 123 } },
      { method: 'POST', actorType: 'AGENT', requestId: 'bad-known', body: { knownConstraints: { category: 'LAPTOP' } } },
    ]) {
      const response = await call(base, '/api/purchase-requests', options);
      assert.equal(response.status, 422);
      assert.equal(response.value.code, 'VALIDATION_ERROR');
    }
    assert.equal(server.store.db.prepare('SELECT COUNT(*) AS n FROM purchase_requests').get().n, initial);
    assert.equal(server.store.db.prepare("SELECT COUNT(*) AS n FROM agent_action_logs WHERE status='FAILED'").get().n, 3);
  });
});

test('skipped optional questions persist through the API and never bypass required fields', async () => {
  await withApi(async base => {
    const draft = await call(base, '/api/purchase-requests', { method: 'POST',
      body: { naturalLanguageRequest: '태블릿 100만원 이하' } });
    const path = `/api/purchase-requests/${draft.value.id}`;
    const skipped = ['modelQuery', 'storageGb', 'conditionPreferences'];
    const patched = await call(base, path, { method: 'PATCH', body: { skippedQuestionFields: skipped } });
    assert.deepEqual(patched.value.nextQuestions, []);
    assert.deepEqual((await call(base, path)).value.skippedQuestionFields, skipped);
    assert.equal((await call(base, path, { method: 'PATCH', body: { skippedQuestionFields: ['maxBudgetKrw'] } })).status, 422);
    assert.equal((await call(base, `${path}/confirm`, { method: 'POST' })).status, 200);
    await call(base, path, { method: 'PATCH', body: { maxBudgetKrw: null } });
    assert.equal((await call(base, `${path}/confirm`, { method: 'POST' })).status, 422);
    assert.equal((await call(base, `${path}/search`, { method: 'POST' })).status, 409);
  });
});
