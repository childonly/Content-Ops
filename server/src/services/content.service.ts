/**
 * 内容服务 - 内容数据增删改查与技能调用
 *
 * 增强版内容生成 (融合 brainstorming + Memory-Assistant + gpt-image-2 三大技能方法论):
 *   1. 创意规划 (brainstorming): 发散-收敛生成创意方向
 *   2. 记忆增强 (Memory-Assistant): 注入历史优质内容风格特征
 *   3. 结构化配图 (gpt-image-2): 类别化图片 prompt 模板
 */

import { getDb } from '../db';
import { getSkillBridge } from '../utils/skill-bridge';
import { createServiceLogger } from '../utils/logger';
import { Content, ContentGenerationParams, ContentGenerationResult, UnifiedContent } from '../types';
import { callLLM, loadPromptTemplate } from './llm-service';
import {
  generateCreativeDirections,
  BrainstormResult,
  CreativeDirection,
} from './brainstorming.service';
import {
  extractMemoryFromHistory,
  enhancePrompt,
  ContentMemory,
} from './memory-enhancer.service';
import { generateImagesForDraft } from './image-generation.service';
import { saveGeneratedContent, updateContentImages } from './content-helpers';
import { getTemplate } from './template.service';

const log = createServiceLogger('content-service');

// ----------------------------------------------------------------------------
// 类型映射
// ----------------------------------------------------------------------------

interface ContentRow {
  id: number;
  title: string;
  body: string | null;
  tags: string | null;
  images: string | null;
  trend_id: number | null;
  hashtag_ids: string | null;
  status: string;
  generated_at: string;
  published_at: string | null;
  is_favorited: number | null;
  favorited_at: string | null;
  group_name: string | null;
  sort_order: number | null;
}

function mapRow(row: ContentRow): Content {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    tags: row.tags ? JSON.parse(row.tags) : [],
    images: row.images ? JSON.parse(row.images) : [],
    trendId: row.trend_id ?? undefined,
    hashtagIds: row.hashtag_ids ?? '',
    status: row.status as Content['status'],
    generatedAt: row.generated_at,
    publishedAt: row.published_at ?? undefined,
    isFavorited: row.is_favorited === 1,
    favoritedAt: row.favorited_at ?? undefined,
    groupName: row.group_name ?? '',
    sortOrder: row.sort_order ?? 0,
  };
}

// ----------------------------------------------------------------------------
// 分页查询内容列表
// ----------------------------------------------------------------------------

export function getContents(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
  favorited?: boolean,
): { data: Content[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM contents';
  const params: Array<string | number> = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  if (favorited) {
    const condition = params.length > 0 ? ' AND' : ' WHERE';
    query += `${condition} is_favorited = 1`;
  }

  query += ' ORDER BY generated_at DESC, id DESC LIMIT ? OFFSET ?';
  const rows = db.prepare(query).all(...params, pageSize, offset) as ContentRow[];
  const data = rows.map(mapRow);

  let countQuery = 'SELECT COUNT(*) AS count FROM contents';
  const countParams: Array<string | number> = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }

  if (favorited) {
    const condition = countParams.length > 0 ? ' AND' : ' WHERE';
    countQuery += `${condition} is_favorited = 1`;
  }

  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;

  return { data, total };
}

// ----------------------------------------------------------------------------
// 根据 ID 获取内容
// ----------------------------------------------------------------------------

export function getContentById(id: number): Content | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM contents WHERE id = ?').get(id) as ContentRow | undefined;
  return row ? mapRow(row) : null;
}

// ----------------------------------------------------------------------------
// 生成内容 - 调用 xhs-content 技能，结果存入数据库
// ----------------------------------------------------------------------------

