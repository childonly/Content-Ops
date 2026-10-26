/**
 * 发布路由 - /api/publish
 *
 * 端点:
 *   GET    /                  获取发布记录列表
 *   GET    /queue             获取发布队列
 *   POST   /execute           执行发布（支持 engine 参数切换引擎）
 *   DELETE /:id               删除发布记录
 *   GET    /engines           获取可用发布引擎列表
 *   POST   /engines/default   设置默认发布引擎
 */

import { Router, Request, Response } from 'express';
import * as publishService from '../services/publish.service';
import { PublishServiceValidationError } from '../services/publish.service';
import { ApiResponse, PaginatedResponse, Publication, PublishParams } from '../types';
import {
  getPublishEngines,
  PublishEngineValidationError,
  setDefaultPublishEngine,
  publishWithEngine,
} from '../services/publish-engine.service';

export const router = Router();

// GET / - 获取发布记录列表
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const status = req.query.status ? String(req.query.status) : undefined;

    const { data, total } = publishService.getPublications(page, pageSize, status);
    const response: PaginatedResponse<Publication> = {
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

// GET /queue - 获取发布队列
router.get('/queue', (_req: Request, res: Response) => {
  try {
    const queue = publishService.getPublishQueue();
    res.json({ success: true, data: queue } as ApiResponse<Publication[]>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /execute - 执行发布
router.post('/execute', async (req: Request, res: Response) => {
  try {
    const params = req.body as PublishParams;
    if (!params.contentId) {
      return res
        .status(400)
        .json({ success: false, error: '缺少 contentId 参数' } as ApiResponse);
    }

    const publication = await publishService.publishContent(params);
    if (publication.status === 'failed') {
      return res.status(502).json({
        success: false,
        data: publication,
        error: publication.errorMessage || '发布失败',
      } as ApiResponse<Publication>);
    }
    return res.status(201).json({
      success: true,
      data: publication,
      message: '内容发布成功',
    } as ApiResponse<Publication>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PublishServiceValidationError ? 400 : 500;
    res.status(status).json({ success: false, error: message } as ApiResponse);
  }
});

// DELETE /:id - 删除发布记录
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const deleted = publishService.deletePublication(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '发布记录不存在' } as ApiResponse);
    }

    res.json({ success: true, message: '发布记录已删除' } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// GET /engines - 获取可用发布引擎列表
router.get('/engines', async (_req: Request, res: Response) => {
  try {
    const engines = await getPublishEngines();
    res.json({ success: true, data: engines } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /engines/default - 设置默认发布引擎
router.post('/engines/default', async (req: Request, res: Response) => {
  try {
    const { engine } = req.body as { engine?: string };
    if (!engine) {
      return res.status(400).json({ success: false, error: '缺少 engine 参数' } as ApiResponse);
    }
    await setDefaultPublishEngine(engine);
    res.json({ success: true, message: `默认发布引擎已设置为 ${engine}` } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PublishEngineValidationError ? 400 : 500;
    res.status(status).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /execute-with-engine - 使用指定引擎发布（直接调用引擎，不走 skill bridge）
router.post('/execute-with-engine', async (req: Request, res: Response) => {
  try {
    const { title, content, tags, images, engine, autoPublish, headless } = req.body as {
      title?: string;
      content?: string;
      tags?: string[];
      images?: string[];
      engine?: string;
      autoPublish?: boolean;
      headless?: boolean;
    };

    if (!title || !content) {
      return res.status(400).json({ success: false, error: '缺少 title 或 content 参数' } as ApiResponse);
    }

    const result = await publishWithEngine({
      title,
      content,
      tags,
      images,
      engine,
      autoPublish,
      headless,
    });

    res.status(result.success ? 200 : 502).json({
      success: result.success,
      data: result,
      error: result.success ? undefined : result.error,
      message: result.success ? '发布成功' : `发布失败: ${result.error}`,
    } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
