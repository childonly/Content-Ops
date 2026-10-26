/**
 * 视频工作室统一路由 — /api/video-studio
 *
 * 将「视频转录」和「视频炼金术」统一为一个 API 入口。
 * skill 作为可切换的工具策略，通过 strategy 参数选择。
 *
 * 端点:
 *   POST   /process              统一处理视频 (strategy 选择 transcribe/alchemist)
 *   GET    /records              获取统一记录列表 (UNION 两张表)
 *   GET    /records/:uid         获取单条统一记录
 *   DELETE /records/:uid         删除单条记录
 *   DELETE /records/batch        批量删除
 *   POST   /records/:uid/summarize  生成 AI 总结稿 (仅转录记录)
 *
 * 数据保护:
 *   - 旧端点 (/api/transcriber/*, /api/video-alchemist/*) 保持不变
 *   - 两张原表不删除、不修改
 *   - 统一列表通过 UNION 查询，仅读操作
 */

import { Router, Request, Response } from 'express';
import {
  processVideoUnified,
  getUnifiedList,
  getUnifiedRecord,
  deleteUnifiedRecord,
  deleteUnifiedRecords,
  summarizeUnifiedRecord,
  submitToContent,
  type VideoStrategy,
} from '../services/video-studio.service';
import { readProgressFile, cleanProgressFile, urlToHash, checkVideoDuration, regenerateFullText } from '../services/transcriber.service';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MAX_VIDEO_DURATION_SECONDS, LONG_VIDEO_WARNING_SECONDS, MODEL_SPEED_FACTOR } from '../utils/constants';
import fs from 'fs';
import path from 'path';
import { extractVideoSourceText, extractVideoUrl } from '../utils/video-url';

const log = createServiceLogger('video-studio-routes');
const execFileAsync = promisify(execFile);
export const router = Router();

// ============================================================================
// POST /process - 统一处理视频
// ============================================================================

