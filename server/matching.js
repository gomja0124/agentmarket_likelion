import { randomUUID } from 'node:crypto';

export const RULE_VERSION = 'step1-rule-v1';

export function matchListings(listings, request, now = new Date().toISOString()) {
  return listings.map(listing => {
    const matchedFields = [];
    const unmetFields = [];
    const missingFields = [...(listing.missingFields || [])];

    if (listing.category !== request.category) unmetFields.push('category');
    else matchedFields.push('category');

    if (listing.priceKrw == null) missingFields.push('priceKrw');
    else if (listing.priceKrw > request.maxBudgetKrw) unmetFields.push('maxBudgetKrw');
    else matchedFields.push('maxBudgetKrw');

    if (request.modelQuery?.trim()) {
      if (!listing.model) missingFields.push('model');
      else if (!listing.model.toLocaleLowerCase().includes(request.modelQuery.trim().toLocaleLowerCase())) unmetFields.push('modelQuery');
      else matchedFields.push('modelQuery');
    }

    if (request.storageGb != null) {
      if (listing.storageGb == null) missingFields.push('storageGb');
      else if (listing.storageGb < request.storageGb) unmetFields.push('storageGb');
      else matchedFields.push('storageGb');
    }

    if (request.conditionPreferences?.length) {
      if (!listing.condition) missingFields.push('condition');
      else if (!request.conditionPreferences.includes(listing.condition)) unmetFields.push('condition');
      else matchedFields.push('condition');
    }

    const uniqueMissing = [...new Set(missingFields)];
    const matchStatus = unmetFields.length ? 'EXCLUDED' : uniqueMissing.length ? 'NEEDS_CONFIRMATION' : 'MATCH';
    return {
      id: randomUUID(),
      purchaseRequestId: request.id,
      listingId: listing.id,
      listing,
      matchStatus,
      matchedFields,
      unmetFields,
      missingFields: uniqueMissing,
      ruleVersion: RULE_VERSION,
      createdAt: now,
    };
  });
}
