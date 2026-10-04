import assert from 'node:assert/strict';
import { createApiServer } from '../server/app.js';

// Isolated HTTP demonstration; never touches the user's local SQLite database.
const server = createApiServer({ dbPath: ':memory:' });
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
async function call(path, body, actor = 'HUMAN', key) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Actor-Type': actor,
      ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, value: await response.json() };
}
try {
  const seeds = await call('/api/listings');
  assert.ok(seeds.value.length >= 12);
  const draft = await call('/api/listing-drafts', {
    category: 'TABLET', model: 'iPad Air 5', title: 'E2E iPad Air',
    priceKrw: 550000, storageGb: 256, condition: 'GOOD', accessories: '박스',
  }, 'AGENT', 'demo-seller-draft');
  assert.equal(draft.status, 201);
  assert.equal((await call(`/api/listing-drafts/${draft.value.id}/publish`, {}, 'AGENT', 'demo-agent-publish')).status, 403);
  const listing = await call(`/api/listing-drafts/${draft.value.id}/publish`, {});
  assert.equal(listing.status, 201);
  const draftInput = { naturalLanguageRequest: '아이패드 에어 60만원 이하 256GB 이상',
    knownConstraints: { conditionPreferences: ['GOOD'] } };
  const purchase = await call('/api/purchase-requests', draftInput, 'AGENT', 'demo-buyer-draft');
  assert.equal(purchase.status, 201);
  assert.equal(purchase.value.nextAction.action, 'REVIEW_AND_CONFIRM');
  const path = `/api/purchase-requests/${purchase.value.id}`;
  assert.equal((await call(`${path}/search`, {}, 'AGENT', 'demo-early-search')).status, 409);
  assert.equal((await call(`${path}/confirm`, {}, 'AGENT', 'demo-agent-confirm')).status, 403);
  assert.equal((await call(`${path}/confirm`, {})).status, 200);
  const search = await call(`${path}/search`, {}, 'AGENT', 'demo-search');
  assert.equal(search.status, 200);
  const replay = await call(`${path}/search`, {}, 'AGENT', 'demo-search');
  assert.deepEqual(replay.value, search.value);
  const candidates = search.value.filter(result => result.matchStatus !== 'EXCLUDED');
  assert.ok(candidates.some(result => result.listingId === listing.value.id));
  console.log(JSON.stringify({ status: 'PASS', seedCount: seeds.value.length,
    purchaseConditions: { category: purchase.value.category, modelQuery: purchase.value.modelQuery,
      maxBudgetKrw: purchase.value.maxBudgetKrw, storageGb: purchase.value.storageGb },
    checks: ['Agent publish blocked', 'search before approval blocked', 'Agent confirmation blocked', 'search retry returns same result'],
    candidates: candidates.map(result => ({ model: result.listing.model, priceKrw: result.listing.priceKrw,
      matchStatus: result.matchStatus, matchedFields: result.matchedFields, missingFields: result.missingFields,
      ruleVersion: result.ruleVersion })),
  }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
  server.store.close();
}
