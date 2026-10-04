import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Store } from './database.js';
import { ApiError, forbidden, invalidState, notFound, validationError } from './errors.js';
import { matchListings } from './matching.js';
import { authConfigFromEnv, authenticate, issueToken, requireScope, requiredScope, SCOPES } from './auth.js';
import {
  CATEGORIES, CONDITIONS, listingMissing, normalizeListingDraft,
  normalizePurchaseRequest, purchaseRequestMissing, requestIdFrom,
} from './validation.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1_500_000) {
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new ApiError(400, 'INVALID_JSON', 'JSON 요청 본문을 확인해 주세요.')); }
    });
    request.on('error', reject);
  });
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function humanOnly(context, action) {
  if (context.actorType === 'AGENT') throw forbidden(`Agent는 ${action}할 수 없습니다. 사람의 승인이 필요합니다.`);
}

function requireOwner(actualId, context, message = '본인 소유의 데이터만 사용할 수 있습니다.') {
  if (actualId !== context.userId) throw forbidden(message);
}

function runCommand(store, context, request, body, { actionType, targetType, targetId, operation }, run) {
  const requestId = requestIdFrom(request, body);
  if (context.actorType === 'AGENT' && !requestId) {
    throw validationError('Agent 쓰기 요청에는 requestId 또는 Idempotency-Key가 필요합니다.', { field: 'requestId' });
  }
  const operationKey = `${request.method} ${operation}`;
  if (requestId) {
    const previous = store.getIdempotentResponse(context.userId, requestId, operationKey);
    if (previous) return previous;
  }

  try {
    return store.transaction(() => {
      const result = run();
      if (context.actorType === 'AGENT') {
        store.recordAgentAction({ id: randomUUID(), userId: context.userId, actionType, targetType,
          targetId: typeof targetId === 'function' ? targetId(result) : targetId,
          requestId, createdAt: now() });
        context.auditRecorded = true;
      }
      if (requestId) store.saveIdempotentResponse(context.userId, requestId, operationKey, result, now());
      return result;
    });
  } catch (error) {
    if (context.actorType === 'AGENT') {
      context.auditRecorded = true;
      store.recordAgentAction({ id: randomUUID(), userId: context.userId, actionType, targetType,
        targetId: typeof targetId === 'function' ? null : targetId,
        status: 'FAILED', requestId, createdAt: now() });
    }
    throw error;
  }
}

function failedActionFor(path) {
  if (path.includes('/listing-drafts') && path.endsWith('/publish')) return ['PUBLISH_LISTING', 'ListingDraft'];
  if (path.startsWith('/api/listings/') && path.endsWith('/drafts')) return ['CREATE_LISTING_DRAFT', 'ListingDraft'];
  if (path === '/api/listing-drafts') return ['CREATE_LISTING_DRAFT', 'ListingDraft'];
  if (path.startsWith('/api/listing-drafts/')) return ['UPDATE_LISTING_DRAFT', 'ListingDraft'];
  if (path.endsWith('/deactivate')) return ['DEACTIVATE_LISTING', 'Listing'];
  if (path === '/api/purchase-requests') return ['CREATE_PURCHASE_REQUEST_DRAFT', 'PurchaseRequest'];
  if (path.endsWith('/confirm')) return ['CONFIRM_PURCHASE_REQUEST', 'PurchaseRequest'];
  if (path.endsWith('/search')) return ['SEARCH_LISTINGS', 'PurchaseRequest'];
  if (path.startsWith('/api/purchase-requests/')) return ['UPDATE_PURCHASE_REQUEST_DRAFT', 'PurchaseRequest'];
  return ['API_COMMAND', 'Unknown'];
}

function categorySchema(category) {
  if (!CATEGORIES.includes(category)) throw validationError('category는 PHONE 또는 TABLET이어야 합니다.', { field: 'category', allowed: CATEGORIES });
  return {
    category,
    requiredFields: ['category', 'model', 'priceKrw'],
    optionalFields: ['title', 'description', 'brand', 'storageGb', 'condition', 'accessories', 'images'],
    questionHints: ['정확한 모델명은 무엇인가요?', '판매 가격은 얼마인가요?', '저장 용량과 제품 상태, 구성품을 알고 있나요?'],
  };
}

