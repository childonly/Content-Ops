import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupSqliteDatabase, addAnalyticsProvenance } from '../../db/safety';
const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe('migration safety', () => {
  it('backs up committed WAL contents and restores the copy in isolation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coh-backup-test-')); roots.push(dir);
    const db = new Database(path.join(dir, 'original.db'));
    db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
    db.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, text TEXT); INSERT INTO records VALUES (1,'retained')");
    const backup = path.join(dir, 'snapshot.db'); backupSqliteDatabase(db, backup);
    const restored = new Database(backup, { readonly: true });
    expect(restored.prepare('SELECT text FROM records WHERE id=1').get()).toEqual({ text: 'retained' });
    expect(restored.pragma('quick_check', { simple: true })).toBe('ok'); restored.close(); db.close();
  });
  it('fails closed if a backup cannot be created', () => {
    const db = new Database(':memory:');
    expect(() => backupSqliteDatabase(db, path.join(os.tmpdir(), 'nonexistent-parent-coh', 'backup.db'))).toThrow(); db.close();
  });
  it('adds provenance idempotently and keeps legacy rows unknown', () => {
    const db = new Database(':memory:'); db.exec('CREATE TABLE analytics(id INTEGER PRIMARY KEY, views INTEGER); INSERT INTO analytics VALUES(7,23)');
    addAnalyticsProvenance(db); addAnalyticsProvenance(db);
    expect(db.prepare('SELECT id, views, source_type FROM analytics').get()).toEqual({ id: 7, views: 23, source_type: 'unknown' }); db.close();
  });
});
