/**
 * Pipeline 服务 - 核心编排服务，串联整个内容运营闭环
 *
 * 阶段流转：
 *   TREND_DISCOVERY -> HASHTAG_RESEARCH -> CONTENT_GENERATION
 *   -> PUBLISHING -> PERFORMANCE_TRACKING -> ITERATION
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import {
  PipelineStage,
  PipelineStatus,
  StageStatus,
  PipelineRun,
  PipelineStageRecord,
  SkillParams,
} from '../types';
import { discoverTrends } from './trend.service';
import { researchHashtags } from './hashtag.service';
import { generateContent } from './content.service';
import { publishContent } from './publish.service';
import { trackAnalytics } from './analytics.service';

const log = createServiceLogger('pipeline-service');

// 阶段顺序
const STAGE_ORDER: PipelineStage[] = [
  PipelineStage.TREND_DISCOVERY,
  PipelineStage.HASHTAG_RESEARCH,
  PipelineStage.CONTENT_GENERATION,
  PipelineStage.PUBLISHING,
  PipelineStage.PERFORMANCE_TRACKING,
  PipelineStage.ITERATION,
];

// startPipeline 可选参数
export interface StartPipelineParams {
  /** 已有趋势 ID，传入后跳过趋势发现阶段 */
  trendId?: number;
  platform?: string;
  category?: string;
  limit?: number;
  keyword?: string;
}

// ----------------------------------------------------------------------------
// 类型映射
// ----------------------------------------------------------------------------

interface PipelineRunRow {
  id: number;
  status: string;
  current_stage: string;
  trend_id: number | null;
  hashtag_ids: string | null;
  content_id: number | null;
  publication_id: number | null;
  analytics_id: number | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  keyword: string | null;
  pipeline_type: string | null;
}

interface PipelineStageRow {
  id: number;
  run_id: number;
  stage: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error_message: string | null;
}

