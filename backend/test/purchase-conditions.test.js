import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePurchaseRequest } from '../server/validation.js';

const context = { userId: 'buyer', actorType: 'AGENT', now: '2026-10-04T00:00:00Z', id: 'request' };
const parse = (payload, existing) => normalizePurchaseRequest(payload, { ...context, existing });

test('minimal Korean intent becomes a private draft without invented optional values', () => {
  const value = parse({ naturalLanguageRequest: '100만 원 이하 태블릿 찾아줘' });
  assert.equal(value.category, 'TABLET');
  assert.equal(value.maxBudgetKrw, 1000000);
  assert.equal(value.modelQuery, null);
  assert.equal(value.storageGb, null);
  assert.deepEqual(value.conditionPreferences, []);
  assert.deepEqual(value.missingFields, []);
  assert.equal(value.status, 'DRAFT');
});

test('model, decimal KRW budget and TB storage are extracted', () => {
  const value = parse({ naturalLanguageRequest: '아이패드 프로 99.5만원 이하 1TB 이상 양호한 제품' });
  assert.equal(value.category, 'TABLET');
  assert.equal(value.modelQuery, 'iPad Pro');
  assert.equal(value.maxBudgetKrw, 995000);
  assert.equal(value.storageGb, 1024);
  assert.deepEqual(value.conditionPreferences, ['GOOD']);
  assert.equal(parse({ naturalLanguageRequest: '휴대폰 600,000원 미만' }).maxBudgetKrw, 599999);
});

test('ambiguous budgets and unsupported bounds produce questions rather than guesses', () => {
  for (const input of ['저렴한 태블릿', '태블릿 50만원 정도', '태블릿 예산 50만원 이상', '태블릿 50만원 이하 또는 80만원 이하']) {
    const value = parse({ naturalLanguageRequest: input });
    assert.equal(value.maxBudgetKrw, null, input);
    assert.ok(value.missingFields.includes('maxBudgetKrw'));
    assert.ok(value.nextQuestions.length);
  }
  const value = parse({ naturalLanguageRequest: '태블릿 100만원 이하 128GB 이하' });
  assert.equal(value.storageGb, null);
  assert.ok(value.missingFields.includes('storageGb'));
});

test('multiple categories, models, capacities and negated terms are not silently selected', () => {
  const value = parse({ naturalLanguageRequest: '아이폰 또는 아이패드 100만원 이하 128GB 또는 256GB' });
  assert.equal(value.category, null);
  assert.equal(value.modelQuery, null);
  assert.equal(value.storageGb, null);
  const negated = parse({ naturalLanguageRequest: '아이패드 말고 태블릿 100만원 이하' });
  assert.equal(negated.modelQuery, null);
});

test('known constraints can complete intent and concrete conflicts are surfaced', () => {
  const value = parse({ naturalLanguageRequest: '저렴한 태블릿', knownConstraints: { maxBudgetKrw: 500000 } });
  assert.equal(value.maxBudgetKrw, 500000);
  assert.deepEqual(value.missingFields, []);
  const conflict = parse({ naturalLanguageRequest: '태블릿 100만원 이하', knownConstraints: { maxBudgetKrw: 800000 } });
  assert.equal(conflict.maxBudgetKrw, null);
  assert.ok(conflict.missingFields.includes('maxBudgetKrw'));
  assert.throws(() => parse({ knownConstraints: { category: 'PHONE' }, category: 'TABLET' }), /충돌/);
});

test('invalid inputs keep validation errors even when they conflict with text', () => {
  for (const payload of [
    { naturalLanguageRequest: 123 },
    { knownConstraints: [] },
    { knownConstraints: { status: 'CONFIRMED' } },
    { naturalLanguageRequest: '100만원 이하', maxBudgetKrw: 'bad' },
    { naturalLanguageRequest: '태블릿', knownConstraints: { category: 'LAPTOP' } },
  ]) assert.throws(() => parse(payload), error => error.code === 'VALIDATION_ERROR');
});

test('structured clients stay compatible and natural-language patches preserve unrelated fields', () => {
  const existing = parse({ category: 'PHONE', maxBudgetKrw: 500000, modelQuery: 'Galaxy S23' });
  const value = parse({ naturalLanguageRequest: '256GB 이상' }, { ...existing, status: 'CONFIRMED' });
  assert.equal(value.category, 'PHONE');
  assert.equal(value.maxBudgetKrw, 500000);
  assert.equal(value.modelQuery, 'Galaxy S23');
  assert.equal(value.storageGb, 256);
  assert.equal(value.status, 'DRAFT');
  assert.equal(value.nextQuestions.length, 1);
  assert.match(value.nextQuestions[0], /제품 상태/);
});
