/**
 * 标签服务 - 标签数据查询与技能调用
 */

import { getDb } from '../db';
import { getSkillBridge } from '../utils/skill-bridge';
import { createServiceLogger } from '../utils/logger';
import { Hashtag, HashtagResearchParams, HashtagResearchResult } from '../types';

const log = createServiceLogger('hashtag-service');

// ----------------------------------------------------------------------------
// 类型映射
// ----------------------------------------------------------------------------

interface HashtagRow {
  id: number;
  tag: string;
  platform: string;
  volume: number;
  growth_rate: number;
  related_tags: string | null;
  trend_id: number | null;
  researched_at: string;
}

function mapRow(row: HashtagRow): Hashtag {
  return {
    id: row.id,
    tag: row.tag,
    platform: row.platform,
    volume: row.volume,
    growthRate: row.growth_rate,
    relatedTags: row.related_tags ? JSON.parse(row.related_tags) : [],
    trendId: row.trend_id ?? undefined,
    researchedAt: row.researched_at,
  };
}

// ----------------------------------------------------------------------------
// 分页查询标签列表
// ----------------------------------------------------------------------------

export function getHashtags(
  page: number = 1,
  pageSize: number = 20,
  trendId?: number,
  keyword?: string,
  platform?: string,
): { data: Hashtag[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM hashtags';
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (trendId) {
    conditions.push('trend_id = ?');
    params.push(trendId);
  }
  if (keyword && keyword.trim()) {
    conditions.push('tag LIKE ?');
    params.push(`%${keyword.trim()}%`);
  }
  if (platform && platform.trim()) {
    conditions.push('platform = ?');
    params.push(platform.trim());
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY researched_at DESC, id DESC LIMIT ? OFFSET ?';
  const rows = db.prepare(query).all(...params, pageSize, offset) as HashtagRow[];
  const data = rows.map(mapRow);

  let countQuery = 'SELECT COUNT(*) AS count FROM hashtags';
  const countParams: Array<string | number> = [];
  const countConditions: string[] = [];

  if (trendId) {
    countConditions.push('trend_id = ?');
    countParams.push(trendId);
  }
  if (keyword && keyword.trim()) {
    countConditions.push('tag LIKE ?');
    countParams.push(`%${keyword.trim()}%`);
  }
  if (platform && platform.trim()) {
    countConditions.push('platform = ?');
    countParams.push(platform.trim());
  }

  if (countConditions.length) {
    countQuery += ' WHERE ' + countConditions.join(' AND ');
  }
  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;

  return { data, total };
}

/** 批量删除标签 */
export function deleteHashtags(ids: number[]): number {
  if (!ids.length) return 0;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM hashtags WHERE id IN (${placeholders})`).run(...ids);
  log.info(`批量删除标签: ${info.changes}/${ids.length} 条`);
  return info.changes;
}

// ----------------------------------------------------------------------------
// 研究标签 - 调用 hashtag-research 技能，结果存入数据库
// ----------------------------------------------------------------------------

export async function researchHashtags(params: HashtagResearchParams): Promise<Hashtag[]> {
  const bridge = getSkillBridge();
  log.info('研究标签', { params });

  const result = await bridge.invoke<HashtagResearchResult>('hashtag-research', params);

  if (!result.success || !result.data) {
    throw new Error(result.error || '标签研究失败');
  }

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO hashtags (tag, platform, volume, growth_rate, related_tags, trend_id, researched_at)
    VALUES (@tag, @platform, @volume, @growth_rate, @related_tags, @trend_id, @researched_at)
  `);

  const hashtags: Hashtag[] = [];
  const fallbackTrendId = params.trendId ?? null;

  const insertMany = db.transaction((items: Hashtag[]) => {
    for (const h of items) {
      const info = insert.run({
        tag: h.tag,
        platform: h.platform || 'xiaohongshu',
        volume: h.volume ?? 0,
        growth_rate: h.growthRate ?? 0,
        related_tags: JSON.stringify(h.relatedTags ?? []),
        trend_id: h.trendId ?? fallbackTrendId,
        researched_at: h.researchedAt || new Date().toISOString(),
      });
      hashtags.push({
        ...h,
        id: Number(info.lastInsertRowid),
        trendId: h.trendId ?? fallbackTrendId ?? undefined,
      });
    }
  });

  insertMany(result.data.hashtags);
  log.info(`研究并保存 ${hashtags.length} 条标签`);

  return hashtags;
}
