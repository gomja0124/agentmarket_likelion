import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummySalt = Buffer.alloc(24, 0);
const dummyHash = Buffer.alloc(32, 0);

export function normalizeLoginName(value) {
  const login = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9._@-]{3,120}$/.test(login)) throw new Error('로그인 이름은 영문 소문자·숫자·._@- 조합 3~120자로 입력해 주세요.');
  return login;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error('비밀번호는 12자 이상, 1024바이트 이하로 입력해 주세요.');
  }
  const salt = randomBytes(24);
  const hash = await derive(password, salt, 32, options);
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024) return false;
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 6 && parts[0] === 'scrypt' && Number(parts[1]) === options.N &&
    Number(parts[2]) === options.r && Number(parts[3]) === options.p;
  const salt = valid ? Buffer.from(parts[4], 'base64url') : dummySalt;
  const expected = valid ? Buffer.from(parts[5], 'base64url') : dummyHash;
  const actual = await derive(password, salt, 32, options);
  return valid && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sessionHash(token) { return createHash('sha256').update(token).digest('hex'); }
export function csrfToken(secret, token) { return createHmac('sha256', secret).update(`csrf:${token}`).digest('base64url'); }
export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function newSessionToken() { return randomBytes(32).toString('base64url'); }
export function newRecoveryCode() { return `amr_${randomBytes(32).toString('base64url')}`; }
export function recoveryCodeHash(code) { return createHash('sha256').update(String(code)).digest('hex'); }

export async function provisionWebUser(store, { loginName, nickname, password, userId } = {}) {
  const login = normalizeLoginName(loginName);
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  if (!name || name.length > 80) throw new Error('표시 이름은 1~80자로 입력해 주세요.');
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  if (userId) {
    store.setWebCredential({ userId, loginName: login, passwordHash, now });
    return { id: userId, loginName: login, nickname: store.getUser(userId).nickname };
  }
  return store.createWebUser({ id: randomUUID(), loginName: login, nickname: name, passwordHash, now });
}
