import test from 'node:test';
import assert from 'node:assert/strict';
import { listingAdvice } from '../server/listing-advice.js';

test('price advice needs three comparable real asking prices and does not present samples as market prices', () => {
  const rows = [430000, 470000, 510000].map((priceKrw, i) => ({ id: String(i), status: 'ACTIVE',
    category: 'PHONE', model: 'Galaxy S23', storageGb: 256, condition: 'GOOD', priceKrw, isSample: false }));
  const input = { category: 'PHONE', model: '갤럭시 S23', storageGb: 256, condition: 'GOOD',
    priceKrw: 490000, hasPhoto: true, hasDescription: true, hasBatteryDetails: true };
  const real = listingAdvice(rows, input);
  assert.equal(real.comparableCount, 3);
  assert.deepEqual(real.recommendedRange, { lowerKrw: 450000, medianKrw: 470000, upperKrw: 490000 });
  assert.deepEqual(real.questions, []);
  const sample = listingAdvice(rows.map(row => ({ ...row, isSample: true })), input);
  assert.equal(sample.recommendedRange, null);
  assert.ok(sample.demonstrationRange);
  assert.equal(listingAdvice(rows.slice(0, 2), input).recommendedRange, null);
  const missing = listingAdvice([], { category: 'PHONE', model: 'Galaxy S23' });
  assert.ok(missing.questions.some(question => question.includes('배터리')));
  assert.ok(missing.questions.some(question => question.includes('사진')));
});
