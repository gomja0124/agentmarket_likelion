import { randomUUID } from 'node:crypto';

export const DEFAULT_API_URL = 'http://127.0.0.1:8080';
export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 백엔드 Step 1 HTTP API를 호출하는 얇은 어댑터. 로직은 갖지 않는다.
 *
 * 인증은 두 가지 중 하나다.
 * - token: 사람이 Web에서 발급한 Agent 토큰. Authorization: Bearer 로 보낸다. (배포용)
 * - userId: 백엔드 demo 모드의 X-User-Id 헤더. (로컬 개발용)
 * 쓰기 요청에는 항상 Idempotency-Key를 붙인다.
 */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `API 오류 (${status})`);
    this.status = status;
    this.code = body?.code || (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN');
    this.details = body?.details || {};
  }
}

export class AgentMarketApi {
  constructor({ baseUrl = DEFAULT_API_URL, token = '', userId = '', timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
    if (!token && !userId) throw new Error('AgentMarketApi에는 token 또는 userId가 필요합니다.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.userId = userId;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  get identity() { return this.token ? `token:${this.token.slice(0, 10)}…` : `user:${this.userId}`; }

  headers(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    else { headers['X-User-Id'] = this.userId; headers['X-Actor-Type'] = 'AGENT'; }
    return headers;
  }

  async request(method, path, { body, requestId } = {}) {
    const headers = this.headers();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['Idempotency-Key'] = requestId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method, headers, signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      throw new ApiError(0, { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', message: timedOut ? `백엔드 응답이 ${this.timeoutMs}ms 안에 오지 않았습니다.` : `백엔드에 연결할 수 없습니다: ${error.message}` });
    } finally {
      clearTimeout(timer);
    }
    let value = null;
    try { value = await response.json(); } catch { value = null; }
    if (!response.ok) throw new ApiError(response.status, value);
    return value;
  }

  get(path) { return this.request('GET', path); }
  post(path, body, requestId = randomUUID()) { return this.request('POST', path, { body, requestId }); }
  patch(path, body, requestId = randomUUID()) { return this.request('PATCH', path, { body, requestId }); }

  health() { return this.get('/api/health'); }
  me() { return this.get('/api/me'); }
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
  myPublicDemands() { return this.get('/api/public-demands/mine'); }
  createPublicDemandDraft(purchaseRequestId, requestId) {
    return this.post(`/api/purchase-requests/${encodeURIComponent(purchaseRequestId)}/public-demand`, {}, requestId);
  }
  updatePublicDemandDraft(id, patch, requestId) { return this.patch(`/api/public-demands/${encodeURIComponent(id)}`, patch, requestId); }
  matchingPublicDemands(listingId) { return this.get(`/api/listings/${encodeURIComponent(listingId)}/public-demands`); }
  myNotifications() { return this.get('/api/notifications/mine'); }
}
