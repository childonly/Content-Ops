/**
 * 评论分析服务 (comments-analysis skill 集成)
 *
 * 拉取指定帖子/视频的评论数据，进行情感分析、主题聚类和关键词提取。
 *
 * 支持的平台:
 *   - 小红书: /xhs/app_v2/note_comments
 *   - 抖音:   /douyin/app/v3/fetch_video_comments
 *   - TikTok: /tiktok/app/v3/fetch_video_comments
 *   - YouTube: /youtube/web/v2/comments
 *
 * 流程:
 *   1. fetchComments(params)   - 调用 TikHub API 获取评论列表
 *   2. analyzeSentiment(comments) - 批量情感分析 (复用 radar-sentiment.ts)
 *   3. clusterThemes(comments)   - 主题聚类与关键词提取
 *   4. summarize(results)        - 生成汇总报告
 *
 * 数据持久化: comment_analyses 表
 */

import tikhubClient from './tikhub-client';
import { createServiceLogger } from '../utils/logger';
import { batchAnalyzeSentiment, type SentimentResult } from '../utils/radar-sentiment';
import { getDb } from '../db';

const log = createServiceLogger('comments-analysis');

// ============================================================================
// 类型定义
// ============================================================================

export type CommentPlatform = 'xiaohongshu' | 'douyin' | 'tiktok' | 'youtube';

export interface CommentItem {
  id: string;
  platform: CommentPlatform;
  author: string;
  content: string;
  likes: number;
  replyTo?: string;
  createdAt: string;
}

export interface CommentAnalysisResult {
  id: number;
  platform: CommentPlatform;
  targetUrl: string;
  totalCount: number;
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
    positiveRatio: number;
  };
  topComments: CommentItem[];
  themes: ThemeCluster[];
  keywords: { word: string; count: number }[];
  status: string;
  errorMessage?: string;
  createdAt: string;
}

