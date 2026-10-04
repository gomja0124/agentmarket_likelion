import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError } from './api-client.js';

export const SERVER_NAME = 'agent-market';
export const SERVER_VERSION = '0.2.0';

const CATEGORY = z.enum(['PHONE', 'TABLET']);
const CONDITION = z.enum(['LIKE_NEW', 'GOOD', 'FAIR']);
const UUID = z.string().uuid();

/**
 * Tool 이름과 입출력은 03 MCP Tools Spec — Step 1을 따른다.
 *   get_category_schema, create_listing_draft, update_listing_draft,
 *   create_purchase_request_draft, update_purchase_request_draft, search_listings, get_listing
 * 그 외(whoami, get_market_guide, browse_listings, list_my_*)는 Agent 편의를 위한 읽기 전용 보조 tool이다.
 * 모든 쓰기 응답에는 humanApprovalRequired와 nextAction이 들어간다(스펙 3절).
 */
export const MARKET_GUIDE = {
  summary: 'Agent Market은 사람이 쓰는 중고 핸드폰·태블릿 마켓이다. 외부 Agent는 판매글 초안 작성, 구매 조건 구조화, 확정된 조건으로 매물 검색까지만 수행하고, 게시·조건 확정·거래 결정은 반드시 사람이 Web에서 직접 한다.',
  categories: ['PHONE', 'TABLET'],
  conditions: { LIKE_NEW: '거의 새것', GOOD: '사용감 있음, 정상 작동', FAIR: '흠집·하자 있음' },
  agentCan: [
    '매물 조회 (browse_listings, get_listing)',
    '판매글 초안 생성·수정 (create_listing_draft, update_listing_draft)',
    '구매 조건 초안 생성·수정 (create_purchase_request_draft, update_purchase_request_draft)',
    '사람이 확정한 구매 조건으로 검색·매칭 실행 (search_listings)',
  ],
  agentCannot: [
    '판매글 게시 (사람이 Web에서 게시 버튼을 눌러야 ACTIVE Listing이 된다)',
    '구매 조건 확정 (사람이 Web에서 확정해야 search_listings가 가능하다)',
    '매물 비활성화, 결제, 연락처 공개, 거래 확정',
  ],
  sellerFlow: [
    '1. 사용자가 제품명·가격·설명을 말하면 get_category_schema로 필수·선택 항목을 확인한다.',
    '2. 이미 받은 정보는 다시 묻지 말고, 누락된 필수 항목(category, model, priceKrw)부터 한두 개씩 질문한다.',
    '3. create_listing_draft로 초안을 저장한다. 모르는 값은 비워 두고 지어내지 않는다.',
    '4. 응답의 publishable이 true가 되면 사용자에게 Web에서 검토·게시해 달라고 안내한다. nextAction을 그대로 전달한다.',
  ],
  buyerFlow: [
    '1. 사용자의 요청을 naturalLanguageRequest로 넘기고, 이미 알아낸 조건은 knownConstraints에 넣어 create_purchase_request_draft를 호출한다.',
    '2. 응답의 nextQuestions 순서대로(카테고리 → 예산 → 모델 → 용량) 한두 개씩 질문하고 update_purchase_request_draft로 반영한다.',
    '3. readyForConfirmation이 true가 되면 사용자에게 Web에서 확인·확정해 달라고 안내한다.',
    '4. 사용자가 확정했다고 하면 search_listings를 호출한다. 확정 전이면 INVALID_STATE로 거부되므로 다시 안내한다.',
    '5. 결과는 matchStatus(MATCH / NEEDS_CONFIRMATION / EXCLUDED)와 matched/unmet/missingFields로 설명한다. missingFields는 정상으로 추정하지 않는다.',
  ],
  retryRule: '쓰기 tool은 멱등하다. 네트워크 오류로 재시도할 때는 같은 requestId를 다시 넘기면 중복 생성되지 않는다.',
  scopes: {
    read: '검색·조회',
    'listing:write': '판매글 초안 생성·수정',
    'purchase:write': '구매 조건 초안 생성·수정',
    search: '확정된 조건으로 검색·매칭 실행',
  },
  scopeRule: '토큰에 없는 권한의 tool은 목록에 나타나지 않는다. 필요한 권한이 없으면 사용자에게 Web에서 권한을 추가한 토큰을 발급해 달라고 안내한다.',
};

