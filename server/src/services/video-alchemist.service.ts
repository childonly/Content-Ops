/**
 * 视频内容炼金术服务
 *
 * 流程: 输入视频 URL → 提取文字内容 → 提炼核心观点 → 改写为多平台图文
 *
 * 步骤:
 *   1. extractTranscript(url)        - 调用 TikHub API 获取视频元数据(标题/描述)
 *                                       并用 LLM 生成摘要作为伪 transcript
 *   2. extractKeyPoints(transcript)  - 调用 LLM 提炼核心观点(列表)
 *   3. rewriteContent(keyPoints, platform) - 调用 LLM 改写为指定平台风格图文
 *   4. (可选)生成配图                  - 复用 image-generation.service
 *
 * 支持平台:
 *   - 抖音 (douyin.com / iesdouyin.com)
 *   - 小红书 (xiaohongshu.com / xhslink.com)
 *   - YouTube (youtube.com / youtu.be)
 *   - TikTok (tiktok.com)
 *
 * 数据持久化: video_alchemist_runs 表
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { callLLM } from './llm-service';
import { generateImagesForDraft } from './image-generation.service';
import tikhubClient from './tikhub-client';

const log = createServiceLogger('video-alchemist');

// ============================================================================
// 类型定义
// ============================================================================

/** 视频内容炼金术处理结果 */
export interface VideoAlchemistResult {
  id: number;
  videoUrl: string;
  platform: string;
  transcript: string;
  keyPoints: string[];
  rewrittenContent: {
    title: string;
    body: string;
    tags: string[];
  };
  images?: string;
  status: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/** TikHub 返回的视频元数据(已标准化) */
interface VideoMetadata {
  platform: string;
  title: string;
  description: string;
  author?: string;
  duration?: number;
  tags?: string[];
}

/** 改写目标平台 */
export type RewritePlatform =
  | 'auto'
  | 'xiaohongshu'
  | 'douyin'
  | 'weibo'
  | 'wechat'
  | 'zhihu';

// ============================================================================
// 数据库行映射
// ============================================================================

interface VideoAlchemistRow {
  id: number;
  video_url: string;
  platform: string;
  transcript: string | null;
  key_points: string | null;
  rewritten_title: string | null;
  rewritten_body: string | null;
  rewritten_tags: string | null;
  images: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: VideoAlchemistRow): VideoAlchemistResult {
  return {
    id: row.id,
    videoUrl: row.video_url,
    platform: row.platform,
    transcript: row.transcript ?? '',
    keyPoints: row.key_points ? safeParseStringArray(row.key_points) : [],
    rewrittenContent: {
      title: row.rewritten_title ?? '',
      body: row.rewritten_body ?? '',
      tags: row.rewritten_tags ? safeParseStringArray(row.rewritten_tags) : [],
    },
    images: row.images ?? undefined,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 安全解析 JSON 字符串数组,失败时返回空数组 */
function safeParseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
    // 逗号分隔的回退
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

// ============================================================================
// URL 平台识别
// ============================================================================

/** 从 URL 识别视频平台 */
function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('douyin.com') || lower.includes('iesdouyin.com')) {
    return 'douyin';
  }
  if (lower.includes('xiaohongshu.com') || lower.includes('xhslink.com')) {
    return 'xiaohongshu';
  }
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return 'youtube';
  }
  if (lower.includes('tiktok.com')) {
    return 'tiktok';
  }
  if (lower.includes('bilibili.com') || lower.includes('b23.tv')) {
    return 'bilibili';
  }
  return 'unknown';
}

