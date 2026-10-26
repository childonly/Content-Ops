import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('template');

export interface ContentTemplate {
  id: number;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  titleFormula?: string;
  contentStructure?: string;
  tags?: string;
  emojiStyle?: string;
  wordCountRange?: string;
  bestFor?: string;
  sampleTitle?: string;
  sampleBody?: string;
  usageCount: number;
  isBuiltin: boolean;
  enabled: boolean;
  isFavorited: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  title_formula: string | null;
  content_structure: string | null;
  tags: string | null;
  emoji_style: string | null;
  word_count_range: string | null;
  best_for: string | null;
  sample_title: string | null;
  sample_body: string | null;
  usage_count: number;
  is_builtin: number;
  enabled: number;
  is_favorited: number;
  created_at: string;
  updated_at: string;
}

function mapTemplate(row: TemplateRow): ContentTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    category: row.category,
    subcategory: row.subcategory ?? undefined,
    titleFormula: row.title_formula ?? undefined,
    contentStructure: row.content_structure ?? undefined,
    tags: row.tags ?? undefined,
    emojiStyle: row.emoji_style ?? undefined,
    wordCountRange: row.word_count_range ?? undefined,
    bestFor: row.best_for ?? undefined,
    sampleTitle: row.sample_title ?? undefined,
    sampleBody: row.sample_body ?? undefined,
    usageCount: row.usage_count,
    isBuiltin: row.is_builtin === 1,
    enabled: row.enabled !== 0,
    isFavorited: row.is_favorited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 获取模板列表 */
export function getTemplates(options?: {
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}): { data: ContentTemplate[]; total: number } {
  const db = getDb();
  const { category, keyword, page = 1, pageSize = 50 } = options || {};

  const conditions: string[] = ['enabled = 1'];  // 仅返回启用的模板
  const params: Array<string | number> = [];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (keyword) {
    conditions.push('(name LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(
    `SELECT * FROM content_templates ${where} ORDER BY is_builtin DESC, usage_count DESC, id ASC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) as TemplateRow[];

  const countRow = db.prepare(
    `SELECT COUNT(*) as count FROM content_templates ${where}`
  ).get(...params) as { count: number };

  return {
    data: rows.map(mapTemplate),
    total: countRow.count,
  };
}

/** 获取模板分类列表 */
export function getTemplateCategories(): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT category FROM content_templates ORDER BY category'
  ).all() as { category: string }[];
  return rows.map(r => r.category);
}

/** 获取单个模板 */
export function getTemplate(id: number): ContentTemplate | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM content_templates WHERE id = ?').get(id) as TemplateRow | undefined;
  return row ? mapTemplate(row) : null;
}

/** 创建自定义模板 */
export function createTemplate(data: {
  name: string;
  description?: string;
  category: string;
  subcategory?: string;
  titleFormula?: string;
  contentStructure?: string;
  tags?: string;
  emojiStyle?: string;
  wordCountRange?: string;
  bestFor?: string;
  sampleTitle?: string;
  sampleBody?: string;
}): ContentTemplate {
  const db = getDb();
  const now = new Date().toISOString();

  const info = db.prepare(`
    INSERT INTO content_templates (name, description, category, subcategory, title_formula, content_structure, tags, emoji_style, word_count_range, best_for, sample_title, sample_body, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    data.name, data.description || null, data.category,
    data.subcategory || null, data.titleFormula || null,
    data.contentStructure || null, data.tags || null,
    data.emojiStyle || null, data.wordCountRange || null,
    data.bestFor || null, data.sampleTitle || null,
    data.sampleBody || null, now, now
  );

  log.info('创建模板', { id: info.lastInsertRowid, name: data.name });
  return getTemplate(Number(info.lastInsertRowid))!;
}

/** 更新模板 */
export function updateTemplate(id: number, data: Partial<{
  name: string; description: string; category: string;
  subcategory: string; titleFormula: string; contentStructure: string;
  tags: string; emojiStyle: string; wordCountRange: string;
  bestFor: string; sampleTitle: string; sampleBody: string;
}>): ContentTemplate | null {
  const db = getDb();
  const exists = getTemplate(id);
  if (!exists) return null;

  const fields: string[] = [];
  const values: any[] = [];

  const map: Record<string, string> = {
    name: 'name', description: 'description', category: 'category',
    subcategory: 'subcategory', titleFormula: 'title_formula',
    contentStructure: 'content_structure', tags: 'tags',
    emojiStyle: 'emoji_style', wordCountRange: 'word_count_range',
    bestFor: 'best_for', sampleTitle: 'sample_title', sampleBody: 'sample_body',
  };

  for (const [key, col] of Object.entries(map)) {
    if ((data as any)[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push((data as any)[key]);
    }
  }

  if (fields.length === 0) return exists;

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now, id);

  db.prepare(`UPDATE content_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  log.info('更新模板', { id });
  return getTemplate(id);
}

/** 删除自定义模板 */
export function deleteTemplate(id: number): boolean {
  const db = getDb();
  const tmpl = getTemplate(id);
  if (!tmpl || tmpl.isBuiltin) return false;

  const info = db.prepare('DELETE FROM content_templates WHERE id = ?').run(id);
  log.info('删除模板', { id, deleted: info.changes > 0 });
  return info.changes > 0;
}

/** 增加模板使用次数 */
export function incrementTemplateUsage(id: number): void {
  const db = getDb();
  db.prepare('UPDATE content_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}