function instructionsText() {
  return [
    MARKET_GUIDE.summary,
    '',
    'Agent가 할 수 있는 일: ' + MARKET_GUIDE.agentCan.join(' / '),
    'Agent가 할 수 없는 일: ' + MARKET_GUIDE.agentCannot.join(' / '),
    '',
    '판매 흐름: ' + MARKET_GUIDE.sellerFlow.join(' '),
    '구매 흐름: ' + MARKET_GUIDE.buyerFlow.join(' '),
    '',
    '값을 모르면 비워 두고 사용자에게 묻는다. 지어내지 않는다. ' + MARKET_GUIDE.retryRule,
    MARKET_GUIDE.scopeRule,
  ].join('\n');
}

// ---- 사람 승인 연결 (스펙 3절) ------------------------------------------------

const LISTING_QUESTIONS = {
  category: '핸드폰인가요, 태블릿인가요?',
  model: '정확한 모델명은 무엇인가요? (예: iPhone 15 Pro, Galaxy Tab S9)',
  priceKrw: '판매 가격은 얼마인가요?',
  storageGb: '저장 용량은 몇 GB인가요?',
  condition: '제품 상태는 어떤가요? 거의 새것 / 사용감 있음 / 흠집·하자 있음 중에서요.',
  accessories: '구성품(박스, 충전기 등)은 무엇이 있나요?',
};
const LISTING_QUESTION_ORDER = ['category', 'model', 'priceKrw', 'storageGb', 'condition', 'accessories'];

const PURCHASE_QUESTIONS = {
  category: '찾으시는 게 핸드폰인가요, 태블릿인가요?',
  maxBudgetKrw: '최대 예산은 얼마까지 생각하시나요?',
  modelQuery: '원하는 모델이나 모델군이 있나요? (예: iPhone 15, Galaxy Tab)',
  storageGb: '최소 저장 용량이 필요하신가요?',
};
// 스펙: 우선 질문은 카테고리 → 예산 → 모델/모델군 → 용량.
const PURCHASE_QUESTION_ORDER = ['category', 'maxBudgetKrw', 'modelQuery', 'storageGb'];

/** 비어 있는 필드에 대한 질문을 스펙 우선순위대로 만든다. 필수 항목이 먼저 온다. */
export function listingQuestions(draft) {
  const empty = name => draft[name] == null || draft[name] === '';
  return LISTING_QUESTION_ORDER.filter(empty).map(name => LISTING_QUESTIONS[name]);
}

export function purchaseQuestions(request) {
  const empty = name => request[name] == null || request[name] === '';
  return PURCHASE_QUESTION_ORDER.filter(empty).map(name => PURCHASE_QUESTIONS[name]);
}

/** 사람이 다음에 해야 할 일. Agent는 이 문장을 사용자에게 그대로 전달한다. */
export function nextActionFor(kind, value, webUrl) {
  const where = webUrl ? ` (${webUrl})` : '';
  if (kind === 'ListingDraft') {
    if (value.status === 'PUBLISHED') return '이 초안은 이미 게시되었습니다. 수정하려면 Web에서 새 초안을 시작하세요.';
    if (value.missingFields?.length) return `필수 정보가 비어 있습니다: ${value.missingFields.join(', ')}. 사용자에게 물어본 뒤 update_listing_draft로 채우세요.`;
    return `초안이 검토 가능 상태(READY_FOR_REVIEW)입니다. 사용자가 Web${where}에서 내용을 확인하고 직접 게시해야 매물이 등록됩니다. Agent는 게시할 수 없습니다.`;
  }
  if (kind === 'PurchaseRequest') {
    if (value.status === 'CONFIRMED') return '구매 조건이 확정되었습니다. search_listings로 매물을 검색할 수 있습니다.';
    if (value.missingFields?.length) return `필수 조건이 비어 있습니다: ${value.missingFields.join(', ')}. 사용자에게 물어본 뒤 update_purchase_request_draft로 채우세요.`;
    return `구매 조건 초안이 저장되었습니다. 사용자가 Web${where}에서 조건을 확인하고 직접 확정해야 검색할 수 있습니다. Agent는 확정할 수 없습니다.`;
  }
  return null;
}

const STRUCTURED_LISTING_FIELDS = ['title', 'description', 'category', 'brand', 'model', 'storageGb', 'condition', 'accessories', 'priceKrw', 'images'];
const STRUCTURED_PURCHASE_FIELDS = ['category', 'modelQuery', 'maxBudgetKrw', 'storageGb', 'conditionPreferences'];
const pick = (object, keys) => Object.fromEntries(keys.map(k => [k, object[k] ?? null]));

