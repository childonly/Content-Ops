/**
 * 分析服务 - 效果追踪与仪表盘统计
 */

import { getDb } from '../db';
import { getSkillBridge } from '../utils/skill-bridge';
import { createServiceLogger } from '../utils/logger';
import {
  AnalyticsRecord,
  AnalyticsTrackParams,
  AnalyticsTrackResult,
  DashboardStats,
} from '../types';

const log = createServiceLogger('analytics-service');

// ----------------------------------------------------------------------------
// 类型映射
// ----------------------------------------------------------------------------

interface AnalyticsRow {
  id: number;
  publication_id: number;
  content_id: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collects: number;
  engagement_rate: number;
  tracked_at: string;
}

function mapRow(row: AnalyticsRow): AnalyticsRecord {
  return {
    id: row.id,
    publicationId: row.publication_id,
    contentId: row.content_id,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    collects: row.collects,
    engagementRate: row.engagement_rate,
    trackedAt: row.tracked_at,
  };
}

// ----------------------------------------------------------------------------
// 分页查询分析数据
// ----------------------------------------------------------------------------

export function getAnalytics(
  page: number = 1,
  pageSize: number = 20,
  publicationId?: number,
): { data: AnalyticsRecord[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM analytics';
  const params: Array<string | number> = [];

  if (publicationId) {
    query += ' WHERE publication_id = ?';
    params.push(publicationId);
  }

  query += ' ORDER BY tracked_at DESC, id DESC LIMIT ? OFFSET ?';
  const rows = db.prepare(query).all(...params, pageSize, offset) as AnalyticsRow[];
  const data = rows.map(mapRow);

  let countQuery = 'SELECT COUNT(*) AS count FROM analytics';
  const countParams: Array<string | number> = [];
  if (publicationId) {
    countQuery += ' WHERE publication_id = ?';
    countParams.push(publicationId);
  }
  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;

  return { data, total };
}

// ----------------------------------------------------------------------------
// 追踪效果 - 调用 creator-analytics 技能，结果存入数据库
// ----------------------------------------------------------------------------

export async function trackAnalytics(params: AnalyticsTrackParams): Promise<AnalyticsRecord> {
  const bridge = getSkillBridge();
  log.info('追踪效果', { params });

  const db = getDb();

  // 通过发布记录获取 content_id
  const pub = db.prepare('SELECT content_id FROM publications WHERE id = ?').get(
    params.publicationId,
  ) as { content_id: number } | undefined;

  if (!pub) {
    throw new Error(`发布记录不存在: ${params.publicationId}`);
  }

  const result = await bridge.invoke<AnalyticsTrackResult>('creator-analytics', {
    ...params,
    contentId: pub.content_id,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error || '效果追踪失败');
  }

  const analytics = result.data.analytics;

  const info = db.prepare(`
    INSERT INTO analytics (publication_id, content_id, views, likes, comments, shares, collects, engagement_rate, tracked_at)
    VALUES (@publication_id, @content_id, @views, @likes, @comments, @shares, @collects, @engagement_rate, @tracked_at)
  `).run({
    publication_id: params.publicationId,
    content_id: pub.content_id,
    views: analytics.views ?? 0,
    likes: analytics.likes ?? 0,
    comments: analytics.comments ?? 0,
    shares: analytics.shares ?? 0,
    collects: analytics.collects ?? 0,
    engagement_rate: analytics.engagementRate ?? 0,
    tracked_at: analytics.trackedAt || new Date().toISOString(),
  });

  const saved: AnalyticsRecord = {
    ...analytics,
    id: Number(info.lastInsertRowid),
    publicationId: params.publicationId,
    contentId: pub.content_id,
  };

  log.info('效果追踪完成', { id: saved.id, publicationId: params.publicationId });
  return saved;
}

// ----------------------------------------------------------------------------
// 仪表盘统计汇总
// ----------------------------------------------------------------------------

export function getDashboardStats(): DashboardStats {
  const db = getDb();

  const totalTrends = (db.prepare('SELECT COUNT(*) AS count FROM trends').get() as { count: number })
    .count;
  const totalContents = (db.prepare('SELECT COUNT(*) AS count FROM contents').get() as {
    count: number;
  }).count;
  const totalPublications = (db.prepare("SELECT COUNT(*) AS count FROM publications WHERE status = 'published'").get() as {
    count: number;
  }).count;

  const agg = db
    .prepare(
      `SELECT COALESCE(SUM(views), 0) AS total_views,
              COALESCE(SUM(likes), 0) AS total_likes,
              COALESCE(AVG(engagement_rate), 0) AS avg_rate
       FROM analytics`,
    )
    .get() as { total_views: number; total_likes: number; avg_rate: number };

  const activePipelines = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM pipeline_runs WHERE status IN ('pending', 'running', 'paused')`,
      )
      .get() as { count: number }
  ).count;
  const completedPipelines = (
    db.prepare(`SELECT COUNT(*) AS count FROM pipeline_runs WHERE status = 'completed'`).get() as {
      count: number;
    }
  ).count;

  return {
    totalTrends,
    totalContents,
    totalPublications,
    totalViews: agg.total_views,
    totalLikes: agg.total_likes,
    avgEngagementRate: parseFloat(agg.avg_rate.toFixed(2)),
    activePipelines,
    completedPipelines,
  };
}

// ----------------------------------------------------------------------------
// 删除分析记录
// ----------------------------------------------------------------------------

export function deleteAnalytics(id: number): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM analytics WHERE id = ?').run(id);
  if (info.changes > 0) {
    log.info('删除分析记录', { id });
  }
  return info.changes > 0;
}

// ----------------------------------------------------------------------------
// 按日期范围查询分析数据
// ----------------------------------------------------------------------------

export function getAnalyticsByDateRange(
  startDate: string,
  endDate: string,
): { data: AnalyticsRecord[]; total: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM analytics
       WHERE tracked_at >= ? AND tracked_at <= ?
       ORDER BY tracked_at DESC, id DESC`,
    )
    .all(startDate, endDate + ' 23:59:59') as AnalyticsRow[];
  const data = rows.map(mapRow);
  return { data, total: data.length };
}
