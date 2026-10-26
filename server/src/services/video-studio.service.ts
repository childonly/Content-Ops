/**
 * 视频工作室统一服务
 *
 * 将「视频转录」和「视频炼金术」两个模块统一为一个入口，
 * skill 作为可切换的工具策略。
 *
 * 策略模式:
 *   - 'transcribe'  → 调用 transcriber.service (本地 ASR: faster-whisper + yt-dlp)
 *   - 'alchemist'   → 调用 video-alchemist.service (API 元数据提取 + LLM 改写)
 *
 * 数据保护:
 *   - 两张原表 (transcriptions / video_alchemist_runs) 均保留不删除
 *   - 统一列表通过 UNION 查询两张表，按时间排序
 *   - 旧 API 端点 (/api/transcriber/*, /api/video-alchemist/*) 继续工作
 *
 * @see DATA_PROTECTION_RULES.md
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import {
  transcribeVideo,
  getTranscriptions,
  getTranscription,
  deleteTranscription,
  deleteTranscriptions,
  summarizeTranscription,
  type TranscribeOptions,
  type TranscribeResult,
} from './transcriber.service';
import {
  processVideo as alchemistProcessVideo,
  getRuns as alchemistGetRuns,
  getRun as alchemistGetRun,
  deleteRun as alchemistDeleteRun,
  type RewritePlatform,
  type VideoAlchemistResult,
} from './video-alchemist.service';
import { createConversation, sendMessage } from './chat.service';

const log = createServiceLogger('video-studio');

// ============================================================================
// 类型定义
// ============================================================================

/** 处理策略 */
export type VideoStrategy = 'transcribe' | 'alchemist';

/** 统一视频记录（合并两种模块的数据） */
export interface UnifiedVideoRecord {
  /** 统一 ID: 't{id}' for transcriptions, 'a{id}' for alchemist */
  uid: string;
  /** 原始表中的 ID */
  id: number;
  /** 来源表 */
  source: 'transcription' | 'alchemist';
  /** 视频 URL */
  url: string;
  /** 原始链接名（仅转录有） */
  sourceText?: string;
  /** 使用的策略/工具 */
  strategy: VideoStrategy;
  /** 处理状态 */
  status: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt?: string;
  /** 错误信息 */
  errorMessage?: string;

  // --- 转录特有字段 ---
  model?: string;
  language?: string;
  duration?: number;
  transcript?: string;
  segments?: { start: number; end: number; text: string }[];
  fullText?: string;
  summary?: string;

  // --- 炼金术特有字段 ---
  platform?: string;
  keyPoints?: string[];
  rewrittenTitle?: string;
  rewrittenBody?: string;
  rewrittenTags?: string[];
  images?: string;

  [key: string]: unknown;
}

/** 统一处理选项 */
export interface UnifiedProcessOptions {
  /** 处理策略 */
  strategy: VideoStrategy;
  /** 转录选项 (strategy='transcribe' 时使用) */
  transcribeOptions?: TranscribeOptions;
  /** 改写平台 (strategy='alchemist' 时使用) */
  alchemistPlatform?: RewritePlatform;
}

// ============================================================================
// 统一处理入口
// ============================================================================

/**
 * 统一视频处理入口。
 *
 * 根据 strategy 参数分发到对应的服务：
 *   - 'transcribe' → transcriber.service.transcribeVideo()
 *   - 'alchemist'  → video-alchemist.service.processVideo()
 *
 * @param url     视频 URL
 * @param options 处理选项（含策略选择）
 * @returns 处理结果（统一格式）
 */
export async function processVideoUnified(
  url: string,
  options: UnifiedProcessOptions,
): Promise<UnifiedVideoRecord> {
  const { strategy } = options;

  log.info(`统一处理视频: url=${url.substring(0, 80)}, strategy=${strategy}`);

  if (strategy === 'transcribe') {
    const result = await transcribeVideo(url, options.transcribeOptions || {});
    return transcribeResultToUnified(result);
  }

  if (strategy === 'alchemist') {
    const result = await alchemistProcessVideo(
      url,
      options.alchemistPlatform || 'auto',
    );
    return alchemistResultToUnified(result);
  }

  throw new Error(`不支持的处理策略: ${strategy}`);
}

