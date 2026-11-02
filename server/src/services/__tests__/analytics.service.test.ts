// @ts-expect-error Node 22 supplies node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ getDb: vi.fn(), invoke: vi.fn(), config: { skillBridgeMode: 'trae' } }));
vi.mock('../../db', () => ({ getDb: deps.getDb }));
vi.mock('../../config', () => ({ config: deps.config }));
vi.mock('../../utils/skill-bridge', () => ({ getSkillBridge: () => ({ invoke: deps.invoke }) }));
vi.mock('../../utils/logger', () => ({ createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { getAnalytics, getAnalyticsByDateRange, getDashboardStats, trackAnalytics } from '../analytics.service';

describe('analytics provenance', () => {
  let db: Database.Database;
  beforeEach(() => {
    deps.config.skillBridgeMode = 'trae';
    deps.invoke.mockReset();
    db = new DatabaseSync(':memory:') as unknown as Database.Database;
    deps.getDb.mockReturnValue(db);
    db.exec(`
      CREATE TABLE publications (id INTEGER PRIMARY KEY, content_id INTEGER, platform TEXT, post_url TEXT, status TEXT);
      INSERT INTO publications VALUES (1, 10, 'xiaohongshu', 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567', 'published');
      CREATE TABLE analytics (id INTEGER PRIMARY KEY, publication_id INTEGER, content_id INTEGER, views INTEGER, likes INTEGER,
        comments INTEGER, shares INTEGER, collects INTEGER, engagement_rate REAL, tracked_at TEXT,
        source_type TEXT DEFAULT 'unknown', provider TEXT, source_url TEXT, source_id TEXT, available_metrics TEXT DEFAULT '[]');
      CREATE TABLE trends (id INTEGER); CREATE TABLE contents (id INTEGER); CREATE TABLE pipeline_runs (status TEXT);
    `);
  });
  afterEach(() => db.close());
  const sample = { views: 100, likes: 8, comments: 2, shares: 1, collects: 3, engagementRate: 14, trackedAt: '2026-11-01T00:00:00.000Z' };
  it('keeps simulation markers after save, reload and date-range export', async () => {
    deps.invoke.mockResolvedValue({ success: true, data: { analytics: { ...sample, isMockData: true } } });
    await trackAnalytics({ publicationId: 1 });
    expect(getAnalytics().data[0]).toMatchObject({ sourceType: 'simulated', isMockData: true });
    expect(getAnalyticsByDateRange('2026-11-01', '2026-11-02').data[0].sourceType).toBe('simulated');
    expect(getDashboardStats().totalViews).toBe(0);
  });
  it('persists observed provenance and forwards the publication URL', async () => {
    deps.invoke.mockResolvedValue({ success: true, data: { analytics: { ...sample, sourceType: 'observed', provider: 'TikHub',
      sourceUrl: 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567', sourceId: '0123456789abcdef01234567', availableMetrics: ['views', 'likes'] } } });
    await trackAnalytics({ publicationId: 1 });
    expect(deps.invoke).toHaveBeenCalledWith('creator-analytics', expect.objectContaining({ publicationUrl: expect.stringContaining('/explore/'), contentId: 10 }));
    expect(getAnalytics().data[0]).toMatchObject({ sourceType: 'observed', provider: 'TikHub', availableMetrics: ['views', 'likes'] });
    expect(getDashboardStats().totalViews).toBe(100);
  });
  it('labels legacy records unknown and excludes them from observed totals', () => {
    db.exec(`INSERT INTO analytics (publication_id, content_id, views, likes, comments, shares, collects, engagement_rate, tracked_at)
      VALUES (1,10,99999,888,0,0,0,0,'2026-11-01')`);
    expect(getAnalytics().data[0].sourceType).toBe('unknown');
    expect(getDashboardStats().totalViews).toBe(0);
  });
  it('does not trust an observed claim from mock mode', async () => {
    deps.config.skillBridgeMode = 'mock';
    deps.invoke.mockResolvedValue({ success: true, data: { analytics: { ...sample, sourceType: 'observed' } } });
    await trackAnalytics({ publicationId: 1 });
    expect(getAnalytics().data[0].sourceType).toBe('simulated');
  });
  it('includes ISO timestamps on the end date without leaking the next day', async () => {
    deps.invoke.mockResolvedValue({ success: true, data: { analytics: { ...sample, sourceType: 'observed' } } });
    await trackAnalytics({ publicationId: 1 });
    expect(getAnalyticsByDateRange('2026-11-01','2026-11-01').data).toHaveLength(1);
    expect(getAnalyticsByDateRange('2026-10-31','2026-10-31').data).toHaveLength(0);
  });
  it('rejects tracking an unpublished record before calling a provider', async () => {
    db.exec("UPDATE publications SET status='pending' WHERE id=1");
    await expect(trackAnalytics({ publicationId: 1 })).rejects.toThrow('已发布');
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});