/** 从抖音 URL 提取 aweme_id */
function extractDouyinId(url: string): string | null {
  // 匹配 /video/{id} 或 ?aweme_id={id} 或 modal_id={id}
  const patterns = [
    /\/video\/(\d+)/,
    /aweme_id=(\d+)/,
    /modal_id=(\d+)/,
    /\/(\d{15,})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

/** 从小红书 URL 提取 note_id */
function extractXhsNoteId(url: string): string | null {
  // 匹配 /explore/{id} 或 /discovery/item/{id} 或 ?note_id={id}
  const patterns = [
    /\/explore\/([a-f0-9]+)/,
    /\/discovery\/item\/([a-f0-9]+)/,
    /note_id=([a-f0-9]+)/,
    /\/([a-f0-9]{24})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

/** 从 YouTube URL 提取 video id */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

// ============================================================================
// TikHub 视频元数据获取
// ============================================================================

/**
 * 调用 TikHub API 获取抖音视频元数据。
 * 端点: /douyin/web/fetch_one_video
 */
async function fetchDouyinMetadata(awemeId: string): Promise<VideoMetadata | null> {
  try {
    const result = await tikhubClient.get<any>('/douyin/web/fetch_one_video', {
      aweme_id: awemeId,
    });

    const aweme = result?.aweme_detail || result?.aweme || result;
    if (!aweme) {
      log.warn(`[douyin] 未获取到视频详情: aweme_id=${awemeId}`);
      return null;
    }

    const desc: string = aweme.desc || '';
    const title: string = desc || (aweme.author?.nickname ? `${aweme.author.nickname}的视频` : '抖音视频');
    const description: string = desc;
    const author: string = aweme?.author?.nickname || aweme?.author?.unique_id || '';
    const duration: number = aweme?.duration || aweme?.video?.duration || 0;

    // 提取话题标签
    const hashtags: string[] = Array.isArray(aweme?.text_extra)
      ? aweme.text_extra
          .map((t: any) => t?.hashtag_name || t?.name || '')
          .filter((s: string) => Boolean(s))
      : [];

    return {
      platform: 'douyin',
      title: description || title,
      description,
      author,
      duration,
      tags: hashtags,
    };
  } catch (e) {
    log.warn(`[douyin] 获取元数据失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * 调用 TikHub API 获取小红书笔记元数据。
 * 端点: /xiaohongshu/web/v1/note_detail
 */
async function fetchXhsMetadata(noteId: string): Promise<VideoMetadata | null> {
  try {
    const result = await tikhubClient.get<any>('/xiaohongshu/web/v1/note_detail', {
      note_id: noteId,
    });

    const note = result?.data?.items?.[0]?.note_card || result?.note || result?.data;
    if (!note) {
      log.warn(`[xhs] 未获取到笔记详情: note_id=${noteId}`);
      return null;
    }

    const title: string = note.title || '';
    const description: string = note.desc || note.desc_v2 || note.title || '';
    const author: string = note?.user?.nickname || note?.user?.name || '';
    const duration: number = note?.video?.duration || 0;

    const hashtags: string[] = Array.isArray(note?.tag_list)
      ? note.tag_list.map((t: any) => t?.name || t?.title || '').filter((s: string) => Boolean(s))
      : [];

    return {
      platform: 'xiaohongshu',
      title,
      description,
      author,
      duration,
      tags: hashtags,
    };
  } catch (e) {
    log.warn(`[xhs] 获取元数据失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * 调用 TikHub API 获取 YouTube 视频元数据。
 * 端点: /youtube/web/v2/video-info
 */
async function fetchYouTubeMetadata(videoId: string): Promise<VideoMetadata | null> {
  try {
    const result = await tikhubClient.get<any>('/youtube/web/v2/video-info', {
      id: videoId,
    });

    const item = result?.data || result?.items?.[0] || result;
    if (!item) {
      log.warn(`[youtube] 未获取到视频详情: video_id=${videoId}`);
      return null;
    }

    const title: string = item?.title || item?.snippet?.title || '';
    const description: string = item?.description || item?.snippet?.description || '';
    const author: string = item?.channel_title || item?.author || item?.snippet?.channelTitle || '';
    const duration: number = item?.duration || item?.content_details?.duration || 0;

    const hashtags: string[] = Array.isArray(item?.tags)
      ? item.tags.map((t: any) => String(t))
      : [];

    return {
      platform: 'youtube',
      title,
      description,
      author,
      duration,
      tags: hashtags,
    };
  } catch (e) {
    log.warn(`[youtube] 获取元数据失败: ${(e as Error).message}`);
    return null;
  }
}

// ============================================================================
// 主流程: extractTranscript
// ============================================================================

/**
 * 从视频 URL 提取文字内容。
 *
 * 由于 TikHub 不直接返回视频字幕,本函数:
 *   1. 识别平台并提取平台 ID
 *   2. 调用对应 TikHub 端点获取视频标题/描述/作者/标签等元数据
 *   3. 将元数据拼接为伪 transcript 文本
 *   4. 调用 LLM 对元数据做语义摘要,生成更具可读性的 transcript
 *
 * @returns 拼接后的 transcript 文本(失败时返回元数据原文)
 */
export async function extractTranscript(url: string): Promise<string> {
  const platform = detectPlatform(url);
  log.info(`提取视频文字: platform=${platform}, url=${url.substring(0, 80)}`);

  if (!tikhubClient.isEnabled()) {
    log.warn('TikHub API 未配置,使用 URL 作为兜底 transcript');
    return `视频链接: ${url}`;
  }

  let metadata: VideoMetadata | null = null;

  switch (platform) {
    case 'douyin': {
      const awemeId = extractDouyinId(url);
      if (!awemeId) {
        log.warn(`[douyin] 无法从 URL 提取 aweme_id: ${url}`);
        return `抖音视频链接: ${url}`;
      }
      metadata = await fetchDouyinMetadata(awemeId);
      break;
    }
    case 'xiaohongshu': {
      const noteId = extractXhsNoteId(url);
      if (!noteId) {
        log.warn(`[xhs] 无法从 URL 提取 note_id: ${url}`);
        return `小红书笔记链接: ${url}`;
      }
      metadata = await fetchXhsMetadata(noteId);
      break;
    }
    case 'youtube': {
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        log.warn(`[youtube] 无法从 URL 提取 video_id: ${url}`);
        return `YouTube 视频链接: ${url}`;
      }
      metadata = await fetchYouTubeMetadata(videoId);
      break;
    }
    default:
      log.warn(`不支持的平台或无法识别 URL: ${url}`);
      return `视频链接: ${url}`;
  }

  if (!metadata) {
    log.warn('TikHub 未返回有效元数据,使用 URL 作为兜底');
    return `视频链接: ${url}`;
  }

  // 拼接元数据为伪 transcript
  const parts: string[] = [];
  if (metadata.title) parts.push(`标题: ${metadata.title}`);
  if (metadata.author) parts.push(`作者: ${metadata.author}`);
  if (metadata.description) parts.push(`描述: ${metadata.description}`);
  if (metadata.tags && metadata.tags.length > 0) {
    parts.push(`话题标签: ${metadata.tags.join(', ')}`);
  }
  if (metadata.duration) {
    parts.push(`时长: ${Math.round(metadata.duration / 1000)} 秒`);
  }
  parts.push(`平台: ${metadata.platform}`);

  const rawTranscript = parts.join('\n');
  log.info(`[transcript] 元数据拼接完成 (${rawTranscript.length} 字符)`);

  // 调用 LLM 生成更具可读性的摘要(失败时回退到原文)
  const llmPrompt = `请基于以下视频元数据,生成一段连贯的视频内容摘要(200-400字),描述视频可能讲述的内容。不要编造细节,只基于已知信息合理推断。

视频元数据:
${rawTranscript}

要求:
1. 第一段简述视频主题
2. 第二段列出可能的核心要点
3. 用中文输出,不要使用 markdown 标记
4. 只输出摘要,不要其他解释`;

  try {
    const { text } = await callLLM(llmPrompt);
    if (text.trim()) {
      log.info(`[transcript] LLM 摘要生成成功 (${text.length} 字符)`);
      return `${rawTranscript}\n\n--- LLM 摘要 ---\n${text.trim()}`;
    }
  } catch (e) {
    log.warn(`[transcript] LLM 摘要生成失败: ${(e as Error).message}`);
  }

  return rawTranscript;
}

// ============================================================================
// 主流程: extractKeyPoints
// ============================================================================

/**
 * 调用 LLM 从 transcript 中提炼核心观点。
 *
 * @returns 核心观点字符串数组(失败时返回单元素兜底数组)
 */
export async function extractKeyPoints(transcript: string): Promise<string[]> {
  log.info(`提炼核心观点 (transcript 长度 ${transcript.length})`);

  const prompt = `请从以下视频内容中提炼 5-8 个核心观点。

视频内容:
${transcript}

要求:
1. 每个观点一句话,简洁清晰
2. 按重要性排序
3. 用中文输出
4. 只输出观点列表,每行一个,不要编号和 markdown 标记
5. 不要重复观点
6. 不要输出其他解释`;

  try {
    const { text, provider } = await callLLM(prompt);
    if (text.trim()) {
      const points = text
        .split('\n')
        .map((line) => line.trim())
        .map((line) => line.replace(/^[\d\.\-\*•\s]+/, '').trim()) // 去除前缀编号/符号
        .filter((line) => line.length > 0);

      if (points.length > 0) {
        log.info(`[keypoints] LLM(${provider}) 提炼 ${points.length} 个观点`);
        return points.slice(0, 10);
      }
    }
  } catch (e) {
    log.warn(`[keypoints] LLM 提炼失败: ${(e as Error).message}`);
  }

  // 兜底: 按换行切分 transcript
  const fallback = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);

  return fallback.length > 0 ? fallback : ['无法提炼核心观点,请查看原始 transcript'];
}

// ============================================================================
// 主流程: rewriteContent
// ============================================================================

/** 平台对应的中文标签 */
const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  weibo: '微博',
  wechat: '微信公众号',
  zhihu: '知乎',
};

/**
 * 调用 LLM 将核心观点改写为指定平台风格的图文。
 *
 * @returns { title, body, tags } 结构化改写结果
 */
export async function rewriteContent(
  keyPoints: string[],
  platform: RewritePlatform,
): Promise<{ title: string; body: string; tags: string[] }> {
  const platformLabel = PLATFORM_LABEL[platform] || '通用社交媒体';
  log.info(`改写内容: platform=${platform}(${platformLabel}), points=${keyPoints.length}`);

  const prompt = `你是一个资深的${platformLabel}内容创作者。请基于以下核心观点,改写为一篇适合${platformLabel}发布的图文内容。

## 核心观点
${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## 风格要求
${getPlatformStyleGuide(platform)}

## 输出格式(必须严格遵守,只输出 JSON,不要 markdown 代码块)
{"title":"标题(15-30字,带 emoji)","body":"正文(300-800字,分段清晰)","tags":["标签1","标签2","标签3"]}`;

  try {
    const { text, provider } = await callLLM(prompt);
    if (text.trim()) {
      const parsed = tryParseRewriteResult(text);
      if (parsed) {
        log.info(`[rewrite] LLM(${provider}) 改写成功: title="${parsed.title.substring(0, 30)}..."`);
        return parsed;
      }
      log.warn('[rewrite] LLM 响应无法解析为 JSON,使用兜底模板');
    }
  } catch (e) {
    log.warn(`[rewrite] LLM 改写失败: ${(e as Error).message}`);
  }

  // 兜底: 模板生成
  return fallbackRewrite(keyPoints, platformLabel);
}

/** 获取平台风格指南 */
function getPlatformStyleGuide(platform: RewritePlatform): string {
  switch (platform) {
    case 'xiaohongshu':
      return [
        '- 标题带 emoji + 吸睛短语(15-25 字)',
        '- 段落清晰,每段 2-3 行,用 emoji 作为段落标记',
        '- 用小红书原生语言:「亲测」「踩坑」「安利」「绝绝子」「救命」',
        '- 结尾带 3-5 个相关话题标签',
        '- 第一人称,像在跟朋友分享经验',
        '- 开头直接抛出痛点或结论',
      ].join('\n');
    case 'douyin':
      return [
        '- 标题带 emoji,适合短视频文案(15-25 字)',
        '- 正文简洁有力,适合口播节奏',
        '- 用抖音热词:「家人们」「绝绝子」「yyds」「上头」',
        '- 结尾带 3-5 个热门话题标签',
        '- 开头 3 秒抓人,直接给结论或悬念',
      ].join('\n');
    case 'weibo':
      return [
        '- 标题简洁带话题符号(20-30 字)',
        '- 正文 140 字以内,信息密度高',
        '- 用微博风格:「转发」「安利」「种草」',
        '- 结尾带 3-5 个 #话题# 标签',
        '- 可@相关账号或话题',
      ].join('\n');
    case 'wechat':
      return [
        '- 标题吸引点击,但不过度标题党(20-40 字)',
        '- 正文 800-1500 字,深度分析',
        '- 用公众号风格:理性、有深度、有洞察',
        '- 分段清晰,适当使用小标题',
        '- 结尾引导关注和转发',
      ].join('\n');
    case 'zhihu':
      return [
        '- 标题以问题形式或结论先行(20-40 字)',
        '- 正文 1000-2000 字,专业有深度',
        '- 用知乎风格:逻辑清晰、有论据、有数据',
        '- 适当使用引用、列表、表格',
        '- 结尾带 3-5 个相关话题标签',
      ].join('\n');
    default:
      return [
        '- 标题简洁带 emoji(15-30 字)',
        '- 正文 300-800 字,分段清晰',
        '- 结尾带 3-5 个话题标签',
        '- 第一人称,真实分享',
      ].join('\n');
  }
}

/** 尝试从 LLM 响应中解析 JSON 改写结果 */
function tryParseRewriteResult(text: string): { title: string; body: string; tags: string[] } | null {
  // 去除可能的 markdown 代码块包裹
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }

  // 尝试直接解析
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.title === 'string' && typeof parsed.body === 'string') {
      return {
        title: parsed.title,
        body: parsed.body,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t)) : [],
      };
    }
  } catch {
    // 忽略,继续尝试
  }

  // 尝试从文本中提取 JSON 块
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch && jsonMatch[0]) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed.title === 'string' && typeof parsed.body === 'string') {
        return {
          title: parsed.title,
          body: parsed.body,
          tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t)) : [],
        };
      }
    } catch {
      // 忽略
    }
  }

  return null;
}