function draftResponse(draft, webUrl) {
  const publishable = draft.status === 'READY_FOR_REVIEW';
  return {
    draftId: draft.id,
    status: draft.status,
    structuredFields: pick(draft, STRUCTURED_LISTING_FIELDS),
    missingFields: draft.missingFields,
    nextQuestions: listingQuestions(draft),
    publishable,
    reviewRequired: true,
    humanApprovalRequired: true,
    nextAction: nextActionFor('ListingDraft', draft, webUrl),
    draft,
  };
}

function purchaseResponse(request, webUrl) {
  const readyForConfirmation = request.status === 'DRAFT' && request.missingFields.length === 0;
  return {
    requestId: request.id,
    status: request.status,
    structuredConditions: pick(request, STRUCTURED_PURCHASE_FIELDS),
    missingFields: request.missingFields,
    nextQuestions: purchaseQuestions(request),
    readyForConfirmation,
    humanApprovalRequired: request.status !== 'CONFIRMED',
    nextAction: nextActionFor('PurchaseRequest', request, webUrl),
    purchaseRequest: request,
  };
}

function summarizeSearch(results) {
  const counts = { MATCH: 0, NEEDS_CONFIRMATION: 0, EXCLUDED: 0 };
  for (const r of results) counts[r.matchStatus] = (counts[r.matchStatus] || 0) + 1;
  return {
    total: results.length,
    ...counts,
    ruleVersion: results[0]?.ruleVersion ?? null,
    note: 'MATCH는 모든 조건 충족, NEEDS_CONFIRMATION은 매물 정보가 없어 판단 불가(정상으로 추정하지 말 것), EXCLUDED는 조건 위반.',
  };
}

// ---- 결과·오류 포장 ---------------------------------------------------------

function ok(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function fail(error) {
  const payload = error instanceof ApiError
    ? {
      success: false,
      code: error.code,
      message: error.message,
      details: error.details,
      retryable: error.status >= 500 || error.status === 0,
      suggestedAction: suggestFor(error),
    }
    : { success: false, code: 'MCP_ERROR', message: error.message, retryable: false };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function suggestFor(error) {
  switch (error.code) {
    case 'FORBIDDEN': return error.message.includes('권한') ? '이 토큰에 없는 권한입니다. 사용자에게 Web에서 권한을 추가한 새 토큰을 발급해 달라고 안내하세요.' : '사람만 할 수 있는 행동입니다. 사용자에게 Web에서 직접 해 달라고 안내하세요.';
    case 'UNAUTHORIZED': return '토큰이 유효하지 않습니다. 사용자에게 Web에서 토큰을 확인하거나 새로 발급해 달라고 안내하세요.';
    case 'TIMEOUT':
    case 'NETWORK_ERROR': return '백엔드에 연결하지 못했습니다. 잠시 후 같은 requestId로 재시도하고, 계속 실패하면 사용자에게 알리세요.';
    case 'INVALID_STATE': return '현재 상태에서는 불가능합니다. 사용자가 Web에서 확정·게시했는지 확인한 뒤 다시 시도하세요.';
    case 'VALIDATION_ERROR': return 'details의 필드를 확인하고 사용자에게 물어본 뒤 값을 고쳐 다시 호출하세요. 값을 지어내지 마세요.';
    case 'NOT_FOUND': return 'ID를 확인하세요. list_my_* tool로 현재 객체 목록을 다시 조회할 수 있습니다.';
    default: return error.status >= 500 ? '잠시 후 같은 requestId로 재시도하세요.' : '요청을 확인하세요.';
  }
}

// ---- 입력 스키마 ------------------------------------------------------------

const listingPatchShape = {
  title: z.string().max(200).nullable().optional().describe('판매글 제목'),
  description: z.string().max(10000).nullable().optional().describe('자유 설명'),
  category: CATEGORY.nullable().optional().describe('PHONE 또는 TABLET'),
  brand: z.string().max(100).nullable().optional(),
  model: z.string().max(200).nullable().optional().describe('정확한 모델명. 예: iPhone 15 Pro, Galaxy Tab S9'),
  storageGb: z.number().int().min(1).nullable().optional().describe('저장 용량 GB'),
  condition: CONDITION.nullable().optional(),
  accessories: z.string().max(2000).nullable().optional().describe('구성품'),
  priceKrw: z.number().int().min(0).nullable().optional().describe('판매 가격, 원 단위 정수'),
  images: z.array(z.string().max(200000)).max(20).optional().describe('이미지 URL 또는 Data URL. Step 1에서는 AI 분석하지 않고 보관만 한다.'),
};

const purchaseConstraintsShape = {
  category: CATEGORY.nullable().optional(),
  modelQuery: z.string().max(200).nullable().optional().describe('모델 또는 모델군 검색어. 예: iPhone 15, Galaxy Tab'),
  maxBudgetKrw: z.number().int().min(0).nullable().optional().describe('최대 예산, 원 단위 정수'),
  storageGb: z.number().int().min(1).nullable().optional().describe('최소 저장 용량 GB'),
  conditionPreferences: z.array(CONDITION).max(3).optional().describe('허용하는 상태 목록. 비우면 상태 조건 없음'),
};

const requestIdField = UUID.optional().describe('재시도용 멱등 키. 생략하면 어댑터가 생성한다.');

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object || {}).filter(([, v]) => v !== undefined));
}

