/**
 * YouTube 数据路由 - /api/youtube-data
 *
 * 端点列表:
 * - GET /search                  - 搜索 YouTube 视频
 *   查询参数: keyword (必填), limit (可选, 默认 20)
 * - GET /videos/:videoId         - 获取视频信息
 * - GET /channels/:channelId     - 获取频道信息
 * - GET /videos/:videoId/comments - 获取视频评论
 *   查询参数: limit (可选, 默认 20)
 *
 * 成功返回: { success: true, data: result }
 * 失败返回: { success: false, error: message }
 */

import { Router, type Request, type Response } from 'express';
import { youtubeDataService } from '../services/youtube-data.service';

export const router = Router();

// GET /search - 搜索 YouTube 视频
router.get('/search', async (req: Request, res: Response) => {
  try {
    const keyword = String(req.query.keyword || '');
    const limit = parseInt(String(req.query.limit ?? '20'), 10) || 20;

    if (!keyword) {
      return res.status(400).json({ success: false, error: 'keyword 参数必填' });
    }

    const result = await youtubeDataService.searchVideos(keyword, limit);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /videos/:videoId - 获取视频信息
router.get('/videos/:videoId', async (req: Request, res: Response) => {
  try {
    const videoId = String(req.params.videoId || '');
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'videoId 不能为空' });
    }

    const result = await youtubeDataService.getVideoInfo(videoId);
    if (!result) {
      return res.status(404).json({ success: false, error: '视频不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /channels/:channelId - 获取频道信息
router.get('/channels/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = String(req.params.channelId || '');
    if (!channelId) {
      return res.status(400).json({ success: false, error: 'channelId 不能为空' });
    }

    const result = await youtubeDataService.getChannelInfo(channelId);
    if (!result) {
      return res.status(404).json({ success: false, error: '频道不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /videos/:videoId/comments - 获取视频评论
router.get('/videos/:videoId/comments', async (req: Request, res: Response) => {
  try {
    const videoId = String(req.params.videoId || '');
    const limit = parseInt(String(req.query.limit ?? '20'), 10) || 20;

    if (!videoId) {
      return res.status(400).json({ success: false, error: 'videoId 不能为空' });
    }

    const result = await youtubeDataService.getVideoComments(videoId, limit);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