/** 兜底模板改写 */
function fallbackRewrite(keyPoints: string[], platformLabel: string): { title: string; body: string; tags: string[] } {
  const title = `${platformLabel}分享 | ${keyPoints[0]?.substring(0, 20) || '视频精华'}...`;
  const body = `今天分享一个超实用的内容!\n\n${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}\n\n希望对你有帮助,记得点赞收藏哦~`;
  const tags = [platformLabel, '内容分享', '干货'];
  return { title, body, tags };
}

// ============================================================================
// 主流程: processVideo
// ============================================================================

/**
 * 视频内容炼金术主函数。
 *
 * 完整流程:
 *   1. 创建数据库运行记录(status=pending)
 *   2. extractTranscript - 提取视频文字内容
 *   3. extractKeyPoints - 提炼核心观点
 *   4. rewriteContent - 改写为指定平台风格
 *   5. (可选)生成配图
 *   6. 更新数据库记录(status=completed)
 *
 * @param url      视频 URL
 * @param platform 目标改写平台(auto 表示根据源平台选择)
 * @returns 处理结果(含数据库记录 ID)
 */
export async function processVideo(
  url: string,
  platform: RewritePlatform = 'auto',
): Promise<VideoAlchemistResult> {
  log.info(`开始处理视频: url=${url.substring(0, 80)}, platform=${platform}`);

  // 1. 创建运行记录
  const runId = createRun(url, platform);
  log.info(`已创建运行记录: id=${runId}`);

  try {
    // 2. 提取 transcript
    updateRunStatus(runId, 'extracting');
    const transcript = await extractTranscript(url);
    saveTranscript(runId, transcript);
    log.info(`运行 ${runId}: transcript 提取完成 (${transcript.length} 字符)`);

    // 3. 提炼核心观点
    updateRunStatus(runId, 'key_points');
    const keyPoints = await extractKeyPoints(transcript);
    saveKeyPoints(runId, keyPoints);
    log.info(`运行 ${runId}: 提炼 ${keyPoints.length} 个核心观点`);

    // 4. 改写内容
    updateRunStatus(runId, 'rewriting');
    const targetPlatform: RewritePlatform =
      platform === 'auto' ? resolveAutoPlatform(url) : platform;
    const rewritten = await rewriteContent(keyPoints, targetPlatform);
    saveRewritten(runId, rewritten);
    log.info(`运行 ${runId}: 内容改写完成 (title="${rewritten.title.substring(0, 30)}...")`);

    // 5. 生成配图(可选,失败不影响主流程)
    updateRunStatus(runId, 'imaging');
    let images: string | undefined;
    try {
      const imgResult = await generateImagesForDraft(rewritten.title, rewritten.body, runId);
      images = imgResult.paths || undefined;
      if (images) {
        saveImages(runId, images);
        log.info(`运行 ${runId}: 配图生成完成 (${images.split(',').length} 张, 提供商: ${imgResult.provider})`);
      } else {
        log.info(`运行 ${runId}: 未生成配图 (${imgResult.error || '可能已禁用'})`);
      }
    } catch (e) {
      log.warn(`运行 ${runId}: 配图生成失败(不影响主流程): ${(e as Error).message}`);
    }

    // 6. 完成
    updateRunStatus(runId, 'completed');
    log.info(`运行 ${runId}: 处理完成`);

    const result = getRun(runId);
    if (!result) {
      // 理论上不会发生,但 TS 严格模式需要处理
      throw new Error(`运行记录 ${runId} 在完成后消失`);
    }
    return result;
  } catch (e) {
    const err = e as Error;
    log.error(`运行 ${runId} 失败: ${err.message}`);
    updateRunStatus(runId, 'failed', err.message);
    const result = getRun(runId);
    if (!result) {
      throw new Error(`运行记录 ${runId} 在失败后消失: ${err.message}`);
    }
    return result;
  }
}