export async function generateContent(params: ContentGenerationParams): Promise<Content> {
  const bridge = getSkillBridge();
  log.info('生成内容', { params });

  const result = await bridge.invoke<ContentGenerationResult>('xhs-content', params);

  if (!result.success || !result.data) {
    throw new Error(result.error || '内容生成失败');
  }

  const content = result.data.content;
  const db = getDb();

  const trendId = content.trendId ?? params.trendId ?? null;
  const hashtagIds =
    content.hashtagIds ||
    (params.hashtagIds && params.hashtagIds.length ? params.hashtagIds.join(',') : '');

  const info = db.prepare(`
    INSERT INTO contents (title, body, tags, images, trend_id, hashtag_ids, status, generated_at)
    VALUES (@title, @body, @tags, @images, @trend_id, @hashtag_ids, @status, @generated_at)
  `).run({
    title: content.title,
    body: content.body ?? '',
    tags: JSON.stringify(content.tags ?? []),
    images: JSON.stringify(content.images ?? []),
    trend_id: trendId,
    hashtag_ids: hashtagIds,
    status: 'draft',
    generated_at: content.generatedAt || new Date().toISOString(),
  });

  const saved: Content = {
    ...content,
    id: Number(info.lastInsertRowid),
    status: 'draft',
    trendId: trendId ?? undefined,
    hashtagIds,
    isFavorited: false,
  };

  log.info('内容已生成并保存', { id: saved.id, title: saved.title });
  return saved;
}

// ----------------------------------------------------------------------------
// 更新内容状态
// ----------------------------------------------------------------------------

export function updateContentStatus(id: number, status: Content['status']): Content | null {
  const db = getDb();

  if (status === 'published') {
    db.prepare("UPDATE contents SET status = ?, published_at = datetime('now') WHERE id = ?").run(
      status,
      id,
    );
  } else {
    db.prepare('UPDATE contents SET status = ? WHERE id = ?').run(status, id);
  }

  log.info('更新内容状态', { id, status });
  return getContentById(id);
}

// ----------------------------------------------------------------------------
// 更新内容（标题、正文、标签等）
// ----------------------------------------------------------------------------

export function updateContent(
  id: number,
  data: { title?: string; body?: string; tags?: string[] },
): Content | null {
  const db = getDb();
  const current = getContentById(id);
  if (!current) {
    return null;
  }

  const updates: string[] = [];
  const params: Array<string | number> = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    params.push(data.title);
  }
  if (data.body !== undefined) {
    updates.push('body = ?');
    params.push(data.body);
  }
  if (data.tags !== undefined) {
    updates.push('tags = ?');
    params.push(JSON.stringify(data.tags));
  }

  if (updates.length === 0) {
    return current;
  }

  params.push(id);
  db.prepare(`UPDATE contents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  log.info('更新内容', { id, fields: Object.keys(data) });
  return getContentById(id);
}

// ----------------------------------------------------------------------------
// 删除内容
// ----------------------------------------------------------------------------

export function deleteContent(id: number): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM contents WHERE id = ?').run(id);
  if (info.changes > 0) {
    log.info('删除内容', { id });
  }
  return info.changes > 0;
}

// ----------------------------------------------------------------------------
// 切换收藏状态
// ----------------------------------------------------------------------------

export function toggleFavorite(id: number): Content | null {
  const db = getDb();
  const current = getContentById(id);
  if (!current) return null;

  const now = new Date().toISOString();
  const newStatus = current.isFavorited ? 0 : 1;

  if (newStatus === 1) {
    db.prepare('UPDATE contents SET is_favorited = 1, favorited_at = ? WHERE id = ?').run(now, id);
  } else {
    db.prepare('UPDATE contents SET is_favorited = 0, favorited_at = NULL WHERE id = ?').run(id);
  }

  log.info('切换收藏状态', { id, favorited: newStatus === 1 });
  return getContentById(id);
}

// ----------------------------------------------------------------------------
// 自定义分组管理
// ----------------------------------------------------------------------------

/** 获取所有分组名称列表（去重） */
export function getGroups(): string[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT DISTINCT group_name FROM contents WHERE group_name IS NOT NULL AND group_name != '' ORDER BY group_name",
  ).all() as { group_name: string }[];
  return rows.map((r) => r.group_name);
}

/** 更新内容的分组 */
export function updateGroupName(id: number, groupName: string): Content | null {
  const db = getDb();
  const current = getContentById(id);
  if (!current) return null;

  db.prepare('UPDATE contents SET group_name = ? WHERE id = ?').run(groupName || '', id);
  log.info('更新内容分组', { id, groupName });
  return getContentById(id);
}

// ----------------------------------------------------------------------------
// 拖拽排序
// ----------------------------------------------------------------------------

/** 批量更新排序 */
export function reorderContents(items: Array<{ id: number; sort_order: number }>): boolean {
  const db = getDb();
  const stmt = db.prepare('UPDATE contents SET sort_order = ? WHERE id = ?');
  const tx = db.transaction((rows: Array<{ id: number; sort_order: number }>) => {
    for (const row of rows) {
      stmt.run(row.sort_order, row.id);
    }
  });
  tx(items);
  log.info('批量更新排序', { count: items.length });
  return true;
}

// ----------------------------------------------------------------------------
// 批量删除
// ----------------------------------------------------------------------------

/** 批量删除内容 */
export function batchDeleteContents(ids: number[]): number {
  const db = getDb();
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM contents WHERE id IN (${placeholders})`).run(...ids);
  log.info('批量删除内容', { count: info.changes, ids });
  return info.changes;
}

