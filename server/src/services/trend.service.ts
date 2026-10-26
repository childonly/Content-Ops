/**
 * 趋势服务 - 趋势数据的增删改查与技能调用
 */

import { getDb } from '../db';
import { getSkillBridge } from '../utils/skill-bridge';
import { createServiceLogger } from '../utils/logger';
import { Trend, TrendDiscoveryParams, TrendDiscoveryResult } from '../types';

const log = createServiceLogger('trend-service');

// ----------------------------------------------------------------------------
// 类型映射：数据库行(snake_case) -> TS 接口(camelCase)
// ----------------------------------------------------------------------------

interface TrendRow {
  id: number;
  title: string;
  description: string | null;
  platform: string;
  category: string | null;
  heat: number;
  growth_rate: number;
  status: string;
  discovered_at: string;
  metadata: string | null;
}

function mapRow(row: TrendRow): Trend {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    platform: row.platform,
    category: row.category ?? '',
    heat: row.heat,
    growthRate: row.growth_rate,
    status: row.status as Trend['status'],
    discoveredAt: row.discovered_at,
    metadata: row.metadata ?? undefined,
  };
}

// ----------------------------------------------------------------------------
// 分页查询趋势列表
// ----------------------------------------------------------------------------

export function getTrends(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
  platform?: string,
  category?: string,
): { data: Trend[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM trends';
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (platform && platform.trim()) {
    conditions.push('platform = ?');
    params.push(platform.trim());
  }
  if (category && category.trim()) {
    conditions.push('category = ?');
    params.push(category.trim());
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY discovered_at DESC, id DESC LIMIT ? OFFSET ?';
  const rows = db.prepare(query).all(...params, pageSize, offset) as TrendRow[];
  const data = rows.map(mapRow);

  let countQuery = 'SELECT COUNT(*) AS count FROM trends';
  const countParams: Array<string | number> = [];
  const countConditions: string[] = [];

  if (status) {
    countConditions.push('status = ?');
    countParams.push(status);
  }
  if (platform && platform.trim()) {
    countConditions.push('platform = ?');
    countParams.push(platform.trim());
  }
  if (category && category.trim()) {
    countConditions.push('category = ?');
    countParams.push(category.trim());
  }

  if (countConditions.length) {
    countQuery += ' WHERE ' + countConditions.join(' AND ');
  }
  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;

  return { data, total };
}

// ----------------------------------------------------------------------------
// 根据 ID 获取趋势
// ----------------------------------------------------------------------------

export function getTrendById(id: number): Trend | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trends WHERE id = ?').get(id) as TrendRow | undefined;
  return row ? mapRow(row) : null;
}

// ----------------------------------------------------------------------------
// 发现趋势 - 调用 trend-research 技能，结果存入数据库
// ----------------------------------------------------------------------------

export async function discoverTrends(params: TrendDiscoveryParams): Promise<Trend[]> {
  const bridge = getSkillBridge();
  log.info('发现趋势', { params });

  const result = await bridge.invoke<TrendDiscoveryResult>('trend-research', params);

  if (!result.success || !result.data) {
    throw new Error(result.error || '趋势发现失败');
  }

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO trends (title, description, platform, category, heat, growth_rate, status, discovered_at, metadata)
    VALUES (@title, @description, @platform, @category, @heat, @growth_rate, @status, @discovered_at, @metadata)
  `);

  // 检查已有趋势：存在则更新热度/增长率/发现时间，不存在则插入
  const checkStmt = db.prepare('SELECT id FROM trends WHERE title = ?');
  const updateStmt = db.prepare(`
    UPDATE trends SET heat = @heat, growth_rate = @growth_rate, discovered_at = @discovered_at,
      description = @description, metadata = @metadata, status = 'new'
    WHERE id = @id
  `);

  const trends: Trend[] = [];

  const insertMany = db.transaction((items: Trend[]) => {
    for (const t of items) {
      // 已存在的同标题趋势：更新热度数据而非跳过
      const existing = checkStmt.get(t.title) as { id: number } | undefined;
      if (existing) {
        updateStmt.run({
          id: existing.id,
          heat: t.heat ?? 0,
          growth_rate: t.growthRate ?? 0,
          discovered_at: t.discoveredAt || new Date().toISOString(),
          description: t.description ?? '',
          metadata: t.metadata ?? null,
        });
        trends.push({ ...t, id: existing.id });
        continue;
      }
      const info = insert.run({
        title: t.title,
        description: t.description ?? '',
        platform: t.platform || 'xiaohongshu',
        category: t.category ?? '',
        heat: t.heat ?? 0,
        growth_rate: t.growthRate ?? 0,
        status: 'new',
        discovered_at: t.discoveredAt || new Date().toISOString(),
        metadata: t.metadata ?? null,
      });
      trends.push({ ...t, id: Number(info.lastInsertRowid), status: 'new' });
    }
  });

  insertMany(result.data.trends);
  const newCount = trends.filter(t => t.status === 'new').length;
  log.info(`趋势发现完成: ${newCount} 条新插入, ${trends.length - newCount} 条已更新 (共 ${trends.length} 条)`);

  return trends;
}

// ----------------------------------------------------------------------------
// 更新趋势状态
// ----------------------------------------------------------------------------

export function updateTrendStatus(id: number, status: Trend['status']): Trend | null {
  const db = getDb();
  const info = db.prepare('UPDATE trends SET status = ? WHERE id = ?').run(status, id);
  if (info.changes === 0) {
    return null;
  }
  log.info('更新趋势状态', { id, status });
  return getTrendById(id);
}

// ----------------------------------------------------------------------------
// 删除趋势
// ----------------------------------------------------------------------------

export function deleteTrend(id: number): boolean {
  const deleted = deleteTrends([id]);
  const info = { changes: deleted };
  if (info.changes > 0) {
    log.info('删除趋势', { id });
  }
  return info.changes > 0;
}

/** 批量删除趋势 */
export function deleteTrends(ids: number[]): number {
  if (!ids.length) return 0;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  // Detach child records before deleting trends. Both hashtags and contents
  // reference trends with a foreign key and otherwise SQLite rejects the delete.
  // Pipeline history is retained as well, but no longer points at a deleted trend.
  const work = () => {
    db.prepare(`UPDATE hashtags SET trend_id = NULL WHERE trend_id IN (${placeholders})`).run(...ids);
    db.prepare(`UPDATE contents SET trend_id = NULL WHERE trend_id IN (${placeholders})`).run(...ids);
    db.prepare(`UPDATE pipeline_runs SET trend_id = NULL WHERE trend_id IN (${placeholders})`).run(...ids);
    return db.prepare(`DELETE FROM trends WHERE id IN (${placeholders})`).run(...ids);
  };
  // better-sqlite3 exposes transaction(), while node:sqlite used by tests does
  // not. Keep the same atomic behavior for both database adapters.
  const dbWithTransaction = db as unknown as { transaction?: (fn: () => unknown) => () => unknown };
  let info: { changes: number };
  if (typeof dbWithTransaction.transaction === 'function') {
    info = dbWithTransaction.transaction.call(db, work)() as { changes: number };
  } else {
    db.exec('BEGIN');
    try {
      info = work() as { changes: number };
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  log.info(`批量删除趋势: ${info.changes}/${ids.length} 条`);
  return info.changes;
}
