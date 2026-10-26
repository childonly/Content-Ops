// @ts-expect-error @types/node@20 does not declare the Node 22 node:sqlite module.
import { DatabaseSync } from 'node:sqlite';
import type Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const getDb = vi.hoisted(() => vi.fn());

vi.mock('../../db', () => ({ getDb }));
vi.mock('../../utils/skill-bridge', () => ({ getSkillBridge: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { deleteTrend, deleteTrends } from '../trend.service';

describe('trend.service deletion', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new DatabaseSync(':memory:') as unknown as Database.Database;
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
      CREATE TABLE trends (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE hashtags (
        id INTEGER PRIMARY KEY,
        trend_id INTEGER,
        FOREIGN KEY (trend_id) REFERENCES trends(id)
      );
      CREATE TABLE contents (
        id INTEGER PRIMARY KEY,
        trend_id INTEGER,
        FOREIGN KEY (trend_id) REFERENCES trends(id)
      );
      CREATE TABLE pipeline_runs (id INTEGER PRIMARY KEY, trend_id INTEGER);
      INSERT INTO trends (id, title) VALUES (1, 'trend one'), (2, 'trend two');
      INSERT INTO hashtags (id, trend_id) VALUES (11, 1);
      INSERT INTO contents (id, trend_id) VALUES (21, 1);
      INSERT INTO pipeline_runs (id, trend_id) VALUES (31, 1);
    `);
    getDb.mockReturnValue(db);
  });

  afterEach(() => db.close());

  it('detaches dependent rows before deleting a trend', () => {
    expect(deleteTrends([1])).toBe(1);
    expect(db.prepare('SELECT id FROM trends WHERE id = 1').get()).toBeUndefined();
    expect(db.prepare('SELECT trend_id FROM hashtags WHERE id = 11').get()).toEqual({ trend_id: null });
    expect(db.prepare('SELECT trend_id FROM contents WHERE id = 21').get()).toEqual({ trend_id: null });
    expect(db.prepare('SELECT trend_id FROM pipeline_runs WHERE id = 31').get()).toEqual({ trend_id: null });
  });

  it('uses the same safe path for single deletion', () => {
    expect(deleteTrend(1)).toBe(true);
    expect(db.prepare('SELECT id FROM trends WHERE id = 1').get()).toBeUndefined();
  });
});