export function createApiServer({
  dbPath, seed = true, store = new Store({ dbPath, seed }),
  auth = authConfigFromEnv(), corsOrigin = process.env.AGENT_MARKET_CORS_ORIGIN || '*',
} = {}) {
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', corsOrigin);
    if (corsOrigin !== '*') response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key,X-User-Id,X-Actor-Type,X-Web-Secret');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }

    let context;
    let body = {};
    let requestPath = '';
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname.replace(/\/$/, '') || '/';
      requestPath = path;
      const segments = path.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
      const method = request.method;

      // health는 인증 없이 열어둔다(배포 환경 readiness 확인용).
      if (method === 'GET' && segments.join('/') === 'api/health') {
        send(response, 200, { status: 'ok', database: 'sqlite', step: 1, authMode: auth.mode }); return;
      }

      context = authenticate(request, store, auth, now());
      requireScope(context, requiredScope(method, path));
      if (['POST', 'PATCH', 'PUT'].includes(method)) body = await parseJsonBody(request);

      if (method === 'GET' && segments.join('/') === 'api/me') {
        send(response, 200, {
          userId: context.userId, actorType: context.actorType,
          scopes: context.scopes ?? SCOPES, tokenId: context.tokenId ?? null, tokenName: context.tokenName ?? null,
          nickname: store.getUser(context.userId)?.nickname ?? null,
        }); return;
      }
      if (segments.join('/') === 'api/agent-tokens' && method === 'GET') {
        humanOnly(context, 'Agent 토큰을 조회');
        send(response, 200, store.listAgentTokens(context.userId)); return;
      }
      if (segments.join('/') === 'api/agent-tokens' && method === 'POST') {
        humanOnly(context, 'Agent 토큰을 발급');
        send(response, 201, issueToken(store, context.userId, body, now())); return;
      }
      if (method === 'DELETE' && segments.length === 3 && segments[0] === 'api' && segments[1] === 'agent-tokens') {
        humanOnly(context, 'Agent 토큰을 폐기');
        const token = store.getAgentToken(segments[2]);
        if (!token) throw notFound('Agent 토큰을 찾을 수 없습니다.');
        requireOwner(token.userId, context);
        send(response, 200, store.revokeAgentToken(token.id, now())); return;
      }
      if (method === 'GET' && segments.length === 4 && segments[0] === 'api' && segments[1] === 'categories' && segments[3] === 'schema') {
        send(response, 200, categorySchema(segments[2].toUpperCase())); return;
      }
      if (method === 'GET' && segments.join('/') === 'api/listings') {
        const requestedStatus = url.searchParams.get('status') || 'ACTIVE';
        if (requestedStatus !== 'ACTIVE') throw validationError('공개 매물 목록에서는 ACTIVE 상태만 조회할 수 있습니다.', { field: 'status' });
        send(response, 200, store.listListings({ status: 'ACTIVE', query: url.searchParams.get('q') || '' })); return;
      }
      if (method === 'GET' && segments.join('/') === 'api/listings/mine') {
        send(response, 200, store.listListingsBySeller(context.userId)); return;
      }
      if (method === 'GET' && segments.join('/') === 'api/listing-drafts/mine') {
        send(response, 200, store.listDraftsBySeller(context.userId)); return;
      }
      if (method === 'GET' && segments.join('/') === 'api/purchase-requests/mine') {
        send(response, 200, store.listRequestsByBuyer(context.userId)); return;
      }
      if (method === 'GET' && segments.length === 3 && segments[0] === 'api' && segments[1] === 'listings') {
        const listing = store.getListing(segments[2]);
        if (!listing) throw notFound('매물을 찾을 수 없습니다.');
        if (listing.status !== 'ACTIVE' && listing.sellerId !== context.userId) throw notFound('매물을 찾을 수 없습니다.');
        send(response, 200, listing); return;
      }

      if (method === 'POST' && segments.join('/') === 'api/listing-drafts') {
        const draft = runCommand(store, context, request, body, {
          actionType: 'CREATE_LISTING_DRAFT', targetType: 'ListingDraft', operation: path,
          targetId: result => result.id,
        }, () => {
          const value = normalizeListingDraft(body, { userId: context.userId, actorType: context.actorType, now: now(), id: randomUUID() });
          if (value.sourceListingId) {
            const source = store.getListing(value.sourceListingId);
            if (!source) throw notFound('수정할 매물을 찾을 수 없습니다.');
            requireOwner(source.sellerId, context);
          }
          return store.saveDraft(value);
        });
        send(response, 201, draft); return;
      }
      if (method === 'PATCH' && segments.length === 3 && segments[0] === 'api' && segments[1] === 'listing-drafts') {
        const draftId = segments[2];
        const existing = store.getDraft(draftId);
        if (!existing) throw notFound('판매 초안을 찾을 수 없습니다.');
        requireOwner(existing.sellerId, context);
        if (existing.status === 'PUBLISHED') throw invalidState('게시된 초안은 수정할 수 없습니다. 새 초안에서 수정해 주세요.');
        const updated = runCommand(store, context, request, body, {
          actionType: 'UPDATE_LISTING_DRAFT', targetType: 'ListingDraft', targetId: draftId, operation: path,
        }, () => store.saveDraft(normalizeListingDraft(body, { existing, userId: context.userId, actorType: context.actorType, now: now(), id: draftId })));
        send(response, 200, updated); return;
      }
      if (method === 'POST' && segments.length === 4 && segments[0] === 'api' && segments[1] === 'listings' && segments[3] === 'drafts') {
        const source = store.getListing(segments[2]);
        if (!source) throw notFound('수정할 매물을 찾을 수 없습니다.');
        requireOwner(source.sellerId, context);
        if (source.status !== 'ACTIVE') throw invalidState('비활성 매물은 새 초안을 만들 수 없습니다.');
        const draft = runCommand(store, context, request, body, {
          actionType: 'CREATE_LISTING_DRAFT', targetType: 'ListingDraft', operation: path,
          targetId: result => result.id,
        }, () => store.saveDraft(normalizeListingDraft({ ...source, ...body, source: context.actorType === 'AGENT' ? 'AGENT' : 'HUMAN', sourceListingId: source.id },
          { userId: context.userId, actorType: context.actorType, now: now(), id: randomUUID() })));
        send(response, 201, draft); return;
      }
      if (method === 'POST' && segments.length === 4 && segments[0] === 'api' && segments[1] === 'listing-drafts' && segments[3] === 'publish') {
        humanOnly(context, '판매글을 게시');
        const draftId = segments[2];
        const draft = store.getDraft(draftId);
        if (!draft) throw notFound('판매 초안을 찾을 수 없습니다.');
        requireOwner(draft.sellerId, context);
        if (draft.status === 'PUBLISHED') throw invalidState('게시된 초안은 다시 게시할 수 없습니다.');
        const missing = listingMissing(draft);
        if (missing.length) throw validationError('게시 전에 필수 정보를 입력해 주세요.', { missingFields: missing });
        if (draft.status !== 'READY_FOR_REVIEW') throw invalidState('검토 가능한 초안만 게시할 수 있습니다.');
        if (draft.sourceListingId) {
          const source = store.getListing(draft.sourceListingId);
          if (!source) throw notFound('수정할 매물을 찾을 수 없습니다.');
          requireOwner(source.sellerId, context);
          if (source.status !== 'ACTIVE') throw invalidState('수정 원본 매물이 더 이상 활성 상태가 아닙니다.');
        }
        const listing = runCommand(store, context, request, body, {
          actionType: 'PUBLISH_LISTING', targetType: 'Listing', targetId: () => null, operation: path,
        }, () => store.publishDraft(draft, randomUUID(), now()));
        send(response, 201, listing); return;
      }
      if (method === 'POST' && segments.length === 4 && segments[0] === 'api' && segments[1] === 'listings' && segments[3] === 'deactivate') {
        humanOnly(context, '매물을 비활성화');
        const listing = store.getListing(segments[2]);
        if (!listing) throw notFound('매물을 찾을 수 없습니다.');
        requireOwner(listing.sellerId, context);
        if (listing.status !== 'ACTIVE') throw invalidState('활성 매물만 비활성화할 수 있습니다.');
        const updated = runCommand(store, context, request, body, {
          actionType: 'DEACTIVATE_LISTING', targetType: 'Listing', targetId: listing.id, operation: path,
        }, () => store.deactivateListing(listing.id, now()));
        send(response, 200, updated); return;
      }

      if (method === 'POST' && segments.join('/') === 'api/purchase-requests') {
        const purchaseRequest = runCommand(store, context, request, body, {
          actionType: 'CREATE_PURCHASE_REQUEST_DRAFT', targetType: 'PurchaseRequest', operation: path,
          targetId: result => result.id,
        }, () => store.savePurchaseRequest(normalizePurchaseRequest(body, { userId: context.userId, actorType: context.actorType, now: now(), id: randomUUID() })));
        send(response, 201, purchaseRequest); return;
      }
      if (method === 'PATCH' && segments.length === 3 && segments[0] === 'api' && segments[1] === 'purchase-requests') {
        const requestId = segments[2];
        const existing = store.getPurchaseRequest(requestId);
        if (!existing) throw notFound('구매 조건을 찾을 수 없습니다.');
        requireOwner(existing.buyerId, context);
        const updated = runCommand(store, context, request, body, {
          actionType: 'UPDATE_PURCHASE_REQUEST_DRAFT', targetType: 'PurchaseRequest', targetId: requestId, operation: path,
        }, () => store.savePurchaseRequest(normalizePurchaseRequest(body, { existing, userId: context.userId, actorType: context.actorType, now: now(), id: requestId })));
        send(response, 200, updated); return;
      }
      if (method === 'POST' && segments.length === 4 && segments[0] === 'api' && segments[1] === 'purchase-requests' && segments[3] === 'confirm') {
        humanOnly(context, '구매 조건을 확정');
        const requestId = segments[2];
        const purchaseRequest = store.getPurchaseRequest(requestId);
        if (!purchaseRequest) throw notFound('구매 조건을 찾을 수 없습니다.');
        requireOwner(purchaseRequest.buyerId, context);
        if (purchaseRequest.status !== 'DRAFT') throw invalidState('DRAFT 상태의 구매 조건만 확정할 수 있습니다.');
        const missing = purchaseRequestMissing(purchaseRequest);
        if (missing.length) throw validationError('확정 전에 필수 구매 조건을 입력해 주세요.', { missingFields: missing });
        const confirmed = runCommand(store, context, request, body, {
          actionType: 'CONFIRM_PURCHASE_REQUEST', targetType: 'PurchaseRequest', targetId: requestId, operation: path,
        }, () => store.confirmPurchaseRequest(requestId, now()));
        send(response, 200, confirmed); return;
      }
      if (method === 'POST' && segments.length === 4 && segments[0] === 'api' && segments[1] === 'purchase-requests' && segments[3] === 'search') {
        const requestId = segments[2];
        const purchaseRequest = store.getPurchaseRequest(requestId);
        if (!purchaseRequest) throw notFound('구매 조건을 찾을 수 없습니다.');
        requireOwner(purchaseRequest.buyerId, context);
        if (purchaseRequest.status !== 'CONFIRMED') throw invalidState('구매자가 Web에서 조건을 확정한 뒤 검색할 수 있습니다.');
        const results = runCommand(store, context, request, body, {
          actionType: 'SEARCH_LISTINGS', targetType: 'PurchaseRequest', targetId: requestId, operation: path,
        }, () => {
          const values = matchListings(store.activeListingsForSearch(), purchaseRequest);
          store.insertSearchResults(values);
          return values;
        });
        send(response, 200, results); return;
      }

      throw notFound('요청한 API 경로를 찾을 수 없습니다.');
    } catch (error) {
      if (context?.actorType === 'AGENT' && !context.auditRecorded && ['POST', 'PATCH'].includes(request.method) && requestPath.startsWith('/api/')) {
        const [actionType, targetType] = failedActionFor(requestPath);
        const segments = requestPath.split('/').filter(Boolean);
        const targetId = ['listing-drafts', 'purchase-requests', 'listings'].includes(segments[1]) ? segments[2] : null;
        try {
          store.recordAgentAction({ id: randomUUID(), userId: context.userId, actionType, targetType,
            targetId: uuidPattern.test(targetId || '') ? targetId : null, status: 'FAILED',
            requestId: requestIdFrom(request, body), createdAt: now() });
        } catch { /* Keep the original API error if audit persistence itself fails. */ }
      }
      const apiError = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
      send(response, apiError.status, {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details ? { details: apiError.details } : {}),
      });
    }
  });
  server.store = store;
  return server;
}
