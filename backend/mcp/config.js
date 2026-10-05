import { AgentMarketApi, DEFAULT_API_URL, DEFAULT_USER_ID } from './api-client.js';

/** 환경 변수를 읽어 공통 설정을 만든다. 잘못된 조합은 시작 시점에 바로 실패시킨다. */
export function configFromEnv(env = process.env) {
  const apiUrl = env.AGENT_MARKET_API_URL || DEFAULT_API_URL;
  const webUrl = env.AGENT_MARKET_WEB_URL || '';
  const timeoutMs = Number(env.AGENT_MARKET_API_TIMEOUT_MS || 15_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('AGENT_MARKET_API_TIMEOUT_MS는 양수여야 합니다.');
  try { new URL(apiUrl); } catch { throw new Error(`AGENT_MARKET_API_URL이 올바른 URL이 아닙니다: ${apiUrl}`); }
  return { apiUrl, webUrl, timeoutMs };
}

/** stdio 모드용 API 클라이언트. 토큰이 있으면 토큰, 없으면 demo userId. */
export function apiForStdio(env = process.env) {
  const { apiUrl, timeoutMs } = configFromEnv(env);
  const token = env.AGENT_MARKET_TOKEN || '';
  const userId = token ? '' : (env.AGENT_MARKET_USER_ID || DEFAULT_USER_ID);
  return new AgentMarketApi({ baseUrl: apiUrl, token, userId, timeoutMs });
}

/** 토큰으로 백엔드에 물어 사용자와 scope를 확인한다. 실패하면 ApiError. */
export async function resolveIdentity(api) {
  const me = await api.me();
  return { userId: me.userId, scopes: Array.isArray(me.scopes) ? me.scopes : null, tokenName: me.tokenName ?? null };
}
