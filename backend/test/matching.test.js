import test from 'node:test';
import assert from 'node:assert/strict';
import { matchListings, RULE_VERSION } from '../server/matching.js';
import { matchesModel } from '../server/model-matching.js';
const request = { id: 'purchase', status: 'CONFIRMED', category: 'PHONE', maxBudgetKrw: 600000,
  modelQuery: null, storageGb: null, conditionPreferences: [] };
const listing = { id: 'listing', status: 'ACTIVE', category: 'PHONE', model: 'Galaxy S23',
  priceKrw: 600000, storageGb: 256, condition: 'GOOD', accessories: '박스', missingFields: [] };
const result = (product = {}, criteria = {}) => matchListings([{ ...listing, ...product }], { ...request, ...criteria })[0];

test('Korean aliases, spacing, case and plus variants normalize to model tokens', () => {
  for (const [model, query] of [
    ['iPhone 15 Pro', '아이폰15프로'], ['iPad Air 5', '아이패드 에어 5세대'],
    ['Galaxy Tab A9+', '갤럭시탭 a9 플러스'], ['Galaxy Z Flip5', '갤럭시 Z 플립 5'],
    ['Galaxy S24 Ultra', '갤럭시s24울트라'],
  ]) assert.equal(matchesModel(model, query), true, query);
});

test('family searches are broad while numbered models preserve variant and number boundaries', () => {
  for (const model of ['iPad 10', 'iPad Air 5', 'iPad Pro 11']) assert.ok(matchesModel(model, '아이패드'));
  assert.ok(matchesModel('Galaxy Tab S9 FE', '갤럭시 탭'));
  assert.ok(matchesModel('iPad Pro 11', '아이패드 프로'));
  for (const [model, query] of [
    ['iPhone 15', 'iPhone 1'], ['Galaxy Tab S90', 'Galaxy Tab S9'],
    ['Galaxy Tab S9 FE', 'Galaxy Tab S9'], ['iPhone 15 Pro Max', 'iPhone 15 Pro'],
    ['iPhone 15 Pro', 'iPhone 15'], ['iPad Air 5', 'iPad Pro'],
  ]) assert.equal(matchesModel(model, query), false, `${query} / ${model}`);
});

test('only active listings and confirmed valid purchase conditions can be matched', () => {
  assert.deepEqual(matchListings([{ ...listing, status: 'INACTIVE' }], request), []);
  assert.throws(() => matchListings([listing], { ...request, status: 'DRAFT' }), error => error.code === 'INVALID_STATE');
  assert.throws(() => matchListings([listing], { ...request, maxBudgetKrw: -1 }), error => error.code === 'VALIDATION_ERROR');
});

test('inclusive budget and minimum storage boundaries produce explicit reasons', () => {
  const value = result({}, { storageGb: 256, modelQuery: '갤럭시 s23', conditionPreferences: ['GOOD'] });
  assert.equal(value.matchStatus, 'MATCH');
  assert.deepEqual(value.matchedFields, ['category', 'maxBudgetKrw', 'modelQuery', 'storageGb', 'condition']);
  assert.equal(value.ruleVersion, RULE_VERSION);
  assert.equal(result({ priceKrw: 600001 }).matchStatus, 'EXCLUDED');
  assert.deepEqual(result({ storageGb: 128 }, { storageGb: 256 }).unmetFields, ['storageGb']);
});

test('missing or explicitly unverified required judgment data never counts as matched', () => {
  for (const [field, patch, criteria] of [
    ['category', { category: null }, {}], ['priceKrw', { priceKrw: null }, {}],
    ['model', { model: '' }, {}], ['storageGb', { storageGb: null }, { storageGb: 256 }],
    ['condition', { condition: null }, { conditionPreferences: ['GOOD'] }],
  ]) {
    const value = result(patch, criteria);
    assert.equal(value.matchStatus, 'NEEDS_CONFIRMATION', field);
    assert.ok(value.missingFields.includes(field));
  }
  const declared = result({ missingFields: ['storageGb'] }, { storageGb: 256 });
  assert.equal(declared.matchStatus, 'NEEDS_CONFIRMATION');
  assert.ok(!declared.matchedFields.includes('storageGb'));
});

test('unrequested missing information is displayed without rejecting a valid match', () => {
  const value = result({ storageGb: null, condition: null, accessories: null, missingFields: ['batteryHealth'] });
  assert.equal(value.matchStatus, 'MATCH');
  assert.deepEqual(value.missingFields, ['batteryHealth', 'storageGb', 'condition', 'accessories']);
});

test('hard violations take precedence and missing information remains visible', () => {
  const value = result({ category: 'TABLET', priceKrw: 700000, storageGb: null, condition: 'FAIR' },
    { storageGb: 256, conditionPreferences: ['GOOD'] });
  assert.equal(value.matchStatus, 'EXCLUDED');
  assert.deepEqual(value.unmetFields, ['category', 'maxBudgetKrw', 'condition']);
  assert.ok(value.missingFields.includes('storageGb'));
});
