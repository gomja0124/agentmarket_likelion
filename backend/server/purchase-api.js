import { purchaseRequestMissing } from './validation.js';

// Add API guidance without changing the stored domain object or existing fields.
export function purchaseRequestResponse(value) {
  const readyForConfirmation = purchaseRequestMissing(value).length === 0;
  const confirmed = value.status === 'CONFIRMED';
  return {
    ...value,
    readyForConfirmation: !confirmed && readyForConfirmation,
    humanApprovalRequired: !confirmed,
    nextAction: confirmed
      ? { action: 'SEARCH_LISTINGS', method: 'POST', path: `/api/purchase-requests/${value.id}/search`, actor: 'HUMAN_OR_AGENT' }
      : readyForConfirmation
        ? { action: 'REVIEW_AND_CONFIRM', method: 'POST', path: `/api/purchase-requests/${value.id}/confirm`, actor: 'HUMAN' }
        : { action: 'COMPLETE_CONDITIONS', method: 'PATCH', path: `/api/purchase-requests/${value.id}`, actor: 'HUMAN_OR_AGENT' },
  };
}