// ============================================================================
// 统一列表查询（UNION 两张表）
// ============================================================================

/**
 * 获取统一视频记录列表。
 *
 * 通过 UNION 查询 transcriptions 和 video_alchemist_runs 两张表，
 * 按创建时间倒序排列。
 *
 * 数据保护: 仅查询，不修改任何数据。
 *
 * @param page     页码
 * @param pageSize 每页条数
 * @param strategy 可选策略过滤
 */
export function getUnifiedList(
  page: number = 1,
  pageSize: number = 20,
  strategy?: VideoStrategy,
): { data: UnifiedVideoRecord[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  // 构建 UNION 查询
  // transcriptions 表字段映射
  const transSelect = `
    SELECT
      't' || id AS uid,
      id AS orig_id,
      'transcription' AS source,
      'transcribe' AS strategy,
      url,
      source_text,
      model,
      language,
      duration,
      status,
      error_message,
      transcript,
      segments,
      full_text,
      summary,
      NULL AS platform,
      NULL AS key_points,
      NULL AS rewritten_title,
      NULL AS rewritten_body,
      NULL AS rewritten_tags,
      NULL AS images,
      created_at,
      updated_at
    FROM transcriptions
  `;

  // video_alchemist_runs 表字段映射
  const alchSelect = `
    SELECT
      'a' || id AS uid,
      id AS orig_id,
      'alchemist' AS source,
      'alchemist' AS strategy,
      video_url AS url,
      NULL AS source_text,
      NULL AS model,
      NULL AS language,
      NULL AS duration,
      status,
      error_message,
      transcript,
      NULL AS segments,
      NULL AS full_text,
      NULL AS summary,
      platform,
      key_points,
      rewritten_title,
      rewritten_body,
      rewritten_tags,
      images,
      created_at,
      updated_at
    FROM video_alchemist_runs
  `;

  let unionQuery: string;
  let countQuery: string;
  const params: Array<string | number> = [];

  if (strategy === 'transcribe') {
    unionQuery = transSelect;
    countQuery = 'SELECT COUNT(*) AS count FROM transcriptions';
  } else if (strategy === 'alchemist') {
    unionQuery = alchSelect;
    countQuery = 'SELECT COUNT(*) AS count FROM video_alchemist_runs';
  } else {
    unionQuery = `${transSelect} UNION ALL ${alchSelect}`;
    countQuery = `
      SELECT (
        (SELECT COUNT(*) FROM transcriptions) +
        (SELECT COUNT(*) FROM video_alchemist_runs)
      ) AS count
    `;
  }

  // 排序 + 分页
  const dataQuery = `${unionQuery} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(dataQuery).all(pageSize, offset) as UnifiedRow[];

  const data = rows.map(mapUnifiedRow);

  const totalRow = db.prepare(countQuery).get() as { count: number };

  return { data, total: totalRow.count };
}

// ============================================================================
// 统一单条查询
// ============================================================================

/**
 * 根据 UID 获取单条统一记录。
 *
 * UID 格式: 't{id}' for transcriptions, 'a{id}' for alchemist
 */
export function getUnifiedRecord(uid: string): UnifiedVideoRecord | null {
  const prefix = uid.charAt(0);
  const id = parseInt(uid.substring(1), 10);

  if (Number.isNaN(id)) {
    return null;
  }

  if (prefix === 't') {
    const result = getTranscription(id);
    return result ? transcribeResultToUnified(result) : null;
  }

  if (prefix === 'a') {
    const result = alchemistGetRun(id);
    return result ? alchemistResultToUnified(result) : null;
  }

  return null;
}

// ============================================================================
// 统一删除
// ============================================================================

/**
 * 根据 UID 删除单条记录。
 *
 * 数据保护: 仅删除用户明确请求的记录，不批量删除。
 */
export function deleteUnifiedRecord(uid: string): boolean {
  const prefix = uid.charAt(0);
  const id = parseInt(uid.substring(1), 10);

  if (Number.isNaN(id)) {
    return false;
  }

  if (prefix === 't') {
    return deleteTranscription(id);
  }

  if (prefix === 'a') {
    return alchemistDeleteRun(id);
  }

  return false;
}

// ============================================================================
// 统一删除（批量）
// ============================================================================

/**
 * 批量删除统一记录。
 *
 * @param uids UID 列表
 * @returns 删除数量
 */
export function deleteUnifiedRecords(uids: string[]): number {
  let deleted = 0;
  const transIds: number[] = [];
  const alchIds: number[] = [];

  for (const uid of uids) {
    const prefix = uid.charAt(0);
    const id = parseInt(uid.substring(1), 10);
    if (Number.isNaN(id)) continue;

    if (prefix === 't') {
      transIds.push(id);
    } else if (prefix === 'a') {
      alchIds.push(id);
    }
  }

  if (transIds.length > 0) {
    deleted += deleteTranscriptions(transIds);
  }

  for (const id of alchIds) {
    if (alchemistDeleteRun(id)) {
      deleted++;
    }
  }

  return deleted;
}

// ============================================================================
// 代理: 转录总结稿生成
// ============================================================================

/**
 * 为转录记录生成 AI 总结稿。
 *
 * 仅适用于 source='transcription' 的记录。
 */
export async function summarizeUnifiedRecord(uid: string): Promise<UnifiedVideoRecord> {
  const prefix = uid.charAt(0);
  const id = parseInt(uid.substring(1), 10);

  if (prefix !== 't') {
    throw new Error('只有转录记录支持生成总结稿');
  }

  const result = await summarizeTranscription(id);
  // 返回完整的 UnifiedVideoRecord，避免前端覆盖后丢失 transcript/fullText 等字段
  return transcribeResultToUnified(result);
}

// ============================================================================
// 提交至内容工作室
// ============================================================================

/**
 * 将视频记录内容提交至内容创作工作室。
 *
 * 流程:
 *   1. 通过 uid 获取统一视频记录
 *   2. 提取可用文本内容（炼金术: rewrittenBody/transcript；转录: fullText/summary/transcript）
 *   3. 调用 chat.service 创建新对话
 *   4. 发送文本作为第一条消息
 *   5. 返回对话 ID 供前端跳转
 *
 * @param uid 统一记录 ID
 * @returns 对话 ID 和标题
 */
export async function submitToContent(
  uid: string,
): Promise<{ conversationId: number; conversationTitle: string }> {
  const record = getUnifiedRecord(uid);
  if (!record) {
    throw new Error(`记录 ${uid} 不存在`);
  }

  // 提取可用文本内容
  // 性能优化：优先使用 summary（AI 总结稿，几百字，LLM 处理快），
  // fullText（完整文稿，可能几万字）作为兜底，避免大 token 输入导致 LLM 响应慢
  let text: string;
  if (record.source === 'alchemist') {
    // 炼金术类型：优先使用 rewrittenBody，其次 transcript
    text = record.rewrittenBody || record.transcript || '';
  } else {
    // 转录类型：优先 summary（短文本，LLM 处理快 5~10 倍），fullText 作为兜底
    text = record.summary || record.fullText || record.transcript || '';
  }

  if (!text.trim()) {
    throw new Error('该记录没有可用的文本内容');
  }

  // 性能优化：限制输入文本长度，防止超大 token 导致 LLM 处理极慢或超时
  const MAX_TEXT_LENGTH = 8000;
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[文本过长，已截断，仅保留前 8000 字]';
  }

  // 构建对话标题：使用 sourceText 或从 URL 提取的平台名
  const conversationTitle =
    record.sourceText?.trim() || extractPlatformFromUrl(record.url);

  // 创建新对话
  const conversation = createConversation(conversationTitle, 'discuss');

  // 构建消息内容（带前缀说明）
  const messageContent = `以下是从视频转录的内容，请帮我基于此创作内容：\n\n${text}`;

  // 先保存用户消息（不等 LLM 回复），立即返回对话 ID
  // LLM 回复将在后台异步生成，前端进入对话页后可轮询获取
  sendMessage(conversation.id, messageContent, 'discuss')
    .then(() => {
      log.info('视频内容提交后 LLM 回复已完成', {
        uid,
        conversationId: conversation.id,
      });
    })
    .catch((err) => {
      log.error('视频内容提交后 LLM 回复失败', {
        uid,
        conversationId: conversation.id,
        error: err.message,
      });
    });

  log.info('已提交至内容工作室（LLM 异步处理中）', {
    uid,
    conversationId: conversation.id,
    conversationTitle: conversation.title,
  });

  return {
    conversationId: conversation.id,
    conversationTitle: conversation.title,
  };
}

/** 从 URL 中提取平台名称用于对话标题 */
function extractPlatformFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('bilibili') || host.includes('b23.tv')) return 'B站视频';
    if (host.includes('douyin')) return '抖音视频';
    if (host.includes('xiaohongshu') || host.includes('xhslink')) return '小红书视频';
    if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube视频';
    if (host.includes('tiktok')) return 'TikTok视频';
    return `${host}视频`;
  } catch {
    return '视频内容';
  }
}

// ============================================================================
// 类型转换辅助函数
// ============================================================================

interface UnifiedRow {
  uid: string;
  orig_id: number;
  source: string;
  strategy: string;
  url: string;
  source_text: string | null;
  model: string | null;
  language: string | null;
  duration: number | null;
  status: string;
  error_message: string | null;
  transcript: string | null;
  segments: string | null;
  full_text: string | null;
  summary: string | null;
  platform: string | null;
  key_points: string | null;
  rewritten_title: string | null;
  rewritten_body: string | null;
  rewritten_tags: string | null;
  images: string | null;
  created_at: string;
  updated_at: string | null;
}

function mapUnifiedRow(row: UnifiedRow): UnifiedVideoRecord {
  let segments: { start: number; end: number; text: string }[] = [];
  if (row.segments) {
    try {
      const parsed = JSON.parse(row.segments);
      if (Array.isArray(parsed)) {
        segments = parsed.map((s: any) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
          text: String(s.text ?? ''),
        }));
      }
    } catch {
      // 忽略解析失败
    }
  }

  let keyPoints: string[] = [];
  if (row.key_points) {
    try {
      const parsed = JSON.parse(row.key_points);
      if (Array.isArray(parsed)) {
        keyPoints = parsed.map((s: any) => String(s));
      }
    } catch {
      keyPoints = row.key_points.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  let rewrittenTags: string[] = [];
  if (row.rewritten_tags) {
    try {
      const parsed = JSON.parse(row.rewritten_tags);
      if (Array.isArray(parsed)) {
        rewrittenTags = parsed.map((s: any) => String(s));
      }
    } catch {
      rewrittenTags = row.rewritten_tags.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  return {
    uid: row.uid,
    id: row.orig_id,
    source: row.source as 'transcription' | 'alchemist',
    strategy: row.strategy as VideoStrategy,
    url: row.url,
    sourceText: row.source_text ?? undefined,
    model: row.model ?? undefined,
    language: row.language ?? undefined,
    duration: row.duration ?? undefined,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    transcript: row.transcript ?? undefined,
    segments,
    fullText: row.full_text ?? undefined,
    summary: row.summary ?? undefined,
    platform: row.platform ?? undefined,
    keyPoints,
    rewrittenTitle: row.rewritten_title ?? undefined,
    rewrittenBody: row.rewritten_body ?? undefined,
    rewrittenTags,
    images: row.images ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  };
}

function transcribeResultToUnified(r: TranscribeResult): UnifiedVideoRecord {
  return {
    uid: `t${r.id}`,
    id: r.id,
    source: 'transcription',
    strategy: 'transcribe',
    url: r.url,
    sourceText: r.sourceText,
    model: r.model,
    language: r.language,
    duration: r.duration,
    status: r.status,
    errorMessage: r.errorMessage,
    transcript: r.transcript,
    segments: r.segments,
    fullText: r.fullText,
    summary: r.summary,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function alchemistResultToUnified(r: VideoAlchemistResult): UnifiedVideoRecord {
  return {
    uid: `a${r.id}`,
    id: r.id,
    source: 'alchemist',
    strategy: 'alchemist',
    url: r.videoUrl,
    platform: r.platform,
    status: r.status,
    errorMessage: r.errorMessage,
    transcript: r.transcript,
    keyPoints: r.keyPoints,
    rewrittenTitle: r.rewrittenContent.title,
    rewrittenBody: r.rewrittenContent.body,
    rewrittenTags: r.rewrittenContent.tags,
    images: r.images,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