export interface ThemeCluster {
  theme: string;
  count: number;
  representativeComment: string;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface FetchCommentsParams {
  platform: CommentPlatform;
  targetId: string;
  targetUrl?: string;
  limit?: number;
  cursor?: string;
}

// ============================================================================
// 数据库行映射
// ============================================================================

interface CommentAnalysisRow {
  id: number;
  platform: string;
  target_url: string | null;
  total_count: number;
  positive_count: number;
  neutral_count: number;
  negative_count: number;
  top_comments: string | null;
  themes: string | null;
  keywords: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

function mapRow(row: CommentAnalysisRow): CommentAnalysisResult {
  let topComments: CommentItem[] = [];
  let themes: ThemeCluster[] = [];
  let keywords: { word: string; count: number }[] = [];

  try { topComments = row.top_comments ? JSON.parse(row.top_comments) : []; } catch { /* ignore */ }
  try { themes = row.themes ? JSON.parse(row.themes) : []; } catch { /* ignore */ }
  try { keywords = row.keywords ? JSON.parse(row.keywords) : []; } catch { /* ignore */ }

  const total = row.total_count || 1;
  return {
    id: row.id,
    platform: row.platform as CommentPlatform,
    targetUrl: row.target_url ?? '',
    totalCount: row.total_count,
    sentimentBreakdown: {
      positive: row.positive_count,
      neutral: row.neutral_count,
      negative: row.negative_count,
      positiveRatio: parseFloat(((row.positive_count / total) * 100).toFixed(2)),
    },
    topComments,
    themes,
    keywords,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
  };
}

// ============================================================================
// TikHub API 调用 - 各平台评论获取
// ============================================================================

/**
 * 调用 TikHub API 获取评论数据。
 * 根据平台选择对应的 TikHub 端点。
 */
async function fetchCommentsFromTikHub(params: FetchCommentsParams): Promise<CommentItem[]> {
  const { platform, targetId, limit = 50, cursor } = params;
  const comments: CommentItem[] = [];

  switch (platform) {
    case 'xiaohongshu': {
      const res = await tikhubClient.get<any>('/xhs/app_v2/note_comments', {
        note_id: targetId,
        cursor: cursor || '',
        limit,
      });
      const rawComments = res?.data?.comments || res?.comments || [];
      for (const c of rawComments) {
        comments.push({
          id: String(c.id || c.comment_id || ''),
          platform: 'xiaohongshu',
          author: c.user?.nickname || c.user?.name || '匿名',
          content: c.content || c.text || '',
          likes: parseInt(String(c.like_count || c.likes || '0'), 10) || 0,
          createdAt: c.create_time ? new Date(c.create_time * 1000).toISOString() : new Date().toISOString(),
        });
      }
      break;
    }

    case 'douyin': {
      const res = await tikhubClient.get<any>('/douyin/app/v3/fetch_video_comments', {
        aweme_id: targetId,
        cursor: cursor || 0,
        count: limit,
      });
      const rawComments = res?.comments || res?.data?.comments || [];
      for (const c of rawComments) {
        comments.push({
          id: String(c.cid || c.id || ''),
          platform: 'douyin',
          author: c.user?.nickname || c.nickname || '匿名',
          content: c.text || c.content || '',
          likes: parseInt(String(c.digg_count || c.like_count || '0'), 10) || 0,
          createdAt: c.create_time ? new Date(c.create_time * 1000).toISOString() : new Date().toISOString(),
        });
      }
      break;
    }

    case 'tiktok': {
      const res = await tikhubClient.get<any>('/tiktok/app/v3/fetch_video_comments', {
        aweme_id: targetId,
        cursor: cursor || 0,
        count: limit,
      });
      const rawComments = res?.comments || res?.data?.comments || [];
      for (const c of rawComments) {
        comments.push({
          id: String(c.cid || c.id || ''),
          platform: 'tiktok',
          author: c.user?.nickname || c.nickname || '匿名',
          content: c.text || c.content || '',
          likes: parseInt(String(c.digg_count || c.like_count || '0'), 10) || 0,
          createdAt: c.create_time ? new Date(c.create_time * 1000).toISOString() : new Date().toISOString(),
        });
      }
      break;
    }

    case 'youtube': {
      const res = await tikhubClient.get<any>('/youtube/web/v2/comments', {
        id: targetId,
        cursor: cursor || '',
      });
      const rawComments = res?.data?.comments || res?.comments || [];
      for (const c of rawComments) {
        comments.push({
          id: String(c.comment_id || c.id || ''),
          platform: 'youtube',
          author: c.author || c.author_name || '匿名',
          content: c.text || c.content || c.text_display || '',
          likes: parseInt(String(c.like_count || c.likes || '0'), 10) || 0,
          createdAt: c.published_at || new Date().toISOString(),
        });
      }
      break;
    }

    default:
      throw new Error(`不支持的平台: ${platform}`);
  }

  log.info(`[TikHub] 获取 ${platform} 评论 ${comments.length} 条`, { targetId });
  return comments;
}

// ============================================================================
// 主题聚类与关键词提取
// ============================================================================

/**
 * 简单主题聚类 - 基于关键词共现关系。
 * 不依赖 LLM，使用词频统计 + 简单分组。
 */
function clusterThemes(comments: CommentItem[], sentiments: SentimentResult[]): ThemeCluster[] {
  // 提取所有评论中的高频词
  const wordFreq = new Map<string, number>();
  const wordComments = new Map<string, { comment: CommentItem; sentiment: SentimentResult }>();

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    const sentiment = sentiments[i];
    // 简单分词：按空格和标点分割，过滤短词
    const words = comment.content
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      if (!wordComments.has(word)) {
        wordComments.set(word, { comment, sentiment });
      }
    }
  }

  // 选取频率最高的词作为主题
  const sortedWords = Array.from(wordFreq.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return sortedWords.map(([word, count]) => {
    const representative = wordComments.get(word);
    return {
      theme: word,
      count,
      representativeComment: representative?.comment.content || '',
      sentiment: representative?.sentiment.type || 'neutral',
    };
  });
}

/**
 * 提取全局关键词频率。
 */
function extractKeywords(comments: CommentItem[]): { word: string; count: number }[] {
  const wordFreq = new Map<string, number>();

  for (const comment of comments) {
    const words = comment.content
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  return Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));
}

// ============================================================================
// 主流程: analyzeComments
// ============================================================================

/**
 * 评论分析主函数。
 *
 * 完整流程:
 *   1. 创建数据库分析记录(status=pending)
 *   2. 调用 TikHub API 获取评论
 *   3. 批量情感分析(radar-sentiment.ts)
 *   4. 主题聚类与关键词提取
 *   5. 保存结果到数据库
 *
 * @param params 包含 platform, targetId, targetUrl, limit
 * @returns 分析结果
 */
