import { randomBytes } from 'node:crypto';
import { Store } from '../server/database.js';
import { provisionWebUser } from '../web/auth.js';

const [loginName, nickname, userId] = process.argv.slice(2);
if (!loginName || !nickname) {
  console.error('사용법: node scripts/create-web-user.js <로그인 이름> <표시 이름> [기존 사용자 UUID]');
  process.exit(1);
}

const store = new Store({ seed: false });
try {
  const password = randomBytes(24).toString('base64url');
  const user = await provisionWebUser(store, { loginName, nickname, password, userId });
  console.log(`로그인 이름: ${user.loginName}`);
  console.log(`사용자 ID: ${user.id}`);
  console.log(`임시 비밀번호(이번에만 표시): ${password}`);
  console.log('비밀번호를 안전하게 전달하고, 운영 화면을 노출하기 전 HTTPS를 설정하세요.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { store.close(); }
