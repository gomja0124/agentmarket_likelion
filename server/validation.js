import { validationError } from './errors.js';

export const CATEGORIES = ['PHONE', 'TABLET'];
export const CONDITIONS = ['LIKE_NEW', 'GOOD', 'FAIR'];
export const SOURCES = ['AGENT', 'HUMAN'];

const objectInput = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, name, { nullable = true, max = 10000 } = {}) => {
  if (value == null && nullable) return null;
  if (typeof value !== 'string') throw validationError(`${name}은(는) 문자열이어야 합니다.`, { field: name });
  const clean = value.trim();
  if (!nullable && !clean) throw validationError(`${name}을(를) 입력해 주세요.`, { field: name });
  if (clean.length > max) throw validationError(`${name}은(는) ${max}자 이하여야 합니다.`, { field: name });
  return clean || null;
};
const enumValue = (value, allowed, name) => {
  if (value == null || value === '') return null;
  if (!allowed.includes(value)) throw validationError(`${name} 값이 올바르지 않습니다.`, { field: name, allowed });
  return value;
};
const integer = (value, name, { minimum = 0 } = {}) => {
  if (value == null || value === '') return null;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw validationError(`${name}은(는) ${minimum} 이상의 정수여야 합니다.`, { field: name, minimum });
  }
  return value;
};
const stringArray = (value, name, { maxItems = 50, maxLength = 2000 } = {}) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || item.length > maxLength)) {
    throw validationError(`${name}은(는) 문자열 배열이어야 합니다.`, { field: name });
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))];
};

export function listingMissing(listing) {
  return [
    !listing.category && 'category',
    !listing.model && 'model',
    (!Number.isSafeInteger(listing.priceKrw) || listing.priceKrw <= 0) && 'priceKrw',
  ].filter(Boolean);
}

export function purchaseRequestMissing(request) {
  return [
    !request.category && 'category',
    (!Number.isSafeInteger(request.maxBudgetKrw) || request.maxBudgetKrw <= 0) && 'maxBudgetKrw',
  ].filter(Boolean);
}

function unresolved(inputFields, declared, required) {
  const stillUnknown = declared.filter(name => {
    const value = inputFields[name];
    return value == null || value === '' || (Array.isArray(value) && value.length === 0);
  });
  return [...new Set([...stillUnknown, ...required])];
}

export function normalizeListingDraft(payload, { existing, userId, actorType, now, id }) {
  if (!objectInput(payload)) throw validationError('요청 본문은 JSON 객체여야 합니다.');
  const merged = { ...(existing || {}), ...payload };
  const category = enumValue(merged.category, CATEGORIES, 'category');
  const condition = enumValue(merged.condition, CONDITIONS, 'condition');
  const source = enumValue(merged.source ?? (actorType === 'AGENT' ? 'AGENT' : 'HUMAN'), SOURCES, 'source');
  const normalized = {
    id: existing?.id || id,
    sellerId: existing?.sellerId || userId,
    source,
    title: text(merged.title, 'title', { max: 200 }),
    description: text(merged.description, 'description', { max: 10000 }),
    category,
    brand: text(merged.brand, 'brand', { max: 100 }),
    model: text(merged.model, 'model', { max: 200 }),
    storageGb: integer(merged.storageGb, 'storageGb', { minimum: 1 }),
    condition,
    accessories: text(merged.accessories, 'accessories', { max: 2000 }),
    priceKrw: integer(merged.priceKrw, 'priceKrw'),
    images: stringArray(merged.images, 'images', { maxItems: 20, maxLength: 200000 }),
    missingFields: [],
    nextQuestions: stringArray(merged.nextQuestions, 'nextQuestions'),
    status: 'DRAFT',
    sourceListingId: existing?.sourceListingId || (merged.sourceListingId ?? null),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const requiredMissing = listingMissing(normalized);
  normalized.missingFields = unresolved(normalized, stringArray(merged.missingFields, 'missingFields'), requiredMissing);
  normalized.status = requiredMissing.length ? 'DRAFT' : 'READY_FOR_REVIEW';
  return normalized;
}

export function normalizePurchaseRequest(payload, { existing, userId, actorType, now, id }) {
  if (!objectInput(payload)) throw validationError('요청 본문은 JSON 객체여야 합니다.');
  const merged = { ...(existing || {}), ...payload };
  const conditionPreferences = stringArray(merged.conditionPreferences, 'conditionPreferences', { maxItems: 3, maxLength: 30 });
  const invalidConditions = conditionPreferences.filter(condition => !CONDITIONS.includes(condition));
  if (invalidConditions.length) throw validationError('conditionPreferences에 지원하지 않는 상태 값이 있습니다.', { field: 'conditionPreferences', allowed: CONDITIONS });
  const normalized = {
    id: existing?.id || id,
    buyerId: existing?.buyerId || userId,
    source: enumValue(merged.source ?? (actorType === 'AGENT' ? 'AGENT' : 'HUMAN'), SOURCES, 'source'),
    category: enumValue(merged.category, CATEGORIES, 'category'),
    modelQuery: text(merged.modelQuery, 'modelQuery', { max: 200 }),
    maxBudgetKrw: integer(merged.maxBudgetKrw, 'maxBudgetKrw'),
    storageGb: integer(merged.storageGb, 'storageGb', { minimum: 1 }),
    conditionPreferences,
    missingFields: [],
    nextQuestions: stringArray(merged.nextQuestions, 'nextQuestions'),
    status: 'DRAFT',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const requiredMissing = purchaseRequestMissing(normalized);
  normalized.missingFields = unresolved(normalized, stringArray(merged.missingFields, 'missingFields'), requiredMissing);
  return normalized;
}

export function requestIdFrom(request, body = {}) {
  return request.headers['idempotency-key'] || body.requestId || null;
}
