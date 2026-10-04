import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { AGENT_MARKET_API_BASE: '' };
const saved = new Map();
globalThis.localStorage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};

const { api } = await import('../src/api.js');

test('Agent의 미확인 항목은 입력 후 해소되고, 게시 수정은 별도 초안에서 시작한다', async () => {
  const draft = await api.saveListingDraft({ source: 'AGENT', category: 'PHONE', model: 'iPhone 15',
    priceKrw: 500000, missingFields: ['condition'], nextQuestions: ['상태는 어떤가요?'] });
  assert.deepEqual(draft.missingFields, ['condition']);
  const edited = await api.saveListingDraft({ ...draft, condition: 'GOOD' });
  assert.deepEqual(edited.missingFields, []);
  assert.deepEqual(edited.nextQuestions, []);
  const published = await api.publishListing(edited.id);
  const revision = await api.startListingRevision(published.id);
  assert.notEqual(revision.id, published.id);
  assert.equal(revision.sourceListingId, published.id);
  assert.equal((await api.getListing(published.id)).status, 'ACTIVE');
});

test('구매 조건은 사람이 확정하기 전 검색할 수 없다', async () => {
  const draft = await api.savePurchaseRequest({ category: 'TABLET', maxBudgetKrw: 800000,
    missingFields: ['modelQuery'], nextQuestions: ['원하는 모델이 있나요?'] });
  assert.deepEqual(draft.missingFields, ['modelQuery']);
  await assert.rejects(api.search(draft.id), /확인한 뒤/);
  const edited = await api.savePurchaseRequest({ ...draft, modelQuery: 'iPad' });
  assert.deepEqual(edited.missingFields, []);
  const confirmed = await api.confirmPurchaseRequest(edited.id);
  const results = await api.search(confirmed.id);
  assert.ok(results.length > 0);
  assert.equal(results[0].purchaseRequestId, confirmed.id);
});
