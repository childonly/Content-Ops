/**
 * 标签路由 - /api/hashtags
 */

import { Router, Request, Response } from 'express';
import * as hashtagService from '../services/hashtag.service';
import { ApiResponse, PaginatedResponse, Hashtag, HashtagResearchParams } from '../types';

export const router = Router();

// GET / - 获取标签列表（支持 keyword 和 platform 过滤）
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const trendIdRaw = req.query.trendId ? String(req.query.trendId) : undefined;
    const trendId = trendIdRaw ? parseInt(trendIdRaw, 10) : undefined;
    const keyword = req.query.keyword ? String(req.query.keyword) : undefined;
    const platform = req.query.platform ? String(req.query.platform) : undefined;

    const { data, total } = hashtagService.getHashtags(page, pageSize, trendId, keyword, platform);
    const response: PaginatedResponse<Hashtag> = {
      success: true,
      data,
      total,
      page,
      pageSize,
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// DELETE /batch - 批量删除标签
router.delete('/batch', (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids?: number[] };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 ids 参数或参数为空' } as ApiResponse);
    }
    const deletedCount = hashtagService.deleteHashtags(ids);
    res.json({ success: true, data: { deleted: deletedCount }, message: `已删除 ${deletedCount} 条标签` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /research - 研究标签
router.post('/research', async (req: Request, res: Response) => {
  try {
    const params = req.body as HashtagResearchParams;
    if (!params.keyword) {
      return res
        .status(400)
        .json({ success: false, error: '缺少 keyword 参数' } as ApiResponse);
    }

    const hashtags = await hashtagService.researchHashtags(params);
    res.status(201).json({
      success: true,
      data: hashtags,
      message: `研究 ${hashtags.length} 条标签`,
    } as ApiResponse<Hashtag[]>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
