/**
 * 媒体下载服务 (social-media-downloader skill 集成)
 *
 * 通过 TikHub API 获取各平台视频/图片的无水印下载链接，
 * 支持下载到本地或返回 URL 供前端使用。
 *
 * 支持的平台:
 *   - 抖音:   /douyin/app/v3/fetch_one_video_v2 (含无水印 URL)
 *   - 小红书: /xhs/app_v2/note_detail (含图片/视频 URL)
 *   - TikTok: /tiktok/app/v3/fetch_one_video_v2
 *   - YouTube: /youtube/web/v2/video-info (流媒体 URL)
 *
 * 流程:
 *   1. detectPlatform(url)    - 从 URL 识别平台
 *   2. extractId(url)         - 提取平台内容 ID
 *   3. fetchMediaUrls(id)     - 调用 TikHub API 获取下载 URL
 *   4. downloadToLocal(urls)  - 可选: 下载到本地
 *
 * 数据持久化: media_downloads 表
 */

import tikhubClient from './tikhub-client';
import { createServiceLogger } from '../utils/logger';
import { getDb } from '../db';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const log = createServiceLogger('media-download');

// ============================================================================
// 类型定义
// ============================================================================

export type MediaPlatform = 'douyin' | 'xiaohongshu' | 'tiktok' | 'youtube';

export type MediaType = 'video' | 'image' | 'audio';

export interface MediaItem {
  type: MediaType;
  url: string;
  filename: string;
  quality?: string;
  size?: number;
}

export interface MediaDownloadResult {
  id: number;
  sourceUrl: string;
  platform: MediaPlatform;
  title: string;
  author: string;
  mediaItems: MediaItem[];
  localPaths: string[];
  status: string;
  errorMessage?: string;
  createdAt: string;
}

// ============================================================================
// 数据库行映射
// ============================================================================

