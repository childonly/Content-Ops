/**
 * 发布服务 - 发布记录管理与发布引擎调用
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { Publication, PublishParams } from '../types';
import {
  getDefaultPublishEngineName,
  publishWithEngine,
} from './publish-engine.service';

const log = createServiceLogger('publish-service');

export class PublishServiceValidationError extends Error {}

interface PublicationRow {
  id: number;
  content_id: number;
  platform: string;
  engine: string | null;
  post_url: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  error_message: string | null;
}

interface PublishableContentRow {
  title: string;
  body: string | null;
  tags: string | null;
  images: string | null;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapRow(row: PublicationRow): Publication {
  return {
    id: row.id,
    contentId: row.content_id,
    platform: row.platform,
    engine: row.engine ?? undefined,
    postUrl: row.post_url ?? undefined,
    status: row.status as Publication['status'],
    scheduledAt: row.scheduled_at ?? undefined,
    publishedAt: row.published_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

export function getPublications(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
): { data: Publication[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;
  let query = 'SELECT * FROM publications';
  const params: Array<string | number> = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY COALESCE(published_at, scheduled_at, id) DESC, id DESC LIMIT ? OFFSET ?';
  const rows = db.prepare(query).all(...params, pageSize, offset) as PublicationRow[];

  let countQuery = 'SELECT COUNT(*) AS count FROM publications';
  const countParams: Array<string | number> = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;
  return { data: rows.map(mapRow), total };
}

export async function publishContent(params: PublishParams): Promise<Publication> {
  const db = getDb();
  const platform = params.platform || 'xiaohongshu';
  if (platform !== 'xiaohongshu') {
    throw new PublishServiceValidationError(`当前仅支持小红书发布，收到平台: ${platform}`);
  }

  const content = db
    .prepare('SELECT title, body, tags, images FROM contents WHERE id = ?')
    .get(params.contentId) as PublishableContentRow | undefined;
  if (!content) {
    throw new PublishServiceValidationError(`内容不存在: ${params.contentId}`);
  }

  const engineName = params.engine?.trim() || getDefaultPublishEngineName();
  const info = db.prepare(`
    INSERT INTO publications (content_id, platform, engine, status, scheduled_at)
    VALUES (@content_id, @platform, @engine, 'publishing', @scheduled_at)
  `).run({
    content_id: params.contentId,
    platform,
    engine: engineName,
    scheduled_at: params.scheduledAt ?? null,
  });
  const publicationId = Number(info.lastInsertRowid);

  try {
    const result = await publishWithEngine({
      title: content.title,
      content: content.body || '',
      tags: parseStringArray(content.tags),
      images: parseStringArray(content.images),
      engine: engineName,
    });

    if (!result.success) {
      db.prepare(`
        UPDATE publications
        SET status = 'failed', engine = ?, error_message = ?
        WHERE id = ?
      `).run(result.engine, result.error || '发布失败', publicationId);
      const failed = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as PublicationRow;
      log.error('发布引擎返回失败', {
        publicationId,
        contentId: params.contentId,
        engine: result.engine,
        error: result.error,
      });
      return mapRow(failed);
    }

    const publishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE publications
      SET status = 'published', engine = ?, post_url = ?, published_at = ?, error_message = NULL
      WHERE id = ?
    `).run(result.engine, result.url ?? null, publishedAt, publicationId);
    db.prepare("UPDATE contents SET status = 'published', published_at = ? WHERE id = ?").run(
      publishedAt,
      params.contentId,
    );
    const row = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as PublicationRow;
    log.info('内容发布成功', {
      publicationId,
      contentId: params.contentId,
      engine: result.engine,
      postUrl: result.url,
    });
    return mapRow(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE publications SET status = 'failed', error_message = ? WHERE id = ?
    `).run(message, publicationId);
    const failed = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as PublicationRow;
    log.error('发布引擎调用异常', {
      publicationId,
      contentId: params.contentId,
      engine: engineName,
      error: message,
    });
    return mapRow(failed);
  }
}

export function getPublishQueue(): Publication[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM publications
      WHERE status IN ('pending', 'publishing')
      ORDER BY COALESCE(scheduled_at, id) ASC, id ASC
    `)
    .all() as PublicationRow[];
  return rows.map(mapRow);
}

export function deletePublication(id: number): boolean {
  const info = getDb().prepare('DELETE FROM publications WHERE id = ?').run(id);
  if (info.changes > 0) log.info('删除发布记录', { id });
  return info.changes > 0;
}