/** auto 模式下根据源平台选择目标改写平台 */
function resolveAutoPlatform(url: string): RewritePlatform {
  const sourcePlatform = detectPlatform(url);
  // 源平台与改写平台相同时,默认小红书风格
  if (sourcePlatform === 'xiaohongshu') return 'xiaohongshu';
  if (sourcePlatform === 'douyin') return 'douyin';
  // 其他平台默认改写为小红书风格
  return 'xiaohongshu';
}

// ============================================================================
// 数据库操作
// ============================================================================

/** 创建运行记录,返回新记录 ID */
function createRun(url: string, platform: string): number {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO video_alchemist_runs (video_url, platform, status)
    VALUES (?, ?, 'pending')
  `).run(url, platform);
  return Number(info.lastInsertRowid);
}

/** 更新运行状态 */
function updateRunStatus(runId: number, status: string, errorMessage?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (errorMessage !== undefined) {
    db.prepare(`
      UPDATE video_alchemist_runs
      SET status = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(status, errorMessage, now, runId);
  } else {
    db.prepare(`
      UPDATE video_alchemist_runs
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, runId);
  }
}

/** 保存 transcript */
function saveTranscript(runId: number, transcript: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_alchemist_runs
    SET transcript = ?, updated_at = ?
    WHERE id = ?
  `).run(transcript, now, runId);
}

