/**
 * 关键词管理路由 (从 xhs-auto-pipeline 移植)
 *
 * 端点:
 *   GET    /api/xhs-keywords           获取关键词列表(支持 ?enabled=1 筛选)
 *   POST   /api/xhs-keywords           新增关键词
 *   PUT    /api/xhs-keywords/:id       更新关键词
 *   DELETE /api/xhs-keywords/:id       删除关键词
 *   POST   /api/xhs-keywords/:id/trigger  立即用该关键词触发流水线
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { createAndStartPipeline } from '../services/xhs-pipeline.service';

const log = createServiceLogger('xhs-keywords-routes');
export const router = Router();

/**
 * 老数据库/从其他工作目录启动时，关键词表可能尚未完成迁移。
 * 这里做一次幂等兜底，避免流水线控制台因表不存在直接返回 500。
 */
function ensureKeywordsTable(db: ReturnType<typeof getDb>): void {
  db.exec(`
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
    )
  `);
}

// GET /api/xhs-keywords - 获取关键词列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureKeywordsTable(db);
    const enabled = req.query.enabled as string | undefined;

    let sql = 'SELECT * FROM keywords';
    const params: any[] = [];
    if (enabled !== undefined) {
      sql += ' WHERE enabled = ?';
      params.push(enabled === '1' || enabled === 'true' ? 1 : 0);
    }
    sql += ' ORDER BY id DESC';

    const keywords = db.prepare(sql).all(...params);
    res.json({ success: true, data: keywords });
  } catch (e) {
    log.error('获取关键词列表失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-keywords - 新增关键词
router.post('/', async (req: Request, res: Response) => {
  try {
    const { keyword, name, description, category, enabled } = req.body as any;
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ success: false, error: '缺少 keyword 参数' });
    }

    const db = getDb();
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT OR IGNORE INTO keywords (keyword, name, description, category, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      keyword.trim(),
      name || null,
      description || null,
      category || null,
      enabled === false ? 0 : 1,
      now,
      now,
    );

    if (result.changes === 0) {
      return res.status(409).json({ success: false, error: `关键词 '${keyword}' 已存在` });
    }

    log.info(`新增关键词: ${keyword}`);
    res.json({
      success: true,
      data: { id: result.lastInsertRowid, keyword: keyword.trim() },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// PUT /api/xhs-keywords/:id - 更新关键词
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 id' });
    }

    const { keyword, name, description, category, enabled } = req.body as any;
    const db = getDb();
    const now = new Date().toISOString();

    const result = db.prepare(`
      UPDATE keywords SET
        keyword = COALESCE(?, keyword),
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        enabled = COALESCE(?, enabled),
        updated_at = ?
      WHERE id = ?
    `).run(
      keyword?.trim() || null,
      name || null,
      description || null,
      category || null,
      enabled === undefined ? null : enabled ? 1 : 0,
      now,
      id,
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: `关键词 ${id} 不存在` });
    }

    res.json({ success: true, data: { id } });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// DELETE /api/xhs-keywords/:id - 删除关键词
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const result = db.prepare('DELETE FROM keywords WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: `关键词 ${id} 不存在` });
    }

    res.json({ success: true, message: `关键词 ${id} 已删除` });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-keywords/:id/trigger - 立即用该关键词触发流水线
router.post('/:id/trigger', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();

    const kw = db.prepare('SELECT * FROM keywords WHERE id = ?').get(id) as any;
    if (!kw) {
      return res.status(404).json({ success: false, error: `关键词 ${id} 不存在` });
    }

    const runId = createAndStartPipeline(kw.keyword);
    log.info(`关键词 ${id} ('${kw.keyword}') 触发流水线 run_${runId}`);

    res.json({
      success: true,
      data: { run_id: runId, keyword: kw.keyword },
      message: `已用关键词 '${kw.keyword}' 启动流水线`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
