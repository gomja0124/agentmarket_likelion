import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { AGENT_MARKET_API_BASE: '', AGENT_MARKET_WEB_AUTH: true };
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (url === '/web/session') return { ok: true, json: async () => ({ authenticated: true, csrfToken: 'csrf-from-session' }) };
  return { ok: true, json: async () => [] };
};
const { api, isDemo } = await import('../src/api.js');

test('Web mode sends the session CSRF token and never trusts a browser user header', async () => {
  assert.equal(isDemo, false);
  await api.webSession();
  await api.listMyListings();
  await api.savePurchaseRequest({ category: 'TABLET', maxBudgetKrw: 500000 });
  assert.equal(calls[1].url, '/api/listings/mine');
  assert.equal(calls[1].options.headers['X-User-Id'], undefined);
  assert.equal(calls[2].options.headers['X-User-Id'], undefined);
  assert.equal(calls[2].options.headers['X-CSRF-Token'], 'csrf-from-session');
  assert.equal(calls[2].options.credentials, 'same-origin');
});
