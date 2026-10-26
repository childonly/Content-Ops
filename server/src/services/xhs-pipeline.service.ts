/**
 * 小红书自动化流水线服务 (从 xhs-auto-pipeline pipeline_service.py 移植)
 *
 * 5 步状态机:
 *   researching → reporting → drafting → reviewing → publishing → completed
 *
 * 核心函数:
 *   - runXhsPipeline(keyword, runId)     主入口,执行完整流水线
 *   - approveAndPublish(draftId)         审核通过后发布草稿
 *
 * 对应 Python 源: backend/app/services/pipeline_service.py
 */

import { config } from '../config';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { searchPosts, generateReport, XhsPost } from './research.service';
import { generateDrafts, NoteDraft } from './llm-service';
import { generateImagesForDraft } from './image-generation.service';

const log = createServiceLogger('xhs-pipeline');

// ============================================================================
// 数据库记录类型
// ============================================================================

interface PipelineRunRecord {
  id: number;
  pipeline_type: string;
  keyword: string | null;
  status: string;
  current_stage: string;
  sources_count: number;
  report_content: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

interface DraftRecord {
  id: number;
  pipeline_run_id: number;
  title: string;
  content: string;
  tags: string;
  images: string;
  status: string;
  published_at: string | null;
  publish_url: string | null;
  publish_error: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 状态更新工具函数
// ============================================================================

/**
 * 更新流水线运行状态。
 */
function updateRunStatus(
  runId: number,
  status: string,
  errorMessage?: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const updates: string[] = ['status = ?', 'current_stage = ?'];
  const params: any[] = [status, status];

  if (errorMessage !== undefined) {
    updates.push('error_message = ?');
    params.push(errorMessage);
  }

  // researching 状态首次进入时更新 started_at(若为空)
  if (status === 'researching') {
    updates.push("started_at = COALESCE(started_at, ?)");
    params.push(now);
  }

  // 终态更新 completed_at
  if (status === 'completed' || status === 'failed') {
    updates.push('completed_at = ?');
    params.push(now);
  }

  params.push(runId);
  db.prepare(`UPDATE pipeline_runs SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  log.info(`流水线运行 ${runId} 状态 → ${status}`);
}

// ============================================================================
// 流水线执行核心
// ============================================================================

/**
 * 执行流水线内部逻辑。
 *
 * 步骤:
 *   1. researching - 搜索小红书笔记(TikHub 优先,Playwright 兜底)
 *   2. reporting   - 生成 Markdown 研究报告
 *   3. drafting    - 通过 LLM 生成笔记草稿(智谱→DeepSeek→Ollama→模板)
 *   3.5 imaging    - 为每篇草稿生成图片(智谱 CogView-4)
 *   4. reviewing   - 暂停等待人工审核
 *
 * @param keyword 搜索关键词
 * @param runId   pipeline_runs 表的记录 ID
 */
async function executePipeline(keyword: string, runId: number): Promise<void> {
  const db = getDb();

  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as PipelineRunRecord | undefined;
  if (!run) {
    log.error(`流水线运行 ${runId} 在数据库中不存在`);
    return;
  }

  // Step 1: Research - 搜索笔记
  updateRunStatus(runId, 'researching');
  const posts: XhsPost[] = await searchPosts(keyword, config.scheduler.defaultSearchLimit);

  db.prepare('UPDATE pipeline_runs SET sources_count = ? WHERE id = ?').run(posts.length, runId);

  // 更新关键词的 last_used_at(若 keywords 表中存在)
  db.prepare(
    `UPDATE keywords SET last_used_at = ?, use_count = use_count + 1, updated_at = ?
     WHERE keyword = ?`,
  ).run(new Date().toISOString(), new Date().toISOString(), keyword);

  // Step 2: Reporting - 生成研究报告
  updateRunStatus(runId, 'reporting');
  const report = generateReport(posts, keyword);
  db.prepare('UPDATE pipeline_runs SET report_content = ? WHERE id = ?').run(report, runId);

  // Step 3: Drafting - 生成草稿
  updateRunStatus(runId, 'drafting');
  const draftsData: NoteDraft[] = await generateDrafts(report, config.scheduler.maxDrafts);

  // 保存草稿到数据库,并为每篇草稿生成图片
  const insertDraft = db.prepare(`
    INSERT INTO drafts (pipeline_run_id, title, content, tags, images, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `);

  for (const draftData of draftsData) {
    // Step 3.5: Imaging - 为草稿生成图片
    let images = '';
    try {
      const draftId = (db.prepare('SELECT MAX(id) as max_id FROM drafts').get() as any)?.max_id || 0;
      const imgResult = await generateImagesForDraft(draftData.title, draftData.content, draftId + 1);
      images = imgResult.paths;
    } catch (e) {
      log.warn(`图片生成失败: ${(e as Error).message}`);
    }

    const now = new Date().toISOString();
    insertDraft.run(runId, draftData.title, draftData.content, draftData.tags, images, now, now);
  }

  log.info(`流水线运行 ${runId} 已保存 ${draftsData.length} 篇草稿`);

  // Step 4: Reviewing - 等待人工审核
  updateRunStatus(runId, 'reviewing');
  log.info(`流水线运行 ${runId} 等待人工审核 (${draftsData.length} 篇草稿待审)`);
}

// ============================================================================
// 主入口: 启动流水线
// ============================================================================

/**
 * 启动小红书自动化流水线。
 *
 * 由 API 路由或 scheduler.service 调用。
 * 流水线在后台异步执行,调用方无需等待完成。
 *
 * @param keyword 搜索关键词
 * @param runId   pipeline_runs 表的记录 ID(由调用方预先创建)
 */
export async function runXhsPipeline(keyword: string, runId: number): Promise<void> {
  log.info(`启动流水线: keyword='${keyword}', run_id=${runId}`);

  try {
    await executePipeline(keyword, runId);
  } catch (e) {
    const err = e as Error;
    log.error(`流水线运行 ${runId} 失败: ${err.message}`);
    updateRunStatus(runId, 'failed', err.message);
  }
}

/**
 * 创建新的流水线运行记录并启动。
 *
 * 供 API 路由调用,返回 run_id 供前端追踪。
 */
export function createAndStartPipeline(keyword: string): number {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO pipeline_runs (pipeline_type, keyword, status, current_stage, started_at)
    VALUES ('xhs_auto', ?, 'pending', 'researching', ?)
  `).run(keyword, now);

  const runId = result.lastInsertRowid as number;
  log.info(`已创建流水线运行 run_${runId} (关键词: '${keyword}')`);

  // 异步启动流水线(不阻塞 API 响应)
  runXhsPipeline(keyword, runId).catch((e) => {
    log.error(`异步流水线运行 ${runId} 异常: ${(e as Error).message}`);
  });

  return runId;
}

// ============================================================================
// 草稿审核与发布
// ============================================================================

/**
 * 审核通过并发布草稿。
 *
 * 由用户在前端点击"审核通过"时触发。
 * 流程:
 *   1. 更新草稿状态为 'approved'
 *   2. 更新流水线状态为 'publishing'
 *   3. 调用 xhs-publish.service.publishNote() 发布到小红书
 *   4. 更新草稿状态为 'published' 或 'published_failed'
 *   5. 若该流水线所有草稿都已完成,标记流水线为 'completed'
 *
 * @param draftId 草稿 ID
 * @returns 更新后的草稿记录
 */
export async function approveAndPublish(draftId: number): Promise<DraftRecord> {
  const db = getDb();

  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId) as DraftRecord | undefined;
  if (!draft) {
    throw new Error(`草稿 ${draftId} 不存在`);
  }

  if (draft.status !== 'pending' && draft.status !== 'rejected') {
    throw new Error(`草稿 ${draftId} 不在可审核状态 (当前状态: ${draft.status})`);
  }

  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(draft.pipeline_run_id) as PipelineRunRecord | undefined;
  if (!run) {
    throw new Error(`草稿 ${draftId} 对应的流水线运行 ${draft.pipeline_run_id} 不存在`);
  }

  // 标记草稿为已审核,流水线为发布中
  db.prepare("UPDATE drafts SET status = 'approved', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    draftId,
  );
  updateRunStatus(run.id, 'publishing');

  // 调用发布服务
  let publishResult: { success: boolean; url?: string; error?: string };

  try {
    // 动态导入避免循环依赖
    const { publishNote } = await import('./xhs-publish.service');
    publishResult = await publishNote({
      title: draft.title,
      content: draft.content,
      tags: draft.tags,
      images: draft.images,
    });
  } catch (e) {
    publishResult = { success: false, error: (e as Error).message };
  }

  const now = new Date().toISOString();

  if (publishResult.success) {
    db.prepare(
      "UPDATE drafts SET status = 'published', published_at = ?, publish_url = ?, updated_at = ? WHERE id = ?",
    ).run(now, publishResult.url || null, now, draftId);
    log.info(`草稿 ${draftId} 发布成功`);
  } else {
    db.prepare(
      "UPDATE drafts SET status = 'published_failed', publish_error = ?, updated_at = ? WHERE id = ?",
    ).run(publishResult.error || '未知错误', now, draftId);
    log.error(`草稿 ${draftId} 发布失败: ${publishResult.error}`);
  }

  // 检查该流水线的所有草稿是否都已完成
  const allDrafts = db
    .prepare('SELECT status FROM drafts WHERE pipeline_run_id = ?')
    .all(run.id) as Array<{ status: string }>;

  const allDone = allDrafts.every((d) =>
    ['published', 'published_failed', 'rejected'].includes(d.status),
  );

  if (allDone) {
    updateRunStatus(run.id, 'completed');
    log.info(`流水线运行 ${run.id} 已完成 - 所有草稿已处理`);
  }

  // 返回更新后的草稿
  return db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId) as DraftRecord;
}

/**
 * 拒绝草稿(不发布)。
 */
export function rejectDraft(draftId: number, reviewNotes?: string): DraftRecord {
  const db = getDb();
  const now = new Date().toISOString();

  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId) as DraftRecord | undefined;
  if (!draft) {
    throw new Error(`草稿 ${draftId} 不存在`);
  }