interface MediaDownloadRow {
  id: number;
  source_url: string;
  platform: string;
  title: string | null;
  author: string | null;
  media_items: string | null;
  local_paths: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

function mapRow(row: MediaDownloadRow): MediaDownloadResult {
  let mediaItems: MediaItem[] = [];
  let localPaths: string[] = [];
  try { mediaItems = row.media_items ? JSON.parse(row.media_items) : []; } catch { /* ignore */ }
  try { localPaths = row.local_paths ? JSON.parse(row.local_paths) : []; } catch { /* ignore */ }
  return {
    id: row.id,
    sourceUrl: row.source_url,
    platform: row.platform as MediaPlatform,
    title: row.title ?? '',
    author: row.author ?? '',
    mediaItems,
    localPaths,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
  };
}

// ============================================================================
// URL 平台识别与 ID 提取
// ============================================================================

function detectPlatform(url: string): MediaPlatform | null {
  const lower = url.toLowerCase();
  if (lower.includes('douyin.com') || lower.includes('iesdouyin.com')) return 'douyin';
  if (lower.includes('xiaohongshu.com') || lower.includes('xhslink.com')) return 'xiaohongshu';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  return null;
}

function extractDouyinId(url: string): string | null {
  const patterns = [/\/video\/(\d+)/, /aweme_id=(\d+)/, /modal_id=(\d+)/, /\/(\d{15,})/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractXhsNoteId(url: string): string | null {
  const patterns = [/\/explore\/([a-f0-9]+)/, /\/discovery\/item\/([a-f0-9]+)/, /note_id=([a-f0-9]+)/, /\/([a-f0-9]{24})/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractTiktokId(url: string): string | null {
  const m = url.match(/\/video\/(\d+)/) || url.match(/\?aid=(\d+)/);
  return m?.[1] || null;
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] || null;
}

// ============================================================================
// TikHub API 调用 - 获取媒体下载 URL
// ============================================================================

interface MediaMetadata {
  platform: MediaPlatform;
  title: string;
  author: string;
  mediaItems: MediaItem[];
}

async function fetchDouyinMedia(awemeId: string): Promise<MediaMetadata | null> {
  const res = await tikhubClient.get<any>('/douyin/app/v3/fetch_one_video_v2', { aweme_id: awemeId });
  const aweme = res?.aweme_detail || res?.aweme || res;
  if (!aweme) return null;

  const title: string = aweme.desc || '抖音视频';
  const author: string = aweme?.author?.nickname || '';
  const mediaItems: MediaItem[] = [];

  // 无水印视频 URL
  const playUrl = aweme?.video?.play_addr?.url_list?.[0] || aweme?.video?.download_addr?.url_list?.[0];
  if (playUrl) {
    mediaItems.push({
      type: 'video',
      url: playUrl,
      filename: `${title}.mp4`,
      quality: aweme?.video?.quality || 'standard',
    });
  }

  // 图集
  const images = aweme?.images || aweme?.image_list || [];
  for (let i = 0; i < images.length; i++) {
    const imgUrl = images[i]?.url_list?.[0] || images[i];
    if (typeof imgUrl === 'string') {
      mediaItems.push({
        type: 'image',
        url: imgUrl,
        filename: `${title}_${i + 1}.jpg`,
      });
    }
  }

  return { platform: 'douyin', title, author, mediaItems };
}

async function fetchXhsMedia(noteId: string): Promise<MediaMetadata | null> {
  const res = await tikhubClient.get<any>('/xhs/app_v2/note_detail', { note_id: noteId });
  const note = res?.data?.items?.[0]?.note_card || res?.note || res?.data;
  if (!note) return null;

  const title: string = note.title || note.desc || '小红书笔记';
  const author: string = note?.user?.nickname || '';
  const mediaItems: MediaItem[] = [];

  // 视频
  if (note?.video?.media?.stream?.[0]?.master_url) {
    mediaItems.push({
      type: 'video',
      url: note.video.media.stream[0].master_url,
      filename: `${title}.mp4`,
    });
  }

  // 图集
  const imageList = note?.image_list || note?.images_list || [];
  for (let i = 0; i < imageList.length; i++) {
    const imgUrl = imageList[i]?.url_default || imageList[i]?.url || imageList[i];
    if (typeof imgUrl === 'string') {
      mediaItems.push({
        type: 'image',
        url: imgUrl,
        filename: `${title}_${i + 1}.jpg`,
      });
    }
  }

  return { platform: 'xiaohongshu', title, author, mediaItems };
}

async function fetchTiktokMedia(videoId: string): Promise<MediaMetadata | null> {
  const res = await tikhubClient.get<any>('/tiktok/app/v3/fetch_one_video_v2', { aweme_id: videoId });
  const item = res?.aweme_detail || res?.item || res;
  if (!item) return null;

  const title: string = item.desc || 'TikTok Video';
  const author: string = item?.author?.nickname || '';
  const mediaItems: MediaItem[] = [];

  const playUrl = item?.video?.play_addr?.url_list?.[0] || item?.video?.download_addr?.url_list?.[0];
  if (playUrl) {
    mediaItems.push({
      type: 'video',
      url: playUrl,
      filename: `${title}.mp4`,
      quality: item?.video?.quality || 'standard',
    });
  }

  return { platform: 'tiktok', title, author, mediaItems };
}

async function fetchYoutubeMedia(videoId: string): Promise<MediaMetadata | null> {
  const res = await tikhubClient.get<any>('/youtube/web/v2/video-info', { id: videoId });
  const item = res?.data || res?.items?.[0] || res;
  if (!item) return null;

  const title: string = item?.title || item?.snippet?.title || 'YouTube Video';
  const author: string = item?.channel_title || item?.author || '';
  const mediaItems: MediaItem[] = [];

  // YouTube 通常不直接提供下载 URL，提供缩略图
  const thumbnail = item?.thumbnail?.thumbnails?.pop()?.url || item?.snippet?.thumbnails?.high?.url;
  if (thumbnail) {
    mediaItems.push({
      type: 'image',
      url: thumbnail,
      filename: `${title}_thumb.jpg`,
    });
  }

  return { platform: 'youtube', title, author, mediaItems };
}

// ============================================================================
// 主流程: getDownloadLinks
// ============================================================================

/**
 * 获取媒体下载链接主函数。
 *
 * 流程:
 *   1. 识别平台并提取内容 ID
 *   2. 调用 TikHub API 获取无水印下载 URL
 *   3. 创建数据库记录
 *   4. 可选: 下载到本地
 *
 * @param sourceUrl 源视频/笔记 URL
 * @param downloadToLocal 是否下载到本地(默认 false)
 * @returns 下载结果
 */
export async function getDownloadLinks(
  sourceUrl: string,
  downloadToLocal: boolean = false,
): Promise<MediaDownloadResult> {
  log.info(`获取媒体下载链接: url=${sourceUrl.substring(0, 80)}, downloadToLocal=${downloadToLocal}`);

  const platform = detectPlatform(sourceUrl);
  if (!platform) {
    throw new Error(`不支持的平台，URL: ${sourceUrl}`);
  }

  if (!tikhubClient.isEnabled()) {
    throw new Error('TikHub API 未配置，无法获取媒体下载链接');
  }

  // 提取平台 ID
  let contentId: string | null = null;
  switch (platform) {
    case 'douyin': contentId = extractDouyinId(sourceUrl); break;
    case 'xiaohongshu': contentId = extractXhsNoteId(sourceUrl); break;
    case 'tiktok': contentId = extractTiktokId(sourceUrl); break;
    case 'youtube': contentId = extractYouTubeId(sourceUrl); break;
  }

  if (!contentId) {
    throw new Error(`无法从 URL 提取 ${platform} 内容 ID: ${sourceUrl}`);
  }

  // 创建数据库记录
  const recordId = createDownloadRecord(sourceUrl, platform);
  log.info(`已创建媒体下载记录: id=${recordId}`);

  try {
    updateDownloadStatus(recordId, 'fetching');

    // 获取媒体元数据
    let metadata: MediaMetadata | null = null;
    switch (platform) {
      case 'douyin': metadata = await fetchDouyinMedia(contentId); break;
      case 'xiaohongshu': metadata = await fetchXhsMedia(contentId); break;
      case 'tiktok': metadata = await fetchTiktokMedia(contentId); break;
      case 'youtube': metadata = await fetchYoutubeMedia(contentId); break;
    }

    if (!metadata) {
      throw new Error(`TikHub 未返回 ${platform} 内容元数据`);
    }

    // 可选: 下载到本地
    let localPaths: string[] = [];
    if (downloadToLocal && metadata.mediaItems.length > 0) {
      updateDownloadStatus(recordId, 'downloading');
      const downloadDir = getDefaultDownloadDir();
      localPaths = await downloadMediaToLocal(metadata.mediaItems, downloadDir, metadata.title);
    }

    // 保存结果
    saveDownloadResult(recordId, {
      title: metadata.title,
      author: metadata.author,
      mediaItems: metadata.mediaItems,
      localPaths,
    });

    updateDownloadStatus(recordId, 'completed');
    log.info(`媒体下载完成: id=${recordId}, items=${metadata.mediaItems.length}, localFiles=${localPaths.length}`);

    const result = getDownload(recordId);
    if (!result) throw new Error(`下载记录 ${recordId} 在完成后消失`);
    return result;
  } catch (e) {
    const err = e as Error;
    log.error(`媒体下载失败: ${err.message}`);
    updateDownloadStatus(recordId, 'failed', err.message);

    const result = getDownload(recordId);
    if (!result) throw new Error(`下载记录 ${recordId} 在失败后消失: ${err.message}`);
    return result;
  }
}

// ============================================================================
// 本地下载
// ============================================================================

function getDefaultDownloadDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'media-downloads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function downloadMediaToLocal(
  mediaItems: MediaItem[],
  downloadDir: string,
  title: string,
): Promise<string[]> {
  const localPaths: string[] = [];
  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  const itemDir = path.join(downloadDir, safeTitle);
  if (!fs.existsSync(itemDir)) {
    fs.mkdirSync(itemDir, { recursive: true });
  }

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    try {
      const filePath = path.join(itemDir, item.filename);
      log.info(`下载 ${item.type}: ${item.filename} (${i + 1}/${mediaItems.length})`);

      const response = await fetch(item.url);
      if (!response.ok || !response.body) {
        log.warn(`下载失败: ${item.filename}, status=${response.status}`);
        continue;
      }

      const fileStream = fs.createWriteStream(filePath);
      await pipeline(response.body as any, fileStream);
      localPaths.push(filePath);
      log.info(`已下载: ${filePath}`);
    } catch (e) {
      log.warn(`下载 ${item.filename} 失败: ${(e as Error).message}`);
    }
  }

  return localPaths;
}

// ============================================================================
// 数据库操作
// ============================================================================

function createDownloadRecord(sourceUrl: string, platform: string): number {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO media_downloads (source_url, platform, status)
    VALUES (?, ?, 'pending')
  `).run(sourceUrl, platform);
  return Number(info.lastInsertRowid);
}

function updateDownloadStatus(recordId: number, status: string, errorMessage?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (errorMessage !== undefined) {
    db.prepare(`
      UPDATE media_downloads SET status = ?, error_message = ?, updated_at = ? WHERE id = ?
    `).run(status, errorMessage, now, recordId);
  } else {
    db.prepare(`
      UPDATE media_downloads SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, recordId);
  }
}

