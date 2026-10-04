import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePurchaseRequest, purchaseRequestMissing } from '../server/validation.js';
import { Store } from '../server/database.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const context = { userId: '00000000-0000-4000-8000-000000000001', actorType: 'AGENT', now: '2026-10-04T00:00:00Z', id: 'request' };
const parse = (payload, existing) => normalizePurchaseRequest(payload, { ...context, existing });

test('questions prioritize category, budget, model, storage and condition', () => {
  const value = parse({});
  assert.deepEqual(value.missingFields, ['category', 'maxBudgetKrw']);
  assert.equal(value.nextQuestions.length, 5);
  for (const [index, word] of ['핸드폰', '예산', '모델', '용량', '상태'].entries()) assert.match(value.nextQuestions[index], new RegExp(word));
});

test('resolved prompts disappear after structured and natural-language answers', () => {
  const initial = parse({ naturalLanguageRequest: '저렴한 태블릿' });
  const budget = parse({ maxBudgetKrw: 1000000 }, initial);
  assert.deepEqual(budget.missingFields, []);
  assert.equal(budget.nextQuestions.length, 3);
  assert.ok(budget.nextQuestions.every(question => !question.includes('예산')));
  const model = parse({ naturalLanguageRequest: '아이패드' }, budget);
  assert.equal(model.nextQuestions.length, 2);
  const full = parse({ storageGb: 256, conditionPreferences: ['GOOD'] }, model);
  assert.deepEqual(full.nextQuestions, []);
});

test('optional questions do not block confirmation and skipped questions remain skipped', () => {
  const initial = parse({ category: 'TABLET', maxBudgetKrw: 1000000 });
  assert.deepEqual(purchaseRequestMissing(initial), []);
  const skipped = parse({ skippedQuestionFields: ['modelQuery', 'storageGb', 'conditionPreferences'] }, initial);
  assert.deepEqual(skipped.nextQuestions, []);
  assert.deepEqual(parse({ maxBudgetKrw: 900000 }, skipped).nextQuestions, []);
  const reopened = parse({ modelQuery: null }, skipped);
  assert.equal(reopened.nextQuestions.length, 1);
  assert.throws(() => parse({ skippedQuestionFields: ['category'] }), error => error.code === 'VALIDATION_ERROR');
});

test('ambiguous optional conditions can be explicitly declined without inventing values', () => {
  const initial = parse({ naturalLanguageRequest: '태블릿 100만원 이하 128GB 또는 256GB' });
  assert.ok(initial.missingFields.includes('storageGb'));
  const skipped = parse({ skippedQuestionFields: ['storageGb'] }, initial);
  assert.ok(!skipped.missingFields.includes('storageGb'));
  assert.ok(skipped.nextQuestions.every(question => !question.includes('용량')));
  assert.equal(skipped.storageGb, null);
});

test('existing SQLite databases migrate safely and persist questions and skip choices across reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-questions-'));
  const dbPath = join(directory, 'old.sqlite');
  try {
    const old = new DatabaseSync(dbPath);
    old.exec(readFileSync(new URL('../server/migrations/001_step1.sql', import.meta.url), 'utf8')
      .replace("  skipped_question_fields_json TEXT NOT NULL DEFAULT '[]',\n", ''));
    old.close();
    const store = new Store({ dbPath, seed: false });
    const value = parse({ category: 'TABLET', maxBudgetKrw: 1000000, skippedQuestionFields: ['modelQuery'] });
    store.savePurchaseRequest(value);
    store.close();
    const reopened = new Store({ dbPath, seed: false });
    try {
      const saved = reopened.getPurchaseRequest(value.id);
      assert.deepEqual(saved.skippedQuestionFields, ['modelQuery']);
      assert.deepEqual(saved.nextQuestions, value.nextQuestions);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
