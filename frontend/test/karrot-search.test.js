import test from 'node:test';
import assert from 'node:assert/strict';
import { karrotSearchFor } from '../src/karrot.js';

test('confirmed device conditions produce a Karrot search handoff with supported filters only', () => {
  const search = karrotSearchFor({ category: 'TABLET', modelQuery: 'iPad Air 5', maxBudgetKrw: 1000000,
    storageGb: 128, conditionPreferences: ['GOOD'] });
  const url = new URL(search.url);
  assert.equal(url.origin, 'https://www.daangn.com');
  assert.equal(url.pathname, '/kr/search/buy-sell/');
  assert.equal(url.searchParams.get('q'), 'iPad Air 5');
  assert.equal(url.searchParams.get('price'), '__1000000');
  assert.equal(url.searchParams.get('category_id'), '1');
  assert.equal(url.searchParams.get('only_on_sale'), 'true');
  assert.equal(url.searchParams.has('storage'), false);
  assert.equal(url.searchParams.has('condition'), false);
  assert.equal(karrotSearchFor({ category: 'PHONE' }).keyword, '스마트폰');
});
