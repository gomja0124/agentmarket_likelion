import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesBrowseQuery, matchesModel } from '../src/model-search.js';

test('한글 모델 별칭으로 영문 매물을 찾고 다른 세대는 제외한다', () => {
  const listing = { title: 'iPad Air 5 256GB · 스페이스 그레이', brand: 'Apple', model: 'iPad Air 5' };
  assert.equal(matchesBrowseQuery(listing, '아이패드 에어'), true);
  assert.equal(matchesBrowseQuery(listing, '아이패드 에어 5'), true);
  assert.equal(matchesBrowseQuery(listing, '아이패드 에어 4'), false);
  assert.equal(matchesModel('iPhone 15 Pro', '아이폰 1'), false);
});
