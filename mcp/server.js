import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AgentMarketApi, ApiError } from './api-client.js';

export const SERVER_NAME = 'agent-market';
export const SERVER_VERSION = '0.1.0';

const CATEGORY = z.enum(['PHONE', 'TABLET']);
const CONDITION = z.enum(['LIKE_NEW', 'GOOD', 'FAIR']);
const UUID = z.string().uuid();

/**
 * 외부 Agent가 가장 먼저 읽어야 하는 안내. Claude Desktop 등은 서버 연결 시 instructions를 시스템 컨텍스트로 받는다.
 * 같은 내용을 get_market_guide tool로도 제공한다.
 */
export const MARKET_GUIDE = {
  summary: 'Agent Market은 사람이 쓰는 중고 핸드폰·태블릿 마켓이다. 외부 Agent는 판매글 초안 작성, 구매 조건 구조화, 확정된 조건으로 매물 검색까지만 수행하고, 게시·조건 확정·거래 결정은 반드시 사람이 Web에서 직접 한다.',
  categories: ['PHONE', 'TABLET'],
  conditions: { LIKE_NEW: '거의 새것', GOOD: '사용감 있음, 정상 작동', FAIR: '흠집·하자 있음' },
  agentCan: [
    '매물 검색·상세 조회 (search_listings, get_listing)',
    '판매글 초안 생성·수정 (create_listing_draft, update_listing_draft)',
    '구매 조건 초안 생성·수정 (create_purchase_request, update_purchase_request)',
    '사람이 확정한 구매 조건으로 검색 실행 (run_search)',
  ],
  agentCannot: [
    '판매글 게시 (사람이 Web에서 게시 버튼을 눌러야 ACTIVE Listing이 된다)',
    '구매 조건 확정 (사람이 Web에서 확정해야 run_search가 가능하다)',
    '매물 비활성화, 결제, 연락처 공개, 거래 확정',
  ],
  sellerFlow: [
    '1. 사용자가 제품명·가격·설명을 말하면 get_category_schema로 필수·선택 항목을 확인한다.',
    '2. 이미 받은 정보는 다시 묻지 말고, 누락된 필수 항목(category, model, priceKrw)부터 한두 개씩 질문한다.',
    '3. create_listing_draft로 초안을 저장한다. 모르는 값은 null로 두고 지어내지 않는다.',
    '4. 응답의 missingFields가 비면 status가 READY_FOR_REVIEW가 된다. 사용자에게 Web에서 검토·게시해 달라고 안내한다.',
  ],
  buyerFlow: [
    '1. 사용자의 짧은 요청에서 category, modelQuery, maxBudgetKrw, storageGb, conditionPreferences를 뽑는다.',
    '2. 결과에 영향이 큰 누락 조건(category, maxBudgetKrw)부터 질문한다. 모든 항목을 한 번에 요구하지 않는다.',
    '3. create_purchase_request로 초안을 저장하고 사용자에게 Web에서 확인·확정해 달라고 안내한다.',
    '4. 사용자가 확정했다고 하면 run_search를 호출한다. 확정 전이면 서버가 거부하므로 다시 안내한다.',
    '5. 결과는 matchStatus(MATCH / NEEDS_CONFIRMATION / EXCLUDED)와 matched/unmet/missingFields로 설명한다. missingFields는 정상으로 추정하지 않는다.',
  ],
  retryRule: '쓰기 tool은 멱등하다. 네트워크 오류로 재시도할 때는 같은 requestId를 다시 넘기면 중복 생성되지 않는다.',
  scopes: {
    read: '검색·조회',
    'listing:write': '판매글 초안 생성·수정',
    'purchase:write': '구매 조건 초안 생성·수정',
    search: '확정된 조건으로 검색 실행',
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
    '값을 모르면 null로 두고 사용자에게 묻는다. 지어내지 않는다. ' + MARKET_GUIDE.retryRule,
    MARKET_GUIDE.scopeRule,
  ].join('\n');
}