/** 保存核心观点 */
function saveKeyPoints(runId: number, keyPoints: string[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_alchemist_runs
    SET key_points = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(keyPoints), now, runId);
}

/** 保存改写后的内容 */
function saveRewritten(
  runId: number,
  rewritten: { title: string; body: string; tags: string[] },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_alchemist_runs
    SET rewritten_title = ?, rewritten_body = ?, rewritten_tags = ?, updated_at = ?
    WHERE id = ?
  `).run(rewritten.title, rewritten.body, JSON.stringify(rewritten.tags), now, runId);
}

/** 保存图片路径 */
function saveImages(runId: number, images: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_alchemist_runs
    SET images = ?, updated_at = ?
    WHERE id = ?
  `).run(images, now, runId);
}

// ============================================================================
// 公共 API: 查询接口
// ============================================================================

/** 获取运行记录列表(分页) */
export function getRuns(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
): { data: VideoAlchemistResult[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM video_alchemist_runs';
  const params: Array<string | number> = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';

  const rows = db.prepare(query).all(...params, pageSize, offset) as VideoAlchemistRow[];
  const data = rows.map(mapRow);

  let countQuery = 'SELECT COUNT(*) AS count FROM video_alchemist_runs';
  const countParams: Array<string | number> = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;

  return { data, total };
}

/** 获取单条运行记录 */
export function getRun(id: number): VideoAlchemistResult | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM video_alchemist_runs WHERE id = ?')
    .get(id) as VideoAlchemistRow | undefined;
  return row ? mapRow(row) : null;
}

/** 删除运行记录 */
export function deleteRun(id: number): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM video_alchemist_runs WHERE id = ?').run(id);
  if (info.changes > 0) {
    log.info(`删除运行记录: id=${id}`);
  }
  return info.changes > 0;
}
