import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/database.js';
import { createBackup } from '../scripts/backup-db.js';

test('WAL DB를 서비스 연결 중 일관된 별도 파일로 백업한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-market-backup-'));
  const path = join(dir, 'market.sqlite');
  const store = new Store({ dbPath: path, seed: false });
  try {
    store.ensureUser('00000000-0000-4000-8000-000000000099');
    const { destination, bytes } = createBackup(path, join(dir, 'backups'));
    assert.ok(bytes > 0);
    assert.equal(statSync(destination).mode & 0o777, 0o600);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try { assert.ok(copy.prepare('SELECT id FROM users WHERE id = ?').get('00000000-0000-4000-8000-000000000099')); }
    finally { copy.close(); }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
