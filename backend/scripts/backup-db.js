import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, chmodSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function createBackup(source, destinationDirectory) {
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath)) throw new Error('원본 DB 파일을 찾을 수 없습니다.');
  const backupDir = resolve(destinationDirectory);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = join(backupDir, `agent-market-${stamp}-${randomBytes(4).toString('hex')}.sqlite`);
  const previousUmask = process.umask(0o077);
  try {
    const db = new DatabaseSync(sourcePath, { readOnly: true });
    try { db.prepare('VACUUM INTO ?').run(destination); }
    finally { db.close(); }
    chmodSync(destination, 0o600);
    const verify = new DatabaseSync(destination, { readOnly: true });
    try {
      if (verify.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('백업 무결성 검사에 실패했습니다.');
    } finally { verify.close(); }
    return { destination, bytes: statSync(destination).size };
  } catch (error) {
    if (existsSync(destination)) unlinkSync(destination);
    throw error;
  } finally { process.umask(previousUmask); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const source = process.env.AGENT_MARKET_DB_PATH || '.local/agent-market.sqlite';
    const destinationDir = process.argv[2] || '/data/backups';
    const result = createBackup(source, destinationDir);
    console.log(`백업 완료: ${result.destination} (${result.bytes} bytes)`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