/** 서버 응답 객체를 보고 사람이 다음에 해야 할 일을 한 줄로 만든다. 승인 지점을 Agent가 사용자에게 그대로 전달하게 하는 장치. */
export function nextStepFor(kind, value, webUrl) {
  const where = webUrl ? ` (${webUrl})` : '';
  if (kind === 'ListingDraft') {
    if (value.status === 'PUBLISHED') return '이 초안은 이미 게시되었습니다.';
    if (value.missingFields?.length) return `필수 정보가 비어 있습니다: ${value.missingFields.join(', ')}. 사용자에게 물어본 뒤 update_listing_draft로 채우세요.`;
    return `초안이 검토 가능 상태(READY_FOR_REVIEW)입니다. 사용자가 Web${where}에서 내용을 확인하고 직접 게시해야 매물이 등록됩니다. Agent는 게시할 수 없습니다.`;
  }
  if (kind === 'PurchaseRequest') {
    if (value.status === 'CONFIRMED') return '구매 조건이 확정되었습니다. run_search로 매물을 검색할 수 있습니다.';
    if (value.missingFields?.length) return `필수 조건이 비어 있습니다: ${value.missingFields.join(', ')}. 사용자에게 물어본 뒤 update_purchase_request로 채우세요.`;
    return `구매 조건 초안이 저장되었습니다. 사용자가 Web${where}에서 조건을 확인하고 직접 확정해야 검색할 수 있습니다. Agent는 확정할 수 없습니다.`;
  }
  return null;
}

function summarizeSearch(results) {
  const counts = { MATCH: 0, NEEDS_CONFIRMATION: 0, EXCLUDED: 0 };
  for (const r of results) counts[r.matchStatus] = (counts[r.matchStatus] || 0) + 1;
  return {
    total: results.length,
    ...counts,
    note: 'MATCH는 모든 조건 충족, NEEDS_CONFIRMATION은 매물 정보가 없어 판단 불가(정상으로 추정하지 말 것), EXCLUDED는 조건 위반.',
  };
}

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

const draftFields = {
  title: z.string().max(200).nullable().optional().describe('판매글 제목'),
  description: z.string().max(10000).nullable().optional().describe('자유 설명'),
  category: CATEGORY.nullable().optional().describe('PHONE 또는 TABLET'),
  brand: z.string().max(100).nullable().optional(),
  model: z.string().max(200).nullable().optional().describe('정확한 모델명. 예: iPhone 15 Pro, Galaxy Tab S9'),
  storageGb: z.number().int().min(1).nullable().optional().describe('저장 용량 GB'),
  condition: CONDITION.nullable().optional(),
  accessories: z.string().max(2000).nullable().optional().describe('구성품'),
  priceKrw: z.number().int().min(0).nullable().optional().describe('판매 가격, 원 단위 정수'),
  requestId: UUID.optional().describe('재시도용 멱등 키. 생략하면 서버 어댑터가 생성한다.'),
};

const purchaseFields = {
  category: CATEGORY.nullable().optional(),
  modelQuery: z.string().max(200).nullable().optional().describe('모델 또는 모델군 검색어. 예: iPhone 15, Galaxy Tab'),
  maxBudgetKrw: z.number().int().min(0).nullable().optional().describe('최대 예산, 원 단위 정수'),
  storageGb: z.number().int().min(1).nullable().optional().describe('최소 저장 용량 GB'),
  conditionPreferences: z.array(CONDITION).max(3).optional().describe('허용하는 상태 목록. 비우면 상태 조건 없음'),
  requestId: UUID.optional().describe('재시도용 멱등 키'),
};

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

/**
 * @param api        백엔드 어댑터 (토큰 또는 demo userId 바인딩)
 * @param webUrl     승인 안내에 넣을 Web 주소
 * @param scopes     이 연결의 권한. null이면 제한 없음(demo). 배열이면 해당 권한의 tool만 등록한다.
 */