  db.prepare(
    "UPDATE drafts SET status = 'rejected', review_notes = ?, updated_at = ? WHERE id = ?",
  ).run(reviewNotes || null, now, draftId);

  log.info(`草稿 ${draftId} 已拒绝`);

  // 检查流水线是否全部完成
  const allDrafts = db
    .prepare('SELECT status FROM drafts WHERE pipeline_run_id = ?')
    .all(draft.pipeline_run_id) as Array<{ status: string }>;

  const allDone = allDrafts.every((d) =>
    ['published', 'published_failed', 'rejected'].includes(d.status),
  );

  if (allDone) {
    updateRunStatus(draft.pipeline_run_id, 'completed');
  }

  return db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId) as DraftRecord;
}

// ============================================================================
// 查询函数(供 API 路由使用)
// ============================================================================

/**
 * 获取流水线运行详情(含草稿列表)。
 */
export function getPipelineRun(runId: number): { run: PipelineRunRecord; drafts: DraftRecord[] } | null {
  const db = getDb();
  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as PipelineRunRecord | undefined;
  if (!run) return null;

  const drafts = db
    .prepare('SELECT * FROM drafts WHERE pipeline_run_id = ? ORDER BY id')
    .all(runId) as DraftRecord[];

  return { run, drafts };
}

