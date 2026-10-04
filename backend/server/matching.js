import { randomUUID } from 'node:crypto';
import { matchesModel, modelTokens } from './model-matching.js';
import { invalidState, validationError } from './errors.js';

export const RULE_VERSION = 'step1-rule-v2';
const categories = ['PHONE', 'TABLET'];
const conditions = ['LIKE_NEW', 'GOOD', 'FAIR'];
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

export function matchListings(listings, request, now = new Date().toISOString()) {
  if (request.status !== 'CONFIRMED') throw invalidState('확정된 구매 조건만 검색할 수 있습니다.');
  if (!categories.includes(request.category) || !positiveInteger(request.maxBudgetKrw) ||
      (request.storageGb != null && !positiveInteger(request.storageGb)) ||
      (request.modelQuery != null && (typeof request.modelQuery !== 'string' || !modelTokens(request.modelQuery).length)) ||
      (request.conditionPreferences != null && (!Array.isArray(request.conditionPreferences) || request.conditionPreferences.some(value => !conditions.includes(value))))) {
    throw validationError('검색 조건이 올바르지 않습니다.');
  }
  return listings.filter(listing => listing.status === 'ACTIVE').map(listing => {
    const matchedFields = [];
    const unmetFields = [];
    const missing = new Set(listing.missingFields || []);
    const requiredMissing = new Set();
    const unknown = (field, valid) => {
      if (missing.has(field) || !valid) { missing.add(field); return true; }
      return false;
    };
    const evaluate = (field, resultField, valid, matches) => {
      if (unknown(field, valid)) requiredMissing.add(field);
      else (matches ? matchedFields : unmetFields).push(resultField);
    };
    evaluate('category', 'category', categories.includes(listing.category), listing.category === request.category);
    evaluate('priceKrw', 'maxBudgetKrw', positiveInteger(listing.priceKrw), listing.priceKrw <= request.maxBudgetKrw);

    const modelKnown = !unknown('model', typeof listing.model === 'string' && modelTokens(listing.model).length > 0);
    // model is required for published listings even without a model constraint.
    if (!modelKnown) requiredMissing.add('model');
    if (request.modelQuery?.trim() && modelKnown) {
      (matchesModel(listing.model, request.modelQuery) ? matchedFields : unmetFields).push('modelQuery');
    }
    if (request.storageGb != null) {
      evaluate('storageGb', 'storageGb', positiveInteger(listing.storageGb), listing.storageGb >= request.storageGb);
    } else unknown('storageGb', positiveInteger(listing.storageGb));
    if (request.conditionPreferences?.length) {
      evaluate('condition', 'condition', conditions.includes(listing.condition), request.conditionPreferences.includes(listing.condition));
    } else unknown('condition', conditions.includes(listing.condition));
    unknown('accessories', typeof listing.accessories === 'string' && listing.accessories.trim().length > 0);

    return {
      id: randomUUID(), purchaseRequestId: request.id, listingId: listing.id, listing,
      matchStatus: unmetFields.length ? 'EXCLUDED' : requiredMissing.size ? 'NEEDS_CONFIRMATION' : 'MATCH',
      matchedFields, unmetFields, missingFields: [...missing], ruleVersion: RULE_VERSION, createdAt: now,
    };
  });
}
