/**
 * 系统管理路由 — /api/admin
 *
 * 统一管理模板库、技能、LLM 配置、模块开关。
 * 管理操作应用于全项目，包括内容工作室的模板可见性控制等。
 *
 * 端点:
 *   GET    /templates    模板列表（含 enabled 过滤）
 *   PUT    /templates/:id 更新模板（含 enabled 切换）
 *   POST   /templates    新增模板
 *   DELETE /templates/:id 删除模板
 *
 *   GET    /skills       技能列表
 *   PUT    /skills/:name  更新技能设置
 *
 *   GET    /llm-config   LLM 配置列表
 *   PUT    /llm-config/:provider 更新 LLM 配置
 *
 *   GET    /modules      模块列表
 *   PUT    /modules/:id   更新模块设置
 *
 *   GET    /favorites    收藏列表
 *   POST   /favorites    添加收藏
 *   DELETE /favorites/:type/:id 取消收藏
 *
 *   GET    /stats        系统概览统计
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import {
  listModuleRuntimeConfigs,
  RuntimeConfigValidationError,
  updateModuleRuntimeConfig,
} from '../services/runtime-config.service';

const log = createServiceLogger('admin');
export const router = Router();

// ============================================================================
// 模板管理
// ============================================================================

router.get('/templates', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.*,
        CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END AS is_favorited
      FROM content_templates t
      LEFT JOIN system_favorites sf ON sf.target_type = 'template' AND sf.target_id = CAST(t.id AS TEXT)
      ORDER BY t.is_builtin DESC, t.usage_count DESC
    `).all();
    return res.json({ success: true, data: rows });
  } catch (e) {
    log.error(`获取模板列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.put('/templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, description, category, subcategory, title_formula, content_structure,
      tags, emoji_style, word_count_range, best_for, sample_title, sample_body, enabled } = req.body;

    // 仅更新传入的非 undefined 字段
    const fields: string[] = [];
    const values: any[] = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (category !== undefined) { fields.push('category = ?'); values.push(category); }
    if (subcategory !== undefined) { fields.push('subcategory = ?'); values.push(subcategory); }
    if (title_formula !== undefined) { fields.push('title_formula = ?'); values.push(title_formula); }
    if (content_structure !== undefined) { fields.push('content_structure = ?'); values.push(content_structure); }
    if (tags !== undefined) { fields.push('tags = ?'); values.push(tags); }
    if (emoji_style !== undefined) { fields.push('emoji_style = ?'); values.push(emoji_style); }
    if (word_count_range !== undefined) { fields.push('word_count_range = ?'); values.push(word_count_range); }
    if (best_for !== undefined) { fields.push('best_for = ?'); values.push(best_for); }
    if (sample_title !== undefined) { fields.push('sample_title = ?'); values.push(sample_title); }
    if (sample_body !== undefined) { fields.push('sample_body = ?'); values.push(sample_body); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(Number(enabled)); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: '无更新字段' });
    }

    fields.push("updated_at = datetime('now','localtime')");
    values.push(Number(id));

    db.prepare(`UPDATE content_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    log.info(`模板 ${id}: 已更新 ${fields.length - 1} 个字段`);

    const updated = db.prepare('SELECT * FROM content_templates WHERE id = ?').get(id);
    return res.json({ success: true, data: updated });
  } catch (e) {
    log.error(`更新模板失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, description, category, subcategory, title_formula, content_structure,
      tags, emoji_style, word_count_range, best_for, sample_title, sample_body } = req.body;

    if (!name || !category) {
      return res.status(400).json({ success: false, error: 'name 和 category 为必填字段' });
    }

    const result = db.prepare(`
      INSERT INTO content_templates (name, description, category, subcategory, title_formula,
        content_structure, tags, emoji_style, word_count_range, best_for, sample_title, sample_body,
        is_builtin, usage_count, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
    `).run(name, description || '', category, subcategory || '', title_formula || '',
      content_structure || '', tags || '', emoji_style || '', word_count_range || '',
      best_for || '', sample_title || '', sample_body || '');

    const newTemplate = db.prepare('SELECT * FROM content_templates WHERE id = ?').get(result.lastInsertRowid);
    log.info(`新模板已创建: "${name}" (id=${result.lastInsertRowid})`);
    return res.json({ success: true, data: newTemplate });
  } catch (e) {
    log.error(`创建模板失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.delete('/templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const template = db.prepare('SELECT is_builtin FROM content_templates WHERE id = ?').get(id) as any;
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    if (template.is_builtin) {
      return res.status(403).json({ success: false, error: '内置模板不可删除，可以禁用（enabled=0）' });
    }
    db.prepare('DELETE FROM content_templates WHERE id = ?').run(id);
    log.info(`模板 ${id}: 已删除`);
    return res.json({ success: true, message: '已删除' });
  } catch (e) {
    log.error(`删除模板失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// 技能管理
// ============================================================================

router.get('/skills', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT ss.*,
        CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END AS is_favorited
      FROM skill_settings ss
      LEFT JOIN system_favorites sf ON sf.target_type = 'skill' AND sf.target_id = ss.name
      ORDER BY ss.display_order
    `).all();
    return res.json({ success: true, data: rows });
  } catch (e) {
    log.error(`获取技能列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.put('/skills/:name', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name } = req.params;
    const { enabled, label, display_order, custom_description } = req.body;

    // upsert
    const existing = db.prepare('SELECT name FROM skill_settings WHERE name = ?').get(name);
    if (existing) {
      const fields: string[] = [];
      const values: any[] = [];
      if (enabled !== undefined) { fields.push('enabled = ?'); values.push(Number(enabled)); }
      if (label !== undefined) { fields.push('label = ?'); values.push(label); }
      if (display_order !== undefined) { fields.push('display_order = ?'); values.push(display_order); }
      if (custom_description !== undefined) { fields.push('custom_description = ?'); values.push(custom_description); }
      fields.push("updated_at = datetime('now','localtime')");
      values.push(name);
      if (fields.length > 1) {
        db.prepare(`UPDATE skill_settings SET ${fields.join(', ')} WHERE name = ?`).run(...values);
      }
    } else {
      db.prepare(`
        INSERT INTO skill_settings (name, label, enabled, display_order, custom_description)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, label || name, enabled !== undefined ? Number(enabled) : 1,
        display_order || 0, custom_description || '');
    }

    const updated = db.prepare('SELECT * FROM skill_settings WHERE name = ?').get(name);
    return res.json({ success: true, data: updated });
  } catch (e) {
    log.error(`更新技能失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// LLM 配置管理
// ============================================================================

router.get('/llm-config', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // 如果 llm_configs 为空，从 config 初始化默认值
    const count = (db.prepare('SELECT COUNT(*) as c FROM llm_configs').get() as any).c;
    if (count === 0) {
      const defaults = [
        { provider: 'zhipu', label: '智谱 GLM', model: 'glm-4.7-flash', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', display_order: 1 },
        { provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/v1/chat/completions', display_order: 2 },
        { provider: 'ollama', label: 'Ollama 本地', model: 'qwen2.5-coder:14b', endpoint: 'http://localhost:11434', display_order: 3 },
      ];
      const stmt = db.prepare('INSERT OR IGNORE INTO llm_configs (provider, label, enabled, api_key, model, endpoint, timeout_ms, display_order) VALUES (?, ?, 1, ?, ?, ?, 120000, ?)');
      for (const d of defaults) {
        stmt.run(d.provider, d.label, '', d.model, d.endpoint, d.display_order);
      }
    }
    const rows = db.prepare('SELECT * FROM llm_configs ORDER BY display_order').all();
    // 不返回 api_key 到前端
    const safe = (rows as any[]).map(r => ({ ...r, api_key: r.api_key ? '***已设置***' : '' }));
    return res.json({ success: true, data: safe });
  } catch (e) {
    log.error(`获取 LLM 配置失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.put('/llm-config/:provider', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { provider } = req.params;
    const { enabled, model, endpoint, api_key, timeout_ms, label } = req.body;

    const fields: string[] = [];
    const values: any[] = [];
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(Number(enabled)); }
    if (model !== undefined) { fields.push('model = ?'); values.push(model); }
    if (endpoint !== undefined) { fields.push('endpoint = ?'); values.push(endpoint); }
    if (api_key !== undefined && api_key !== '***已设置***') { fields.push('api_key = ?'); values.push(api_key); }
    if (timeout_ms !== undefined) { fields.push('timeout_ms = ?'); values.push(timeout_ms); }
    if (label !== undefined) { fields.push('label = ?'); values.push(label); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: '无更新字段' });
    }

    fields.push("updated_at = datetime('now','localtime')");
    values.push(provider);
    db.prepare(`UPDATE llm_configs SET ${fields.join(', ')} WHERE provider = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM llm_configs WHERE provider = ?').get(provider) as any;
    const safe = { ...updated, api_key: updated.api_key ? '***已设置***' : '' };
    log.info(`LLM 配置 ${provider}: 已更新`);
    return res.json({ success: true, data: safe });
  } catch (e) {
    log.error(`更新 LLM 配置失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// 模块管理
// ============================================================================

router.get('/modules', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM module_settings').get() as any).c;
    if (count === 0) {
      const defaults = [
        { id: 'content', label: '内容工作室', category: 'content-ops', description: 'AI 对话创作 + 内容管理', access_url: '/content' },
        { id: 'video-studio', label: '视频工作室', category: 'video', description: '视频转录 + 炼金术处理', access_url: '/video-studio' },
        { id: 'xhs-pipeline', label: '小红书流水线', category: 'xhs-pipeline', description: '选题→创作→发布全流程', access_url: '/xhs-pipeline' },
        { id: 'radar', label: '情报中心', category: 'content-ops', description: '社媒热点监测', access_url: '/radar' },
        { id: 'trends', label: '趋势发现', category: 'content-ops', description: '趋势话题发现与研究', access_url: '/trends' },
        { id: 'hashtags', label: '标签研究', category: 'content-ops', description: '标签数据分析', access_url: '/hashtags' },
        { id: 'publish', label: '发布队列', category: 'content-ops', description: '内容发布管理', access_url: '/publish' },
        { id: 'analytics', label: '数据分析', category: 'content-ops', description: '内容效果分析', access_url: '/analytics' },
        { id: 'pipeline', label: '闭环管理', category: 'content-ops', description: '趋势→内容→发布闭环', access_url: '/pipeline' },
        { id: 'draft-review', label: '草稿审核', category: 'xhs-pipeline', description: 'AI 生成草稿人工审核', access_url: '/draft-review' },
      ];
      const stmt = db.prepare('INSERT OR IGNORE INTO module_settings (id, label, category, enabled, description, access_url) VALUES (?, ?, ?, 1, ?, ?)');
      for (const d of defaults) {
        stmt.run(d.id, d.label, d.category, d.description, d.access_url);
      }
    }
    return res.json({ success: true, data: listModuleRuntimeConfigs(db) });
  } catch (e) {
    log.error(`获取模块列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.put('/modules/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const updated = updateModuleRuntimeConfig(db, id, {
      enabled: req.body.enabled,
      label: req.body.label,
      selected_skill: req.body.selected_skill,
      selected_llms: req.body.selected_llms,
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    log.error(`更新模块失败: ${(e as Error).message}`);
    if (e instanceof RuntimeConfigValidationError) {
      const status = e.message.startsWith('模块不存在') ? 404 : 400;
      return res.status(status).json({ success: false, error: e.message });
    }
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// 收藏管理
// ============================================================================

router.get('/favorites', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type } = req.query;
    let rows;
    if (type) {
      rows = db.prepare('SELECT * FROM system_favorites WHERE target_type = ? ORDER BY created_at DESC').all(type);
    } else {
      rows = db.prepare('SELECT * FROM system_favorites ORDER BY created_at DESC').all();
    }
    return res.json({ success: true, data: rows });
  } catch (e) {
    log.error(`获取收藏列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.post('/favorites', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { target_type, target_id, target_name } = req.body;
    if (!target_type || !target_id || !target_name) {
      return res.status(400).json({ success: false, error: 'target_type, target_id, target_name 为必填' });
    }
    db.prepare('INSERT OR REPLACE INTO system_favorites (target_type, target_id, target_name) VALUES (?, ?, ?)').run(target_type, target_id, target_name);
    return res.json({ success: true, message: '已收藏' });
  } catch (e) {
    log.error(`添加收藏失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.delete('/favorites/:type/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, id } = req.params;
    db.prepare('DELETE FROM system_favorites WHERE target_type = ? AND target_id = ?').run(type, id);
    return res.json({ success: true, message: '已取消收藏' });
  } catch (e) {
    log.error(`取消收藏失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// API 密钥管理（集中管理 TikHub 等外部服务密钥）
// ============================================================================

// 密钥掩码：仅显示前4位和后4位，中间用 **** 代替
function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

router.get('/api-keys', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // 若 api_keys 表为空，从 config 初始化默认条目
    const count = (db.prepare('SELECT COUNT(*) as c FROM api_keys').get() as any).c;
    if (count === 0) {
      const defaults = [
        { key_name: 'tikhub', label: 'TikHub API', category: 'social-media', description: 'TikHub 社媒数据 API 密钥（趋势/标签/分析）', api_key: config.tikhubApiKey, display_order: 1 },
      ];
      const stmt = db.prepare('INSERT OR IGNORE INTO api_keys (key_name, label, category, api_key, description, enabled, display_order) VALUES (?, ?, ?, ?, ?, 1, ?)');
      for (const d of defaults) {
        stmt.run(d.key_name, d.label, d.category, d.api_key, d.description, d.display_order);
      }
    }
    const rows = db.prepare('SELECT * FROM api_keys ORDER BY display_order').all() as any[];
    // 不返回完整密钥到前端，只返回掩码
    const safe = rows.map(r => ({
      ...r,
      api_key: r.api_key ? maskApiKey(r.api_key) : '',
      has_key: r.api_key ? 1 : 0,
    }));
    return res.json({ success: true, data: safe });
  } catch (e) {
    log.error(`获取 API 密钥列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.put('/api-keys/:keyName', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { keyName } = req.params;
    const { api_key, enabled, label, description } = req.body;

    const fields: string[] = [];
    const values: any[] = [];
    // 密钥为空字符串或掩码格式（含 ****）时不更新
    if (api_key !== undefined && api_key !== '' && !api_key.includes('****')) {
      fields.push('api_key = ?'); values.push(api_key);
    }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(Number(enabled)); }
    if (label !== undefined) { fields.push('label = ?'); values.push(label); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: '无更新字段' });
    }

    fields.push("updated_at = datetime('now','localtime')");
    values.push(keyName);
    db.prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE key_name = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM api_keys WHERE key_name = ?').get(keyName) as any;
    const safe = { ...updated, api_key: updated.api_key ? maskApiKey(updated.api_key) : '', has_key: updated.api_key ? 1 : 0 };
    log.info(`API 密钥 ${keyName}: 已更新`);
    return res.json({ success: true, data: safe });
  } catch (e) {
    log.error(`更新 API 密钥失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// 系统设置管理（运行时可编辑的系统级偏好）
// ============================================================================

router.get('/llm-default', (_req: Request, res: Response) => {
  const row = getDb().prepare("SELECT value FROM system_settings WHERE key = 'llm.default_provider'").get() as { value?: string } | undefined;
  res.json({ success: true, data: { provider: row?.value || 'auto' } });
});

router.put('/llm-default', (req: Request, res: Response) => {
  const provider = String(req.body?.provider || '').trim().toLowerCase();
  if (!provider) return res.status(400).json({ success: false, error: 'provider 必填' });
  if (provider !== 'auto') {
    const found = getDb().prepare('SELECT provider, enabled FROM llm_configs WHERE provider = ?').get(provider) as { enabled?: number } | undefined;
    if (!found || found.enabled === 0) return res.status(400).json({ success: false, error: `LLM 提供商不可用: ${provider}` });
  }
  getDb().prepare(`INSERT INTO system_settings (key,value,category,label,description,input_type,display_order)
    VALUES ('llm.default_provider',?,'llm','默认 LLM','全局未指定模型时优先使用的 LLM','select',0)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now','localtime')`).run(provider);
  return res.json({ success: true, data: { provider } });
});

router.get('/system-settings', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // 若 system_settings 表为空，初始化默认条目
    const count = (db.prepare('SELECT COUNT(*) as c FROM system_settings').get() as any).c;
    if (count === 0) {
      const defaults = [
        { key: 'whisper_default_model', value: 'medium', category: 'video', label: 'Whisper 默认模型', description: '视频转录默认使用的 Whisper 模型', input_type: 'select', display_order: 1 },
        { key: 'image_generation_enabled', value: 'true', category: 'content', label: '图片生成开关', description: '是否启用 AI 图片生成（草稿配图）', input_type: 'switch', display_order: 2 },
        { key: 'image_count', value: '1', category: 'content', label: '图片生成数量', description: '每篇草稿生成图片数（1-4）', input_type: 'number', display_order: 3 },
        { key: 'scheduler_enabled', value: 'true', category: 'pipeline', label: '定时任务调度器', description: '是否启用小红书流水线定时调度', input_type: 'switch', display_order: 4 },
        { key: 'scheduler_timezone', value: 'Asia/Shanghai', category: 'pipeline', label: '调度器时区', description: '定时任务调度的时区', input_type: 'text', display_order: 5 },
        { key: 'default_search_limit', value: '20', category: 'pipeline', label: '默认搜索数量', description: '流水线默认搜索笔记数量', input_type: 'number', display_order: 6 },
        { key: 'max_drafts', value: '3', category: 'pipeline', label: '最大草稿数', description: '每次流水线生成的最大草稿数', input_type: 'number', display_order: 7 },
      ];
      const stmt = db.prepare('INSERT OR IGNORE INTO system_settings (key, value, category, label, description, input_type, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const d of defaults) {
        stmt.run(d.key, d.value, d.category, d.label, d.description, d.input_type, d.display_order);
      }
    }
    const rows = db.prepare('SELECT * FROM system_settings ORDER BY display_order').all();
    return res.json({ success: true, data: rows });
  } catch (e) {
    log.error(`获取系统设置失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

router.put('/system-settings/:key', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ success: false, error: '缺少 value 字段' });
    }

    db.prepare(`UPDATE system_settings SET value = ?, updated_at = datetime('now','localtime') WHERE key = ?`).run(String(value), key);

    const updated = db.prepare('SELECT * FROM system_settings WHERE key = ?').get(key);
    log.info(`系统设置 ${key}: 已更新`);
    return res.json({ success: true, data: updated });
  } catch (e) {
    log.error(`更新系统设置失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// 系统信息（只读，展示当前运行时配置概览）
// ============================================================================

router.get('/system-info', (_req: Request, res: Response) => {
  try {
    const info = {
      port: config.port,
      nodeEnv: config.nodeEnv,
      dbPath: config.dbPath,
      clientUrl: config.clientUrl,
      skillBridgeMode: config.skillBridgeMode,
      tikhubBaseUrl: config.tikhubBaseUrl,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaModel: config.ollamaModel,
      llmProvider: config.llm.provider,
      llmTimeout: config.llm.timeout,
      pythonScriptsPath: config.pythonScriptsPath,
      uvPath: config.uvPath,
      imageProvider: config.image.provider,
      imageModel: config.image.model,
      schedulerTimezone: config.scheduler.timezone,
    };
    return res.json({ success: true, data: info });
  } catch (e) {
    log.error(`获取系统信息失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// 系统概览统计
// ============================================================================

router.get('/stats', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const templateCount = (db.prepare('SELECT COUNT(*) as c FROM content_templates').get() as any).c;
    const templateEnabledCount = (db.prepare('SELECT COUNT(*) as c FROM content_templates WHERE enabled = 1').get() as any).c;
    const skillCount = (db.prepare('SELECT COUNT(*) as c FROM skill_settings').get() as any).c;
    const skillEnabledCount = (db.prepare('SELECT COUNT(*) as c FROM skill_settings WHERE enabled = 1').get() as any).c;
    const moduleCount = (db.prepare('SELECT COUNT(*) as c FROM module_settings').get() as any).c;
    const moduleEnabledCount = (db.prepare('SELECT COUNT(*) as c FROM module_settings WHERE enabled = 1').get() as any).c;
    const favCount = (db.prepare('SELECT COUNT(*) as c FROM system_favorites').get() as any).c;
    const llmProviders = (db.prepare('SELECT COUNT(*) as c FROM llm_configs WHERE enabled = 1').get() as any).c;

    return res.json({
      success: true,
      data: {
        templates: { total: templateCount, enabled: templateEnabledCount },
        skills: { total: skillCount, enabled: skillEnabledCount },
        modules: { total: moduleCount, enabled: moduleEnabledCount },
        favorites: favCount,
        llmProviders,
      },
    });
  } catch (e) {
    log.error(`获取统计失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// 提示词管理（system_prompts）
// ============================================================================

/** GET /api/admin/prompts - 获取提示词列表 */
router.get('/prompts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category, enabled } = req.query;
    let query = 'SELECT * FROM system_prompts';
    const conditions: string[] = [];
    const params: any[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (enabled !== undefined) {
      conditions.push('enabled = ?');
      params.push(enabled === 'true' ? 1 : 0);
    }
    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY display_order ASC, id ASC';

    const rows = db.prepare(query).all(...params);
    return res.json({ success: true, data: rows });
  } catch (e) {
    log.error(`获取提示词列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** POST /api/admin/prompts - 创建提示词 */
router.post('/prompts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, label, category, content, description, variables } = req.body;
    if (!name || !label) {
      return res.status(400).json({ success: false, error: 'name 和 label 为必填项' });
    }

    const existing = db.prepare('SELECT id FROM system_prompts WHERE name = ?').get(name);
    if (existing) {
      return res.status(409).json({ success: false, error: `提示词「${name}」已存在` });
    }

    const result = db.prepare(`
      INSERT INTO system_prompts (name, label, category, content, description, variables)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, label, category || 'general', content || '', description || '', JSON.stringify(variables || []));

    const row = db.prepare('SELECT * FROM system_prompts WHERE id = ?').get(result.lastInsertRowid);
    return res.json({ success: true, data: row, message: '提示词创建成功' });
  } catch (e) {
    log.error(`创建提示词失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** PUT /api/admin/prompts/:id - 更新提示词 */
router.put('/prompts/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const { label, category, content, description, variables, enabled, display_order } = req.body;

    const existing = db.prepare('SELECT id FROM system_prompts WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: '提示词不存在' });
    }

    const updates: string[] = [];
    const params: any[] = [];
    if (label !== undefined) { updates.push('label = ?'); params.push(label); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (variables !== undefined) { updates.push('variables = ?'); params.push(JSON.stringify(variables)); }
    if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
    if (display_order !== undefined) { updates.push('display_order = ?'); params.push(display_order); }

    if (updates.length === 0) {
      return res.json({ success: true, data: existing, message: '无更新字段' });
    }

    updates.push("updated_at = datetime('now','localtime')");
    params.push(id);
    db.prepare(`UPDATE system_prompts SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const row = db.prepare('SELECT * FROM system_prompts WHERE id = ?').get(id);
    return res.json({ success: true, data: row, message: '提示词更新成功' });
  } catch (e) {
    log.error(`更新提示词失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** DELETE /api/admin/prompts/:id - 删除提示词 */
router.delete('/prompts/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const result = db.prepare('DELETE FROM system_prompts WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '提示词不存在' });
    }
    return res.json({ success: true, message: '提示词已删除' });
  } catch (e) {
    log.error(`删除提示词失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
