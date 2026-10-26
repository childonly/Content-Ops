/**
 * Pipeline 路由 - /api/pipeline
 */

import { Router, Request, Response } from 'express';
import * as pipelineService from '../services/pipeline.service';
import type { StartPipelineParams } from '../services/pipeline.service';
import { ApiResponse, PaginatedResponse, PipelineRun } from '../types';

export const router = Router();

// GET / - 获取 Pipeline 运行列表
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;

    const { data, total } = pipelineService.getPipelineRuns(page, pageSize);
    const response: PaginatedResponse<PipelineRun> = {
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

// GET /:id - 获取运行详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const run = pipelineService.getPipelineRunById(id);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Pipeline 运行不存在' } as ApiResponse);
    }

    res.json({ success: true, data: run } as ApiResponse<PipelineRun>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /run - 启动新 Pipeline
router.post('/run', (req: Request, res: Response) => {
  try {
    const params = (req.body || {}) as StartPipelineParams;
    const run = pipelineService.startPipeline(params);
    res.status(201).json({
      success: true,
      data: run,
      message: 'Pipeline 已启动',
    } as ApiResponse<PipelineRun>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /:id/advance - 推进下一阶段
router.post('/:id/advance', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const run = await pipelineService.advanceStage(id);
    res.json({
      success: true,
      data: run,
      message: `阶段 ${run.currentStage} 已推进`,
    } as ApiResponse<PipelineRun>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// DELETE /batch - 批量删除 Pipeline 运行记录（必须位于 /:id 之前）
router.delete('/batch', (req: Request, res: Response) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'ids 必须是非空数组' } as ApiResponse);
    const deleted = pipelineService.batchDeletePipelineRuns(ids);
    res.json({ success: true, data: { deleted }, message: `已删除 ${deleted} 条运行记录` });
  } catch (error) { res.status(500).json({ success: false, error: (error as Error).message } as ApiResponse); }
});

// PUT /:id - 编辑运行元数据
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    const run = pipelineService.updatePipelineRun(id, { keyword: req.body?.keyword, trendId: req.body?.trendId === '' ? null : req.body?.trendId });
    if (!run) return res.status(404).json({ success: false, error: 'Pipeline 运行不存在' } as ApiResponse);
    res.json({ success: true, data: run });
  } catch (error) { res.status(500).json({ success: false, error: (error as Error).message } as ApiResponse); }
});

// DELETE /:id - 删除 Pipeline 运行记录
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const deleted = pipelineService.deletePipelineRun(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Pipeline 运行不存在' } as ApiResponse);
    }

    res.json({ success: true, message: 'Pipeline 运行已删除' } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /:id/pause - 暂停运行
router.post('/:id/pause', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const run = pipelineService.pausePipeline(id);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Pipeline 运行不存在' } as ApiResponse);
    }

    res.json({ success: true, data: run, message: 'Pipeline 已暂停' } as ApiResponse<PipelineRun>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /:id/resume - 恢复运行（从暂停状态恢复）
router.post('/:id/resume', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const run = pipelineService.resumePipeline(id);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Pipeline 运行不存在' } as ApiResponse);
    }

    res.json({ success: true, data: run, message: 'Pipeline 已恢复' } as ApiResponse<PipelineRun>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
