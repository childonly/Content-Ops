/**
 * 趋势路由 - /api/trends
 */

import { Router, Request, Response } from 'express';
import * as trendService from '../services/trend.service';
import { ApiResponse, PaginatedResponse, Trend, TrendDiscoveryParams } from '../types';

export const router = Router();

// GET / - 获取趋势列表（支持 platform 和 category 过滤）
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const status = req.query.status ? String(req.query.status) : undefined;
    const platform = req.query.platform ? String(req.query.platform) : undefined;
    const category = req.query.category ? String(req.query.category) : undefined;

    const { data, total } = trendService.getTrends(page, pageSize, status, platform, category);
    const response: PaginatedResponse<Trend> = {
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

// GET /:id - 获取趋势详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const trend = trendService.getTrendById(id);
    if (!trend) {
      return res.status(404).json({ success: false, error: '趋势不存在' } as ApiResponse);
    }

    res.json({ success: true, data: trend } as ApiResponse<Trend>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /discover - 发现新趋势
router.post('/discover', async (req: Request, res: Response) => {
  try {
    const params = req.body as TrendDiscoveryParams;
    const trends = await trendService.discoverTrends(params);
    res.status(201).json({
      success: true,
      data: trends,
      message: `发现 ${trends.length} 条趋势`,
    } as ApiResponse<Trend[]>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// DELETE /batch - 批量删除趋势
router.delete('/batch', (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids?: number[] };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 ids 参数或参数为空' } as ApiResponse);
    }
    const deletedCount = trendService.deleteTrends(ids);
    res.json({ success: true, data: { deleted: deletedCount }, message: `已删除 ${deletedCount} 条趋势` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// DELETE /:id - 删除趋势
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const deleted = trendService.deleteTrend(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '趋势不存在' } as ApiResponse);
    }

    res.json({ success: true, message: '趋势已删除' } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// PATCH /:id/status - 更新趋势状态
router.patch('/:id/status', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const { status } = req.body as { status?: string };
    if (!status) {
      return res.status(400).json({ success: false, error: '缺少 status 参数' } as ApiResponse);
    }

    const trend = trendService.updateTrendStatus(id, status as Trend['status']);
    if (!trend) {
      return res.status(404).json({ success: false, error: '趋势不存在' } as ApiResponse);
    }

    res.json({ success: true, data: trend, message: '状态已更新' } as ApiResponse<Trend>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
