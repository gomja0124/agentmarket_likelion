import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/database.js';
import { csrfToken, hashPassword, newRecoveryCode, newSessionToken, normalizeLoginName, provisionWebUser,
  recoveryCodeHash, safeEqual, sessionHash, verifyPassword } from './auth.js';

const defaultFrontendDir = fileURLToPath(new URL('../../frontend/', import.meta.url));
const maxBodyBytes = 1_500_000;
const sessionSeconds = 12 * 60 * 60;
const loginWindowMs = 10 * 60 * 1000;
const loginLimit = 6;

const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
};
const error = (response, status, code, message) => json(response, status, { code, message });

function cookieValue(header, name) {
  const found = String(header || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return found.length === 1 ? found[0].slice(name.length + 1) : '';
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('요청 본문이 너무 큽니다.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function webConfig(options) {
  const origin = options.origin || process.env.AGENT_MARKET_WEB_URL;
  const apiUrl = options.apiUrl || process.env.AGENT_MARKET_API_URL || 'http://127.0.0.1:8080';
  const webSecret = options.webSecret || process.env.AGENT_MARKET_WEB_SECRET || '';
  if (!origin || new URL(origin).origin !== origin.replace(/\/$/, '')) throw new Error('AGENT_MARKET_WEB_URL은 공개 Web origin이어야 합니다.');
  if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    throw new Error('Web URL은 HTTPS여야 합니다. HTTP는 로컬호스트에서만 허용합니다.');
  }
  if (webSecret.length < 16) throw new Error('AGENT_MARKET_WEB_SECRET은 16자 이상이어야 합니다.');
  if (!/^https?:$/.test(new URL(apiUrl).protocol)) throw new Error('API URL이 올바르지 않습니다.');
  return { origin: origin.replace(/\/$/, ''), apiUrl, webSecret,
    cookieName: origin.startsWith('https://') ? '__Host-am-session' : 'am-session-dev',
    secureCookie: origin.startsWith('https://') };
}

export function createWebServer(options = {}) {
  const config = webConfig(options);
  const store = options.store || new Store({ dbPath: options.dbPath, seed: options.seed ?? true });
  const frontendDir = resolve(options.frontendDir || defaultFrontendDir);
  const attempts = new Map();
  let activeLogins = 0;
  let activeRegistrations = 0;

  const sessionFor = request => {
    const token = cookieValue(request.headers.cookie, config.cookieName);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = store.getWebSession(sessionHash(token), new Date().toISOString());
    return session ? { ...session, token } : null;
  };
  const setCookie = (response, token, maxAge = sessionSeconds) => {
    response.setHeader('Set-Cookie', `${config.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secureCookie ? '; Secure' : ''}`);
  };
  const validOrigin = request => request.headers.origin === config.origin;
  const validCsrf = (request, session) => safeEqual(request.headers['x-csrf-token'], csrfToken(config.webSecret, session.token));
  const rateLimited = (key, limit = loginLimit) => {
    const now = Date.now();
    const record = attempts.get(key);
    if (!record || now - record.start > loginWindowMs) { attempts.set(key, { start: now, count: 1 }); return false; }
    record.count += 1;
    return record.count > limit;
  };
  const createSession = (response, user, extra = {}) => {
    const token = newSessionToken();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + sessionSeconds * 1000).toISOString();
    store.purgeExpiredWebSessions(createdAt);
    store.saveWebSession({ sessionHash: sessionHash(token), userId: user.id, createdAt, expiresAt });
    setCookie(response, token);
    json(response, 200, { authenticated: true, userId: user.id, nickname: user.nickname,
      csrfToken: csrfToken(config.webSecret, token), ...extra });
  };

  const serveFile = async (response, relative, contentType) => {
    try {
      const body = await readFile(resolve(frontendDir, relative));
      response.writeHead(200, { 'Content-Type': contentType }); response.end(body);
    } catch { error(response, 404, 'NOT_FOUND', '파일을 찾을 수 없습니다.'); }
  };

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (config.secureCookie) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(request.url, config.origin);
      const path = url.pathname;
      const method = request.method;
      const session = sessionFor(request);
      if (method === 'GET' && path === '/healthz') { json(response, 200, { status: 'ok' }); return; }
      if (method === 'GET' && path === '/web/session') {
        json(response, 200, session ? { authenticated: true, userId: session.userId, nickname: session.nickname,
          csrfToken: csrfToken(config.webSecret, session.token) } : { authenticated: false }); return;
      }
      if (method === 'POST' && path === '/web/register') {
        if (!validOrigin(request)) { error(response, 403, 'BAD_ORIGIN', '허용되지 않은 요청 출처입니다.'); return; }
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
          error(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 허용합니다.'); return;
        }
        if (activeRegistrations >= 4) { error(response, 429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.'); return; }
        const ip = request.socket.remoteAddress || 'unknown';
        if (rateLimited(`register:ip:${ip}`, 20)) {
          error(response, 429, 'RATE_LIMITED', '가입 시도가 많습니다. 10분 뒤 다시 시도해 주세요.'); return;
        }
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          error(response, 400, 'INVALID_REGISTRATION', '가입 정보를 확인해 주세요.'); return;
        }
        let loginName;
        try { loginName = normalizeLoginName(body.loginName); }
        catch (cause) { error(response, 400, 'INVALID_REGISTRATION', cause.message); return; }
        if (store.getWebCredential(loginName)) {
          error(response, 409, 'LOGIN_NAME_TAKEN', '이미 사용 중인 로그인 이름입니다.'); return;
        }
        activeRegistrations += 1;
        try {
          const user = await provisionWebUser(store, { loginName, nickname: body.nickname, password: body.password });
          const recoveryCode = newRecoveryCode();
          store.saveRecoveryCode(user.id, recoveryCodeHash(recoveryCode), new Date().toISOString());
          createSession(response, { id: user.id, nickname: user.nickname }, { recoveryCode });
        } catch (cause) {
          if (String(cause.message).includes('UNIQUE constraint failed: web_credentials.login_name')) {
            error(response, 409, 'LOGIN_NAME_TAKEN', '이미 사용 중인 로그인 이름입니다.');
          } else if (/^(표시 이름은|비밀번호는)/.test(String(cause.message))) {
            error(response, 400, 'INVALID_REGISTRATION', cause.message);
          } else { throw cause; }
        } finally { activeRegistrations -= 1; }
        return;
      }
      if (method === 'POST' && path === '/web/login') {
        if (!validOrigin(request)) { error(response, 403, 'BAD_ORIGIN', '허용되지 않은 요청 출처입니다.'); return; }
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) { error(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 허용합니다.'); return; }
        if (activeLogins >= 4) { error(response, 429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.'); return; }
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        let loginName;
        try { loginName = normalizeLoginName(body.loginName); }
        catch { loginName = ''; }
        const ip = request.socket.remoteAddress || 'unknown';
        if (rateLimited(`ip:${ip}`) || rateLimited(`user:${loginName}`)) {
          error(response, 429, 'RATE_LIMITED', '로그인 시도가 많습니다. 10분 뒤 다시 시도해 주세요.'); return;
        }
        activeLogins += 1;
        try {
          const credential = loginName ? store.getWebCredential(loginName) : null;
          if (!await verifyPassword(body.password, credential?.passwordHash)) {
            error(response, 401, 'INVALID_CREDENTIALS', '로그인 이름 또는 비밀번호가 올바르지 않습니다.'); return;
          }
          attempts.delete(`ip:${ip}`); attempts.delete(`user:${loginName}`);
          createSession(response, { id: credential.userId, nickname: credential.nickname }); return;
        } finally { activeLogins -= 1; }
      }
      if (method === 'POST' && path === '/web/logout') {
        if (!session) { error(response, 401, 'UNAUTHORIZED', '로그인이 필요합니다.'); return; }
        if (!validOrigin(request) || !validCsrf(request, session)) { error(response, 403, 'CSRF', '요청을 확인할 수 없습니다.'); return; }
        store.deleteWebSession(session.sessionHash);
        setCookie(response, '', 0);
        json(response, 200, { authenticated: false }); return;
      }
      if (method === 'POST' && path === '/web/recovery-code') {
        if (!session) { error(response, 401, 'UNAUTHORIZED', '로그인이 필요합니다.'); return; }
        if (!validOrigin(request) || !validCsrf(request, session)) { error(response, 403, 'CSRF', '요청을 확인할 수 없습니다.'); return; }
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
          error(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 허용합니다.'); return;
        }
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          error(response, 400, 'INVALID_RECOVERY', '요청을 확인해 주세요.'); return;
        }
        const ip = request.socket.remoteAddress || 'unknown';
        if (rateLimited(`recovery-issue:${session.userId}:${ip}`, 6)) {
          error(response, 429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.'); return;
        }
        const credential = store.getWebCredentialByUser(session.userId);
        if (!await verifyPassword(body.password, credential?.passwordHash)) {
          error(response, 401, 'INVALID_CREDENTIALS', '현재 비밀번호가 올바르지 않습니다.'); return;
        }
        const recoveryCode = newRecoveryCode();
        store.saveRecoveryCode(session.userId, recoveryCodeHash(recoveryCode), new Date().toISOString());
        json(response, 200, { recoveryCode }); return;
      }
      if (method === 'POST' && path === '/web/reset-password') {
        if (!validOrigin(request)) { error(response, 403, 'BAD_ORIGIN', '허용되지 않은 요청 출처입니다.'); return; }
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
          error(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 허용합니다.'); return;
        }
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          error(response, 400, 'INVALID_RECOVERY', '요청을 확인해 주세요.'); return;
        }
        let loginName;
        try { loginName = normalizeLoginName(body.loginName); } catch { loginName = ''; }
        const ip = request.socket.remoteAddress || 'unknown';
        const ipLimited = rateLimited(`reset:ip:${ip}`, 10);
        const userLimited = rateLimited(`reset:user:${loginName}`, 6);
        if (ipLimited || userLimited) { error(response, 429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.'); return; }
        const credential = loginName ? store.getWebCredential(loginName) : null;
        const actual = recoveryCodeHash(body.recoveryCode || '');
        if (!credential || !safeEqual(actual, store.getRecoveryCode(credential.userId) || '0'.repeat(64))) {
          error(response, 401, 'INVALID_RECOVERY', '로그인 이름 또는 복구 코드가 올바르지 않습니다.'); return;
        }
        let passwordHash;
        try { passwordHash = await hashPassword(body.newPassword); }
        catch (cause) { error(response, 400, 'INVALID_PASSWORD', cause.message); return; }
        store.resetWebPassword(credential.userId, passwordHash, new Date().toISOString());
        json(response, 200, { reset: true, message: '비밀번호가 변경되었습니다. 기존 로그인과 Agent 토큰은 모두 종료됩니다.' }); return;
      }
      if (path.startsWith('/api/')) {
        if (!session) { error(response, 401, 'UNAUTHORIZED', '로그인이 필요합니다.'); return; }
        if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) { error(response, 405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.'); return; }
        if (method !== 'GET' && (!validOrigin(request) || !validCsrf(request, session))) {
          error(response, 403, 'CSRF', '요청을 확인할 수 없습니다.'); return;
        }
        const body = method === 'GET' ? undefined : await readBody(request);
        const headers = { 'X-User-Id': session.userId, 'X-Actor-Type': 'HUMAN', 'X-Web-Secret': config.webSecret,
          'Content-Type': request.headers['content-type'] || 'application/json' };
        if (request.headers['idempotency-key']) headers['Idempotency-Key'] = request.headers['idempotency-key'];
        const upstream = await fetch(new URL(path + url.search, config.apiUrl), {
          method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15_000),
        });
        const payload = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
        response.end(payload); return;
      }
      if (method !== 'GET') { error(response, 405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.'); return; }
      if (path === '/sell' || path === '/sell/') {
        if (session) { response.writeHead(302, { Location: '/#sell' }); response.end(); return; }
        await serveFile(response, 'seller.html', 'text/html; charset=utf-8'); return;
      }
      if (path === '/login') {
        if (session) { response.writeHead(302, { Location: '/' }); response.end(); return; }
        await serveFile(response, 'login.html', 'text/html; charset=utf-8'); return;
      }
      if (path === '/register') {
        if (session) { response.writeHead(302, { Location: '/' }); response.end(); return; }
        await serveFile(response, 'register.html', 'text/html; charset=utf-8'); return;
      }
      if (path === '/recover') { await serveFile(response, 'recover.html', 'text/html; charset=utf-8'); return; }
      if (path === '/account') {
        if (!session) { response.writeHead(302, { Location: '/login' }); response.end(); return; }
        await serveFile(response, 'account.html', 'text/html; charset=utf-8'); return;
      }
      if (path === '/') {
        await serveFile(response, session ? 'index.html' : 'landing.html', 'text/html; charset=utf-8'); return;
      }
      if (path === '/index.html') {
        if (!session) { response.writeHead(302, { Location: '/login' }); response.end(); return; }
        await serveFile(response, 'index.html', 'text/html; charset=utf-8'); return;
      }
      if (path === '/config.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        response.end("window.AGENT_MARKET_API_BASE = ''; window.AGENT_MARKET_WEB_AUTH = true;"); return;
      }
      if (/^\/src\/[a-z0-9-]+\.js$/.test(path)) { await serveFile(response, path.slice(1), 'text/javascript; charset=utf-8'); return; }
      if (path === '/src/styles.css') { await serveFile(response, 'src/styles.css', 'text/css; charset=utf-8'); return; }
      if (path === '/src/landing.css') { await serveFile(response, 'src/landing.css', 'text/css; charset=utf-8'); return; }
      error(response, 404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
    } catch (cause) {
      if (cause instanceof SyntaxError) error(response, 400, 'INVALID_JSON', 'JSON 요청을 확인해 주세요.');
      else if (cause.status === 413) error(response, 413, 'PAYLOAD_TOO_LARGE', cause.message);
      else error(response, 502, 'WEB_GATEWAY_ERROR', '서버 요청을 처리하지 못했습니다.');
    }
  });
  server.store = store;
  return server;
}
