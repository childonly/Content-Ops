/**
 * 内容服务共享辅助函数
 *
 * 从 content.service.ts 提取的公共函数，供 chat.service.ts 等其他服务复用
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('content-helpers');

export interface GeneratedContent {
  title: string;
  body: string;
  tags: string[];
}

/**
 * 将生成的内容保存到 contents 表，返回新 ID。
 */
export function saveGeneratedContent(content: GeneratedContent): number {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO contents (title, body, tags, images, trend_id, hashtag_ids, status, generated_at)
    VALUES (@title, @body, @tags, @images, @trend_id, @hashtag_ids, @status, @generated_at)
  `).run({
    title: content.title,
    body: content.body,
    tags: JSON.stringify(content.tags),
    images: JSON.stringify([]),
    trend_id: null,
    hashtag_ids: '',
    status: 'draft',
    generated_at: new Date().toISOString(),
  });

  const id = Number(info.lastInsertRowid);
  log.info('生成内容已保存', { id, title: content.title });
  return id;
}

/**
 * 更新内容的 images 字段。
 */
export function updateContentImages(id: number, images: string): void {
  const db = getDb();
  const imageList = images.split(',').filter(Boolean);
  db.prepare('UPDATE contents SET images = ? WHERE id = ?').run(
    JSON.stringify(imageList),
    id,
  );
  log.info('内容图片已更新', { id, imageCount: imageList.length });
}

/**
 * 更新内容的 images 字段（数组版本）。
 */
export function updateContentImageList(id: number, images: string[]): void {
  const db = getDb();
  db.prepare('UPDATE contents SET images = ? WHERE id = ?').run(
    JSON.stringify(images),
    id,
  );
  log.info('内容图片列表已更新', { id, imageCount: images.length });
}
