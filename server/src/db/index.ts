import Database from 'better-sqlite3';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

const log = createServiceLogger('database');

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    // 确保数据目录存在
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new Database(config.dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');

    log.info('数据库已连接', { path: config.dbPath });
  }

  return dbInstance;
}

/**
 * 安全添加列 - 若列已存在则跳过。
 *
 * SQLite 不支持 "ADD COLUMN IF NOT EXISTS",
 * 通过 PRAGMA table_info 检测现有列,实现幂等升级。
 */
function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    log.info(`[migrate] 已添加列: ${table}.${column}`);
  }
}

/**
 * 迁移前自动备份数据库。
 *
 * 按照 DATA_PROTECTION_RULES.md 规则，每次执行迁移前必须创建带时间戳的备份。
 * 备份文件命名: {dbPath}.pre-migrate-{timestamp}
 * 备份失败不阻止迁移，但会记录警告。
 */
function backupDatabaseBeforeMigration(dbPath: string): void {
  try {
    if (!fs.existsSync(dbPath)) {
      log.warn('[backup] 数据库文件不存在，跳过迁移前备份');
      return;
    }
    const timestamp = Date.now();
    const backupPath = `${dbPath}.pre-migrate-${timestamp}`;
    fs.copyFileSync(dbPath, backupPath);
    log.info(`[backup] 迁移前数据库备份完成: ${backupPath}`);
  } catch (e) {
    log.warn(`[backup] 迁移前备份失败(不阻止迁移): ${(e as Error).message}`);
  }
}

/**
 * 数据库 schema 升级 - 将原 7 张表演进为 11 张表。
 *
 * 新增表(4 张):
 *   - keywords           关键词管理(xhs-auto-pipeline 移植)
 *   - schedules          定时任务(xhs-auto-pipeline 移植)
 *   - drafts             草稿(xhs-auto-pipeline 移植)
 *   - xhs_login_metadata 登录元数据(xhs-auto-pipeline 移植)
 *
 * 已有表升级:
 *   - pipeline_runs 新增 pipeline_type/keyword/sources_count/report_content 字段
 *     用于支持 xhs-auto-pipeline 的 5 步流水线状态机
 *
 * 数据保护: 迁移前自动备份，迁移仅添加列/表/补全空值，绝不删除数据。
 * 详见 DATA_PROTECTION_RULES.md
 */
