/**
 * 视频内容炼金术路由 — /api/video-alchemist
 *
 * 端点:
 *   POST   /process      处理视频 (URL → 提取 → 提炼 → 改写)
 *   GET    /runs         获取处理记录列表(分页)
 *   GET    /runs/:id     获取单条处理记录
 *   DELETE /runs/:id     删除处理记录
 */

import { Router, Request, Response } from 'express';
import {
  processVideo,
  getRuns,
  getRun,
  deleteRun,
  type RewritePlatform,
} from '../services/video-alchemist.service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('video-alchemist-routes');
export const router = Router();

// ============================================================================
// POST /process - 处理视频
// ============================================================================

router.post('/process', async (req: Request, res: Response) => {
  try {
    const { url, platform } = req.body as { url?: string; platform?: string };

    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, error: '缺少 url 参数' });
    }

    // 校验 platform 取值
    const validPlatforms: string[] = ['auto', 'xiaohongshu', 'douyin', 'weibo', 'wechat', 'zhihu'];
    const targetPlatform: RewritePlatform =
      platform && validPlatforms.includes(platform) ? (platform as RewritePlatform) : 'auto';

    log.info(`API 处理视频: url=${url.substring(0, 80)}, platform=${targetPlatform}`);

    const result = await processVideo(url.trim(), targetPlatform);

    // 处理失败时返回 200 + success: false（而非 HTTP 500），
    // 因为请求本身处理成功，只是视频处理操作失败
    return res.status(200).json({
      success: result.status !== 'failed',
      data: result,
      message: result.status === 'completed' ? '视频处理完成' : result.status === 'failed' ? `处理失败: ${result.errorMessage}` : '处理中',
    });
  } catch (e) {
    log.error(`处理视频失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /runs - 获取处理记录列表
// ============================================================================

router.get('/runs', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const status = req.query.status ? String(req.query.status) : undefined;

    const { data, total } = getRuns(page, pageSize, status);

    return res.json({
      success: true,
      data,
      total,
      page,
      pageSize,
    });
  } catch (e) {
    log.error(`获取处理记录列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /runs/:id - 获取单条处理记录
// ============================================================================

router.get('/runs/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const result = getRun(id);
    if (!result) {
      return res.status(404).json({ success: false, error: `处理记录 ${id} 不存在` });
    }

    return res.json({ success: true, data: result });
  } catch (e) {
    log.error(`获取处理记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// DELETE /runs/:id - 删除处理记录
// ============================================================================

router.delete('/runs/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const deleted = deleteRun(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `处理记录 ${id} 不存在` });
    }

    log.info(`删除处理记录: id=${id}`);
    return res.json({ success: true, message: '处理记录已删除' });
  } catch (e) {
    log.error(`删除处理记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
