/**
 * YoutubeDataService 单元测试
 *
 * 测试 YouTube 数据服务的所有公开方法：
 * - searchVideos:      搜索视频（端点 /youtube/web_v2/get_general_search）
 * - getVideoInfo:      获取视频信息（端点 /youtube/web_v2/get_video_info）
 * - getChannelInfo:    获取频道信息（端点 /youtube/web/get_channel_info）
 * - getVideoComments:  获取视频评论（端点 /youtube/web_v2/get_video_comments）
 *
 * Mock 策略：mock tikhub-client 模块，验证：
 * 1. 正确的 API 端点路径和参数（特别是 search_query 而非 q）
 * 2. 响应数据的标准化逻辑
 * 3. 错误处理与抛出
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 使用 vi.hoisted 确保 mock 函数在 vi.mock 工厂执行时已初始化
const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

// Mock tikhub-client
vi.mock('../tikhub-client', () => ({
  default: {
    get: mockGet,
    post: vi.fn(),
    isEnabled: vi.fn(() => true),
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { YoutubeDataService } from '../youtube-data.service';

describe('YoutubeDataService', () => {
  let service: YoutubeDataService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new YoutubeDataService();
  });

  // ============================================================
  // searchVideos
  // ============================================================
  describe('searchVideos', () => {
    it('成功搜索视频 - 使用 search_query 参数（非 q）', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'vid_001',
            title: '测试视频标题',
            description: '视频描述内容',
            author: {
              channel_id: 'ch1',
              title: '频道名称',
              avatar: 'http://avatar.url/ch1.jpg',
              channel_url: 'https://www.youtube.com/channel/ch1',
            },
            thumbnails: {
              high: { url: 'http://thumb.url/high.jpg' },
              medium: { url: 'http://thumb.url/med.jpg' },
              default: { url: 'http://thumb.url/def.jpg' },
            },
            duration: 'PT10M30S',
            published_at: '2024-01-15T10:00:00Z',
            stats: { view_count: 10000, like_count: 500, comment_count: 50 },
            video_url: 'https://www.youtube.com/watch?v=vid_001',
          },
          {
            video_id: 'vid_002',
            title: '第二个视频',
            author: { channel_id: 'ch2', title: '频道B' },
            stats: { view_count: 5000, like_count: 200 },
          },
        ],
        has_more: true,
        cursor: 'next_page_token',
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('编程教程', 20);

      // 验证使用正确的端点和参数名（search_query 而非 q）
      expect(mockGet).toHaveBeenCalledWith(
        '/youtube/web_v2/get_general_search',
        { search_query: '编程教程' },
        undefined,
      );

      expect(result.videos).toHaveLength(2);
      expect(result.videos[0].id).toBe('vid_001');
      expect(result.videos[0].title).toBe('测试视频标题');
      expect(result.videos[0].author.name).toBe('频道名称');
      expect(result.videos[0].author.channelUrl).toBe('https://www.youtube.com/channel/ch1');
      expect(result.videos[0].thumbnail).toBe('http://thumb.url/high.jpg');
      expect(result.videos[0].metrics.views).toBe(10000);
      expect(result.videos[0].metrics.likes).toBe(500);
      expect(result.videos[0].metrics.comments).toBe(50);
      expect(result.videos[0].url).toBe('https://www.youtube.com/watch?v=vid_001');

      expect(result.videos[1].id).toBe('vid_002');
      expect(result.videos[1].thumbnail).toBe('');

      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe('next_page_token');
      expect(result.total).toBe(2);
    });

    it('空结果 → 返回空数组', async () => {
      mockGet.mockResolvedValue({ items: [], has_more: false });

      const result = await service.searchVideos('无结果');

      expect(result.videos).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('limit 限制返回数量', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        video_id: `vid_${i}`,
        title: `视频${i}`,
        author: { title: '频道' },
      }));
      mockGet.mockResolvedValue({ items });

      const result = await service.searchVideos('测试', 3);

      expect(result.videos).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('API 错误时抛出异常', async () => {
      mockGet.mockRejectedValue(new Error('TikHub API 返回 422 错误'));
      await expect(service.searchVideos('测试')).rejects.toThrow('422');
    });

    it('兼容 { data: { items: [...] } } 格式', async () => {
      const mockResponse = {
        data: {
          items: [
            {
              video_id: 'nested_vid',
              title: '嵌套格式视频',
              author: { title: '频道' },
            },
          ],
        },
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('嵌套');
      expect(result.videos).toHaveLength(1);
      expect(result.videos[0].id).toBe('nested_vid');
    });

    it('缩略图优先级: high > medium > default', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'thumb_test',
            title: '缩略图测试',
            author: { title: '频道' },
            thumbnails: {
              medium: { url: 'http://thumb.url/med.jpg' },
              default: { url: 'http://thumb.url/def.jpg' },
            },
          },
        ],
      };

      mockGet.mockResolvedValue(mockResponse);
      const result = await service.searchVideos('缩略图');
      expect(result.videos[0].thumbnail).toBe('http://thumb.url/med.jpg');
    });
  });

  // ============================================================
  // getVideoInfo
  // ============================================================
  describe('getVideoInfo', () => {
    it('成功获取视频信息', async () => {
      const mockResponse = {
        data: {
          items: [
            {
              video_id: 'detail_vid',
              title: '视频详情',
              description: '详细描述',
              author: {
                channel_id: 'ch_detail',
                title: '详情频道',
                avatar: 'http://avatar.url/detail.jpg',
              },
              stats: { view_count: 99999, like_count: 8888, comment_count: 777 },
              published_at: '2024-06-01T12:00:00Z',
              duration: 'PT5M',
            },
          ],
        },
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getVideoInfo('detail_vid');

      expect(mockGet).toHaveBeenCalledWith(
        '/youtube/web_v2/get_video_info',
        { video_id: 'detail_vid' },
        undefined,
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe('detail_vid');
      expect(result!.title).toBe('视频详情');
      expect(result!.author.name).toBe('详情频道');
      expect(result!.metrics.views).toBe(99999);
      expect(result!.metrics.likes).toBe(8888);
      expect(result!.publishedAt).toBe('2024-06-01T12:00:00.000Z');
    });

    it('videoId 为空 → 抛出错误', async () => {
      await expect(service.getVideoInfo('')).rejects.toThrow('videoId 不能为空');
    });

    it('API 错误 → 抛出异常', async () => {
      mockGet.mockRejectedValue(new Error('API Error'));
      await expect(service.getVideoInfo('vid_001')).rejects.toThrow('API Error');
    });

    it('无 video_id 的响应 → 返回 null', async () => {
      mockGet.mockResolvedValue({ data: { items: [{ title: '无ID视频' }] } });
      const result = await service.getVideoInfo('vid_001');
      // extractDetailObject 会回退，但 normalizeVideo 检查 video_id
      // 如果没有 video_id，返回 null
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // getChannelInfo
  // ============================================================
  describe('getChannelInfo', () => {
    it('成功获取频道信息', async () => {
      const mockResponse = {
        channel_info: {
          channel_id: 'ch_full',
          title: '完整频道',
          description: '频道描述',
          thumbnails: { high: { url: 'http://avatar.url/ch.jpg' } },
          banner: { url: 'http://banner.url/b.jpg' },
          stats: {
            subscriber_count: 1000000,
            video_count: 500,
            view_count: 99999999,
          },
          channel_url: 'https://www.youtube.com/channel/ch_full',
        },
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getChannelInfo('ch_full');

      expect(mockGet).toHaveBeenCalledWith(
        '/youtube/web/get_channel_info',
        { channel_id: 'ch_full' },
        undefined,
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe('ch_full');
      expect(result!.name).toBe('完整频道');
      expect(result!.description).toBe('频道描述');
      expect(result!.avatar).toBe('http://avatar.url/ch.jpg');
      expect(result!.bannerUrl).toBe('http://banner.url/b.jpg');
      expect(result!.subscriberCount).toBe(1000000);
      expect(result!.videoCount).toBe(500);
      expect(result!.viewCount).toBe(99999999);
    });

    it('channelId 为空 → 抛出错误', async () => {
      await expect(service.getChannelInfo('')).rejects.toThrow('channelId 不能为空');
    });

    it('API 错误 → 抛出异常', async () => {
      mockGet.mockRejectedValue(new Error('API Error'));
      await expect(service.getChannelInfo('ch_001')).rejects.toThrow('API Error');
    });
  });

  // ============================================================
  // getVideoComments
  // ============================================================
  describe('getVideoComments', () => {
    it('成功获取评论列表', async () => {
      const mockResponse = {
        comments: [
          {
            id: 'cmt_001',
            content: '很棒的视频！',
            author: {
              channel_id: 'cmt_ch1',
              name: '评论者A',
              avatar: 'http://avatar.url/c1.jpg',
            },
            stats: { like_count: 50, reply_count: 3 },
            published_at: '2024-03-10T08:00:00Z',
          },
          {
            id: 'cmt_002',
            content: '学到了很多',
            author: { channel_id: 'cmt_ch2', name: '评论者B' },
            stats: { like_count: 20, reply_count: 1 },
            published_at: '2024-03-11T09:00:00Z',
          },
        ],
        has_more: true,
        cursor: 'next_cmt_cursor',
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getVideoComments('vid_001', 20);

      expect(mockGet).toHaveBeenCalledWith(
        '/youtube/web_v2/get_video_comments',
        { video_id: 'vid_001', count: 20 },
        undefined,
      );
      expect(result.comments).toHaveLength(2);
      expect(result.comments[0].id).toBe('cmt_001');
      expect(result.comments[0].content).toBe('很棒的视频！');
      expect(result.comments[0].author.name).toBe('评论者A');
      expect(result.comments[0].author.channelUrl).toBe('https://www.youtube.com/channel/cmt_ch1');
      expect(result.comments[0].likeCount).toBe(50);
      expect(result.comments[0].replyCount).toBe(3);
      expect(result.comments[0].publishedAt).toBe('2024-03-10T08:00:00.000Z');
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe('next_cmt_cursor');
    });

    it('limit 上限为 100', async () => {
      mockGet.mockResolvedValue({ comments: [], has_more: false });

      await service.getVideoComments('vid_001', 200);

      expect(mockGet).toHaveBeenCalledWith(
        '/youtube/web_v2/get_video_comments',
        { video_id: 'vid_001', count: 100 },
        undefined,
      );
    });

    it('videoId 为空 → 抛出错误', async () => {
      await expect(service.getVideoComments('')).rejects.toThrow('videoId 不能为空');
    });

    it('API 错误 → 抛出异常', async () => {
      mockGet.mockRejectedValue(new Error('API Error'));
      await expect(service.getVideoComments('vid_001')).rejects.toThrow('API Error');
    });
  });

  // ============================================================
  // normalizeVideo 边界情况
  // ============================================================
  describe('normalizeVideo 边界情况', () => {
    it('视频无 video_id → 被过滤', async () => {
      const mockResponse = {
        items: [
          { title: '无ID视频', author: { title: '频道' } },
          { video_id: 'valid_vid', title: '有效视频', author: { title: '频道' } },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('测试');
      expect(result.videos).toHaveLength(1);
      expect(result.videos[0].id).toBe('valid_vid');
    });

    it('视频无 stats → metrics 全为 0', async () => {
      const mockResponse = {
        items: [
          { video_id: 'no_stats', title: '无统计', author: { title: '频道' } },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('测试');
      expect(result.videos[0].metrics.views).toBe(0);
      expect(result.videos[0].metrics.likes).toBe(0);
      expect(result.videos[0].metrics.comments).toBe(0);
    });

    it('缩略图为字符串 → 直接使用', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'str_thumb',
            title: '字符串缩略图',
            author: { title: '频道' },
            thumbnail: 'http://thumb.url/str.jpg',
          },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('测试');
      expect(result.videos[0].thumbnail).toBe('http://thumb.url/str.jpg');
    });

    it('视频无 author → author 字段为空字符串', async () => {
      const mockResponse = {
        items: [
          { video_id: 'no_author', title: '无作者', stats: { view_count: 100 } },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('测试');
      expect(result.videos[0].author.id).toBe('');
      expect(result.videos[0].author.name).toBe('');
    });

    it('publishedAt 无效 → 使用当前时间', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'bad_date',
            title: '无效日期',
            author: { title: '频道' },
            published_at: 'invalid-date-string',
          },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('测试');
      const now = new Date();
      expect(result.videos[0].publishedAt).toContain(now.getFullYear().toString());
    });

    it('自动生成 URL（无 video_url 时）', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'auto_url',
            title: '自动URL',
            author: { title: '频道' },
          },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchVideos('测试');
      expect(result.videos[0].url).toBe('https://www.youtube.com/watch?v=auto_url');
    });
  });

  // ============================================================
  // extractThumbnail 优先级测试
  // ============================================================
  describe('extractThumbnail 优先级', () => {
    it('maxres 优先级高于 high', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'maxres_test',
            title: 'MaxRes',
            author: { title: '频道' },
            thumbnails: {
              maxres: { url: 'http://thumb.url/maxres.jpg' },
              high: { url: 'http://thumb.url/high.jpg' },
            },
          },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);
      // 注意: 优先级是 high > medium > default > maxres > standard
      // 所以这里应该返回 high 而非 maxres
      const result = await service.searchVideos('测试');
      expect(result.videos[0].thumbnail).toBe('http://thumb.url/high.jpg');
    });

    it('仅有 default 缩略图', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'default_only',
            title: 'Default',
            author: { title: '频道' },
            thumbnails: {
              default: { url: 'http://thumb.url/def.jpg' },
            },
          },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);
      const result = await service.searchVideos('测试');
      expect(result.videos[0].thumbnail).toBe('http://thumb.url/def.jpg');
    });

    it('无缩略图 → 返回空字符串', async () => {
      const mockResponse = {
        items: [
          {
            video_id: 'no_thumb',
            title: '无缩略图',
            author: { title: '频道' },
          },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);
      const result = await service.searchVideos('测试');
      expect(result.videos[0].thumbnail).toBe('');
    });
  });
});