// ----------------------------------------------------------------------------
// 统一内容列表（合并 contents 表和 drafts 表）
// ----------------------------------------------------------------------------

interface DraftRow {
  id: number;
  title: string;
  content: string | null;
  tags: string | null;
  images: string | null;
  status: string;
  created_at: string;
  published_at: string | null;
}

/**
 * 获取统一内容列表（合并 contents 和 drafts）。
 *
 * @param page 页码
 * @param pageSize 每页条数
 * @param status 状态过滤
 * @param favorited 仅收藏
 * @param source 来源过滤: 'content_studio' | 'pipeline' | '' (全部)
 */
export function getUnifiedContents(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
  favorited?: boolean,
  source?: string,
  groupName?: string,
): { data: UnifiedContent[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  const contentsRows: UnifiedContent[] = [];
  const draftRows: UnifiedContent[] = [];

  // 查询 contents 表（source = content_studio）
  if (!source || source === 'content_studio') {
    let query = 'SELECT id, title, tags, images, is_favorited, status, generated_at, group_name, sort_order FROM contents';
    const conditions: string[] = [];

    if (status) {
      conditions.push('status = ?');
    }
    if (favorited) {
      conditions.push('is_favorited = 1');
    }
    if (groupName) {
      conditions.push('group_name = ?');
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY sort_order ASC, generated_at DESC, id DESC';

    const rows = db.prepare(query).all() as Array<{
      id: number; title: string; tags: string | null; images: string | null;
      is_favorited: number | null; status: string; generated_at: string;
      group_name: string | null; sort_order: number | null;
    }>;

    for (const row of rows) {
      contentsRows.push({
        id: row.id,
        title: row.title,
        tags: row.tags ? JSON.parse(row.tags) : [],
        images: row.images ? JSON.parse(row.images) : [],
        isFavorited: row.is_favorited === 1,
        status: row.status,
        generatedAt: row.generated_at,
        source: 'content_studio',
        groupName: row.group_name ?? '',
        sortOrder: row.sort_order ?? 0,
      });
    }
  }

  // 查询 drafts 表（source = pipeline）
  if (!source || source === 'pipeline') {
    let query = 'SELECT id, title, tags, images, status, created_at, published_at FROM drafts';
    const conditions: string[] = [];

    if (status) {
      conditions.push('status = ?');
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC, id DESC';

    const rows = db.prepare(query).all() as DraftRow[];

    for (const row of rows) {
      draftRows.push({
        id: row.id,
        title: row.title,
        tags: row.tags ? (row.tags.includes('[') ? JSON.parse(row.tags) : row.tags.split(',').map((t) => t.trim()).filter(Boolean)) : [],
        images: row.images ? row.images.split(',').filter(Boolean) : [],
        isFavorited: false,
        status: row.status,
        generatedAt: row.created_at,
        source: 'pipeline',
        groupName: '',
        sortOrder: 0,
      });
    }
  }

  // 合并并排序
  const allRows = [...contentsRows, ...draftRows];
  allRows.sort((a, b) => {
    // 先按 sort_order, 再按 generated_at 倒序
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
  });

  const total = allRows.length;
  const data = allRows.slice(offset, offset + pageSize);

  return { data, total };
}

/**
 * 获取统一内容统计（按来源和状态分类计数）。
 */
export function getUnifiedStats(): {
  total: number;
  contentStudio: number;
  pipeline: number;
  byStatus: Record<string, number>;
  bySourceStatus: Record<string, Record<string, number>>;
} {
  const db = getDb();

  const contentCount = (db.prepare('SELECT COUNT(*) as count FROM contents').get() as { count: number }).count;
  const draftCount = (db.prepare('SELECT COUNT(*) as count FROM drafts').get() as { count: number }).count;

  // contents 按状态统计
  const contentStatusRows = db.prepare(
    'SELECT status, COUNT(*) as count FROM contents GROUP BY status',
  ).all() as Array<{ status: string; count: number }>;

  // drafts 按状态统计
  const draftStatusRows = db.prepare(
    'SELECT status, COUNT(*) as count FROM drafts GROUP BY status',
  ).all() as Array<{ status: string; count: number }>;

  const byStatus: Record<string, number> = {};
  const bySourceStatus: Record<string, Record<string, number>> = {
    content_studio: {},
    pipeline: {},
  };

  for (const row of contentStatusRows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + row.count;
    bySourceStatus.content_studio[row.status] = row.count;
  }
  for (const row of draftStatusRows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + row.count;
    bySourceStatus.pipeline[row.status] = row.count;
  }

  return {
    total: contentCount + draftCount,
    contentStudio: contentCount,
    pipeline: draftCount,
    byStatus,
    bySourceStatus,
  };
}

// ----------------------------------------------------------------------------
// 增强版内容生成 (融合 brainstorming + Memory + gpt-image-2)
// ----------------------------------------------------------------------------

/**
 * 增强版内容生成请求参数。
 */
export interface EnhancedContentRequest {
  keywords: string[];
  trends?: string[];
  hashtags?: string[];
  enableBrainstorming?: boolean;
  enableMemory?: boolean;
  enableImage?: boolean;
}

/**
 * 增强版内容生成结果。
 */
export interface EnhancedContentResult {
  brainstorm?: BrainstormResult; // 创意规划结果 (enableBrainstorming=true 时)
  memory?: ContentMemory; // 历史记忆 (enableMemory=true 时)
  content: {
    title: string;
    body: string;
    tags: string[];
  };
  images?: string; // 生成的图片路径 (enableImage=true 时,逗号分隔)
  savedContentId?: number; // 保存到数据库后的内容 ID
  llmProvider?: string; // 实际使用的 LLM 提供商
  durationMs: number; // 总耗时 (ms)
}

/**
 * 增强版内容生成主函数。
 *
 * 流程:
 *   1. (可选) 创意规划: generateCreativeDirections() 获取创意方向
 *   2. (可选) 记忆提取: extractMemoryFromHistory() 获取历史优质内容特征
 *   3. 基于创意方向 + 记忆上下文 → 调用 LLM 生成内容
 *   4. (可选) 图片生成: generateImagesForDraft() 生成配图
 *   5. 保存到数据库并返回完整结果
 *
 * @param params 增强版生成请求
 * @returns EnhancedContentResult 完整结果
 */
export async function generateEnhancedContent(
  params: EnhancedContentRequest,
): Promise<EnhancedContentResult> {
  const startTime = Date.now();
  const keywords = params.keywords ?? [];
  const primaryKeyword = keywords[0]?.trim() || '小红书';

  log.info('增强版内容生成开始', {
    keywords,
    enableBrainstorming: params.enableBrainstorming,
    enableMemory: params.enableMemory,
    enableImage: params.enableImage,
  });

  // 阶段 1: 创意规划 (brainstorming)
  let brainstorm: BrainstormResult | undefined;
  let selectedDirection: CreativeDirection | undefined;

  if (params.enableBrainstorming) {
    try {
      brainstorm = await generateCreativeDirections(
        primaryKeyword,
        params.trends,
        params.hashtags,
      );
      const idx = brainstorm.recommendedDirection;
      selectedDirection = brainstorm.directions[idx];
      log.info('创意规划完成', {
        directionCount: brainstorm.directions.length,
        recommended: idx,
        angle: selectedDirection?.angle,
      });
    } catch (e) {
      log.warn(`创意规划失败,继续无创意方向生成: ${(e as Error).message}`);
    }
  }

  // 阶段 2: 记忆提取 (Memory-Assistant)
  let memory: ContentMemory | undefined;
  if (params.enableMemory) {
    try {
      memory = extractMemoryFromHistory(20);
      log.info('记忆提取完成', {
        topTitles: memory.topTitles.length,
        popularTags: memory.popularTags.length,
      });
    } catch (e) {
      log.warn(`记忆提取失败,继续无记忆生成: ${(e as Error).message}`);
    }
  }

  // 阶段 3: 调用 LLM 生成内容
  const contentPrompt = buildEnhancedContentPrompt(
    primaryKeyword,
    keywords,
    selectedDirection,
    memory,
    params.trends,
    params.hashtags,
  );

  log.info('调用 LLM 生成内容...');
  const { text: llmResponse, provider } = await callLLM(contentPrompt);

  const generated = parseGeneratedContent(llmResponse, primaryKeyword);

  log.info('LLM 内容生成完成', {
    provider,
    title: generated.title,
    bodyLength: generated.body.length,
  });

  // 阶段 4: 图片生成 (gpt-image-2 增强版)
  let images: string | undefined;
  if (params.enableImage) {
    try {
      // 先保存内容获取 ID,再用于图片命名
      const savedId = saveGeneratedContent(generated);
      const imgResult = await generateImagesForDraft(generated.title, generated.body, savedId);
      images = imgResult.paths || undefined;

      // 更新内容的 images 字段
      if (images) {
        updateContentImages(savedId, images);
      }

      const durationMs = Date.now() - startTime;
      log.info('增强版内容生成完成 (含图片)', { savedId, images, durationMs });

      return {
        brainstorm,
        memory,
        content: generated,
        images: images || undefined,
        savedContentId: savedId,
        llmProvider: provider,
        durationMs,
      };
    } catch (e) {
      log.warn(`图片生成失败: ${(e as Error).message}`);
      // 图片失败不影响内容返回
    }
  }

  // 阶段 5: 保存到数据库 (无图片或图片失败)
  const savedId = saveGeneratedContent(generated);
  const durationMs = Date.now() - startTime;

  log.info('增强版内容生成完成', { savedId, durationMs });

  return {
    brainstorm,
    memory,
    content: generated,
    savedContentId: savedId,
    llmProvider: provider,
    durationMs,
  };
}

// ----------------------------------------------------------------------------
// 辅助: 构建增强版内容生成 Prompt
// ----------------------------------------------------------------------------

/**
 * 构建增强版内容生成 Prompt。
 *
 * 融合:
 *   - 默认 prompt 模板 (loadPromptTemplate)
 *   - 创意方向 (brainstorming 结果)
 *   - 记忆上下文 (Memory-Assistant 增强)
 *   - 趋势和标签数据
 */
function buildEnhancedContentPrompt(
  primaryKeyword: string,
  keywords: string[],
  direction: CreativeDirection | undefined,
  memory: ContentMemory | undefined,
  trends?: string[],
  hashtags?: string[],
): string {
  // 加载默认 prompt 模板
  const baseTemplate = loadPromptTemplate();

  // 构建报告内容 (替代原 {report} 占位符)
  const reportParts: string[] = [];

  reportParts.push(`# 小红书搜索报告：${primaryKeyword}`);

  if (trends && trends.length > 0) {
    reportParts.push(`\n## 热门趋势`);
    trends.forEach((t, i) => reportParts.push(`${i + 1}. ${t}`));
  }

  if (hashtags && hashtags.length > 0) {
    reportParts.push(`\n## 相关标签`);
    reportParts.push(hashtags.map((h) => `#${h}`).join(' '));
  }

  if (keywords.length > 1) {
    reportParts.push(`\n## 关键词`);
    reportParts.push(keywords.map((k) => `- ${k}`).join('\n'));
  }

  if (direction) {
    reportParts.push(`\n## 推荐创意方向`);
    reportParts.push(`- 创意角度: ${direction.angle}`);
    reportParts.push(`- 建议标题: ${direction.title}`);
    reportParts.push(`- 目标受众: ${direction.targetAudience}`);
    reportParts.push(`- 开头钩子: ${direction.hook}`);
    reportParts.push(`- 内容大纲:`);
    direction.outline.forEach((o, i) => reportParts.push(`  ${i + 1}. ${o}`));
  }

  const report = reportParts.join('\n');

  // 用报告填充模板
  let promptBody: string;
  try {
    promptBody = baseTemplate.replace(/\{report\}/g, report);
  } catch {
    promptBody = baseTemplate.replace('{report}', report);
  }

  // 如果有记忆,注入到 prompt 前 (Memory-Assistant 方法论)
  if (memory) {
    promptBody = enhancePrompt(promptBody, memory);
  }

  // 追加任务要求
  const taskRequirement = `\n\n---\n\n## 任务要求\n\n请生成 1 篇高质量小红书笔记草稿。${
    direction ? `请严格遵循上面的"推荐创意方向"来创作。` : ''
  }\n\n请严格按照以下格式输出：\n\n## 笔记 1: [标题]\n[正文内容]\n\n标签: [标签1, 标签2, 标签3]\n`;

  return promptBody + taskRequirement;
}

// ----------------------------------------------------------------------------
// 辅助: 解析 LLM 生成的内容
// ----------------------------------------------------------------------------

interface GeneratedContent {
  title: string;
  body: string;
  tags: string[];
}

/**
 * 解析 LLM 响应为结构化内容。
 *
 * 期望格式 (来自 llm-service 的 prompt):
 *   ## 笔记 1: [标题]
 *   [正文内容]
 *   标签: [标签1, 标签2, 标签3]
 */
function parseGeneratedContent(llmResponse: string, fallbackKeyword: string): GeneratedContent {
  if (!llmResponse || !llmResponse.trim()) {
    log.warn('LLM 返回空,使用兜底内容');
    return fallbackContent(fallbackKeyword);
  }

  // 尝试匹配 "## 笔记 1: 标题" 格式
  const noteMatch = llmResponse.match(/##\s*笔记\s*\d+\s*[:：]\s*(.+)/);
  const title = noteMatch ? noteMatch[1].trim() : `${fallbackKeyword}分享`;

  // 提取标签行
  let tags: string[] = [];
  const tagsMatch = llmResponse.match(/(?:标签|tags|Tags)\s*[:：]\s*(.+)/i);
  if (tagsMatch) {
    tags = tagsMatch[1]
      .split(/[,，\s]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter((t) => t.length > 0);
  }

  // 提取正文 (标题行和标签行之间的内容)
  let body = llmResponse;
  // 去掉标题行
  if (noteMatch) {
    const titleIdx = llmResponse.indexOf(noteMatch[0]);
    body = llmResponse.substring(titleIdx + noteMatch[0].length);
  }
  // 去掉标签行
  if (tagsMatch) {
    const tagsIdx = body.lastIndexOf(tagsMatch[0]);
    if (tagsIdx >= 0) {
      body = body.substring(0, tagsIdx);
    }
  }
  body = body.trim();

  if (!body) {
    body = llmResponse.trim();
  }

  // 如果没有提取到标签,使用关键词作为默认标签
  if (tags.length === 0) {
    tags = [fallbackKeyword, '分享', '小红书'];
  }

  log.info('内容解析完成', { title, bodyLength: body.length, tagsCount: tags.length });

  return { title, body, tags };
}

/**
 * 兜底内容 (LLM 不可用时)。
 */
function fallbackContent(keyword: string): GeneratedContent {
  return {
    title: `【分享】${keyword}实用攻略`,
    body: `今天来分享关于${keyword}的一些实用心得！\n\n很多姐妹都在问${keyword}怎么做,今天一次性讲清楚！\n\n核心要点：\n- 明确你的目标\n- 选择合适的方法\n- 坚持执行,记录过程\n\n希望对你有帮助,记得点赞收藏哦～`,
    tags: [keyword, '分享', '小红书', '干货'],
  };
}

// saveGeneratedContent 和 updateContentImages 已提取到 content-helpers.ts 共享模块

/** 内容优化参数 */
export interface ContentOptimizeParams {
  title: string;
  body: string;
  templateId?: number;
}

/** 内容优化结果 */
export interface ContentOptimizeResult {
  score: number;           // 0-100 综合评分
  titleScore: number;      // 标题评分
  bodyScore: number;       // 正文评分
  structureScore: number;  // 结构评分
  suggestions: string[];   // 改进建议
  optimizedTitle?: string;  // 优化后的标题
  optimizedBody?: string;   // 优化后的正文
}

const OPTIMIZE_PROMPT_TEMPLATE = `你是一个小红书内容优化专家。请分析以下笔记内容并给出优化建议。

## 笔记内容
标题：{title}
正文：
{body}
{template_section}

## 评分维度（每项0-100分）
1. 标题吸引力：是否使用痛点/数字/悬念？是否引发点击欲望？
2. 正文结构：是否有引言-分点-结尾？分段是否清晰？emoji使用是否恰当？
3. 整体可读性：语言是否口语化？是否有互动引导？

## 输出格式（严格JSON）
{
  "score": 85,
  "titleScore": 80,
  "bodyScore": 87,
  "structureScore": 88,
  "suggestions": ["建议1", "建议2"],
  "optimizedTitle": "优化后的标题",
  "optimizedBody": "优化后的正文（保持原意，优化结构和表达）"
}`;

export async function optimizeContent(params: ContentOptimizeParams): Promise<ContentOptimizeResult> {
  const { title, body, templateId } = params;

  // 获取模板信息（如果有）
  let templateSection = '';
  if (templateId) {
    const tmpl = getTemplate(templateId);
    if (tmpl) {
      templateSection = `\n## 参考模板
名称：${tmpl.name}
类型：${tmpl.category}${tmpl.subcategory ? ' / ' + tmpl.subcategory : ''}
标题公式：${tmpl.titleFormula || '无'}
内容结构：${tmpl.contentStructure || '无'}
Emoji风格：${tmpl.emojiStyle || '无'}
建议字数：${tmpl.wordCountRange || '无'}`;
    }
  }

  const prompt = OPTIMIZE_PROMPT_TEMPLATE
    .replace('{title}', title)
    .replace('{body}', body)
    .replace('{template_section}', templateSection);

  log.info('开始内容优化', { titleLength: title.length, bodyLength: body.length, templateId });

  try {
    const { text } = await callLLM(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]) as ContentOptimizeResult;
      log.info('内容优化完成', { score: result.score });
      return result;
    }
    throw new Error('LLM 返回格式异常');
  } catch (e) {
    log.error('内容优化失败', { error: (e as Error).message });
    throw new Error(`AI内容优化失败: ${(e as Error).message}`);
  }
}
