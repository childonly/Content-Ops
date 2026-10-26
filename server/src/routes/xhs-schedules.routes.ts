/**
 * 定时任务管理路由 (从 xhs-auto-pipeline 移植)
 *
 * 端点:
 *   GET    /api/xhs-schedules              获取定时任务列表
 *   POST   /api/xhs-schedules              新增定时任务
 *   PUT    /api/xhs-schedules/:id          更新定时任务
 *   DELETE /api/xhs-schedules/:id          删除定时任务
 *   POST   /api/xhs-schedules/:id/trigger  立即触发一次
 *   GET    /api/xhs-schedules/status       获取调度器状态
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { pipelineScheduler } from '../services/scheduler.service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('xhs-schedules-routes');
export const router = Router();

// GET /api/xhs-schedules/status - 调度器状态
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const tasks = pipelineScheduler.getTasksStatus();
    res.json({
      success: true,
      data: {
        running: tasks.length > 0,
        active_tasks: tasks.length,
        tasks,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /api/xhs-schedules - 获取定时任务列表
router.get('/', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const schedules = db.prepare('SELECT * FROM schedules ORDER BY id DESC').all();
    res.json({ success: true, data: schedules });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-schedules - 新增定时任务
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, keyword, cron_expression, enabled, config } = req.body as any;
    if (!name || !keyword || !cron_expression) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数 (name, keyword, cron_expression)',
      });
    }

    // 校验 cron 表达式
    if (!pipelineScheduler.validateCronExpression(cron_expression)) {
      return res.status(400).json({
        success: false,
        error: `无效的 cron 表达式: '${cron_expression}' (应为 5 字段: minute hour day month day_of_week)`,
      });
    }

    const db = getDb();
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO schedules (name, keyword, cron_expression, enabled, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      keyword,
      cron_expression,
      enabled === false ? 0 : 1,
      config ? JSON.stringify(config) : null,
      now,
      now,
    );

    const scheduleId = result.lastInsertRowid as number;

    // 若启用,注册到调度器
    if (enabled !== false) {
      pipelineScheduler.addSchedule(scheduleId, keyword, cron_expression);
    }

    log.info(`新增定时任务 ${scheduleId}: '${name}' cron='${cron_expression}'`);
    res.json({
      success: true,
      data: { id: scheduleId, name, keyword, cron_expression },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// PUT /api/xhs-schedules/:id - 更新定时任务
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, keyword, cron_expression, enabled, config } = req.body as any;

    const db = getDb();
    const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ success: false, error: `定时任务 ${id} 不存在` });
    }

    const newCron = cron_expression || existing.cron_expression;
    const newKeyword = keyword || existing.keyword;

    // 若提供了新 cron 表达式,校验
    if (cron_expression && !pipelineScheduler.validateCronExpression(cron_expression)) {
      return res.status(400).json({
        success: false,
        error: `无效的 cron 表达式: '${cron_expression}'`,
      });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE schedules SET
        name = COALESCE(?, name),
        keyword = COALESCE(?, keyword),
        cron_expression = COALESCE(?, cron_expression),
        enabled = COALESCE(?, enabled),
        config = COALESCE(?, config),
        updated_at = ?
      WHERE id = ?
    `).run(
      name || null,
      keyword || null,
      cron_expression || null,
      enabled === undefined ? null : enabled ? 1 : 0,
      config ? JSON.stringify(config) : null,
      now,
      id,
    );

    // 更新调度器中的任务
    const newEnabled = enabled === undefined ? existing.enabled : enabled ? 1 : 0;
    if (newEnabled) {
      pipelineScheduler.updateSchedule(id, newKeyword, newCron);
    } else {
      pipelineScheduler.removeSchedule(id);
    }

    log.info(`更新定时任务 ${id}`);
    res.json({ success: true, data: { id } });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// DELETE /api/xhs-schedules/:id - 删除定时任务
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();

    pipelineScheduler.removeSchedule(id);

    const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: `定时任务 ${id} 不存在` });
    }

    res.json({ success: true, message: `定时任务 ${id} 已删除` });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-schedules/:id/trigger - 立即触发一次
router.post('/:id/trigger', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();

    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as any;
    if (!schedule) {
      return res.status(404).json({ success: false, error: `定时任务 ${id} 不存在` });
    }

    // 动态导入避免循环依赖
    const { createAndStartPipeline } = await import('../services/xhs-pipeline.service');
    const runId = createAndStartPipeline(schedule.keyword);

    log.info(`手动触发定时任务 ${id} ('${schedule.keyword}') → run_${runId}`);
    res.json({
      success: true,
      data: { run_id: runId, keyword: schedule.keyword },
      message: `已用关键词 '${schedule.keyword}' 启动流水线`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
