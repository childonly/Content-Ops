/**
 * 仪表盘路由 - /api/dashboard
 */

import { Router, Request, Response } from 'express';
import * as analyticsService from '../services/analytics.service';
import { ApiResponse, DashboardStats, PIPELINE_STAGES, PipelineStageInfo } from '../types';

export const router = Router();

// GET /stats - 获取仪表盘统计数据
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = analyticsService.getDashboardStats();
    res.json({ success: true, data: stats } as ApiResponse<DashboardStats>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// GET /pipeline-stages - 获取 Pipeline 阶段定义
router.get('/pipeline-stages', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: PIPELINE_STAGES,
    } as ApiResponse<PipelineStageInfo[]>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