export function createAgentMarketServer({ api, webUrl = process.env.AGENT_MARKET_WEB_URL || '', scopes = null } = {}) {
  if (!api) throw new Error('createAgentMarketServer에는 api가 필요합니다.');
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: instructionsText() });
  const guard = fn => async args => { try { return ok(await fn(args)); } catch (error) { return fail(error); } };
  const has = scope => scopes == null || scopes.includes(scope);
  const register = (scope, name, config, handler) => { if (has(scope)) server.registerTool(name, config, guard(handler)); };

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

  register('read', 'get_category_schema', {
    title: '카테고리 항목 조회',
    description: '판매글 초안에 필요한 필수·선택 항목과 질문 힌트를 돌려준다. 초안을 만들기 전에 호출한다.',
    inputSchema: { category: CATEGORY },
  }, ({ category }) => api.categorySchema(category));

  register('read', 'search_listings', {
    title: '공개 매물 검색',
    description: '구매 조건 없이 ACTIVE 매물을 텍스트로 검색한다. 시세 파악이나 빠른 확인용. 조건 기반 매칭은 run_search를 쓴다.',
    inputSchema: { query: z.string().max(200).optional().describe('모델명 등 검색어') },
  }, async ({ query }) => ({ listings: await api.listListings(query || '') }));

  register('read', 'get_listing', {
    title: '매물 상세',
    description: '매물 ID로 상세를 조회한다. missingFields에 있는 항목은 판매자가 입력하지 않은 것이므로 정상으로 추정하지 않는다.',
    inputSchema: { listingId: UUID },
  }, ({ listingId }) => api.getListing(listingId));

  register('read', 'list_my_listing_drafts', {
    title: '내 판매 초안 목록',
    description: '현재 사용자의 게시 전 판매 초안을 돌려준다. 게시 여부 확인에도 쓴다.',
    inputSchema: {},
  }, async () => {
    const drafts = await api.myDrafts();
    return { drafts: drafts.map(d => ({ ...d, nextStep: nextStepFor('ListingDraft', d, webUrl) })) };
  });

  register('read', 'list_my_listings', {
    title: '내 매물 목록',
    description: '현재 사용자가 게시한 매물(ACTIVE/INACTIVE)을 돌려준다.',
    inputSchema: {},
  }, async () => ({ listings: await api.myListings() }));

  register('read', 'list_my_purchase_requests', {
    title: '내 구매 조건 목록',
    description: '현재 사용자의 구매 조건(DRAFT/CONFIRMED)을 돌려준다. 사용자가 Web에서 확정했는지 확인할 때 쓴다.',
    inputSchema: {},
  }, async () => {
    const requests = await api.myPurchaseRequests();
    return { purchaseRequests: requests.map(r => ({ ...r, nextStep: nextStepFor('PurchaseRequest', r, webUrl) })) };
  });

  register('listing:write', 'create_listing_draft', {
    title: '판매글 초안 생성',
    description: '사용자가 말한 정보로 판매글 초안을 만든다. 모르는 값은 생략하거나 null로 둔다. 응답의 missingFields와 nextStep을 사용자에게 전달한다. 게시는 사람이 Web에서 한다.',
    inputSchema: draftFields,
  }, async ({ requestId, ...fields }) => {
    const draft = await api.createDraft(stripUndefined(fields), requestId);
    return { draft, nextStep: nextStepFor('ListingDraft', draft, webUrl) };
  });

  register('listing:write', 'update_listing_draft', {
    title: '판매글 초안 수정',
    description: '사용자에게 추가로 들은 값으로 초안을 채운다. 넘긴 필드만 바뀐다.',
    inputSchema: { draftId: UUID, ...draftFields },
  }, async ({ draftId, requestId, ...fields }) => {
    const draft = await api.updateDraft(draftId, stripUndefined(fields), requestId);
    return { draft, nextStep: nextStepFor('ListingDraft', draft, webUrl) };
  });

  register('purchase:write', 'create_purchase_request', {
    title: '구매 조건 초안 생성',
    description: '사용자의 요청을 구조화해 구매 조건 초안을 만든다. category와 maxBudgetKrw가 필수이며 없으면 missingFields로 돌아온다. 확정은 사람이 Web에서 한다.',
    inputSchema: purchaseFields,
  }, async ({ requestId, ...fields }) => {
    const purchaseRequest = await api.createPurchaseRequest(stripUndefined(fields), requestId);
    return { purchaseRequest, nextStep: nextStepFor('PurchaseRequest', purchaseRequest, webUrl) };
  });

  register('purchase:write', 'update_purchase_request', {
    title: '구매 조건 초안 수정',
    description: '구매 조건을 수정한다. 확정된 조건을 수정하면 DRAFT로 돌아가 다시 확정이 필요하다.',
    inputSchema: { purchaseRequestId: UUID, ...purchaseFields },
  }, async ({ purchaseRequestId, requestId, ...fields }) => {
    const purchaseRequest = await api.updatePurchaseRequest(purchaseRequestId, stripUndefined(fields), requestId);
    return { purchaseRequest, nextStep: nextStepFor('PurchaseRequest', purchaseRequest, webUrl) };
  });

  register('search', 'run_search', {
    title: '확정된 조건으로 매물 검색',
    description: '사람이 Web에서 확정한 구매 조건으로 Rule-based 매칭을 실행한다. 확정 전이면 INVALID_STATE로 거부된다. 결과의 NEEDS_CONFIRMATION은 정보 부족이지 적합이 아니다.',
    inputSchema: { purchaseRequestId: UUID, requestId: UUID.optional() },
  }, async ({ purchaseRequestId, requestId }) => {
    const results = await api.search(purchaseRequestId, requestId);
    return { summary: summarizeSearch(results), results };
  });

  return server;
}
