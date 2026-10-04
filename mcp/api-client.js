import { randomUUID } from 'node:crypto';

export const DEFAULT_API_URL = 'http://127.0.0.1:8080';
export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * 백엔드 Step 1 HTTP API를 호출하는 얇은 어댑터.
 * 모든 요청은 X-Actor-Type: AGENT 로 보내고, 쓰기 요청에는 Idempotency-Key를 붙인다.
 * 로직은 갖지 않는다. 상태·권한·검증은 전부 서버가 판정한다.
 */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `API 오류 (${status})`);
    this.status = status;
    this.code = body?.code || 'UNKNOWN';
    this.details = body?.details || {};
  }
}

export class AgentMarketApi {
  constructor({ baseUrl = DEFAULT_API_URL, userId = DEFAULT_USER_ID, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.userId = userId;
    this.fetch = fetchImpl;
  }

  async request(method, path, { body, requestId } = {}) {
    const headers = { 'X-User-Id': this.userId, 'X-Actor-Type': 'AGENT' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['Idempotency-Key'] = requestId;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let value = null;
    try { value = await response.json(); } catch { value = null; }
    if (!response.ok) throw new ApiError(response.status, value);
    return value;
  }

  get(path) { return this.request('GET', path); }
  post(path, body, requestId = randomUUID()) { return this.request('POST', path, { body, requestId }); }
  patch(path, body, requestId = randomUUID()) { return this.request('PATCH', path, { body, requestId }); }

  health() { return this.get('/api/health'); }
  categorySchema(category) { return this.get(`/api/categories/${encodeURIComponent(category)}/schema`); }
  listListings(query = '') { return this.get(`/api/listings?status=ACTIVE${query ? `&q=${encodeURIComponent(query)}` : ''}`); }
  getListing(id) { return this.get(`/api/listings/${encodeURIComponent(id)}`); }
  myListings() { return this.get('/api/listings/mine'); }
  myDrafts() { return this.get('/api/listing-drafts/mine'); }
  myPurchaseRequests() { return this.get('/api/purchase-requests/mine'); }

  createDraft(fields, requestId) { return this.post('/api/listing-drafts', fields, requestId); }
  updateDraft(id, fields, requestId) { return this.patch(`/api/listing-drafts/${encodeURIComponent(id)}`, fields, requestId); }
  draftFromListing(listingId, fields, requestId) { return this.post(`/api/listings/${encodeURIComponent(listingId)}/drafts`, fields, requestId); }
  createPurchaseRequest(fields, requestId) { return this.post('/api/purchase-requests', fields, requestId); }
  updatePurchaseRequest(id, fields, requestId) { return this.patch(`/api/purchase-requests/${encodeURIComponent(id)}`, fields, requestId); }
  search(purchaseRequestId, requestId) { return this.post(`/api/purchase-requests/${encodeURIComponent(purchaseRequestId)}/search`, {}, requestId); }
}
