import { seedListings } from './data.js';
import { listingMissing, matchListings, requestMissing, unresolvedFields } from './matching.js';

const base = window.AGENT_MARKET_API_BASE || '';
export const isDemo = !base;
const key = 'agent-market-step1-v2';
const demoUser = '00000000-0000-4000-8000-000000000001';
const seedSeller = '00000000-0000-4000-8000-000000000002';
const accountKey = 'agent-market-demo-account';
export const demoAccounts = { buyer: demoUser, seller: seedSeller };
export const currentDemoAccount = () => globalThis.localStorage?.getItem?.(accountKey) === seedSeller ? 'seller' : 'buyer';
export const switchDemoAccount = account => localStorage.setItem(accountKey, demoAccounts[account] || demoUser);
const initialState = () => ({ listings: seedListings, drafts: [], requests: [] });
const read = () => {
  try { return JSON.parse(localStorage.getItem(key)) || initialState(); }
  catch { return initialState(); }
};
const write = state => localStorage.setItem(key, JSON.stringify(state));
const id = () => crypto.randomUUID();

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-User-Id': demoAccounts[currentDemoAccount()] }, ...options,
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
  async authMode() {
    return isDemo ? 'local' : (await request('/api/health')).authMode;
  },
  async listListings() {
    return isDemo ? read().listings : request('/api/listings?status=ACTIVE');
  },
  async getListing(listingId) {
    return isDemo ? read().listings.find(item => item.id === listingId) : request(`/api/listings/${encodeURIComponent(listingId)}`);
  },
  async listMyListings() {
    return isDemo ? read().listings.filter(item => item.sellerId === demoUser) : request('/api/listings/mine');
  },
  async listMyDrafts() {
    return isDemo ? read().drafts : request('/api/listing-drafts/mine');
  },
  async listMyPurchaseRequests() {
    return isDemo ? read().requests : request('/api/purchase-requests/mine');
  },
  async startListingRevision(listingId) {
    if (!isDemo) return request(`/api/listings/${encodeURIComponent(listingId)}/drafts`, { method: 'POST' });
    const state = read();
    const listing = state.listings.find(item => item.id === listingId && item.sellerId === demoUser);
    if (!listing) throw new Error('내 판매글만 수정할 수 있습니다.');
    const now = new Date().toISOString();
    const draft = { ...listing, id: id(), sourceListingId: listing.id, source: 'HUMAN',
      status: 'READY_FOR_REVIEW', createdAt: now, updatedAt: now };
    state.drafts.unshift(draft); write(state); return draft;
  },
  async saveListingDraft(draft) {
    if (!isDemo) return draft.id
      ? request(`/api/listing-drafts/${draft.id}`, { method: 'PATCH', body: draft })
      : request('/api/listing-drafts', { method: 'POST', body: draft });
    const state = read();
    const now = new Date().toISOString();
    const missingFields = unresolvedFields(draft, listingMissing);
    const saved = { ...draft, id: draft.id || id(), sellerId: demoUser, source: draft.source || 'HUMAN',
      status: listingMissing(draft).length ? 'DRAFT' : 'READY_FOR_REVIEW', missingFields,
      nextQuestions: missingFields.length ? draft.nextQuestions || [] : [],
      createdAt: draft.createdAt || now, updatedAt: now };
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
    const now = new Date().toISOString();
    const listing = { ...draft, id: draft.sourceListingId || id(), draftId, status: 'ACTIVE', images: draft.images || [],
      createdAt: draft.sourceListingId ? state.listings.find(item => item.id === draft.sourceListingId)?.createdAt || now : now,
      updatedAt: now, publishedAt: now };
    if (draft.sourceListingId) state.listings = state.listings.filter(item => item.id !== draft.sourceListingId);
    state.listings.unshift(listing);
    state.drafts = state.drafts.filter(item => item.id !== draftId);
    write(state);
    return listing;
  },
  async deactivateListing(listingId) {
    if (!isDemo) return request(`/api/listings/${listingId}/deactivate`, { method: 'POST' });
    const state = read();
    const listing = state.listings.find(item => item.id === listingId);
    if (!listing || listing.sellerId !== demoUser) throw new Error('내 판매글만 비활성화할 수 있습니다.');
    listing.status = 'INACTIVE'; listing.updatedAt = new Date().toISOString(); write(state); return listing;
  },
  async savePurchaseRequest(value) {
    if (!isDemo) return value.id
      ? request(`/api/purchase-requests/${value.id}`, { method: 'PATCH', body: value })
      : request('/api/purchase-requests', { method: 'POST', body: value });
    const state = read();
    const now = new Date().toISOString();
    const missingFields = unresolvedFields(value, requestMissing);
    const saved = { ...value, id: value.id || id(), buyerId: demoUser, source: value.source || 'HUMAN',
      status: 'DRAFT', missingFields, nextQuestions: missingFields.length ? value.nextQuestions || [] : [],
      createdAt: value.createdAt || now, updatedAt: now };
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
    item.status = 'CONFIRMED'; item.updatedAt = new Date().toISOString(); write(state); return item;
  },
  async search(requestId) {
    if (!isDemo) {
      const results = await request(`/api/purchase-requests/${requestId}/search`, { method: 'POST' });
      return Promise.all(results.filter(result => result.matchStatus !== 'EXCLUDED').map(async result => ({
        ...result, listing: result.listing || await api.getListing(result.listingId),
      })));
    }
    const state = read();
    const item = state.requests.find(value => value.id === requestId);
    if (item?.status !== 'CONFIRMED') throw new Error('구매자가 조건을 확인한 뒤 검색할 수 있습니다.');
    return matchListings(state.listings, item);
  },
  async listMyPublicDemands() {
    return isDemo ? [] : request('/api/public-demands/mine');
  },
  async createPublicDemandDraft(purchaseRequestId) {
    if (isDemo) throw new Error('공개 수요 기능은 백엔드를 실행한 뒤 이용할 수 있습니다.');
    return request(`/api/purchase-requests/${encodeURIComponent(purchaseRequestId)}/public-demand`, { method: 'POST' });
  },
  async updatePublicDemand(demandId, changes) {
    if (isDemo) throw new Error('공개 수요 기능은 백엔드를 실행한 뒤 이용할 수 있습니다.');
    return request(`/api/public-demands/${encodeURIComponent(demandId)}`, { method: 'PATCH', body: changes });
  },
  async changePublicDemandStatus(demandId, action) {
    if (isDemo) throw new Error('공개 수요 기능은 백엔드를 실행한 뒤 이용할 수 있습니다.');
    return request(`/api/public-demands/${encodeURIComponent(demandId)}/${encodeURIComponent(action)}`, { method: 'POST' });
  },
  async matchingPublicDemands(listingId) {
    if (isDemo) return [];
    return request(`/api/listings/${encodeURIComponent(listingId)}/public-demands`);
  },
  async listConnections() {
    return isDemo ? [] : request('/api/connection-requests/mine');
  },
  async createConnectionRequest(publicDemandId, listingId) {
    if (isDemo) throw new Error('연결 요청 기능은 백엔드를 실행한 뒤 이용할 수 있습니다.');
    return request('/api/connection-requests', { method: 'POST', body: { publicDemandId, listingId } });
  },
  async respondConnectionRequest(connectionId, action) {
    if (isDemo) throw new Error('연결 요청 기능은 백엔드를 실행한 뒤 이용할 수 있습니다.');
    return request(`/api/connection-requests/${encodeURIComponent(connectionId)}/${encodeURIComponent(action)}`, { method: 'POST' });
  },
  async listNotifications() {
    return isDemo ? [] : request('/api/notifications/mine');
  },
  async markNotificationRead(notificationId) {
    if (isDemo) return null;
    return request(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
  },
  async listAgentTokens() {
    return isDemo ? [] : request('/api/agent-tokens');
  },
  async issueAgentToken(details) {
    if (isDemo) throw new Error('Agent 연결은 백엔드를 실행한 뒤 이용할 수 있습니다.');
    return request('/api/agent-tokens', { method: 'POST', body: details });
  },
  async revokeAgentToken(tokenId) {
    if (isDemo) throw new Error('Agent 연결은 백엔드를 실행한 뒤 이용할 수 있습니다.');
    return request(`/api/agent-tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' });
  },
};
