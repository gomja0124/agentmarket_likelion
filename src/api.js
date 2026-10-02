import { seedListings } from './data.js';
import { listingMissing, matchListings, requestMissing } from './matching.js';

const base = window.AGENT_MARKET_API_BASE || '';
export const isDemo = !base;
const key = 'agent-market-step1-v1';
const initialState = () => ({ listings: seedListings, drafts: [], requests: [] });
const read = () => {
  try { return JSON.parse(localStorage.getItem(key)) || initialState(); }
  catch { return initialState(); }
};
const write = state => localStorage.setItem(key, JSON.stringify(state));
const id = () => crypto.randomUUID();

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' }, ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    let message = `요청에 실패했습니다 (${response.status}).`;
    try { message = (await response.json()).message || message; } catch { /* non-JSON error */ }
    throw new Error(message);
  }
  return response.json();
}

export const api = {
  async listListings() {
    return isDemo ? read().listings : request('/api/listings?status=ACTIVE');
  },
  async getListing(listingId) {
    return isDemo ? read().listings.find(item => item.id === listingId) : request(`/api/listings/${encodeURIComponent(listingId)}`);
  },
  async listMyListings() {
    return isDemo ? read().listings.filter(item => item.sellerId === 'demo-user') : request('/api/listings/mine');
  },
  async listMyDrafts() {
    return isDemo ? read().drafts : request('/api/listing-drafts/mine');
  },
  async saveListingDraft(draft) {
    if (!isDemo) return draft.id
      ? request(`/api/listing-drafts/${draft.id}`, { method: 'PATCH', body: draft })
      : request('/api/listing-drafts', { method: 'POST', body: draft });
    const state = read();
    const saved = { ...draft, id: draft.id || id(), sellerId: 'demo-user', source: draft.source || 'HUMAN',
      status: listingMissing(draft).length ? 'DRAFT' : 'READY_FOR_REVIEW', missingFields: [...new Set([...(draft.missingFields || []), ...listingMissing(draft)])],
      updatedAt: new Date().toISOString() };
    const index = state.drafts.findIndex(item => item.id === saved.id);
    if (index < 0) state.drafts.unshift(saved); else state.drafts[index] = saved;
    write(state);
    return saved;
  },
  async publishListing(draftId) {
    if (!isDemo) return request(`/api/listing-drafts/${draftId}/publish`, { method: 'POST' });
    const state = read();
    const draft = state.drafts.find(item => item.id === draftId);
    if (!draft) throw new Error('판매 초안을 찾을 수 없습니다.');
    if (listingMissing(draft).length) throw new Error('필수 정보를 입력한 뒤 게시해 주세요.');
    const listing = { ...draft, id: id(), draftId, status: 'ACTIVE', images: draft.images || [],
      publishedAt: new Date().toISOString() };
    state.listings.unshift(listing);
    state.drafts = state.drafts.filter(item => item.id !== draftId);
    write(state);
    return listing;
  },
  async deactivateListing(listingId) {
    if (!isDemo) return request(`/api/listings/${listingId}/deactivate`, { method: 'POST' });
    const state = read();
    const listing = state.listings.find(item => item.id === listingId);
    if (!listing || listing.sellerId !== 'demo-user') throw new Error('내 판매글만 비활성화할 수 있습니다.');
    listing.status = 'INACTIVE'; write(state); return listing;
  },
  async savePurchaseRequest(value) {
    if (!isDemo) return value.id
      ? request(`/api/purchase-requests/${value.id}`, { method: 'PATCH', body: value })
      : request('/api/purchase-requests', { method: 'POST', body: value });
    const state = read();
    const saved = { ...value, id: value.id || id(), buyerId: 'demo-user', source: value.source || 'HUMAN',
      status: 'DRAFT', missingFields: requestMissing(value), updatedAt: new Date().toISOString() };
    const index = state.requests.findIndex(item => item.id === saved.id);
    if (index < 0) state.requests.unshift(saved); else state.requests[index] = saved;
    write(state); return saved;
  },
  async confirmPurchaseRequest(requestId) {
    if (!isDemo) return request(`/api/purchase-requests/${requestId}/confirm`, { method: 'POST' });
    const state = read();
    const item = state.requests.find(value => value.id === requestId);
    if (!item) throw new Error('구매 조건을 찾을 수 없습니다.');
    if (requestMissing(item).length) throw new Error('기기 종류와 최대 예산을 입력해 주세요.');
    item.status = 'CONFIRMED'; write(state); return item;
  },
  async search(requestId) {
    if (!isDemo) return request(`/api/purchase-requests/${requestId}/search`, { method: 'POST' });
    const state = read();
    const item = state.requests.find(value => value.id === requestId);
    if (item?.status !== 'CONFIRMED') throw new Error('구매자가 조건을 확인한 뒤 검색할 수 있습니다.');
    return matchListings(state.listings, item);
  },
};