// ---- 서버 -----------------------------------------------------------------

/**
 * @param api        백엔드 어댑터 (토큰 또는 demo userId 바인딩). 모든 tool은 이 바인딩의 사용자로 실행된다.
 * @param webUrl     승인 안내에 넣을 Web 주소
 * @param scopes     이 연결의 권한. null이면 제한 없음(demo). 배열이면 해당 권한의 tool만 등록한다.
 */
export function createAgentMarketServer({ api, webUrl = process.env.AGENT_MARKET_WEB_URL || '', scopes = null } = {}) {
  if (!api) throw new Error('createAgentMarketServer에는 api가 필요합니다.');
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: instructionsText() });
  const guard = fn => async args => { try { return ok(await fn(args)); } catch (error) { return fail(error); } };
  const has = scope => scopes == null || scopes.includes(scope);
  const register = (scope, name, config, handler) => { if (has(scope)) server.registerTool(name, config, guard(handler)); };

  // ---- 보조 읽기 tool ----
  register('read', 'whoami', {
    title: '현재 연결 정보',
    description: '이 Agent가 누구를 대리하는지, 어떤 권한(scope)이 있는지 돌려준다. 권한 부족 오류가 나면 먼저 호출한다.',
    inputSchema: {},
  }, async () => ({ ...(await api.me()), availableScopes: scopes ?? Object.keys(MARKET_GUIDE.scopes), webUrl: webUrl || null }));

  register('read', 'get_market_guide', {
    title: '마켓 이용 규칙',
    description: '가장 먼저 호출한다. Agent가 할 수 있는 일과 없는 일, 판매·구매 흐름, 승인 지점, 재시도 규칙을 돌려준다.',
    inputSchema: {},
  }, async () => ({ ...MARKET_GUIDE, apiHealth: await api.health(), webUrl: webUrl || null }));

  register('read', 'browse_listings', {
    title: '공개 매물 둘러보기',
    description: '구매 조건 없이 ACTIVE 매물을 텍스트로 훑어본다. 시세 파악용. 조건 기반 매칭은 search_listings를 쓴다.',
    inputSchema: { query: z.string().max(200).optional().describe('모델명 등 검색어') },
  }, async ({ query }) => ({ listings: await api.listListings(query || '') }));

  register('read', 'list_my_listing_drafts', {
    title: '내 판매 초안 목록',
    description: '현재 사용자의 게시 전 판매 초안을 돌려준다. 게시 여부 확인에도 쓴다.',
    inputSchema: {},
  }, async () => ({ drafts: (await api.myDrafts()).map(d => draftResponse(d, webUrl)) }));

  register('read', 'list_my_listings', {
    title: '내 매물 목록',
    description: '현재 사용자가 게시한 매물(ACTIVE/INACTIVE)을 돌려준다.',
    inputSchema: {},
  }, async () => ({ listings: await api.myListings() }));

  register('read', 'list_my_purchase_requests', {
    title: '내 구매 조건 목록',
    description: '현재 사용자의 구매 조건(DRAFT/CONFIRMED)을 돌려준다. 사용자가 Web에서 확정했는지 확인할 때 쓴다.',
    inputSchema: {},
  }, async () => ({ purchaseRequests: (await api.myPurchaseRequests()).map(r => purchaseResponse(r, webUrl)) }));

  // ---- 03 MCP Tools Spec — Step 1 ----
  register('read', 'get_category_schema', {
    title: '카테고리 입력 필드 조회',
    description: 'PHONE/TABLET의 requiredFields, optionalFields, questionHints를 돌려준다. 초안을 만들기 전에 호출한다. 최소 구매 조건은 category와 maxBudgetKrw다.',
    inputSchema: { category: CATEGORY },
  }, async ({ category }) => ({
    ...(await api.categorySchema(category)),
    minimumPurchaseConditions: ['category', 'maxBudgetKrw'],
    preferredPurchaseConditions: ['modelQuery', 'storageGb'],
  }));

  register('read', 'get_listing', {
    title: '매물 상세',
    description: '후보 매물의 구조화 필드와 이미지 링크를 돌려준다. missingFields에 있는 항목은 판매자가 입력하지 않은 것이므로 정상으로 추정하지 않는다.',
    inputSchema: { listingId: UUID },
  }, ({ listingId }) => api.getListing(listingId));

  register('listing:write', 'create_listing_draft', {
    title: '판매글 초안 생성',
    description: '판매자가 제공한 정보를 구조화해 ListingDraft를 만든다. productName은 model의 별칭, freeText는 description으로 저장된다. 모르는 값은 생략한다(추정 금지). 응답의 missingFields·nextQuestions로 질문하고, publishable이면 nextAction을 사용자에게 전달한다. 게시는 사람이 Web에서 한다.',
    inputSchema: {
      ...listingPatchShape,
      productName: z.string().max(200).optional().describe('model의 별칭'),
      freeText: z.string().max(10000).optional().describe('판매자의 자유 설명. description으로 저장'),
      requestId: requestIdField,
    },
  }, async ({ requestId, productName, freeText, ...fields }) => {
    const payload = stripUndefined({ ...fields, model: fields.model ?? productName, description: fields.description ?? freeText });
    return draftResponse(await api.createDraft(payload, requestId), webUrl);
  });

  register('listing:write', 'update_listing_draft', {
    title: '판매글 초안 수정',
    description: '질문 답변이나 판매자 수정을 patch로 반영한다. 넘긴 필드만 바뀐다. 응답의 publishable이 true면 사람이 Web에서 게시할 수 있다. 게시 자체는 수행하지 않는다.',
    inputSchema: { draftId: UUID, patch: z.object(listingPatchShape), requestId: requestIdField },
  }, async ({ draftId, patch, requestId }) => {
    const draft = await api.updateDraft(draftId, stripUndefined(patch), requestId);
    return { ...draftResponse(draft, webUrl), updatedDraft: draft };
  });

  register('purchase:write', 'create_purchase_request_draft', {
    title: '구매 조건 초안 생성',
    description: '구매 의도를 구조화한다. naturalLanguageRequest에 사용자의 말을 그대로 넣고, 거기서 이미 확실한 조건만 knownConstraints에 넣는다(추정 금지). 응답의 nextQuestions 순서(카테고리 → 예산 → 모델 → 용량)로 질문한다. 확정은 사람이 Web에서 한다.',
    inputSchema: {
      category: CATEGORY.nullable().optional(),
      naturalLanguageRequest: z.string().max(2000).optional().describe('사용자의 원문 요청. 예: 100만 원 이하 태블릿 찾아줘'),
      knownConstraints: z.object(purchaseConstraintsShape).optional().describe('이미 확실한 조건'),
      requestId: requestIdField,
    },
  }, async ({ category, naturalLanguageRequest, knownConstraints, requestId }) => {
    const payload = stripUndefined({ ...(knownConstraints || {}), category: knownConstraints?.category ?? category });
    const request = await api.createPurchaseRequest(payload, requestId);
    return { ...purchaseResponse(request, webUrl), naturalLanguageRequest: naturalLanguageRequest ?? null };
  });

  register('purchase:write', 'update_purchase_request_draft', {
    title: '구매 조건 초안 수정',
    description: '구매자 답변을 patch로 반영한다. 확정된 조건을 수정하면 DRAFT로 돌아가 다시 확정이 필요하다. readyForConfirmation이 true면 사람이 Web에서 확정할 수 있다.',
    inputSchema: { requestId: UUID.describe('PurchaseRequest ID'), patch: z.object(purchaseConstraintsShape), idempotencyKey: requestIdField },
  }, async ({ requestId, patch, idempotencyKey }) => {
    const request = await api.updatePurchaseRequest(requestId, stripUndefined(patch), idempotencyKey);
    return { ...purchaseResponse(request, webUrl), updatedRequest: request };
  });

  register('search', 'search_listings', {
    title: '확정된 구매 조건으로 검색·매칭',
    description: '사람이 Web에서 확정한 PurchaseRequest로 자체 DB를 Rule-based 매칭한다. 확정 전이면 INVALID_STATE로 거부된다. 결과의 NEEDS_CONFIRMATION은 정보 부족이지 적합이 아니다.',
    inputSchema: { purchaseRequestId: UUID, requestId: requestIdField },
  }, async ({ purchaseRequestId, requestId }) => {
    const results = await api.search(purchaseRequestId, requestId);
    return { purchaseRequestId, summary: summarizeSearch(results), results };
  });

  return server;
}