function saveDownloadResult(
  recordId: number,
  data: { title: string; author: string; mediaItems: MediaItem[]; localPaths: string[] },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE media_downloads
    SET title = ?, author = ?, media_items = ?, local_paths = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.title,
    data.author,
    JSON.stringify(data.mediaItems),
    JSON.stringify(data.localPaths),
    now,
    recordId,
  );
}

// ============================================================================
// 公共 API: 查询接口
// ============================================================================

/** 获取下载记录列表(分页) */
export function getDownloads(
  page: number = 1,
  pageSize: number = 20,
  platform?: string,
): { data: MediaDownloadResult[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM media_downloads';
  const params: Array<string | number> = [];
  if (platform) {
    query += ' WHERE platform = ?';
    params.push(platform);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const rows = db.prepare(query).all(...params) as MediaDownloadRow[];
  const countQuery = platform
    ? 'SELECT COUNT(*) as total FROM media_downloads WHERE platform = ?'
    : 'SELECT COUNT(*) as total FROM media_downloads';
  const countRow = db.prepare(countQuery).get(...(platform ? [platform] : [])) as { total: number };

  return { data: rows.map(mapRow), total: countRow.total };
}

/** 获取单条下载记录 */
export function getDownload(id: number): MediaDownloadResult | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM media_downloads WHERE id = ?').get(id) as MediaDownloadRow | undefined;
  return row ? mapRow(row) : null;
}
