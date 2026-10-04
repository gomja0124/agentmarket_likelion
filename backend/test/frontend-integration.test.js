import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../server/app.js';

test('frontend HTTP adapter publishes a listing and searches confirmed purchase conditions', async () => {
  const server = createApiServer({ dbPath: ':memory:' });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const previousWindow = globalThis.window;
  globalThis.window = { AGENT_MARKET_API_BASE: `http://127.0.0.1:${server.address().port}` };
  try {
    const { api, isDemo } = await import('../../frontend/src/api.js');
    assert.equal(isDemo, false);
    assert.equal((await api.listListings()).length, 12);
    const draft = await api.saveListingDraft({ source: 'AGENT', category: 'TABLET',
      model: 'Integration Tablet', priceKrw: 300000, storageGb: 256, condition: 'GOOD' });
    const edited = await api.saveListingDraft({ ...draft, title: 'Integration listing' });
    const listing = await api.publishListing(edited.id);
    assert.equal(listing.status, 'ACTIVE');
    assert.ok((await api.listMyListings()).some(item => item.id === listing.id));
    const purchase = await api.savePurchaseRequest({ category: 'TABLET',
      modelQuery: 'Integration Tablet', maxBudgetKrw: 400000, storageGb: 128 });
    await assert.rejects(api.search(purchase.id), /확정/);
    const confirmed = await api.confirmPurchaseRequest(purchase.id);
    const results = await api.search(confirmed.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].listing.id, listing.id);
    assert.equal(results[0].matchStatus, 'MATCH');
    await api.deactivateListing(listing.id);
    assert.deepEqual(await api.search(confirmed.id), []);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await new Promise(resolve => server.close(resolve));
    server.store.close();
  }
});
