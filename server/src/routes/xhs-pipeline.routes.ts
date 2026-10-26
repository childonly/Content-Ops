/**
 * 小红书自动化流水线路由 (替换原 proxy.routes.ts 的 /api/xhs-pipeline 代理)
 *
 * 端点:
 *   POST /api/xhs-pipeline/start          启动新流水线
 *   GET  /api/xhs-pipeline/runs           获取流水线运行列表
 *   GET  /api/xhs-pipeline/runs/:id       获取流水线运行详情(含草稿)
 *   POST /api/xhs-pipeline/drafts/:id/approve   审核通过并发布草稿
 *   POST /api/xhs-pipeline/drafts/:id/reject    拒绝草稿
 *   GET  /api/xhs-pipeline/drafts/pending       获取待审核草稿列表
 *   POST /api/xhs-pipeline/research             仅执行研究(不启动完整流水线)
 */

import { Router, Request, Response } from 'express';
import {
  createAndStartPipeline,
  getPipelineRun,
  getRecentRunsWithDrafts,
  getPendingDrafts,
  approveAndPublish,
  rejectDraft,
} from '../services/xhs-pipeline.service';
import { searchPosts, generateReport } from '../services/research.service';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('xhs-pipeline-routes');
export const router = Router();

// POST /api/xhs-pipeline/start - 启动新流水线
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { keyword } = req.body as { keyword?: string };
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ success: false, error: '缺少 keyword 参数' });
    }

    const runId = createAndStartPipeline(keyword.trim());
    log.info(`API 启动流水线: keyword='${keyword}', run_id=${runId}`);

    res.json({
      success: true,
      data: {
        run_id: runId,
        keyword: keyword.trim(),
        status: 'pending',
        message: '流水线已启动,正在后台执行',
      },
    });
  } catch (e) {
    log.error(`启动流水线失败: ${(e as Error).message}`);
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /api/xhs-pipeline/runs - 获取流水线运行列表(含草稿)
router.get('/runs', async (_req: Request, res: Response) => {
  try {
    const limit = parseInt(_req.query.limit as string, 10) || 20;
    // 返回 Array<{ run, drafts }> 格式,供草稿审核页面使用
    const runs = getRecentRunsWithDrafts(limit);
    res.json({ success: true, data: runs });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /api/xhs-pipeline/runs/:id - 获取流水线运行详情
router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.id, 10);
    if (isNaN(runId)) {
      return res.status(400).json({ success: false, error: '无效的 run_id' });
    }

    const result = getPipelineRun(runId);
    if (!result) {
      return res.status(404).json({ success: false, error: `流水线运行 ${runId} 不存在` });
    }

    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /api/xhs-pipeline/drafts/pending - 获取待审核草稿
router.get('/drafts/pending', async (_req: Request, res: Response) => {
  try {
    const drafts = getPendingDrafts();
    res.json({ success: true, data: drafts });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-pipeline/drafts/:id/approve - 审核通过并发布
router.post('/drafts/:id/approve', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id, 10);
    if (isNaN(draftId)) {
      return res.status(400).json({ success: false, error: '无效的 draft_id' });
    }

    log.info(`API 审核通过草稿 ${draftId}`);
    const updated = await approveAndPublish(draftId);
    res.json({
      success: true,
      data: updated,
      message: updated.status === 'published' ? '草稿发布成功' : '草稿发布失败',
    });
  } catch (e) {
    log.error(`审核发布失败: ${(e as Error).message}`);
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-pipeline/drafts/:id/reject - 拒绝草稿
router.post('/drafts/:id/reject', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id, 10);
    if (isNaN(draftId)) {
      return res.status(400).json({ success: false, error: '无效的 draft_id' });
    }

    const { review_notes } = req.body as { review_notes?: string };
    const updated = rejectDraft(draftId, review_notes);
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// DELETE /api/xhs-pipeline/drafts/:id - 删除草稿
router.delete('/drafts/:id', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id, 10);
    if (isNaN(draftId)) {
      return res.status(400).json({ success: false, error: '无效的 draft_id' });
    }

    const db = getDb();
    const info = db.prepare('DELETE FROM drafts WHERE id = ?').run(draftId);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: `草稿 ${draftId} 不存在` });
    }

    log.info(`删除草稿 ${draftId}`);
    res.json({ success: true, message: '草稿已删除' });
  } catch (e) {
    log.error(`删除草稿失败: ${(e as Error).message}`);
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// DELETE /api/xhs-pipeline/runs/:id - 删除流水线运行记录
router.delete('/runs/:id', async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.id, 10);
    if (isNaN(runId)) {
      return res.status(400).json({ success: false, error: '无效的 run_id' });
    }

    const db = getDb();
    // 先删除关联草稿
    db.prepare('DELETE FROM drafts WHERE pipeline_run_id = ?').run(runId);
    // 再删除运行记录
    const info = db.prepare('DELETE FROM pipeline_runs WHERE id = ?').run(runId);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: `流水线运行 ${runId} 不存在` });
    }

    log.info(`删除流水线运行 ${runId}`);
    res.json({ success: true, message: '流水线运行已删除' });
  } catch (e) {
    log.error(`删除流水线运行失败: ${(e as Error).message}`);
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-pipeline/research - 仅执行研究(不启动完整流水线)
router.post('/research', async (req: Request, res: Response) => {
  try {
    const { keyword, limit } = req.body as { keyword?: string; limit?: number };
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ success: false, error: '缺少 keyword 参数' });
    }

    const searchLimit = Math.min(limit || 20, 50);
    const posts = await searchPosts(keyword.trim(), searchLimit);
    const report = generateReport(posts, keyword.trim());

    res.json({
      success: true,
      data: {
        keyword: keyword.trim(),
        posts_count: posts.length,
        posts: posts.slice(0, 10),
        report,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /api/xhs-pipeline/dashboard/stats - 仪表盘统计数据
// 供前端 XhsPipelineView.vue 的"仪表盘统计"Tab 使用
router.get('/dashboard/stats', async (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // 流水线运行统计(仅统计 xhs_auto 类型)
    const runStats = db
      .prepare(
        `SELECT
           COUNT(*) as total_runs,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_runs,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs
         FROM pipeline_runs WHERE pipeline_type = 'xhs_auto'`,
      )
      .get() as any;

    // 草稿统计
    const draftStats = db
      .prepare(
        `SELECT
           COUNT(*) as total_drafts,
           SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published_drafts,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_drafts
         FROM drafts`,
      )
      .get() as any;

    // 关键词和定时任务数量
    const keywordCount = (
      db.prepare('SELECT COUNT(*) as count FROM keywords').get() as any
    ).count;
    const scheduleCount = (
      db.prepare('SELECT COUNT(*) as count FROM schedules').get() as any
    ).count;

    // 最近运行记录(最多 10 条)
    const recentRuns = db
      .prepare(
        `SELECT id, keyword, status, started_at, completed_at, error_message, sources_count
         FROM pipeline_runs WHERE pipeline_type = 'xhs_auto'
         ORDER BY id DESC LIMIT 10`,
      )
      .all();

    res.json({
      success: true,
      data: {
        total_runs: runStats?.total_runs || 0,
        completed_runs: runStats?.completed_runs || 0,
        failed_runs: runStats?.failed_runs || 0,
        total_drafts: draftStats?.total_drafts || 0,
        published_drafts: draftStats?.published_drafts || 0,
        pending_drafts: draftStats?.pending_drafts || 0,
        keyword_count: keywordCount,
        schedule_count: scheduleCount,
        recent_runs: recentRuns,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
