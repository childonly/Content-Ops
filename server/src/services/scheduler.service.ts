/**
 * 定时任务调度服务 (从 xhs-auto-pipeline scheduler.py 移植)
 *
 * 使用 node-cron 替代 Python APScheduler,提供基于 cron 表达式的流水线触发。
 *
 * 核心功能:
 *   - start()/shutdown()           生命周期管理
 *   - addSchedule()                注册 cron 任务
 *   - removeSchedule()             移除任务
 *   - updateSchedule()             更新任务(移除后重新添加)
 *   - getNextRunTime()             查询下次执行时间
 *   - loadSchedulesFromDb()        启动时从数据库加载所有启用的任务
 *
 * 对应 Python 源: backend/app/scheduler/scheduler.py
 *
 * Week 1: 创建框架,Week 3 接入实际流水线触发逻辑
 */

import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('scheduler');

// ============================================================================
// Schedule 记录类型(对应 schedules 表)
// ============================================================================

export interface ScheduleRecord {
  id: number;
  name: string;
  keyword: string;
  cron_expression: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_run_status: string | null;
  last_error: string | null;
  config: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// PipelineScheduler 调度器
// ============================================================================

/**
 * 流水线调度器 - node-cron 封装
 *
 * 每个 schedule 记录对应一个 ScheduledTask,存储在 _tasks Map 中。
 * 任务触发时调用 _triggerPipeline(在 Week 3 接入实际流水线服务)。
 */
class PipelineScheduler {
  private _tasks: Map<number, ScheduledTask> = new Map();
  private _started = false;

  /**
   * 启动调度器并从数据库加载所有启用的任务。
   */
  async start(): Promise<void> {
    if (!config.scheduler.enabled) {
      log.info('调度器已在配置中禁用,跳过启动');
      return;
    }

    if (this._started) {
      log.warn('调度器已在运行,跳过重复启动');
      return;
    }

    this._started = true;
    log.info(`调度器启动 (时区: ${config.scheduler.timezone})`);

    // 从数据库加载所有启用的任务
    await this.loadSchedulesFromDb();
  }

  /**
   * 关闭调度器,停止所有任务。
   */
  shutdown(): void {
    if (!this._started) {
      return;
    }

    for (const [id, task] of this._tasks) {
      task.stop();
      log.info(`已停止任务 schedule_${id}`);
    }
    this._tasks.clear();
    this._started = false;
    log.info('调度器已关闭');
  }

  /**
   * 校验 cron 表达式是否有效。
   */
  validateCronExpression(cronExpression: string): boolean {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }
    return cron.validate(cronExpression);
  }

  /**
   * 注册新的 cron 任务。
   *
   * @param scheduleId 数据库 schedules 表的记录 ID
   * @param keyword    触发流水线使用的关键词
   * @param cronExpression 标准 5 字段 cron 表达式
   */
  addSchedule(scheduleId: number, keyword: string, cronExpression: string): void {
    if (!this._started) {
      log.warn('调度器未启动,无法添加任务');
      return;
    }

    if (!this.validateCronExpression(cronExpression)) {
      throw new Error(
        `无效的 cron 表达式 '${cronExpression}': 应为 5 字段 (minute hour day month day_of_week)`,
      );
    }

    // 若已存在同 ID 任务,先移除
    if (this._tasks.has(scheduleId)) {
      this._tasks.get(scheduleId)!.stop();
      this._tasks.delete(scheduleId);
    }

    const task = cron.schedule(
      cronExpression,
      () => {
        // Week 3 将接入实际流水线触发
        this._triggerPipeline(scheduleId, keyword).catch((err) => {
          log.error(`任务 schedule_${scheduleId} 触发失败: ${err.message}`);
        });
      },
      {
        timezone: config.scheduler.timezone,
      },
    );

    this._tasks.set(scheduleId, task);
    log.info(`已添加任务 schedule_${scheduleId}: keyword='${keyword}', cron='${cronExpression}'`);
  }

  /**
   * 移除任务。
   */
  removeSchedule(scheduleId: number): void {
    const task = this._tasks.get(scheduleId);
    if (task) {
      task.stop();
      this._tasks.delete(scheduleId);
      log.info(`已移除任务 schedule_${scheduleId}`);
    } else {
      log.warn(`任务 schedule_${scheduleId} 不存在(可能已被移除)`);
    }
  }

  /**
   * 更新任务(移除后重新添加)。
   */
  updateSchedule(scheduleId: number, keyword: string, cronExpression: string): void {
    this.removeSchedule(scheduleId);
    this.addSchedule(scheduleId, keyword, cronExpression);
    log.info(`已更新任务 schedule_${scheduleId}`);
  }

