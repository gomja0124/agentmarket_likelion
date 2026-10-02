export function matchListings(listings, request) {
  return listings.filter(item => item.status === 'ACTIVE').map(item => {
    const matchedFields = [];
    const missingFields = [];
    const unmetFields = [];
    if (item.category !== request.category) unmetFields.push('category'); else matchedFields.push('category');
    if (item.priceKrw == null) missingFields.push('priceKrw');
    else if (item.priceKrw > request.maxBudgetKrw) unmetFields.push('maxBudgetKrw');
    else matchedFields.push('maxBudgetKrw');
    if (request.modelQuery?.trim()) {
      if (!item.model) missingFields.push('model');
      else if (!item.model.toLowerCase().includes(request.modelQuery.trim().toLowerCase())) unmetFields.push('model');
      else matchedFields.push('model');
    }
    if (request.storageGb) {
      if (item.storageGb == null) missingFields.push('storageGb');
      else if (item.storageGb < request.storageGb) unmetFields.push('storageGb');
      else matchedFields.push('storageGb');
    }
    if (request.conditionPreferences?.length) {
      if (!item.condition) missingFields.push('condition');
      else if (!request.conditionPreferences.includes(item.condition)) unmetFields.push('condition');
      else matchedFields.push('condition');
    }
    missingFields.push(...(item.missingFields || []));
    return { id: `result-${item.id}`, listingId: item.id, listing: item,
      matchStatus: unmetFields.length ? 'EXCLUDED' : missingFields.length ? 'NEEDS_CONFIRMATION' : 'MATCH',
      matchedFields, unmetFields, missingFields, ruleVersion: 'demo-1' };
  }).filter(result => result.matchStatus !== 'EXCLUDED');
}

export function listingMissing(draft) {
  return ['category', 'model', 'priceKrw'].filter(key => !draft[key] || (key === 'priceKrw' && Number(draft[key]) <= 0));
}

export function requestMissing(request) {
  return ['category', 'maxBudgetKrw'].filter(key => !request[key] || (key === 'maxBudgetKrw' && Number(request[key]) <= 0));
}