/**
 * 获取最近的流水线运行列表。
 */
export function getRecentPipelineRuns(limit: number = 20): PipelineRunRecord[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM pipeline_runs WHERE pipeline_type = ? ORDER BY id DESC LIMIT ?')
    .all('xhs_auto', limit) as PipelineRunRecord[];
}

/**
 * 获取最近的流水线运行列表(含每条运行对应的草稿列表)。
 *
 * 用于草稿审核页面 /runs 端点,前端期望返回 Array<{ run, drafts }> 格式。
 */
export function getRecentRunsWithDrafts(
  limit: number = 20,
): Array<{ run: PipelineRunRecord; drafts: DraftRecord[] }> {
  const db = getDb();
  const runs = db
    .prepare('SELECT * FROM pipeline_runs WHERE pipeline_type = ? ORDER BY id DESC LIMIT ?')
    .all('xhs_auto', limit) as PipelineRunRecord[];

  return runs.map((run) => {
    const drafts = db
      .prepare('SELECT * FROM drafts WHERE pipeline_run_id = ? ORDER BY id')
      .all(run.id) as DraftRecord[];
    return { run, drafts };
  });
}

/**
 * 获取待审核的草稿列表。
 */
export function getPendingDrafts(): DraftRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT d.* FROM drafts d
       JOIN pipeline_runs r ON d.pipeline_run_id = r.id
       WHERE d.status = 'pending' AND r.pipeline_type = 'xhs_auto'
       ORDER BY d.id DESC`,
    )
    .all() as DraftRecord[];
}