function mapStageRow(row: PipelineStageRow): PipelineStageRecord {
  return {
    stage: row.stage as PipelineStage,
    status: row.status as StageStatus,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    result: row.result ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function mapRunRow(row: PipelineRunRow, stages: PipelineStageRecord[] = []): PipelineRun {
  return {
    id: row.id,
    status: row.status as PipelineStatus,
    currentStage: row.current_stage as PipelineStage,
    trendId: row.trend_id ?? undefined,
    hashtagIds: row.hashtag_ids ?? undefined,
    contentId: row.content_id ?? undefined,
    publicationId: row.publication_id ?? undefined,
    analyticsId: row.analytics_id ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    keyword: row.keyword ?? undefined,
    pipelineType: row.pipeline_type ?? undefined,
    stages,
  };
}

function getStagesByRunId(runId: number): PipelineStageRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM pipeline_stages WHERE run_id = ? ORDER BY id ASC')
    .all(runId) as PipelineStageRow[];
  return rows.map(mapStageRow);
}

// ----------------------------------------------------------------------------
// 查询 Pipeline 运行记录
// ----------------------------------------------------------------------------

export function getPipelineRuns(
  page: number = 1,
  pageSize: number = 20,
): { data: PipelineRun[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare('SELECT * FROM pipeline_runs ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(pageSize, offset) as PipelineRunRow[];

  // 批量查询所有 stages，避免 N+1 查询
  const runIds = rows.map(r => r.id);
  let stagesByRunId: Map<number, PipelineStageRecord[]> = new Map();
  if (runIds.length > 0) {
    const placeholders = runIds.map(() => '?').join(',');
    const stageRows = db
      .prepare(`SELECT * FROM pipeline_stages WHERE run_id IN (${placeholders}) ORDER BY id ASC`)
      .all(...runIds) as PipelineStageRow[];
    for (const sr of stageRows) {
      const mapped = mapStageRow(sr);
      if (!stagesByRunId.has(sr.run_id)) {
        stagesByRunId.set(sr.run_id, []);
      }
      stagesByRunId.get(sr.run_id)!.push(mapped);
    }
  }
  const data = rows.map((row) => mapRunRow(row, stagesByRunId.get(row.id) || []));

  const total = (db.prepare('SELECT COUNT(*) AS count FROM pipeline_runs').get() as {
    count: number;
  }).count;

  return { data, total };
}

// ----------------------------------------------------------------------------
// 获取单次运行详情（含阶段记录）
// ----------------------------------------------------------------------------

export function getPipelineRunById(id: number): PipelineRun | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id) as
    | PipelineRunRow
    | undefined;
  if (!row) {
    return null;
  }
  return mapRunRow(row, getStagesByRunId(id));
}

// ----------------------------------------------------------------------------
// 启动新的 Pipeline 运行
// ----------------------------------------------------------------------------

export function startPipeline(params?: StartPipelineParams): PipelineRun {
  const db = getDb();
  log.info('启动 Pipeline', { params });

  const hasExistingTrend = !!params?.trendId;
  const initialStage = hasExistingTrend
    ? PipelineStage.HASHTAG_RESEARCH
    : PipelineStage.TREND_DISCOVERY;

  // 创建运行记录
  const info = db
    .prepare(
      `INSERT INTO pipeline_runs (status, current_stage, trend_id, keyword, started_at)
       VALUES (@status, @current_stage, @trend_id, @keyword, datetime('now'))`,
    )
    .run({
      status: PipelineStatus.RUNNING,
      current_stage: initialStage,
      trend_id: hasExistingTrend ? params!.trendId : null,
      keyword: params?.keyword?.trim() || null,
    });

  const runId = Number(info.lastInsertRowid);

  // 创建全部阶段记录
  const insertStage = db.prepare(
    'INSERT INTO pipeline_stages (run_id, stage, status) VALUES (?, ?, ?)',
  );
  const insertStages = db.transaction(() => {
    for (const stage of STAGE_ORDER) {
      if (hasExistingTrend && stage === PipelineStage.TREND_DISCOVERY) {
        // 跳过趋势发现阶段
        insertStage.run(
          runId,
          stage,
          StageStatus.SKIPPED,
        );
        // 补充 result 说明
        db.prepare(
          `UPDATE pipeline_stages SET result = ?, completed_at = datetime('now') WHERE run_id = ? AND stage = ?`,
        ).run(`使用已有趋势 trendId=${params!.trendId}`, runId, stage);
      } else {
        insertStage.run(runId, stage, StageStatus.PENDING);
      }
    }
  });
  insertStages();

  log.info('Pipeline 已创建', { runId, initialStage });
  return getPipelineRunById(runId)!;
}

// ----------------------------------------------------------------------------
// 阶段上下文：在阶段间传递产出
// ----------------------------------------------------------------------------

interface StageContext {
  trendId: number | null;
  hashtagIds: string | null;
  contentId: number | null;
  publicationId: number | null;
  analyticsId: number | null;
  resultStr: string;
}

// ----------------------------------------------------------------------------
// 阶段处理器：每个阶段一个独立函数（策略模式）
// ----------------------------------------------------------------------------

async function handleTrendDiscovery(ctx: StageContext): Promise<void> {
  const trends = await discoverTrends({ platform: 'xiaohongshu', limit: 5 });
  if (trends.length === 0) {
    throw new Error('未发现任何趋势');
  }
  ctx.trendId = trends[0].id;
  ctx.resultStr = `发现 ${trends.length} 条趋势，选用 trendId=${ctx.trendId}`;
}

async function handleHashtagResearch(ctx: StageContext): Promise<void> {
  const db = getDb();
  let keyword = '热门';
  if (ctx.trendId) {
    const trend = db.prepare('SELECT title FROM trends WHERE id = ?').get(ctx.trendId) as
      | { title: string }
      | undefined;
    if (trend) {
      keyword = trend.title;
    }
  }
  const hashtags = await researchHashtags({
    keyword,
    trendId: ctx.trendId ?? undefined,
  });
  ctx.hashtagIds = hashtags.map((h) => h.id).join(',');
  ctx.resultStr = `研究 ${hashtags.length} 条标签，IDs=${ctx.hashtagIds}`;
}

async function handleContentGeneration(ctx: StageContext): Promise<void> {
  const content = await generateContent({
    trendId: ctx.trendId ?? undefined,
    hashtagIds: ctx.hashtagIds
      ? ctx.hashtagIds.split(',').map(Number).filter((n) => !Number.isNaN(n))
      : undefined,
  });
  ctx.contentId = content.id;
  ctx.resultStr = `生成内容 contentId=${ctx.contentId}`;
}

async function handlePublishing(ctx: StageContext): Promise<void> {
  if (!ctx.contentId) {
    throw new Error('缺少 contentId，无法执行发布');
  }
  const publication = await publishContent({
    contentId: ctx.contentId,
    platform: 'xiaohongshu',
  });
  ctx.publicationId = publication.id;
  ctx.resultStr = `发布成功 publicationId=${ctx.publicationId}`;
}

async function handlePerformanceTracking(ctx: StageContext): Promise<void> {
  if (!ctx.publicationId) {
    throw new Error('缺少 publicationId，无法追踪效果');
  }
  const analytics = await trackAnalytics({ publicationId: ctx.publicationId });
  ctx.analyticsId = analytics.id;
  ctx.resultStr = `追踪完成 analyticsId=${ctx.analyticsId}`;
}

function handleIteration(ctx: StageContext): void {
  ctx.resultStr = '迭代优化阶段完成，Pipeline 闭环结束';
}

/** 阶段处理器映射表 */
const STAGE_HANDLERS: Record<
  PipelineStage,
  (ctx: StageContext) => Promise<void> | void
> = {
  [PipelineStage.TREND_DISCOVERY]: handleTrendDiscovery,
  [PipelineStage.HASHTAG_RESEARCH]: handleHashtagResearch,
  [PipelineStage.CONTENT_GENERATION]: handleContentGeneration,
  [PipelineStage.PUBLISHING]: handlePublishing,
  [PipelineStage.PERFORMANCE_TRACKING]: handlePerformanceTracking,
  [PipelineStage.ITERATION]: handleIteration,
};

// ----------------------------------------------------------------------------
// DB 更新辅助函数
// ----------------------------------------------------------------------------

function markStageStatus(
  runId: number,
  stage: PipelineStage,
  status: StageStatus,
  extra?: { result?: string; errorMessage?: string },
): void {
  const db = getDb();
  if (status === StageStatus.RUNNING) {
    db.prepare(
      `UPDATE pipeline_stages SET status = ?, started_at = datetime('now') WHERE run_id = ? AND stage = ?`,
    ).run(status, runId, stage);
  } else if (status === StageStatus.COMPLETED) {
    db.prepare(
      `UPDATE pipeline_stages SET status = ?, completed_at = datetime('now'), result = ? WHERE run_id = ? AND stage = ?`,
    ).run(status, extra?.result ?? '', runId, stage);
  } else if (status === StageStatus.FAILED) {
    db.prepare(
      `UPDATE pipeline_stages SET status = ?, completed_at = datetime('now'), error_message = ? WHERE run_id = ? AND stage = ?`,
    ).run(status, extra?.errorMessage ?? '', runId, stage);
  }
}

// ----------------------------------------------------------------------------
// 推进到下一阶段：执行当前阶段的技能并流转
// ----------------------------------------------------------------------------

export async function advanceStage(runId: number): Promise<PipelineRun> {
  const db = getDb();
  const run = getPipelineRunById(runId);
  if (!run) {
    throw new Error(`Pipeline 运行不存在: ${runId}`);
  }
  if (run.status !== PipelineStatus.RUNNING) {
    throw new Error(`Pipeline 运行状态不允许推进: ${run.status}`);
  }

  const currentStage = run.currentStage;
  log.info('推进 Pipeline 阶段', { runId, currentStage });

  // 标记当前阶段为 running
  markStageStatus(runId, currentStage, StageStatus.RUNNING);

  // 初始化阶段上下文
  const ctx: StageContext = {
    trendId: run.trendId ?? null,
    hashtagIds: run.hashtagIds ?? null,
    contentId: run.contentId ?? null,
    publicationId: run.publicationId ?? null,
    analyticsId: run.analyticsId ?? null,
    resultStr: '',
  };

  try {
    // 执行阶段处理器
    const handler = STAGE_HANDLERS[currentStage];
    if (!handler) {
      throw new Error(`未知阶段: ${currentStage}`);
    }
    await handler(ctx);

    // 标记阶段完成
    markStageStatus(runId, currentStage, StageStatus.COMPLETED, { result: ctx.resultStr });

    // 推进运行状态
    const currentIdx = STAGE_ORDER.indexOf(currentStage);
    const isLastStage = currentIdx >= STAGE_ORDER.length - 1;

    if (isLastStage) {
      db.prepare(
        `UPDATE pipeline_runs SET status = ?, completed_at = datetime('now'),
         trend_id = ?, hashtag_ids = ?, content_id = ?, publication_id = ?, analytics_id = ? WHERE id = ?`,
      ).run(
        PipelineStatus.COMPLETED,
        ctx.trendId,
        ctx.hashtagIds,
        ctx.contentId,
        ctx.publicationId,
        ctx.analyticsId,
        runId,
      );
    } else {
      const nextStage = STAGE_ORDER[currentIdx + 1];
      db.prepare(
        `UPDATE pipeline_runs SET current_stage = ?,
         trend_id = ?, hashtag_ids = ?, content_id = ?, publication_id = ?, analytics_id = ? WHERE id = ?`,
      ).run(
        nextStage,
        ctx.trendId,
        ctx.hashtagIds,
        ctx.contentId,
        ctx.publicationId,
        ctx.analyticsId,
        runId,
      );
    }

    log.info(`阶段 ${currentStage} 完成`, { runId, resultStr: ctx.resultStr });
    return getPipelineRunById(runId)!;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`阶段 ${currentStage} 失败`, { runId, error: errMsg });

    // 标记阶段失败
    markStageStatus(runId, currentStage, StageStatus.FAILED, { errorMessage: errMsg });

    // 标记运行失败
    db.prepare(
      `UPDATE pipeline_runs SET status = ?, error_message = ? WHERE id = ?`,
    ).run(PipelineStatus.FAILED, errMsg, runId);

    throw error;
  }
}

