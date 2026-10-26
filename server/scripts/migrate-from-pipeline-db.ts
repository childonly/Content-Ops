/**
 * 数据迁移脚本: 将 xhs-auto-pipeline 的 pipeline.db 迁移到 content-ops-hub.db
 *
 * 迁移内容:
 *   - keywords 表         (xhs-auto-pipeline → content-ops-hub)
 *   - schedules 表        (xhs-auto-pipeline → content-ops-hub)
 *   - drafts 表           (xhs-auto-pipeline → content-ops-hub)
 *   - pipeline_runs 表    (xhs-auto-pipeline.keyword/sources_count/report_content → content-ops-hub,pipeline_type='xhs_auto')
 *
 * 使用方式:
 *   cd content-ops-hub/server
 *   npx ts-node --transpile-only scripts/migrate-from-pipeline-db.ts
 *
 * 安全保证:
 *   - 只读取 pipeline.db,不修改
 *   - 使用 INSERT OR IGNORE 避免重复导入
 *   - 迁移前自动备份数据库
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ============================================================================
// 路径配置
// ============================================================================

const CONTENT_OPS_DB = path.join(process.cwd(), 'data', 'content-ops-hub.db');
const PIPELINE_DB = path.join(
  'e:',
  '000 【AI-项目】',
  'Trae_work',
  'xhs-auto-pipeline',
  'backend',
  'data',
  'pipeline.db',
);

// ============================================================================
// 主迁移逻辑
// ============================================================================

function main(): void {
  console.log('=== 数据迁移: pipeline.db → content-ops-hub.db ===\n');

  // 检查源数据库
  if (!fs.existsSync(PIPELINE_DB)) {
    console.log(`⚠ 源数据库不存在: ${PIPELINE_DB}`);
    console.log('  (若 xhs-auto-pipeline 从未运行过,这是正常的,跳过迁移)');
    return;
  }

  // 检查目标数据库
  if (!fs.existsSync(CONTENT_OPS_DB)) {
    console.log(`✗ 目标数据库不存在: ${CONTENT_OPS_DB}`);
    console.log('  请先运行 npm run db:init 初始化 content-ops-hub.db');
    process.exit(1);
  }

  // 备份目标数据库
  const backupPath = `${CONTENT_OPS_DB}.migrate-backup-${Date.now()}`;
  fs.copyFileSync(CONTENT_OPS_DB, backupPath);
  console.log(`✓ 已备份目标数据库: ${backupPath}\n`);

  const target = new Database(CONTENT_OPS_DB);
  target.pragma('journal_mode = WAL');
  target.pragma('foreign_keys = ON');

  const source = new Database(PIPELINE_DB, { readonly: true });

  try {
    // ============================================================
    // 1. 迁移 keywords 表
    // ============================================================
    console.log('--- 迁移 keywords 表 ---');
    const keywords = source.prepare('SELECT * FROM keywords').all() as any[];
    console.log(`  源数据: ${keywords.length} 条`);

    const insertKeyword = target.prepare(`
      INSERT OR IGNORE INTO keywords (keyword, name, description, category, enabled, last_used_at, use_count, created_at, updated_at)
      VALUES (@keyword, @name, @description, @category, @enabled, @last_used_at, @use_count, @created_at, @updated_at)
    `);

    let kwCount = 0;
    for (const kw of keywords) {
      const result = insertKeyword.run({
        keyword: kw.keyword,
        name: kw.name || null,
        description: kw.description || null,
        category: kw.category || null,
        enabled: kw.enabled ? 1 : 1, // xhs-auto-pipeline 的 keywords 默认全部启用
        last_used_at: kw.last_used_at || null,
        use_count: kw.use_count || 0,
        created_at: kw.created_at || new Date().toISOString(),
        updated_at: kw.updated_at || new Date().toISOString(),
      });
      if (result.changes > 0) kwCount++;
    }
    console.log(`  已导入: ${kwCount} 条 (跳过 ${keywords.length - kwCount} 条重复)\n`);

    // ============================================================
    // 2. 迁移 schedules 表
    // ============================================================
    console.log('--- 迁移 schedules 表 ---');
    let schedules: any[] = [];
    try {
      schedules = source.prepare('SELECT * FROM schedules').all() as any[];
    } catch {
      console.log('  源表不存在,跳过');
    }
    console.log(`  源数据: ${schedules.length} 条`);

    const insertSchedule = target.prepare(`
      INSERT OR IGNORE INTO schedules (name, keyword, cron_expression, enabled, last_run_at, next_run_at, run_count, last_run_status, last_error, config, created_at, updated_at)
      VALUES (@name, @keyword, @cron_expression, @enabled, @last_run_at, @next_run_at, @run_count, @last_run_status, @last_error, @config, @created_at, @updated_at)
    `);

    let schedCount = 0;
    for (const sc of schedules) {
      const result = insertSchedule.run({
        name: sc.name,
        keyword: sc.keyword,
        cron_expression: sc.cron_expression,
        enabled: sc.enabled ? 1 : 0,
        last_run_at: sc.last_run_at || null,
        next_run_at: sc.next_run_at || null,
        run_count: sc.run_count || 0,
        last_run_status: sc.last_run_status || null,
        last_error: sc.last_error || null,
        config: sc.config || null,
        created_at: sc.created_at || new Date().toISOString(),
        updated_at: sc.updated_at || new Date().toISOString(),
      });
      if (result.changes > 0) schedCount++;
    }
    console.log(`  已导入: ${schedCount} 条\n`);

    // ============================================================
    // 3. 迁移 pipeline_runs 表(只迁移 xhs-auto-pipeline 的字段)
    // ============================================================
    console.log('--- 迁移 pipeline_runs 表 ---');
    const pipelineRuns = source.prepare('SELECT * FROM pipeline_runs').all() as any[];
    console.log(`  源数据: ${pipelineRuns.length} 条`);

    const insertRun = target.prepare(`
      INSERT INTO pipeline_runs (pipeline_type, keyword, status, current_stage, sources_count, report_content, started_at, completed_at, error_message)
      VALUES ('xhs_auto', @keyword, @status, @current_stage, @sources_count, @report_content, @started_at, @completed_at, @error_message)
    `);

    let runCount = 0;
    for (const run of pipelineRuns) {
      insertRun.run({
        keyword: run.keyword || null,
        status: run.status || 'pending',
        current_stage: run.current_stage || 'researching',
        sources_count: run.sources_count || 0,
        report_content: run.report_content || null,
        started_at: run.started_at || new Date().toISOString(),
        completed_at: run.completed_at || null,
        error_message: run.error_message || null,
      });
      runCount++;
    }
    console.log(`  已导入: ${runCount} 条 (pipeline_type='xhs_auto')\n`);

    // ============================================================
    // 4. 迁移 drafts 表
    // ============================================================
    console.log('--- 迁移 drafts 表 ---');
    let drafts: any[] = [];
    try {
      drafts = source.prepare('SELECT * FROM drafts').all() as any[];
    } catch {
      console.log('  源表不存在,跳过');
    }
    console.log(`  源数据: ${drafts.length} 条`);

    // 需要建立 旧 pipeline_run_id → 新 pipeline_run_id 的映射
    // 简化处理: 按 keyword + started_at 匹配
    const insertDraft = target.prepare(`
      INSERT INTO drafts (pipeline_run_id, title, content, tags, images, status, published_at, publish_url, publish_error, created_at, updated_at)
      VALUES (
        (SELECT id FROM pipeline_runs WHERE pipeline_type = 'xhs_auto' AND keyword = @keyword
         ORDER BY ABS(julianday(started_at) - julianday(@started_at)) LIMIT 1),
        @title, @content, @tags, @images, @status, @published_at, @publish_url, @publish_error, @created_at, @updated_at
      )
    `);

    let draftCount = 0;
    for (const draft of drafts) {
      // 先获取源 pipeline_run 的 keyword + started_at
      const sourceRun = source.prepare('SELECT keyword, started_at FROM pipeline_runs WHERE id = ?').get(draft.pipeline_run_id) as any;

      const result = insertDraft.run({
        keyword: sourceRun?.keyword || null,
        started_at: sourceRun?.started_at || new Date().toISOString(),
        title: draft.title,
        content: draft.content || null,
        tags: draft.tags || null,
        images: draft.images || null,
        status: draft.status || 'pending',
        published_at: draft.published_at || null,
        publish_url: draft.publish_url || null,
        publish_error: draft.publish_error || null,
        created_at: draft.created_at || new Date().toISOString(),
        updated_at: draft.updated_at || new Date().toISOString(),
      });
      if (result.changes > 0) draftCount++;
    }
    console.log(`  已导入: ${draftCount} 条\n`);

    // ============================================================
    // 汇总
    // ============================================================
    console.log('=== 迁移完成 ===');
    console.log(`  keywords:       ${kwCount} 条`);
    console.log(`  schedules:      ${schedCount} 条`);
    console.log(`  pipeline_runs:  ${runCount} 条`);
    console.log(`  drafts:         ${draftCount} 条`);
    console.log(`\n备份文件: ${backupPath}`);
    console.log(`\n注意: 若需要回滚,可用备份文件覆盖 ${CONTENT_OPS_DB}`);
  } finally {
    source.close();
    target.close();
  }
}

main();
