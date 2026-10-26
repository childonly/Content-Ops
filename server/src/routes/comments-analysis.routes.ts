/**
 * 评论分析路由 - /api/comments-analysis
 *
 * 端点列表:
 * - POST /analyze           - 发起评论分析
 *   body: { platform, targetId, targetUrl?, limit?, cursor? }
 * - GET  /list              - 获取分析记录列表(分页)
 *   查询参数: page, pageSize, platform
 * - GET  /:id               - 获取单条分析记录详情
 *
 * 成功返回: { success: true, data: result }
 * 失败返回: { success: false, error: message }
 */

import { Router, type Request, type Response } from 'express';
import { analyzeComments, getAnalyses, getAnalysis, type CommentPlatform } from '../services/comments-analysis.service';

export const router = Router();

// POST /analyze - 发起评论分析
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { platform, targetId, targetUrl, limit, cursor } = req.body || {};

    if (!platform) {
      return res.status(400).json({ success: false, error: 'platform 参数必填' });
    }
    if (!targetId) {
      return res.status(400).json({ success: false, error: 'targetId 参数必填' });
    }

    const validPlatforms: CommentPlatform[] = ['xiaohongshu', 'douyin', 'tiktok', 'youtube'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        error: `不支持的平台: ${platform}，可选: ${validPlatforms.join(', ')}`,
      });
    }

    const result = await analyzeComments({
      platform,
      targetId: String(targetId),
      targetUrl: targetUrl ? String(targetUrl) : undefined,
      limit: limit ? parseInt(String(limit), 10) : 50,
      cursor: cursor ? String(cursor) : undefined,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /list - 获取分析记录列表
router.get('/list', async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const platform = req.query.platform ? String(req.query.platform) : undefined;

    const result = getAnalyses(page, pageSize, platform);
    res.json({ success: true, data: result.data, total: result.total, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /:id - 获取单条分析记录
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const result = getAnalysis(id);
    if (!result) {
      return res.status(404).json({ success: false, error: '分析记录不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