export async function analyzeComments(
  params: FetchCommentsParams,
): Promise<CommentAnalysisResult> {
  const { platform, targetId, targetUrl = '', limit = 50 } = params;

  log.info(`开始评论分析: platform=${platform}, targetId=${targetId}, limit=${limit}`);

  // 1. 创建数据库记录
  const recordId = createAnalysisRecord(platform, targetUrl);
  log.info(`已创建评论分析记录: id=${recordId}`);

  try {
    if (!tikhubClient.isEnabled()) {
      throw new Error('TikHub API 未配置，无法获取评论数据');
    }

    // 2. 获取评论
    updateAnalysisStatus(recordId, 'fetching');
    const comments = await fetchCommentsFromTikHub(params);

    if (comments.length === 0) {
      log.warn(`未获取到评论数据`);
      saveAnalysisResult(recordId, {
        totalCount: 0,
        sentiments: [],
        comments: [],
        themes: [],
        keywords: [],
      });
      updateAnalysisStatus(recordId, 'completed');
      return getAnalysis(recordId)!;
    }

    // 3. 批量情感分析
    updateAnalysisStatus(recordId, 'analyzing');
    const sentiments = batchAnalyzeSentiment(
      comments.map((c) => ({ id: c.id, text: c.content })),
    );

    // 4. 主题聚类与关键词
    const themes = clusterThemes(comments, sentiments);
    const keywords = extractKeywords(comments);

    // 5. 保存结果
    saveAnalysisResult(recordId, {
      totalCount: comments.length,
      sentiments,
      comments,
      themes,
      keywords,
    });

    updateAnalysisStatus(recordId, 'completed');
    log.info(`评论分析完成: id=${recordId}, comments=${comments.length}`);

    const result = getAnalysis(recordId);
    if (!result) throw new Error(`分析记录 ${recordId} 在完成后消失`);
    return result;
  } catch (e) {
    const err = e as Error;
    log.error(`评论分析失败: ${err.message}`);
    updateAnalysisStatus(recordId, 'failed', err.message);

    const result = getAnalysis(recordId);
    if (!result) throw new Error(`分析记录 ${recordId} 在失败后消失: ${err.message}`);
    return result;
  }
}

// ============================================================================
// 数据库操作
// ============================================================================

function createAnalysisRecord(platform: string, targetUrl: string): number {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO comment_analyses (platform, target_url, status)
    VALUES (?, ?, 'pending')
  `).run(platform, targetUrl);
  return Number(info.lastInsertRowid);
}

function updateAnalysisStatus(recordId: number, status: string, errorMessage?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (errorMessage !== undefined) {
    db.prepare(`
      UPDATE comment_analyses SET status = ?, error_message = ?, updated_at = ? WHERE id = ?
    `).run(status, errorMessage, now, recordId);
  } else {
    db.prepare(`
      UPDATE comment_analyses SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, recordId);
  }
}

function saveAnalysisResult(
  recordId: number,
  data: {
    totalCount: number;
    sentiments: SentimentResult[];
    comments: CommentItem[];
    themes: ThemeCluster[];
    keywords: { word: string; count: number }[];
  },
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const positive = data.sentiments.filter((s) => s.type === 'positive').length;
  const neutral = data.sentiments.filter((s) => s.type === 'neutral').length;
  const negative = data.sentiments.filter((s) => s.type === 'negative').length;

  // topComments: 按点赞数排序取前 10
  const topComments = [...data.comments]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 10);

  db.prepare(`
    UPDATE comment_analyses
    SET total_count = ?,
        positive_count = ?,
        neutral_count = ?,
        negative_count = ?,
        top_comments = ?,
        themes = ?,
        keywords = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    data.totalCount,
    positive,
    neutral,
    negative,
    JSON.stringify(topComments),
    JSON.stringify(data.themes),
    JSON.stringify(data.keywords),
    now,
    recordId,
  );
}

// ============================================================================
// 公共 API: 查询接口
// ============================================================================

/** 获取评论分析记录列表(分页) */
export function getAnalyses(
  page: number = 1,
  pageSize: number = 20,
  platform?: string,
): { data: CommentAnalysisResult[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM comment_analyses';
  const params: Array<string | number> = [];
  if (platform) {
    query += ' WHERE platform = ?';
    params.push(platform);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const rows = db.prepare(query).all(...params) as CommentAnalysisRow[];
  const countQuery = platform
    ? 'SELECT COUNT(*) as total FROM comment_analyses WHERE platform = ?'
    : 'SELECT COUNT(*) as total FROM comment_analyses';
  const countRow = db.prepare(countQuery).get(...(platform ? [platform] : [])) as { total: number };

  return {
    data: rows.map(mapRow),
    total: countRow.total,
  };
}

/** 获取单条评论分析记录 */
export function getAnalysis(id: number): CommentAnalysisResult | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM comment_analyses WHERE id = ?').get(id) as CommentAnalysisRow | undefined;
  return row ? mapRow(row) : null;
}