export function migrateDb(): void {
  // 迁移前备份（数据保护规则要求）
  backupDatabaseBeforeMigration(config.dbPath);

  const db = getDb();

  // 服务重启后，将上次进程中断留下的 running 运行记录标记为失败，避免界面长期显示“执行中”。
  if ((db.pragma('table_info(business_flow_runs)') as Array<{ name: string }>).length > 0) {
    db.prepare(`
      UPDATE business_flow_runs
      SET status = 'failed', completed_at = COALESCE(completed_at, started_at),
          error = COALESCE(error, '执行进程中断')
      WHERE status = 'running'
    `).run();
  }

  // pipeline_runs 字段升级(向后兼容)
  addColumnIfMissing(db, 'pipeline_runs', 'pipeline_type', "TEXT DEFAULT 'content_ops'");
  addColumnIfMissing(db, 'pipeline_runs', 'keyword', 'TEXT');
  addColumnIfMissing(db, 'pipeline_runs', 'sources_count', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'pipeline_runs', 'report_content', 'TEXT');

  // transcriptions 字段升级（转录台账：全文稿 + AI总结稿 + 模型 + 原始链接名）
  addColumnIfMissing(db, 'transcriptions', 'full_text', 'TEXT');
  addColumnIfMissing(db, 'transcriptions', 'summary', 'TEXT');
  addColumnIfMissing(db, 'transcriptions', 'model', 'TEXT');
  addColumnIfMissing(db, 'transcriptions', 'source_text', 'TEXT');

  // publications 字段升级（记录实际发布引擎）
  addColumnIfMissing(db, 'publications', 'engine', "TEXT DEFAULT 'xhs-skill'");

  // contents 字段升级（收藏功能）
  addColumnIfMissing(db, 'contents', 'is_favorited', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'contents', 'favorited_at', 'TEXT');

  // contents 字段升级（内容模板库 + AI优化）
  addColumnIfMissing(db, 'contents', 'template_id', 'INTEGER');
  addColumnIfMissing(db, 'contents', 'optimization_score', 'REAL');
  addColumnIfMissing(db, 'contents', 'optimization_notes', 'TEXT');

  // contents 字段升级（自定义分组 + 拖拽排序）
  addColumnIfMissing(db, 'contents', 'group_name', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'contents', 'sort_order', 'INTEGER DEFAULT 0');

  // 修复旧记录：full_text 为空但 segments 有数据的记录，从 segments 重新生成 full_text
  try {
    const staleRows = db.prepare(`
      SELECT id, segments, language FROM transcriptions
      WHERE (full_text IS NULL OR full_text = '') AND segments IS NOT NULL AND segments != ''
    `).all() as { id: number; segments: string; language: string | null }[];

    if (staleRows.length > 0) {
      const updateStmt = db.prepare('UPDATE transcriptions SET full_text = ? WHERE id = ?');
      for (const row of staleRows) {
        try {
          const segments = JSON.parse(row.segments);
          if (Array.isArray(segments) && segments.length > 0) {
            const lang = row.language || '';
            const separator = lang.startsWith('zh') || lang.startsWith('ja') ? '' : ' ';
            const fullText = segments
              .map((s: any) => String(s.text || '').trim())
              .filter(Boolean)
              .join(separator);
            if (fullText) {
              updateStmt.run(fullText, row.id);
            }
          }
        } catch {
          // 忽略 JSON 解析失败
        }
      }
      log.info(`[migrate] 已修复 ${staleRows.length} 条转录记录的 full_text 字段`);
    }
  } catch (e) {
    log.warn(`[migrate] 修复 full_text 失败: ${(e as Error).message}`);
  }

  // 修复旧记录：model 为空但状态为 completed 的记录，设置默认模型为 'medium'
  try {
    const modelFixResult = db.prepare(`
      UPDATE transcriptions SET model = 'medium'
      WHERE model IS NULL AND status = 'completed'
    `).run();
    if (modelFixResult.changes > 0) {
      log.info(`[migrate] 已修复 ${modelFixResult.changes} 条转录记录的 model 字段`);
    }
  } catch (e) {
    log.warn(`[migrate] 修复 model 失败: ${(e as Error).message}`);
  }

  // 修复僵尸记录：服务器重启后，将卡在 transient 状态的记录标记为失败
  // 这些记录的 Python 子进程已经随服务器终止而消失，不会继续执行
  try {
    const stuckResult = db.prepare(`
      UPDATE transcriptions SET status = 'failed',
        error_message = '进程异常终止（服务器重启或Python崩溃），请重试'
      WHERE status IN ('transcribing', 'downloading')
    `).run();
    if (stuckResult.changes > 0) {
      log.info(`[migrate] 已修复 ${stuckResult.changes} 条卡住的转录记录（transcribing/downloading → failed）`);
    }
  } catch (e) {
    log.warn(`[migrate] 修复僵尸转录记录失败: ${(e as Error).message}`);
  }

  try {
    const alchemistStuck = db.prepare(`
      UPDATE video_alchemist_runs SET status = 'failed',
        error_message = '进程异常终止，请重试'
      WHERE status = 'processing'
    `).run();
    if (alchemistStuck.changes > 0) {
      log.info(`[migrate] 已修复 ${alchemistStuck.changes} 条卡住的炼金术记录（processing → failed）`);
    }
  } catch (e) {
    log.warn(`[migrate] 修复僵尸炼金术记录失败: ${(e as Error).message}`);
  }

  // 修复早期项目工作流错误数据：失败的视频记录曾被包装为“已完成候选成果”。
  // 只回退节点状态并保留全部输入/输出，用户可直接重试，不删除任何记录。
  try {
    const invalidProjectNodes = db.prepare(`
      UPDATE project_workflow_nodes
      SET status = 'failed',
          error = COALESCE(json_extract(output_snapshot, '$.selected.value.errorMessage'), '上次视频处理失败，请重新执行'),
          updated_at = datetime('now')
      WHERE status = 'completed'
        AND json_valid(output_snapshot)
        AND json_extract(output_snapshot, '$.selected.value.status') = 'failed'
    `).run();
    if (invalidProjectNodes.changes > 0) {
      db.prepare(`
        UPDATE project_workflows
        SET status = 'failed',
            current_node_id = (
              SELECT n.node_id FROM project_workflow_nodes n
              WHERE n.workflow_id = project_workflows.id AND n.status = 'failed'
              ORDER BY n.id LIMIT 1
            ),
            updated_at = datetime('now')
        WHERE EXISTS (
          SELECT 1 FROM project_workflow_nodes n
          WHERE n.workflow_id = project_workflows.id AND n.status = 'failed'
        )
      `).run();
      log.info(`[migrate] 已回退 ${invalidProjectNodes.changes} 个错误标记为完成的项目视频节点`);
    }
  } catch (e) {
    log.warn(`[migrate] 修复项目视频节点状态失败: ${(e as Error).message}`);
  }

  // ============================================================================
  // 系统管理模块升级
  // ============================================================================

  // content_templates 新增 enabled 字段（控制内容工作室中的可见性）
  addColumnIfMissing(db, 'content_templates', 'enabled', 'INTEGER DEFAULT 1');
  addColumnIfMissing(db, 'content_templates', 'is_favorited', 'INTEGER DEFAULT 0');

  // skill_settings: 技能管理表（控制技能的启用/禁用状态）
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_settings (
      name TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      custom_description TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // module_settings: 模块开关表（控制各功能模块的启用/禁用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS module_settings (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT DEFAULT 'content-ops',
      enabled INTEGER DEFAULT 1,
      description TEXT,
      access_url TEXT,
      selected_skill TEXT DEFAULT '',
      selected_llms TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  addColumnIfMissing(db, 'module_settings', 'selected_skill', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'module_settings', 'selected_llms', "TEXT DEFAULT '[]'");
  db.prepare(`
    UPDATE module_settings
    SET selected_skill = ''
    WHERE selected_skill IS NULL
  `).run();
  db.prepare(`
    UPDATE module_settings
    SET selected_llms = '[]'
    WHERE selected_llms IS NULL OR selected_llms = ''
  `).run();

  const legacyContentModule = db
    .prepare("SELECT id FROM module_settings WHERE id = 'content-studio'")
    .get();
  const currentContentModule = db
    .prepare("SELECT id FROM module_settings WHERE id = 'content'")
    .get();
  if (legacyContentModule && !currentContentModule) {
    db.prepare("UPDATE module_settings SET id = 'content' WHERE id = 'content-studio'").run();
  }

  // system_favorites: 统一收藏表（支持模板/Skill/模块/视频/对话收藏）
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(target_type, target_id)
    );
  `);

  // system_prompts: 提示词管理表（统一管理系统各模块使用的提示词）
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      content TEXT NOT NULL DEFAULT '',
      description TEXT DEFAULT '',
      variables TEXT DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // llm_configs: LLM 配置表（运行时动态管理 LLM provider 配置）
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_configs (
      provider TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      api_key TEXT DEFAULT '',
      model TEXT NOT NULL,
      endpoint TEXT DEFAULT '',
      timeout_ms INTEGER DEFAULT 120000,
      display_order INTEGER DEFAULT 0,
      extra_config TEXT DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // api_keys: 外部 API 密钥管理表（集中管理 TikHub 等第三方服务密钥）
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key_name TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT DEFAULT 'external',
      api_key TEXT DEFAULT '',
      description TEXT,
      enabled INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // system_settings: 系统偏好设置表（运行时可编辑的系统级配置）
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      category TEXT DEFAULT 'general',
      label TEXT,
      description TEXT,
      input_type TEXT DEFAULT 'text',
      display_order INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // 迁移后修复：将旧模板的 enabled 全部设为 1
  try {
    db.prepare(`UPDATE content_templates SET enabled = 1 WHERE enabled IS NULL`).run();
  } catch { /* ignore */ }

  log.info('[migrate] 系统管理模块升级完成');
}

export function initDb(): void {
  const db = getDb();

  db.exec(`
    -- ============================================================
    -- 原有 7 张表(保留向后兼容)
    -- ============================================================

    -- 趋势表
    CREATE TABLE IF NOT EXISTS trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      platform TEXT DEFAULT 'xiaohongshu',
      category TEXT,
      heat INTEGER DEFAULT 0,
      growth_rate REAL DEFAULT 0,
      status TEXT DEFAULT 'new',
      discovered_at TEXT DEFAULT (datetime('now')),
      metadata TEXT
    );

    -- 标签表
    CREATE TABLE IF NOT EXISTS hashtags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL,
      platform TEXT DEFAULT 'xiaohongshu',
      volume INTEGER DEFAULT 0,
      growth_rate REAL DEFAULT 0,
      related_tags TEXT,
      trend_id INTEGER,
      researched_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (trend_id) REFERENCES trends(id)
    );

    -- 内容表
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      tags TEXT,
      images TEXT,
      trend_id INTEGER,
      hashtag_ids TEXT,
      status TEXT DEFAULT 'draft',
      generated_at TEXT DEFAULT (datetime('now')),
      published_at TEXT,
      FOREIGN KEY (trend_id) REFERENCES trends(id)
    );

    -- 发布表
    CREATE TABLE IF NOT EXISTS publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL,
      platform TEXT DEFAULT 'xiaohongshu',
      engine TEXT DEFAULT 'xhs-skill',
      post_url TEXT,
      status TEXT DEFAULT 'pending',
      scheduled_at TEXT,
      published_at TEXT,
      error_message TEXT,
      FOREIGN KEY (content_id) REFERENCES contents(id)
    );

    -- 分析表
    CREATE TABLE IF NOT EXISTS analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publication_id INTEGER NOT NULL,
      content_id INTEGER NOT NULL,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      collects INTEGER DEFAULT 0,
      engagement_rate REAL DEFAULT 0,
      tracked_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (publication_id) REFERENCES publications(id),
      FOREIGN KEY (content_id) REFERENCES contents(id)
    );

    -- Pipeline 运行记录表(已通过 migrateDb 扩展字段)
    -- 新字段: pipeline_type, keyword, sources_count, report_content
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'pending',
      current_stage TEXT DEFAULT 'trend_discovery',
      trend_id INTEGER,
      hashtag_ids TEXT,
      content_id INTEGER,
      publication_id INTEGER,
      analytics_id INTEGER,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      error_message TEXT,
      -- 以下字段由 migrateDb 动态添加(对新数据库此处也会创建)
      pipeline_type TEXT DEFAULT 'content_ops',
      keyword TEXT,
      sources_count INTEGER DEFAULT 0,
      report_content TEXT
    );

    -- Pipeline 阶段记录表
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      result TEXT,
      error_message TEXT,
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id)
    );

    -- ============================================================
    -- 新增 4 张表(xhs-auto-pipeline 移植)
    -- ============================================================

    -- 关键词表 - 流水线输入关键词管理
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE,
      name TEXT,
      description TEXT,
      category TEXT,
      enabled INTEGER DEFAULT 1,
      last_used_at TEXT,
      use_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 定时任务表 - node-cron 调度配置
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      keyword TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      run_count INTEGER DEFAULT 0,
      last_run_status TEXT,
      last_error TEXT,
      config TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 草稿表 - 流水线生成的笔记草稿
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_run_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      tags TEXT,
      images TEXT,
      status TEXT DEFAULT 'pending',
      published_at TEXT,
      publish_url TEXT,
      publish_error TEXT,
      review_notes TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id)
    );

    -- 小红书登录元数据表 - Cookie 生命周期管理
    CREATE TABLE IF NOT EXISTS xhs_login_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      is_logged_in INTEGER DEFAULT 0,
      last_login_time TEXT,
      last_check_time TEXT,
      last_refresh_time TEXT,
      browser TEXT,
      cookie_age_days REAL DEFAULT 0,
      will_expire_soon INTEGER DEFAULT 0,
      is_expired INTEGER DEFAULT 0,
      login_count INTEGER DEFAULT 0,
      refresh_count INTEGER DEFAULT 0,
      consecutive_failures INTEGER DEFAULT 0,
      metadata_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 视频内容炼金术运行记录表
    -- 输入视频 URL → 提取文字 → 提炼核心观点 → 改写多平台图文
    -- ============================================================
    CREATE TABLE IF NOT EXISTS video_alchemist_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_url TEXT NOT NULL,
      platform TEXT DEFAULT 'auto',
      transcript TEXT,
      key_points TEXT, -- JSON array
      rewritten_title TEXT,
      rewritten_body TEXT,
      rewritten_tags TEXT, -- JSON array
      images TEXT, -- comma-separated paths
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 视频转录记录表
    -- 使用 faster-whisper 进行本地 ASR 转录
    -- ============================================================
    CREATE TABLE IF NOT EXISTS transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      audio_path TEXT,
      transcript TEXT,
      segments TEXT, -- JSON array
      full_text TEXT, -- 全文稿：去除时间戳的纯文本拼接
      summary TEXT, -- 总结稿：AI LLM 生成的内容摘要
      language TEXT,
      duration REAL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      model TEXT, -- 使用的 Whisper 模型 (tiny/base/small/medium/large-v3)
      source_text TEXT -- 原始链接名（用户输入的原始文本，如B站分享文本）
    );

    -- ============================================================
    -- 评论分析记录表 (comments-analysis skill 集成)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS comment_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      target_url TEXT,
      total_count INTEGER DEFAULT 0,
      positive_count INTEGER DEFAULT 0,
      neutral_count INTEGER DEFAULT 0,
      negative_count INTEGER DEFAULT 0,
      top_comments TEXT, -- JSON array of CommentItem
      themes TEXT, -- JSON array of ThemeCluster
      keywords TEXT, -- JSON array of {word, count}
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 媒体下载记录表 (social-media-downloader skill 集成)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS media_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT,
      author TEXT,
      media_items TEXT, -- JSON array of MediaItem
      local_paths TEXT, -- JSON array of local file paths
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 业务流线表 (BusinessFlow - 类似"扣子"的自定义流程编排)
    -- 用户可拖拽 skill 和模块组成新的业务流线
    -- ============================================================
    CREATE TABLE IF NOT EXISTS business_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      nodes TEXT NOT NULL,        -- JSON array of flow nodes (skill/module references with positions)
      edges TEXT NOT NULL,        -- JSON array of flow edges (connections between nodes)
      status TEXT DEFAULT 'draft', -- 'draft' | 'active' | 'archived'
      last_run_at TEXT,
      run_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 业务流线运行记录（追加式，可追溯每次执行）
    CREATE TABLE IF NOT EXISTS business_flow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      input_data TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (flow_id) REFERENCES business_flows(id) ON DELETE CASCADE
    );

    -- 业务流线逐节点运行结果
    CREATE TABLE IF NOT EXISTS business_flow_step_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      flow_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      node_label TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      attempt INTEGER DEFAULT 1,
      provider TEXT,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES business_flow_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (flow_id) REFERENCES business_flows(id) ON DELETE CASCADE
    );

    -- 项目工作流：从业务蓝图创建的某一次真实执行实例
    CREATE TABLE IF NOT EXISTS project_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      mode TEXT NOT NULL DEFAULT 'step',
      initial_input TEXT NOT NULL DEFAULT '{}',
      nodes_snapshot TEXT NOT NULL,
      edges_snapshot TEXT NOT NULL,
      current_node_id TEXT,
      final_content_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (flow_id) REFERENCES business_flows(id) ON DELETE RESTRICT,
      FOREIGN KEY (final_content_id) REFERENCES contents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS project_workflow_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      module_id TEXT NOT NULL,
      label TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      prompt TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      input_snapshot TEXT,
      output_snapshot TEXT,
      output_type TEXT,
      artifact_refs TEXT,
      source_refs TEXT,
      provider TEXT,
      model TEXT,
      error TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(workflow_id, node_id),
      FOREIGN KEY (workflow_id) REFERENCES project_workflows(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- 对话表 (Content Studio 多轮对话)
    -- 支持与 LLM 进行多轮对话式内容创作
    -- ============================================================
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '新对话',
      mode TEXT DEFAULT 'discuss', -- 'discuss' = 正常讨论 | 'keyword' = 关键词提取
      status TEXT DEFAULT 'active', -- 'active' | 'confirmed' | 'archived'
      confirmed_message_id INTEGER, -- 确认的消息 ID
      generated_content_id INTEGER,  -- 生成的内容 ID
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 对话消息表
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
      content TEXT NOT NULL,
      mode TEXT, -- 'discuss' | 'keyword' (用户消息的模式)
      extracted_keywords TEXT, -- JSON array (keyword 模式下提取的关键词)
      confirmed INTEGER DEFAULT 0, -- 是否已确认
      llm_provider TEXT, -- 实际使用的 LLM 提供商
      duration_ms INTEGER, -- LLM 响应耗时
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- 内容模板表
    -- ============================================================
    CREATE TABLE IF NOT EXISTS content_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      subcategory TEXT,
      title_formula TEXT,
      content_structure TEXT,
      tags TEXT,
      emoji_style TEXT,
      word_count_range TEXT,
      best_for TEXT,
      sample_title TEXT,
      sample_body TEXT,
      usage_count INTEGER DEFAULT 0,
      is_builtin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 插入模板种子数据（17 类内置模板）
  db.exec(`
    INSERT OR IGNORE INTO content_templates (name, description, category, subcategory, title_formula, content_structure, tags, emoji_style, word_count_range, best_for, sample_title, sample_body, is_builtin) VALUES
    ('干货测评型', '以专业测评+避坑指南为核心，适合知识科普类内容', '干货类', '测评避坑', '{数字}+{场景}必看！{痛点}避坑指南，第{数字}个99%人不知道', '引言(痛点共鸣)→ 分点干货(每点=emoji+加粗标题+2-3句详解)→ 总结(一句话精华)→ 互动引导', '测评,避坑,攻略,知识科普', '📊💡⚠️✅❌🔥', '800-1500字', '知识科普、产品测评、行业避坑', '2025必看！装修避坑指南，第7个99%人不知道', '装修前看了100篇攻略，总结了这些血泪教训...', 1),
    ('好物合集型', '信息量大、内容集中，以合集形式展示', '合集类', '好物推荐', '{数字}款{品类}合集｜从入门到高阶，一篇搞定', '开篇引入→ 分类展示(每类=emoji+名称+特点+适用人群)→ 对比表格→ 总结推荐', '合集,推荐,清单,好物', '✨📦🎁💯🌟', '600-1200字', '产品推荐、书单、工具合集', '10款宝藏APP合集｜从入门到高阶，一篇搞定', '用了3年手机，这10个APP是我最不舍得删的...', 1),
    ('对比测评型', '通过对比展示差异，提升用户阅读兴趣', '对比类', '产品对比', '{产品A} vs {产品B}｜{维度}对比，结果出乎意料', '背景说明→ 多维度对比(价格/效果/体验等)→ 总结评分→ 购买建议', '对比,测评,选择困难,推荐', '⚡🆚📊👀🏆', '800-1500字', '产品对比、方法对比、前后对比', 'iPhone vs 华为｜拍照对比，结果出乎意料', '用了两款手机各一个月，拍了几百张照片后...', 1),
    ('问题解答型', '针对用户痛点给答案，适合专业知识输出', '问题解答类', 'Q&A', '{数字}个{领域}常见问题，一次说清楚！', '问题引入→ 逐个回答(问题=加粗+回答=2-4句)→ 补充建议→ 评论互动', '问答,科普,解惑,新手必看', '❓💬📝💡🙋', '500-1000字', '专业知识、经验科普、问题答疑', '10个新手化妆常见问题，一次说清楚！', '刚学化妆时踩过的坑，今天全部分享出来...', 1),
    ('故事分享型', '以个人经历为主，IP人设打造', '故事分享类', '个人成长', '从{状态A}到{状态B}，我用了{时间}，{关键转折}改变了一切', '背景铺垫→ 转折点→ 努力过程→ 成果展示→ 心得总结→ 鼓励读者', '成长故事,个人IP,逆袭,励志', '🌟💪🔥✨📖', '800-2000字', '个人成长、逆袭故事、创业经历', '从月薪3k到月入3w，我用了1年，这个习惯改变了一切', '一年前的今天，我还在为房租发愁...', 1),
    ('体验分享型', '以真实感受分享产品/服务，适合种草', '体验分享类', '探店体验', '去{地点/品牌}体验了{服务}，说点大实话...', '背景/契机→ 体验过程(细节描述)→ 亮点/槽点→ 性价比分析→ 是否推荐', '探店,体验,种草,真实分享', '🏃🎬🍜💆🎯', '600-1200字', '探店、旅游、服务体验、产品试用', '去海底捞体验了美甲服务，说点大实话...', '周末无聊，朋友说去做个美甲，结果发现...', 1),
    ('教程攻略型', '手把手教学，步骤清晰明了', '干货类', '教程攻略', '{数字}步学会{技能}｜新手也能轻松上手', '效果预览→ 准备清单→ 分步教程(每步=序号+标题+说明)→ 常见问题→ 成品展示', '教程,攻略,DIY,新手', '📝🔧📐✂️🎨', '800-2000字', '手工教程、软件教程、生活技能', '5步学会手机修图｜新手也能轻松上手', '以前总羡慕别人的照片好看，直到我发现了...', 1),
    ('日常Vlog型', '从日常生活中找亮点，持续输出', '日常分享类', 'Vlog', '记录我的{日常主题}日常｜{时间}，{小亮点}', '开场(今日主题)→ 过程记录→ 小高潮/亮点→ 收尾感悟→ 明日预告', '日常,vlog,生活记录,治愈', '📷🌿☕🐱🌇', '400-800字', '日常生活、工作记录、学习打卡', '记录我的周末日常｜星期六，终于去了那家咖啡店', '这周工作太累了，周末决定给自己放个小假...', 1),
    ('产品种草型', '真实感受分享产品，适合带货', '产品种草类', '美妆护肤', '用了{时间}{产品}，我的{部位/状态}发生了这些变化...', 'before状态→ 使用过程→ after对比→ 成分/原理分析→ 适合人群→ 购买建议', '种草,测评,护肤,美妆', '💄✨🧴🌸💋', '600-1200字', '护肤品、化妆品、生活好物', '用了30天这款精华，我的皮肤发生了这些变化...', '换季的时候皮肤状态特别差，直到朋友推了这款...', 1),
    ('行业洞察型', '深度分析行业趋势，适合专业内容', '干货类', '行业分析', '{行业}人必看｜{时间}{趋势/数据}解读，未来{方向}才是关键', '数据引入→ 趋势分析(3-5点)→ 案例佐证→ 机会/挑战→ 行动建议', '行业分析,趋势,洞察,职场', '📈🔍💼🌐⚡', '1000-2500字', '行业分析、职场洞察、趋势解读', 'AI从业者必看｜2025最新趋势解读，未来这个方向才是关键', '最近跟几位行业大佬聊了聊，发现一个共识...', 1),
    ('清单盘点型', '盘点式内容，信息密度高', '合集类', '盘点总结', '{数字}个{主题}｜全部知道的都是大佬', '总述(引起兴趣)→ 逐项盘点(每项=序号+名称+一句话描述)→ 总结(最推荐哪项)→ 互动', '盘点,总结,科普,冷知识', '🔢📋🧠💎🎯', '600-1000字', '知识盘点、冷知识、年度总结', '30个生活冷知识｜全部知道的都是大佬', '有些冷知识真的可以帮你省不少事，比如...', 1),
    ('评论互动型', '以互动为核心，提升笔记数据', '钩子类', '互动话题', '说一个你{领域}最{极端描述}的经历，我先来...', '抛出话题→ 分享自己经历→ 引导读者分享→ 评论互动维护', '互动,话题,讨论,社交', '💬🔥🎭🤔👀', '300-600字', '话题讨论、社区互动、引流', '说一个你面试时最离谱的经历，我先来...', '想起那年面试，面试官竟然...', 1),
    ('装修家居型', '家居装修风格展示与预算分享', '装修装饰类', '全屋装修', '{面积}㎡{风格}装修｜花了{金额}，附全部清单', '装修前状况→ 设计理念→ 分区展示(客厅/卧室/厨卫)→ 费用清单→ 避坑经验', '装修,家居,设计,预算', '🏠🛋️🪴💡🖼️', '800-2000字', '装修分享、家居设计、改造案例', '89㎡日式原木风装修｜花了15w，附全部清单', '装修前纠结了半年，最后选了原木风...', 1),
    ('母婴育儿型', '母婴经验分享与育儿知识', '干货类', '母婴育儿', '{宝宝月龄}宝妈必看｜关于{育儿痛点}，儿科医生这样说', '痛点引入→ 专业知识→ 个人经验→ 注意事项→ 推荐好物', '母婴,育儿,宝妈,经验', '👶🍼🧸💕🏥', '600-1500字', '育儿经验、母婴好物、孕期知识', '6月龄宝妈必看｜关于辅食添加，儿科医生这样说', '宝宝满6个月那天我开始焦虑，辅食到底怎么加...', 1),
    ('美食教程型', '菜谱与美食分享', '干货类', '美食教程', '{难度}{菜名}｜{口感描述}，{时间}搞定', '成品展示→ 食材清单→ 详细步骤→ 小贴士→ 成品再展示', '美食,菜谱,家常菜,烘焙', '🍳🍰🥘🍜🍱', '500-1000字', '美食教程、菜谱分享、饮品制作', '超简单！空气炸锅版烤鸡翅｜外酥里嫩，20分钟搞定', '最近沉迷空气炸锅，发现烤鸡翅简直太方便了...', 1),
    ('穿搭分享型', '穿搭搭配与时尚分享', '干货类', '穿搭搭配', '{季节/场景}穿搭｜{风格}这样穿，{效果}', '场景/季节引入→ 搭配方案(2-4套)→ 单品分析→ 穿搭技巧→ 购买渠道', '穿搭,时尚,搭配,OOTD', '👗👠👜🎀🌺', '400-800字', '日常穿搭、职场穿搭、季节穿搭', '初秋通勤穿搭｜温柔系这样穿，显高又显瘦', '换季的时候最头疼的就是早上穿什么...', 1),
    ('旅行攻略型', '目的地攻略与旅行分享', '干货类', '旅行攻略', '{地点}{天数}日游攻略｜人均{金额}，玩遍精华', '目的地简介→ 行程安排→ 费用明细→ 住宿推荐→ 避坑指南→ 美食推荐', '旅行,攻略,游记,打卡', '✈️🗺️🏖️📸🍽️', '1000-2500字', '旅行攻略、短途游、出境游', '重庆3日游攻略｜人均1500，玩遍精华', '最近去了一趟重庆，真的被这座城市迷住了...', 1);
  `);

  // 先执行字段升级(为已存在的 pipeline_runs 添加新列),
  // 然后再创建索引(索引可能引用新列,如 idx_pipeline_runs_keyword)
  migrateDb();

  // 创建索引(此时所有列都已存在)
  db.exec(`
    -- ============================================================
    -- 索引(原有 + 新增)
    -- ============================================================
    CREATE INDEX IF NOT EXISTS idx_trends_status ON trends(status);
    CREATE INDEX IF NOT EXISTS idx_trends_platform ON trends(platform);
    CREATE INDEX IF NOT EXISTS idx_contents_status ON contents(status);
    CREATE INDEX IF NOT EXISTS idx_contents_trend ON contents(trend_id);
    CREATE INDEX IF NOT EXISTS idx_contents_group ON contents(group_name);
    CREATE INDEX IF NOT EXISTS idx_contents_sort ON contents(sort_order);
    CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);
    CREATE INDEX IF NOT EXISTS idx_publications_content ON publications(content_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_publication ON analytics(publication_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_keyword ON pipeline_runs(keyword);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_type ON pipeline_runs(pipeline_type);
    CREATE INDEX IF NOT EXISTS idx_pipeline_stages_run ON pipeline_stages(run_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);
    CREATE INDEX IF NOT EXISTS idx_keywords_enabled ON keywords(enabled);
    CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
    CREATE INDEX IF NOT EXISTS idx_schedules_keyword ON schedules(keyword);
    CREATE INDEX IF NOT EXISTS idx_drafts_run_id ON drafts(pipeline_run_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
    CREATE INDEX IF NOT EXISTS idx_video_alchemist_runs_status ON video_alchemist_runs(status);
    CREATE INDEX IF NOT EXISTS idx_video_alchemist_runs_platform ON video_alchemist_runs(platform);
    CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);
    CREATE INDEX IF NOT EXISTS idx_transcriptions_url ON transcriptions(url);
    CREATE INDEX IF NOT EXISTS idx_comment_analyses_status ON comment_analyses(status);
    CREATE INDEX IF NOT EXISTS idx_comment_analyses_platform ON comment_analyses(platform);
    CREATE INDEX IF NOT EXISTS idx_media_downloads_status ON media_downloads(status);
    CREATE INDEX IF NOT EXISTS idx_media_downloads_platform ON media_downloads(platform);
    CREATE INDEX IF NOT EXISTS idx_business_flows_status ON business_flows(status);
    CREATE INDEX IF NOT EXISTS idx_business_flow_runs_flow ON business_flow_runs(flow_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_business_flow_step_runs_run ON business_flow_step_runs(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_project_workflows_flow ON project_workflows(flow_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_workflow_nodes_workflow ON project_workflow_nodes(workflow_id, id);
    CREATE INDEX IF NOT EXISTS idx_project_workflow_nodes_status ON project_workflow_nodes(workflow_id, status);
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_content_templates_category ON content_templates(category);
    CREATE INDEX IF NOT EXISTS idx_content_templates_builtin ON content_templates(is_builtin);
    CREATE INDEX IF NOT EXISTS idx_api_keys_category ON api_keys(category);
    CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
  `);

  log.info('数据库表已初始化(21 张表)');
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    log.info('数据库连接已关闭');
  }
}