// ----------------------------------------------------------------------------
// 删除 Pipeline 运行记录（含阶段记录）
// ----------------------------------------------------------------------------

export function deletePipelineRun(id: number): boolean {
  const db = getDb();
  // 先删除关联的阶段记录
  db.prepare('DELETE FROM pipeline_stages WHERE run_id = ?').run(id);
  // 再删除运行记录
  const info = db.prepare('DELETE FROM pipeline_runs WHERE id = ?').run(id);
  if (info.changes > 0) {
    log.info('删除 Pipeline 运行', { id });
  }
  return info.changes > 0;
}

export function batchDeletePipelineRuns(ids: number[]): number {
  const uniqueIds = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length) return 0;
  const db = getDb();
  const placeholders = uniqueIds.map(() => '?').join(',');
  return db.transaction(() => {
    db.prepare(`DELETE FROM pipeline_stages WHERE run_id IN (${placeholders})`).run(...uniqueIds);
    const info = db.prepare(`DELETE FROM pipeline_runs WHERE id IN (${placeholders})`).run(...uniqueIds);
    log.info('批量删除 Pipeline 运行', { requested: uniqueIds.length, deleted: info.changes });
    return info.changes;
  })();
}

export function updatePipelineRun(id: number, input: { keyword?: string; trendId?: number | null }): PipelineRun | null {
  const run = getPipelineRunById(id);
  if (!run) return null;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.keyword !== undefined) { fields.push('keyword = ?'); values.push(input.keyword.trim() || null); }
  if (input.trendId !== undefined) { fields.push('trend_id = ?'); values.push(input.trendId); }
  if (!fields.length) return run;
  getDb().prepare(`UPDATE pipeline_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  log.info('编辑 Pipeline 运行元数据', { id, fields });
  return getPipelineRunById(id);
}

// ----------------------------------------------------------------------------
// 暂停运行
// ----------------------------------------------------------------------------

export function pausePipeline(runId: number): PipelineRun | null {
  const db = getDb();
  const run = getPipelineRunById(runId);
  if (!run) {
    return null;
  }

  if (run.status !== PipelineStatus.RUNNING) {
    throw new Error(`Pipeline 运行状态不允许暂停: ${run.status}`);
  }

  db.prepare('UPDATE pipeline_runs SET status = ? WHERE id = ?').run(
    PipelineStatus.PAUSED,
    runId,
  );
  log.info('Pipeline 已暂停', { runId });
  return getPipelineRunById(runId);
}

// ----------------------------------------------------------------------------
// 恢复运行（从暂停状态恢复为运行中）
// ----------------------------------------------------------------------------

export function resumePipeline(runId: number): PipelineRun | null {
  const db = getDb();
  const run = getPipelineRunById(runId);
  if (!run) {
    return null;
  }

  if (run.status !== PipelineStatus.PAUSED) {
    throw new Error(`Pipeline 运行状态不允许恢复: ${run.status}（仅暂停状态可恢复）`);
  }

  db.prepare('UPDATE pipeline_runs SET status = ? WHERE id = ?').run(
    PipelineStatus.RUNNING,
    runId,
  );
  log.info('Pipeline 已恢复', { runId });
  return getPipelineRunById(runId);
}

// ----------------------------------------------------------------------------
// 获取运行的阶段记录
// ----------------------------------------------------------------------------

export function getPipelineStages(runId: number): PipelineStageRecord[] {
  return getStagesByRunId(runId);
}

// 重新导出 SkillParams 以保持类型可用
export type { SkillParams };