  /**
   * 获取任务的下次执行时间。
   *
   * node-cron 不直接暴露 nextRunTime,通过解析 cron 表达式估算。
   * 此处返回当前时间 + 1 个调度周期作为近似值(Week 3 可用 cron-parser 精确计算)。
   */
  getNextRunTime(scheduleId: number): Date | null {
    const task = this._tasks.get(scheduleId);
    if (!task) {
      return null;
    }
    // node-cron 的 ScheduledTask 不暴露 nextDate,返回 null 表示未知
    // 前端可通过 cron-parser 自行计算
    return null;
  }

  /**
   * 获取所有已注册任务的状态。
   *
   * node-cron 的 ScheduledTask 类型定义未暴露 isActive(),
   * 通过 Map 的 has() 判断任务是否已注册(注册即视为运行中)。
   */
  getTasksStatus(): Array<{ scheduleId: number; running: boolean }> {
    return Array.from(this._tasks.keys()).map((id) => ({
      scheduleId: id,
      running: true,
    }));
  }

  /**
   * 从数据库加载所有启用的任务。
   */
  async loadSchedulesFromDb(): Promise<void> {
    if (!this._started) {
      log.warn('调度器未启动,无法加载任务');
      return;
    }

    const db = getDb();
    const schedules = db
      .prepare('SELECT * FROM schedules WHERE enabled = 1')
      .all() as ScheduleRecord[];

    let loaded = 0;
    for (const schedule of schedules) {
      try {
        this.addSchedule(schedule.id, schedule.keyword, schedule.cron_expression);
        loaded++;
      } catch (e) {
        log.error(`加载任务 schedule_${schedule.id} ('${schedule.name}') 失败: ${(e as Error).message}`);
      }
    }

    log.info(`从数据库加载 ${loaded}/${schedules.length} 个任务`);
  }

  /**
   * 任务触发回调 - 在 Week 3 接入实际流水线服务。
   *
   * 当前框架实现:
   *   1. 更新 schedule.last_run_at
   *   2. 创建新的 pipeline_run 记录(pipeline_type='xhs_auto')
   *   3. 调用 xhs-pipeline.service.runPipeline(Week 2 实现)
   */
  private async _triggerPipeline(scheduleId: number, keyword: string): Promise<void> {
    log.info(`调度触发: schedule_id=${scheduleId}, keyword='${keyword}'`);

    const db = getDb();
    const now = new Date().toISOString();

    // 更新 schedule 的 last_run_at
    db.prepare(
      `UPDATE schedules SET last_run_at = ?, run_count = run_count + 1, updated_at = ? WHERE id = ?`,
    ).run(now, now, scheduleId);

    // 创建新的 pipeline_run 记录
    const result = db
      .prepare(
        `INSERT INTO pipeline_runs (pipeline_type, keyword, status, current_stage, started_at)
         VALUES ('xhs_auto', ?, 'pending', 'researching', ?)`,
      )
      .run(keyword, now);

    const runId = result.lastInsertRowid as number;
    log.info(`已创建流水线运行 run_${runId} (关键词: '${keyword}')`);

    // 更新 schedule 的 next_run_at(Week 3 可用 cron-parser 精确计算)
    try {
      // 动态导入 cron-parser(可选依赖,失败时跳过)
      const cronParser = require('cron-parser');
      const interval = cronParser.parseExpression(
        (db.prepare('SELECT cron_expression FROM schedules WHERE id = ?').get(scheduleId) as any)
          ?.cron_expression || '0 * * * *',
        { tz: config.scheduler.timezone },
      );
      const nextRun = interval.next().toDate().toISOString();
      db.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(nextRun, scheduleId);
    } catch {
      // cron-parser 不可用时跳过 next_run_at 计算
    }

    // 调用实际流水线(Week 2 实现 xhs-pipeline.service 后启用)
    try {
      // 动态导入避免循环依赖
      const { runXhsPipeline } = await import('./xhs-pipeline.service');
      await runXhsPipeline(keyword, runId);

      // 标记本次运行为成功
      db.prepare('UPDATE schedules SET last_run_status = ? WHERE id = ?').run('success', scheduleId);
    } catch (e) {
      const err = e as Error;
      log.error(`流水线运行 run_${runId} 失败: ${err.message}`);
      db.prepare('UPDATE schedules SET last_run_status = ?, last_error = ? WHERE id = ?').run(
        'failed',
        err.message,
        scheduleId,
      );
    }
  }
}

// ============================================================================
// 全局单例
// ============================================================================

export const pipelineScheduler = new PipelineScheduler();
