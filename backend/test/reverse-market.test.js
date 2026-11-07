import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApiServer } from '../server/app.js';

const buyer = '00000000-0000-4000-8000-000000000011';
const seller = '00000000-0000-4000-8000-000000000012';
const outsider = '00000000-0000-4000-8000-000000000013';

test('Step 2 keeps demand private until buyer approval, then permits only matched seller connections', async () => {
  const server = createApiServer({ dbPath: ':memory:', seed: false });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, user, method = 'GET', body, actor = 'HUMAN') {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-User-Id': user, 'X-Actor-Type': actor,
        ...(actor === 'AGENT' ? { 'Idempotency-Key': randomUUID() } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  }
  try {
    const draft = (await call('/api/listing-drafts', seller, 'POST', {
      category: 'TABLET', model: 'iPad Air 5', priceKrw: 550000, storageGb: 256,
      condition: 'GOOD', title: 'iPad Air 5 256GB',
    })).value;
    const listing = (await call(`/api/listing-drafts/${draft.id}/publish`, seller, 'POST')).value;
    const purchase = (await call('/api/purchase-requests', buyer, 'POST', {
      category: 'TABLET', modelQuery: 'iPad Air', maxBudgetKrw: 600000,
      storageGb: 128, conditionPreferences: ['GOOD'],
    })).value;
    const early = await call(`/api/purchase-requests/${purchase.id}/public-demand`, buyer, 'POST', {});
    assert.equal(early.status, 409);
    await call(`/api/purchase-requests/${purchase.id}/confirm`, buyer, 'POST');
    const demand = (await call(`/api/purchase-requests/${purchase.id}/public-demand`, buyer, 'POST', {})).value;
    assert.equal(demand.status, 'DRAFT');
    assert.equal((await call(`/api/public-demands/${demand.id}`, seller)).status, 404);
    assert.deepEqual((await call(`/api/listings/${listing.id}/public-demands`, seller)).value, []);
    assert.equal((await call(`/api/public-demands/${demand.id}/publish`, buyer, 'POST', {}, 'AGENT')).status, 403);
    assert.equal((await call(`/api/public-demands/${demand.id}`, buyer, 'PATCH', { description: '연락처 010-1234-5678' })).status, 422);
    await call(`/api/public-demands/${demand.id}`, buyer, 'PATCH', { minBudgetKrw: 500000 });
    assert.equal((await call(`/api/public-demands/${demand.id}/publish`, buyer, 'POST')).status, 200);
    const matches = (await call(`/api/listings/${listing.id}/public-demands`, seller)).value;
    assert.equal(matches.length, 1);
    assert.equal(matches[0].matchStatus, 'MATCH');
    assert.equal(matches[0].demand.buyerId, undefined);
    assert.equal((await call(`/api/public-demands/${demand.id}`, outsider)).status, 404);
    assert.equal((await call(`/api/listings/${listing.id}/public-demands`, outsider)).status, 403);
    const connection = (await call('/api/connection-requests', seller, 'POST', { publicDemandId: demand.id, listingId: listing.id })).value;
    assert.equal(connection.status, 'PENDING');
    assert.equal(connection.buyerId, undefined);
    assert.equal((await call('/api/connection-requests', seller, 'POST', { publicDemandId: demand.id, listingId: listing.id })).status, 409);
    assert.equal((await call(`/api/connection-requests/${connection.id}/accept`, seller, 'POST')).status, 403);
    const accepted = await call(`/api/connection-requests/${connection.id}/accept`, buyer, 'POST');
    assert.equal(accepted.value.status, 'ACCEPTED');
    const buyerNotices = (await call('/api/notifications/mine', buyer)).value;
    assert.deepEqual(new Set(buyerNotices.map(x => x.type)), new Set(['NEW_MATCH', 'CONNECTION_REQUEST']));
    const sellerNotices = (await call('/api/notifications/mine', seller)).value;
    assert.deepEqual(new Set(sellerNotices.map(x => x.type)), new Set(['NEW_MATCH', 'CONNECTION_ACCEPTED']));
    await call(`/api/public-demands/${demand.id}/pause`, buyer, 'POST');
    assert.deepEqual((await call(`/api/listings/${listing.id}/public-demands`, seller)).value, []);
    await call(`/api/public-demands/${demand.id}/resume`, buyer, 'POST');
    assert.equal((await call('/api/notifications/mine', buyer)).value.filter(item => item.type === 'NEW_MATCH').length, 1,
      '일시정지 후 재개해도 같은 매물의 매칭 알림은 중복되지 않는다');
    await call(`/api/public-demands/${demand.id}/close`, buyer, 'POST');
    assert.deepEqual((await call(`/api/listings/${listing.id}/public-demands`, seller)).value, []);
    assert.equal((await call('/api/connection-requests', seller, 'POST', { publicDemandId: demand.id, listingId: listing.id })).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    server.store.close();
  }
});
