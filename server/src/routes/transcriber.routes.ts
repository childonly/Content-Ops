/**
 * 视频转录路由 — /api/transcriber
 *
 * 端点:
 *   POST   /transcribe          转录视频 (URL → 下载音频 → ASR 转录)
 *   GET    /transcriptions      获取转录记录列表(分页)
 *   GET    /transcriptions/:id  获取单条转录记录
 *   DELETE /transcriptions/:id  删除转录记录
 */

import { Router, Request, Response } from 'express';
import {
  transcribeVideo,
  getTranscriptions,
  getTranscription,
  deleteTranscription,
  deleteTranscriptions,
  summarizeTranscription,
  type TranscribeOptions,
} from '../services/transcriber.service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('transcriber-routes');
export const router = Router();

// 支持的 Whisper 模型大小
const VALID_MODELS: string[] = ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'];

// ============================================================================
// POST /transcribe - 转录视频
// ============================================================================

router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const { url, model, language, outputDir, sourceText } = req.body as {
      url?: string;
      model?: string;
      language?: string;
      outputDir?: string;
      sourceText?: string;
    };

    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, error: '缺少 url 参数' });
    }

    // 校验 model 取值（默认 medium，平衡精度和速度）
    const modelSize = model && VALID_MODELS.includes(model) ? model : 'medium';

    // language: 'auto' 或空值视为不指定语言（让 faster-whisper 自动检测）
    // faster-whisper 的 language 参数接受 None（自动检测）或语言代码如 'zh'/'en'
    // 传入 'auto' 会导致 faster-whisper 无法识别而报错
    const lang = language && language.trim() && language.trim() !== 'auto' ? language.trim() : undefined;

    const options: TranscribeOptions = {
      model: modelSize,
      language: lang,
      outputDir: outputDir && outputDir.trim() ? outputDir.trim() : undefined,
      sourceText: sourceText && sourceText.trim() ? sourceText.trim() : undefined,
    };

    log.info(`API 转录视频: url=${url.substring(0, 80)}, model=${modelSize}, language=${lang || 'auto'}`);

    const result = await transcribeVideo(url.trim(), options);

    // 转录失败时返回 200 + success: false（而非 HTTP 500），
    // 因为请求本身处理成功，只是转录操作失败
    return res.status(200).json({
      success: result.status !== 'failed',
      data: result,
      message: result.status === 'completed'
        ? '转录完成'
        : result.status === 'failed'
          ? `转录失败: ${result.errorMessage}`
          : '转录中',
    });
  } catch (e) {
    log.error(`转录视频失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /transcriptions - 获取转录记录列表
// ============================================================================

router.get('/transcriptions', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const status = req.query.status ? String(req.query.status) : undefined;

    const { data, total } = getTranscriptions(page, pageSize, status);

    return res.json({
      success: true,
      data,
      total,
      page,
      pageSize,
    });
  } catch (e) {
    log.error(`获取转录记录列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /transcriptions/:id - 获取单条转录记录
// ============================================================================

router.get('/transcriptions/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const result = getTranscription(id);
    if (!result) {
      return res.status(404).json({ success: false, error: `转录记录 ${id} 不存在` });
    }

    return res.json({ success: true, data: result });
  } catch (e) {
    log.error(`获取转录记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// DELETE /transcriptions/:id - 删除转录记录
// ============================================================================

router.delete('/transcriptions/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const deleted = deleteTranscription(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `转录记录 ${id} 不存在` });
    }

    log.info(`删除转录记录: id=${id}`);
    return res.json({ success: true, message: '转录记录已删除' });
  } catch (e) {
    log.error(`删除转录记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// DELETE /transcriptions/batch - 批量删除转录记录
// ============================================================================

router.delete('/transcriptions/batch', (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids?: number[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 ids 参数或参数为空' });
    }

    const deletedCount = deleteTranscriptions(ids);
    log.info(`批量删除转录记录: ${deletedCount}/${ids.length} 条`);
    return res.json({ success: true, data: { deleted: deletedCount }, message: `已删除 ${deletedCount} 条记录` });
  } catch (e) {
    log.error(`批量删除转录记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /transcriptions/:id/summarize - 生成 AI 总结稿
// ============================================================================

router.post('/transcriptions/:id/summarize', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    log.info(`生成 AI 总结稿: id=${id}`);

    const result = await summarizeTranscription(id);

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

export default router;
