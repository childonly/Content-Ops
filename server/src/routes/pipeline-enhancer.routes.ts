/**
 * 内容生产链路增强路由 — /api/pipeline-enhancer
 *
 * 端点:
 *   POST   /enhance           执行内容增强（auto-redbook / summarizer / baoyu / full）
 *   GET    /themes            获取可用的 Auto-Redbook 主题列表
 *   GET    /layouts           获取可用的 Baoyu 布局列表
 *   GET    /styles            获取可用的 Baoyu 风格列表
 */

import { Router, Request, Response } from 'express';
import {
  enhancePipeline,
  getAutoRedbookThemes,
  getBaoyuLayouts,
  getBaoyuStyles,
  type EnhanceMode,
  type PipelineEnhanceParams,
} from '../services/pipeline-enhancer.service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('pipeline-enhancer-routes');
export const router = Router();

// ============================================================================
// POST /enhance - 执行内容增强
// ============================================================================

router.post('/enhance', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<PipelineEnhanceParams>;
    if (!body.title || !body.content) {
      return res.status(400).json({ success: false, error: '缺少 title 或 content 参数' });
    }

    const params: PipelineEnhanceParams = {
      mode: (body.mode as EnhanceMode) || 'full',
      title: body.title,
      content: body.content,
      tags: body.tags,
      theme: body.theme,
      platform: body.platform,
      generateImage: body.generateImage,
      imageEngine: body.imageEngine,
    };

    log.info('内容增强请求', { mode: params.mode, title: params.title });
    const result = await enhancePipeline(params);

    return res.json({ success: result.success, data: result });
  } catch (e) {
    log.error(`内容增强失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /themes - 获取 Auto-Redbook 主题列表
// ============================================================================

router.get('/themes', (_req: Request, res: Response) => {
  try {
    const themes = getAutoRedbookThemes();
    return res.json({ success: true, data: themes });
  } catch (e) {
    log.error(`获取主题列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /layouts - 获取 Baoyu 布局列表
// ============================================================================

router.get('/layouts', (_req: Request, res: Response) => {
  try {
    const layouts = getBaoyuLayouts();
    return res.json({ success: true, data: layouts });
  } catch (e) {
    log.error(`获取布局列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /styles - 获取 Baoyu 风格列表
// ============================================================================

router.get('/styles', (_req: Request, res: Response) => {
  try {
    const styles = getBaoyuStyles();
    return res.json({ success: true, data: styles });
  } catch (e) {
    log.error(`获取风格列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
