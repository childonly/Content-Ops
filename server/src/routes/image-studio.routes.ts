/**
 * 图片工作室路由 — /api/image-studio
 *
 * 端点:
 *   GET    /engines                 获取可用引擎列表（含健康检查）
 *   POST   /engines/default         设置默认引擎
 *   POST   /generate                生成图片
 *   GET    /records                 获取历史记录（分页）
 *   GET    /records/:uid            获取单条记录
 *   DELETE /records/:uid            删除记录
 *   GET    /auto-redbook/themes     获取 Auto-Redbook 主题列表
 *   POST   /auto-redbook/render     Auto-Redbook 卡片渲染（返回全部图片）
 */

import { Router, Request, Response } from 'express';
import {
  getEngines,
  generateImage,
  getRecords,
  getRecord,
  deleteRecord,
  setDefaultEngine,
  getAutoRedbookThemes,
  renderAutoRedbookCards,
} from '../services/image-studio.service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('image-studio-routes');
export const router = Router();

// ============================================================================
// GET /engines - 获取可用引擎列表
// ============================================================================

router.get('/engines', async (_req: Request, res: Response) => {
  try {
    const engines = await getEngines();
    return res.json({ success: true, data: engines });
  } catch (e) {
    log.error(`获取引擎列表失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /engines/default - 设置默认引擎
// ============================================================================

router.post('/engines/default', async (req: Request, res: Response) => {
  try {
    const { engine } = req.body as { engine?: string };
    if (!engine) {
      return res.status(400).json({ success: false, error: '缺少 engine 参数' });
    }

    await setDefaultEngine(engine);
    log.info(`默认引擎已设置为: ${engine}`);
    return res.json({ success: true, message: `默认引擎已设置为 ${engine}` });
  } catch (e) {
    log.error(`设置默认引擎失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /generate - 生成图片
// ============================================================================

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const params = req.body;
    if (!params || (!params.prompt && !params.content && !params.title)) {
      return res.status(400).json({ success: false, error: '缺少生成参数' });
    }

    log.info('图片生成请求', { mode: params.mode, engine: params.engine });
    const result = await generateImage(params);
    return res.json({ success: result.status !== 'failed', data: result });
  } catch (e) {
    log.error(`图片生成失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /records - 获取历史记录
// ============================================================================

router.get('/records', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const { data, total } = getRecords(page, pageSize);
    return res.json({ success: true, data, total, page, pageSize });
  } catch (e) {
    log.error(`获取历史记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /records/:uid - 获取单条记录
// ============================================================================

router.get('/records/:uid', (req: Request, res: Response) => {
  try {
    const record = getRecord(req.params.uid);
    if (!record) {
      return res.status(404).json({ success: false, error: '记录不存在' });
    }
    return res.json({ success: true, data: record });
  } catch (e) {
    log.error(`获取记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// DELETE /records/:uid - 删除记录
// ============================================================================

router.delete('/records/:uid', (req: Request, res: Response) => {
  try {
    const deleted = deleteRecord(req.params.uid);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '记录不存在' });
    }
    return res.json({ success: true, message: '记录已删除' });
  } catch (e) {
    log.error(`删除记录失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// GET /auto-redbook/themes - 获取 Auto-Redbook 主题列表
// ============================================================================

router.get('/auto-redbook/themes', async (_req: Request, res: Response) => {
  try {
    const themes = await getAutoRedbookThemes();
    return res.json({ success: true, data: themes });
  } catch (e) {
    log.error(`获取 Auto-Redbook 主题失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /auto-redbook/render - Auto-Redbook 卡片渲染（返回全部图片）
// ============================================================================

router.post('/auto-redbook/render', async (req: Request, res: Response) => {
  try {
    const { title, subtitle, emoji, content, theme, mode } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '缺少 content 参数' });
    }

    log.info('Auto-Redbook 卡片渲染请求', { title, theme, mode });
    const result = await renderAutoRedbookCards({
      title,
      subtitle,
      emoji,
      content,
      theme,
      mode,
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    log.error(`Auto-Redbook 卡片渲染失败: ${(e as Error).message}`);
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
