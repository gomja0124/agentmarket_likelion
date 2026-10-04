import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../server/app.js';

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
    assert.ok(results.value.every(result => result.ruleVersion === 'step1-rule-v1'));
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
