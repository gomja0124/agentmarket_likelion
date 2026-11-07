import { randomUUID } from 'node:crypto';
import { matchListings } from './matching.js';
import { validationError } from './errors.js';

const conditions = ['LIKE_NEW', 'GOOD', 'FAIR'];
const allowedFields = new Set(['title', 'description', 'minBudgetKrw', 'maxBudgetKrw', 'modelQuery', 'storageGb', 'conditionPreferences', 'expiresAt']);
const cleanText = (value, field, max) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw validationError(`${field} 값이 올바르지 않습니다.`, { field });
  return value.trim() || null;
};
const positiveInteger = (value, field, nullable = false) => {
  if (nullable && (value == null || value === '')) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw validationError(`${field}은(는) 양의 정수여야 합니다.`, { field });
  return value;
};

export function demandFromRequest(request, id = randomUUID(), now = new Date().toISOString()) {
  return {
    id, buyerId: request.buyerId, purchaseRequestId: request.id,
    title: `${request.modelQuery || (request.category === 'PHONE' ? '핸드폰' : '태블릿')} 구해요`,
    description: null, category: request.category, modelQuery: request.modelQuery,
    storageGb: request.storageGb, conditionPreferences: request.conditionPreferences,
    minBudgetKrw: null, maxBudgetKrw: request.maxBudgetKrw, status: 'DRAFT',
    expiresAt: null, createdAt: now, updatedAt: now,
  };
}

export function patchDemand(demand, patch, now = new Date().toISOString()) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !allowedFields.has(key))) {
    throw validationError('공개 수요 수정 필드가 올바르지 않습니다.');
  }
  const next = { ...demand };
  if (Object.hasOwn(patch, 'title')) next.title = cleanText(patch.title, 'title', 200);
  if (Object.hasOwn(patch, 'description')) next.description = cleanText(patch.description, 'description', 2000);
  if (Object.hasOwn(patch, 'modelQuery')) next.modelQuery = cleanText(patch.modelQuery, 'modelQuery', 200);
  if (Object.hasOwn(patch, 'storageGb')) next.storageGb = positiveInteger(patch.storageGb, 'storageGb', true);
  if (Object.hasOwn(patch, 'minBudgetKrw')) next.minBudgetKrw = positiveInteger(patch.minBudgetKrw, 'minBudgetKrw', true);
  if (Object.hasOwn(patch, 'maxBudgetKrw')) next.maxBudgetKrw = positiveInteger(patch.maxBudgetKrw, 'maxBudgetKrw');
  if (Object.hasOwn(patch, 'conditionPreferences')) {
    if (!Array.isArray(patch.conditionPreferences) || patch.conditionPreferences.some(value => !conditions.includes(value))) {
      throw validationError('conditionPreferences 값이 올바르지 않습니다.', { field: 'conditionPreferences' });
    }
    next.conditionPreferences = [...new Set(patch.conditionPreferences)];
  }
  if (Object.hasOwn(patch, 'expiresAt')) {
    if (patch.expiresAt != null && (typeof patch.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(patch.expiresAt) || Number.isNaN(Date.parse(patch.expiresAt)))) {
      throw validationError('expiresAt은 ISO 날짜여야 합니다.', { field: 'expiresAt' });
    }
    next.expiresAt = patch.expiresAt ?? null;
  }
  if (!next.title) throw validationError('공개 제목을 입력해 주세요.', { field: 'title' });
  if (next.minBudgetKrw != null && next.minBudgetKrw > next.maxBudgetKrw) {
    throw validationError('최소 예산은 최대 예산보다 클 수 없습니다.', { field: 'minBudgetKrw' });
  }
  if (next.expiresAt && next.expiresAt <= now) throw validationError('만료일은 미래여야 합니다.', { field: 'expiresAt' });
  const publicText = `${next.title} ${next.description || ''}`;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(publicText) ||
      /(?:^|\D)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/.test(publicText)) {
    throw validationError('공개 제목·설명에 연락처를 넣을 수 없습니다.', { field: 'description' });
  }
  next.updatedAt = now;
  return next;
}

export function publicDemandView(demand) {
  const { buyerId, purchaseRequestId, ...publicFields } = demand;
  return publicFields;
}

export function matchDemand(listing, demand) {
  const result = matchListings([listing], {
    id: demand.id, status: 'CONFIRMED', category: demand.category,
    modelQuery: demand.modelQuery, maxBudgetKrw: demand.maxBudgetKrw,
    storageGb: demand.storageGb, conditionPreferences: demand.conditionPreferences,
  })[0];
  if (demand.minBudgetKrw != null && listing.priceKrw < demand.minBudgetKrw) {
    result.matchStatus = 'EXCLUDED';
    result.unmetFields.push('minBudgetKrw');
  }
  return {
    matchStatus: result.matchStatus, matchedFields: result.matchedFields,
    unmetFields: result.unmetFields, missingFields: result.missingFields,
    ruleVersion: result.ruleVersion,
  };
}
