/**
 * 小红书数据路由 - /api/xhs-data
 *
 * 端点列表:
 * - GET /search                  - 搜索小红书笔记
 *   查询参数: keyword (必填), limit (可选, 默认 20)
 * - GET /notes/:noteId           - 获取笔记详情
 * - GET /users/:userId           - 获取用户信息
 * - GET /users/:userId/notes     - 获取用户笔记列表
 *   查询参数: cursor (可选, 分页游标)
 * - GET /notes/:noteId/comments  - 获取笔记评论
 *   查询参数: cursor (可选, 分页游标)
 *
 * 成功返回: { success: true, data: result }
 * 失败返回: { success: false, error: message }
 */

import { Router, type Request, type Response } from 'express';
import { xhsDataService } from '../services/xhs-data.service';

export const router = Router();

// GET /search - 搜索小红书笔记
router.get('/search', async (req: Request, res: Response) => {
  try {
    const keyword = String(req.query.keyword || '');
    const limit = parseInt(String(req.query.limit ?? '20'), 10) || 20;

    if (!keyword) {
      return res.status(400).json({ success: false, error: 'keyword 参数必填' });
    }

    const result = await xhsDataService.searchNotes(keyword, limit);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /notes/:noteId - 获取笔记详情
router.get('/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const noteId = String(req.params.noteId || '');
    if (!noteId) {
      return res.status(400).json({ success: false, error: 'noteId 不能为空' });
    }

    const result = await xhsDataService.getNoteDetail(noteId);
    if (!result) {
      return res.status(404).json({ success: false, error: '笔记不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /users/:userId - 获取用户信息
router.get('/users/:userId', async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId 不能为空' });
    }

    const result = await xhsDataService.getUserInfo(userId);
    if (!result) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /users/:userId/notes - 获取用户笔记列表
router.get('/users/:userId/notes', async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    const cursor = String(req.query.cursor || '');

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId 不能为空' });
    }

    const result = await xhsDataService.getUserNotes(userId, cursor);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /notes/:noteId/comments - 获取笔记评论
router.get('/notes/:noteId/comments', async (req: Request, res: Response) => {
  try {
    const noteId = String(req.params.noteId || '');
    const cursor = String(req.query.cursor || '');

    if (!noteId) {
      return res.status(400).json({ success: false, error: 'noteId 不能为空' });
    }

    const result = await xhsDataService.getNoteComments(noteId, cursor);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
