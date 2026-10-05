import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError, forbidden, validationError } from './errors.js';
import { DEMO_USER_ID } from './seed.js';

/**
 * 인증·권한.
 *
 * 호출 주체는 두 종류다.
 * - HUMAN: Web 사용자. 로그인 세션은 Web 서버가 관리하고, 이 API에는 X-User-Id로 전달한다.
 *   strict 모드에서는 Web 서버만 아는 공유 비밀(X-Web-Secret)이 함께 와야 믿는다.
 * - AGENT: 외부 Agent. 사람이 Web에서 발급한 Bearer 토큰(amk_...)으로만 인증한다.
 *   토큰에는 scope가 붙어 있고, 쓰기 경로마다 필요한 scope가 다르다.
 *
 * AGENT_MARKET_AUTH_MODE
 * - demo   (기본): 토큰이 있으면 검증하고, 없으면 예전처럼 X-User-Id / X-Actor-Type 헤더를 그대로 믿는다. 로컬 개발용.
 * - strict        : AGENT는 토큰 필수. HUMAN은 X-Web-Secret이 AGENT_MARKET_WEB_SECRET과 일치해야 한다. 배포용.
 */
export const SCOPES = ['read', 'listing:write', 'purchase:write', 'search'];
export const DEFAULT_SCOPES = ['read'];
export const TOKEN_PREFIX = 'amk_';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unauthorized = message => new ApiError(401, 'UNAUTHORIZED', message);

export function authConfigFromEnv(env = process.env) {
  const mode = (env.AGENT_MARKET_AUTH_MODE || 'demo').toLowerCase();
  if (!['demo', 'strict'].includes(mode)) throw new Error(`AGENT_MARKET_AUTH_MODE must be demo or strict, got ${mode}`);
  const webSecret = env.AGENT_MARKET_WEB_SECRET || '';
  if (mode === 'strict' && webSecret.length < 16) {
    throw new Error('strict 모드에서는 AGENT_MARKET_WEB_SECRET(16자 이상)이 필요합니다.');
  }
  return { mode, webSecret };
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken() {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

function secretsMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 요청에서 호출 주체를 결정한다. 실패하면 401. */
export function authenticate(request, store, config, now = new Date().toISOString()) {
  const header = request.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (bearer) {
    if (!bearer.startsWith(TOKEN_PREFIX)) throw unauthorized('Agent 토큰 형식이 올바르지 않습니다.');
    const token = store.findAgentTokenByHash(hashToken(bearer));
    if (!token) throw unauthorized('Agent 토큰을 찾을 수 없습니다.');
    if (token.revokedAt) throw unauthorized('폐기된 Agent 토큰입니다. Web에서 새 토큰을 발급받으세요.');
    if (token.expiresAt && token.expiresAt <= now) throw unauthorized('만료된 Agent 토큰입니다.');
    store.touchAgentToken(token.id, now);
    return { userId: token.userId, actorType: 'AGENT', scopes: token.scopes, tokenId: token.id, tokenName: token.name };
  }

  const userId = request.headers['x-user-id'] || (config.mode === 'demo' ? DEMO_USER_ID : '');
  const actorType = String(request.headers['x-actor-type'] || 'HUMAN').toUpperCase();
  if (!uuidPattern.test(userId) || !['HUMAN', 'AGENT'].includes(actorType)) {
    throw unauthorized('사용자 또는 호출 주체가 올바르지 않습니다.');
  }

  if (config.mode === 'strict') {
    if (actorType === 'AGENT') throw unauthorized('Agent는 Bearer 토큰으로만 접속할 수 있습니다.');
    const provided = request.headers['x-web-secret'] || '';
    if (!provided || !secretsMatch(provided, config.webSecret)) throw unauthorized('Web 서버 인증에 실패했습니다.');
    if (!store.getUser(userId)) throw unauthorized('존재하지 않는 사용자입니다.');
    return { userId, actorType: 'HUMAN', scopes: null };
  }

  store.ensureUser(userId);
  // demo 모드의 헤더 Agent는 scope 제한 없음(기존 동작 유지).
  return { userId, actorType, scopes: null };
}

/** 경로별 필요 scope. 토큰 기반 AGENT에만 적용되고 HUMAN은 제한 없음. */
export function requiredScope(method, path) {
  if (method === 'GET') return 'read';
  if (path.endsWith('/search')) return 'search';
  if (path.startsWith('/api/listing-drafts') || /^\/api\/listings\/[^/]+\/drafts$/.test(path)) return 'listing:write';
  if (path.startsWith('/api/purchase-requests')) return 'purchase:write';
  return null;
}

export function requireScope(context, scope) {
  if (!scope || context.scopes == null) return;
  if (!context.scopes.includes(scope)) {
    throw forbidden(`이 토큰에는 ${scope} 권한이 없습니다. 사용자가 Web에서 권한을 추가한 새 토큰을 발급해야 합니다.`);
  }
}

export function normalizeTokenRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('요청 본문은 JSON 객체여야 합니다.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) throw validationError('name은 1~100자 문자열이어야 합니다.', { field: 'name' });
  const scopes = body.scopes == null ? DEFAULT_SCOPES : body.scopes;
  if (!Array.isArray(scopes) || !scopes.length || scopes.some(s => !SCOPES.includes(s))) {
    throw validationError('scopes 값이 올바르지 않습니다.', { field: 'scopes', allowed: SCOPES });
  }
  let expiresAt = null;
  if (body.expiresInDays != null) {
    if (!Number.isInteger(body.expiresInDays) || body.expiresInDays < 1 || body.expiresInDays > 365) {
      throw validationError('expiresInDays는 1~365 사이 정수여야 합니다.', { field: 'expiresInDays' });
    }
    expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();
  }
  return { name, scopes: [...new Set(['read', ...scopes])], expiresAt };
}

export function issueToken(store, userId, body, now = new Date().toISOString()) {
  const { name, scopes, expiresAt } = normalizeTokenRequest(body);
  const token = generateToken();
  const record = store.createAgentToken({
    id: randomUUID(), userId, name, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 10),
    scopes, createdAt: now, expiresAt,
  });
  // 토큰 원문은 이 응답에서 한 번만 보여준다.
  return { ...record, token };
}
