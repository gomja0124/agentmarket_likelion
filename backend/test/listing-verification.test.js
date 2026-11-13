import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../server/app.js';
import { Store } from '../server/database.js';

const seller = '00000000-0000-4000-8000-000000000091';
const buyer = '00000000-0000-4000-8000-000000000092';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lD8AAAAASUVORK5CYII=';

test('production inventory hides unconfirmed and stale real listings until their seller checks availability', async () => {
  const store = new Store({ dbPath: ':memory:', seed: false, requireVerifiedListings: true });
  const server = createApiServer({ store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, userId, method = 'GET', body, actor = 'HUMAN') {
    const response = await fetch(base + path, { method, headers: { 'X-User-Id': userId, 'X-Actor-Type': actor,
      'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  }
  try {
    const draft = await call('/api/listing-drafts', seller, 'POST', { category: 'PHONE', model: 'Galaxy S23',
      storageGb: 256, priceKrw: 480000, condition: 'GOOD', images: [image], description: '기기 상태를 직접 확인했습니다.' });
    const published = await call(`/api/listing-drafts/${draft.value.id}/publish`, seller, 'POST');
    assert.equal(published.status, 201);
    const id = published.value.id;
    assert.deepEqual((await call('/api/listings', buyer)).value, []);
    assert.equal((await call(`/api/listings/${id}`, buyer)).status, 404);
    assert.equal((await call(`/api/listings/${id}/verify`, buyer, 'POST', {})).status, 403);
    assert.equal((await call(`/api/listings/${id}/verify`, seller, 'POST', {}, 'AGENT')).status, 403);
    assert.equal((await call(`/api/listings/${id}/verify`, seller, 'POST', { ownedBySeller: true })).status, 422);
    const confirmation = { ownedBySeller: true, photosAreOfItem: true, conditionAccurate: true, availableForSale: true };
    assert.equal((await call(`/api/listings/${id}/verify`, seller, 'POST', confirmation)).status, 200);
    assert.equal((await call('/api/listings', buyer)).value.length, 1);
    store.db.prepare('UPDATE listings SET availability_checked_at=? WHERE id=?')
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString(), id);
    assert.deepEqual((await call('/api/listings', buyer)).value, []);
    assert.equal((await call(`/api/listings/${id}/verify`, seller, 'POST', confirmation)).status, 200);
    assert.equal((await call('/api/listings', buyer)).value.length, 1);
    assert.equal((await call(`/api/listings/${id}/sold`, seller, 'POST')).status, 200);
    assert.equal((await call(`/api/listings/${id}/verify`, seller, 'POST', confirmation)).status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve)); store.close();
  }
});