router.post('/process', async (req: Request, res: Response) => {
  try {
    const { url, strategy, model, language, sourceText, platform } = req.body as {
      url?: string;
      strategy?: VideoStrategy;
      model?: string;
      language?: string;
      sourceText?: string;
      platform?: string;
    };

    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, error: '缺少 url 参数' });
    }

    // 默认策略: transcribe（本地 ASR）
    const selectedStrategy: VideoStrategy =
      strategy === 'alchemist' ? 'alchemist' : 'transcribe';

    const normalizedUrl = extractVideoUrl(url);
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      return res.status(400).json({ success: false, error: '未识别到有效的视频 URL，请粘贴平台分享链接或完整 URL' });
    }
    const normalizedSourceText = sourceText && sourceText.trim() ? sourceText.trim() : extractVideoSourceText(url);
    log.info(`API 统一处理视频: url=${normalizedUrl.substring(0, 80)}, strategy=${selectedStrategy}`);

    const result = await processVideoUnified(normalizedUrl, {
      strategy: selectedStrategy,
      transcribeOptions: {
        model: model || 'medium',
        language: language && language.trim() && language.trim() !== 'auto'
          ? language.trim() : undefined,
        sourceText: normalizedSourceText || undefined,
      },
      alchemistPlatform: platform as any || 'auto',
    });

    return res.status(200).json({
      success: result.status !== 'failed',
      data: result,
      message: result.status === 'completed'
        ? '处理完成'
        : result.status === 'failed'
          ? `处理失败: ${result.errorMessage}`
          : '处理中',
    });
  } catch (e) {
    log.error(`统一处理视频失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /records - 获取统一记录列表
// ============================================================================

router.get('/records', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const strategy = req.query.strategy as VideoStrategy | undefined;

    const { data, total } = getUnifiedList(page, pageSize, strategy);

    return res.json({
      success: true,
      data,
      total,
      page,
      pageSize,
    });
  } catch (e) {
    log.error(`获取统一记录列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /records/:uid - 获取单条统一记录
// ============================================================================

router.get('/records/:uid', (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    const result = getUnifiedRecord(uid);

    if (!result) {
      return res.status(404).json({ success: false, error: `记录 ${uid} 不存在` });
    }

    return res.json({ success: true, data: result });
  } catch (e) {
    log.error(`获取统一记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// DELETE /records/batch - 批量删除（必须在 :uid 路由之前，否则 "batch" 被匹配为 :uid）
// ============================================================================

router.delete('/records/batch', (req: Request, res: Response) => {
  try {
    const { uids } = req.body as { uids?: string[] };

    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 uids 参数或参数为空' });
    }

    const deletedCount = deleteUnifiedRecords(uids);
    log.info(`批量删除统一记录: ${deletedCount}/${uids.length} 条`);
    return res.json({
      success: true,
      data: { deleted: deletedCount },
      message: `已删除 ${deletedCount} 条记录`,
    });
  } catch (e) {
    log.error(`批量删除统一记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// DELETE /records/:uid - 删除单条记录
// ============================================================================

router.delete('/records/:uid', (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    const deleted = deleteUnifiedRecord(uid);

    if (!deleted) {
      return res.status(404).json({ success: false, error: `记录 ${uid} 不存在` });
    }

    log.info(`删除统一记录: uid=${uid}`);
    return res.json({ success: true, message: '记录已删除' });
  } catch (e) {
    log.error(`删除统一记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /records/:uid/summarize - 生成 AI 总结稿
// ============================================================================

router.post('/records/:uid/summarize', async (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    log.info(`生成 AI 总结稿: uid=${uid}`);

    const result = await summarizeUnifiedRecord(uid);

    return res.json({
      success: true,
      data: result,
      message: '总结稿已生成',
    });
  } catch (e) {
    log.error(`生成总结稿失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /records/:uid/submit-to-content - 提交至内容工作室
// ============================================================================

router.post('/records/:uid/submit-to-content', async (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    log.info(`提交至内容工作室: uid=${uid}`);

    const result = await submitToContent(uid);

    return res.json({
      success: true,
      data: result,
      message: '已提交至内容工作室',
    });
  } catch (e) {
    log.error(`提交至内容工作室失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /records/:uid/regenerate - 重新生成（基于缓存继续）
// ============================================================================

router.post('/records/:uid/regenerate', async (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    log.info(`重新生成记录: uid=${uid}`);

    // 获取原始记录
    const record = getUnifiedRecord(uid);
    if (!record) {
      return res.status(404).json({ success: false, error: `记录 ${uid} 不存在` });
    }

    // 只有转录策略支持重新生成
    if (record.strategy !== 'transcribe') {
      return res.status(400).json({
        success: false,
        error: '仅转录记录支持重新生成',
      });
    }

    // 检查是否有缓存的音频文件
    const urlHash = urlToHash(record.url);
    const audioDir = path.resolve(process.cwd(), 'data', 'transcriptions');
    const cachePrefix = `audio_${urlHash}_`;
    let hasAudioCache = false;
    let cachedAudioPath = '';

    try {
      if (fs.existsSync(audioDir)) {
        const files = fs.readdirSync(audioDir).filter(f => f.startsWith(cachePrefix));
        if (files.length > 0) {
          hasAudioCache = true;
          cachedAudioPath = path.join(audioDir, files[0]);
          log.info(`发现音频缓存: ${cachedAudioPath}`);
        }
      }
    } catch {
      // 检查缓存失败不影响流程
    }

    // 检查是否有段级 checkpoint
    const checkpointPath = path.join(audioDir, `checkpoint_${urlHash}.json`);
    let hasCheckpoint = false;
    let checkpointSegments: any[] = [];
    try {
      if (fs.existsSync(checkpointPath)) {
        const content = fs.readFileSync(checkpointPath, 'utf-8');
        const data = JSON.parse(content);
        if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
          hasCheckpoint = true;
          checkpointSegments = data.segments;
          log.info(`发现段级 checkpoint: ${checkpointSegments.length} 个片段已转录`);
        }
      }
    } catch {
      // checkpoint 读取失败不影响流程
    }

    // 调用转录服务重新生成（会自动使用缓存的音频文件）
    const result = await processVideoUnified(record.url, {
      strategy: 'transcribe',
      transcribeOptions: {
        model: record.model || 'medium',
        language: record.language && record.language !== 'auto' ? record.language : undefined,
        sourceText: record.sourceText,
      },
    });

    return res.json({
      success: result.status !== 'failed',
      data: result,
      cacheInfo: {
        audioCached: hasAudioCache,
        audioPath: cachedAudioPath,
        checkpointExists: hasCheckpoint,
        checkpointSegments: checkpointSegments.length,
      },
      message: result.status === 'completed'
        ? (hasAudioCache ? '基于音频缓存重新生成完成' : '重新生成完成')
        : result.status === 'failed'
          ? `重新生成失败: ${result.errorMessage}`
          : '重新生成中',
    });
  } catch (e) {
    log.error(`重新生成记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /records/:uid/regenerate-fulltext - 重新生成全文稿（仅标点和分段，不重新 ASR）
// ============================================================================

router.post('/records/:uid/regenerate-fulltext', async (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    const { useLLM } = req.body as { useLLM?: boolean };

    log.info(`重新生成全文稿: uid=${uid}, useLLM=${useLLM ?? false}`);

    // 获取统一记录
    const record = getUnifiedRecord(uid);
    if (!record) {
      return res.status(404).json({ success: false, error: `记录 ${uid} 不存在` });
    }

    // 只有转录策略支持全文稿重新生成
    if (record.strategy !== 'transcribe') {
      return res.status(400).json({
        success: false,
        error: '仅转录记录支持全文稿重新生成',
      });
    }

    // 从 UID 中提取数字 ID（格式: t123 → 123）
    const prefix = uid.charAt(0);
    const numericId = parseInt(uid.substring(1), 10);

    if (prefix !== 't' || Number.isNaN(numericId)) {
      return res.status(400).json({
        success: false,
        error: `无效的转录记录 UID: ${uid}`,
      });
    }

    // 调用 regenerateFullText 重新生成全文稿
    const updated = await regenerateFullText(numericId, useLLM ?? false);

    // 将更新后的转录记录转换为统一格式返回
    const unified = getUnifiedRecord(uid);

    return res.json({
      success: true,
      data: unified,
      message: useLLM ? 'LLM 标点修复完成' : '规则断句重新生成完成',
    });
  } catch (e) {
    log.error(`重新生成全文稿失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /records/:uid/cache-info - 获取记录的缓存信息
// ============================================================================

router.get('/records/:uid/cache-info', (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    const record = getUnifiedRecord(uid);
    if (!record) {
      return res.status(404).json({ success: false, error: `记录 ${uid} 不存在` });
    }

    const urlHash = urlToHash(record.url);
    const audioDir = path.resolve(process.cwd(), 'data', 'transcriptions');
    const cachePrefix = `audio_${urlHash}_`;

    // 检查音频缓存
    let audioCachePath = '';
    let audioCacheSize = 0;
    try {
      if (fs.existsSync(audioDir)) {
        const files = fs.readdirSync(audioDir).filter(f => f.startsWith(cachePrefix));
        if (files.length > 0) {
          audioCachePath = path.join(audioDir, files[0]);
          audioCacheSize = fs.statSync(audioCachePath).size;
        }
      }
    } catch {
      // 忽略
    }

    // 检查段级 checkpoint
    const checkpointPath = path.join(audioDir, `checkpoint_${urlHash}.json`);
    let checkpointSegments = 0;
    let checkpointLastUpdate = '';
    try {
      if (fs.existsSync(checkpointPath)) {
        const content = fs.readFileSync(checkpointPath, 'utf-8');
        const data = JSON.parse(content);
        if (data.segments && Array.isArray(data.segments)) {
          checkpointSegments = data.segments.length;
          checkpointLastUpdate = data.timestamp || '';
        }
      }
    } catch {
      // 忽略
    }

    // 检查进度文件
    const progressPath = path.join(audioDir, `progress_${urlHash}.json`);
    let progressStage = '';
    let progressPct = 0;
    try {
      if (fs.existsSync(progressPath)) {
        const content = fs.readFileSync(progressPath, 'utf-8');
        const data = JSON.parse(content);
        progressStage = data.stage || '';
        progressPct = data.percentage || 0;
      }
    } catch {
      // 忽略
    }

    return res.json({
      success: true,
      data: {
        audioCached: !!audioCachePath,
        audioPath: audioCachePath,
        audioCacheSize,
        checkpointExists: checkpointSegments > 0,
        checkpointSegments,
        checkpointLastUpdate,
        progressStage,
        progressPct,
        canRegenerate: !!audioCachePath || checkpointSegments > 0,
      },
    });
  } catch (e) {
    log.error(`获取缓存信息失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /progress - 获取转录实时进度
// ============================================================================

router.get('/progress', (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, error: '缺少 url 参数' });
    }

    const progress = readProgressFile(url.trim());
    return res.json({
      success: true,
      data: progress,
      urlHash: urlToHash(url.trim()),
    });
  } catch (e) {
    log.error(`获取进度失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /check-video - 预检查视频时长（不下载，不转录）
// ============================================================================

router.post('/check-video', async (req: Request, res: Response) => {
  try {
    const { url, model } = req.body as { url?: string; model?: string };
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, error: '缺少 url 参数' });
    }

    const modelSize = model || 'medium';
    log.info(`预检查视频: url=${url.substring(0, 80)}, model=${modelSize}`);

    const result = await checkVideoDuration(url.trim(), modelSize);

    return res.json({
      success: true,
      data: result,
    });
  } catch (e) {
    log.error(`预检查视频失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /logs - 获取 PM2 实时日志（复用 npx pm2 logs 功能）
// ============================================================================

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const lines = parseInt(String(req.query.lines ?? '50'), 10) || 50;
    const maxLines = Math.min(lines, 200); // 上限 200 行

    // 使用 pm2 logs 命令获取最近的日志
    // --nostream: 只输出历史日志，不持续流式输出
    // --raw: 输出原始格式
    const result = await execFileAsync('npx', [
      'pm2', 'logs', 'content-ops-hub', '--nostream', '--lines', String(maxLines), '--raw',
    ], {
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
      shell: true,
    });

    const logText = result.stdout || result.stderr || '';

    return res.json({
      success: true,
      data: logText,
    });
  } catch (e) {
    log.error(`获取 PM2 日志失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /notes - 收藏转录文本片段到笔记
// ============================================================================

router.post('/notes', (req: Request, res: Response) => {
  try {
    const { videoUid, videoTitle, sourceUrl, timestamp, selectedText } = req.body as {
      videoUid?: string;
      videoTitle?: string;
      sourceUrl?: string;
      timestamp?: number | null;
      selectedText?: string;
    };

    if (!selectedText || !selectedText.trim()) {
      return res.status(400).json({ success: false, error: '缺少 selectedText 参数' });
    }

    const db = getDb();

    // 幂等创建笔记表（若不存在）
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_uid TEXT,
        video_title TEXT,
        source_url TEXT,
        timestamp REAL,
        selected_text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);

    const result = db.prepare(`
      INSERT INTO video_notes (video_uid, video_title, source_url, timestamp, selected_text)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      videoUid || null,
      videoTitle || null,
      sourceUrl || null,
      timestamp ?? null,
      selectedText.trim()
    );

    log.info(`收藏文本到笔记: id=${result.lastInsertRowid}, videoUid=${videoUid || '-'}`);

    return res.json({
      success: true,
      data: { id: result.lastInsertRowid },
      message: '已收藏到笔记',
    });
  } catch (e) {
    log.error(`收藏文本到笔记失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
