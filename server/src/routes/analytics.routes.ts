/**
 * 分析路由 - /api/analytics
 */

import { Router, Request, Response } from 'express';
import * as analyticsService from '../services/analytics.service';
import {
  ApiResponse,
  PaginatedResponse,
  AnalyticsRecord,
  AnalyticsTrackParams,
} from '../types';

export const router = Router();

// GET / - 获取分析数据列表
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const publicationIdRaw = req.query.publicationId
      ? String(req.query.publicationId)
      : undefined;
    const publicationId = publicationIdRaw ? parseInt(publicationIdRaw, 10) : undefined;

    const { data, total } = analyticsService.getAnalytics(page, pageSize, publicationId);
    const response: PaginatedResponse<AnalyticsRecord> = {
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

// GET /date-range - 按日期范围查询分析数据
router.get('/date-range', (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : '';
    const endDate = req.query.endDate ? String(req.query.endDate) : '';
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: '缺少 startDate 或 endDate 参数' } as ApiResponse);
    }

    const { data, total } = analyticsService.getAnalyticsByDateRange(startDate, endDate);
    const response: PaginatedResponse<AnalyticsRecord> = {
      success: true,
      data,
      total,
      page: 1,
      pageSize: total,
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// DELETE /:id - 删除分析记录
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const deleted = analyticsService.deleteAnalytics(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '分析记录不存在' } as ApiResponse);
    }

    res.json({ success: true, message: '分析记录已删除' } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /track - 追踪效果
router.post('/track', async (req: Request, res: Response) => {
  try {
    const params = req.body as AnalyticsTrackParams;
    if (!params.publicationId) {
      return res
        .status(400)
        .json({ success: false, error: '缺少 publicationId 参数' } as ApiResponse);
    }

    const analytics = await analyticsService.trackAnalytics(params);
    res.status(201).json({
      success: true,
      data: analytics,
      message: '效果追踪完成',
    } as ApiResponse<AnalyticsRecord>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
