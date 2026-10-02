import test from 'node:test';
import assert from 'node:assert/strict';
import { matchListings, listingMissing, requestMissing } from '../src/matching.js';

test('승인 필수 값이 없으면 게시와 검색을 진행할 수 없다', () => {
  assert.deepEqual(listingMissing({ category: 'PHONE', model: '', priceKrw: 0 }), ['model', 'priceKrw']);
  assert.deepEqual(requestMissing({ category: 'TABLET', maxBudgetKrw: null }), ['maxBudgetKrw']);
});

test('조건 위반은 제외하고 판단 정보 누락은 확인 필요로 표시한다', () => {
  const listings = [
    { id: 'match', category: 'TABLET', priceKrw: 500000, model: 'iPad Air', storageGb: 128, status: 'ACTIVE' },
    { id: 'missing', category: 'TABLET', priceKrw: 500000, model: 'iPad Air', storageGb: null, status: 'ACTIVE' },
    { id: 'expensive', category: 'TABLET', priceKrw: 1500000, model: 'iPad Air', storageGb: 128, status: 'ACTIVE' },
    { id: 'inactive', category: 'TABLET', priceKrw: 500000, model: 'iPad Air', storageGb: 128, status: 'INACTIVE' },
  ];
  const results = matchListings(listings, { category: 'TABLET', maxBudgetKrw: 1000000, modelQuery: 'iPad', storageGb: 128 });
  assert.deepEqual(results.map(x => [x.listingId, x.matchStatus]), [['match', 'MATCH'], ['missing', 'NEEDS_CONFIRMATION']]);
  assert.deepEqual(results[1].missingFields, ['storageGb']);
});
