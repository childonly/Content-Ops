/**
 * 媒体下载路由 - /api/media-download
 *
 * 端点列表:
 * - POST /fetch           - 获取媒体下载链接(可选下载到本地)
 *   body: { url, downloadToLocal? }
 * - GET  /list            - 获取下载记录列表(分页)
 *   查询参数: page, pageSize, platform
 * - GET  /:id             - 获取单条下载记录详情
 *
 * 成功返回: { success: true, data: result }
 * 失败返回: { success: false, error: message }
 */

import { Router, type Request, type Response } from 'express';
import { getDownloadLinks, getDownloads, getDownload } from '../services/media-download.service';

export const router = Router();

// POST /fetch - 获取媒体下载链接
router.post('/fetch', async (req: Request, res: Response) => {
  try {
    const { url, downloadToLocal } = req.body || {};

    if (!url) {
      return res.status(400).json({ success: false, error: 'url 参数必填' });
    }

    const result = await getDownloadLinks(String(url), Boolean(downloadToLocal));
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /list - 获取下载记录列表
router.get('/list', async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const platform = req.query.platform ? String(req.query.platform) : undefined;

    const result = getDownloads(page, pageSize, platform);
    res.json({ success: true, data: result.data, total: result.total, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /:id - 获取单条下载记录
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const result = getDownload(id);
    if (!result) {
      return res.status(404).json({ success: false, error: '下载记录不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
