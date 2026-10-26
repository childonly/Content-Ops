/**
 * XhsDataService 单元测试
 *
 * 测试小红书数据服务的所有公开方法：
 * - searchNotes:        搜索笔记（端点 /xiaohongshu/app_v2/search_notes）
 * - getNoteDetail:      获取笔记详情（尝试图文+视频两个端点）
 * - getUserInfo:        获取用户信息
 * - getUserNotes:       获取用户笔记列表
 * - getNoteComments:    获取笔记评论
 *
 * Mock 策略：mock tikhub-client 模块，验证：
 * 1. 正确的 API 端点路径和参数
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

import { XhsDataService } from '../xhs-data.service';
import type { XhsNote, XhsSearchResult, XhsUser, XhsCommentResult, XhsUserNotesResult } from '../xhs-data.service';

describe('XhsDataService', () => {
  let service: XhsDataService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new XhsDataService();
  });

  // ============================================================
  // searchNotes
  // ============================================================
  describe('searchNotes', () => {
    it('成功搜索笔记 - 返回标准化结果', async () => {
      const mockResponse = {
        items: [
          {
            note_card: {
              note_id: 'note_001',
              title: '测试笔记标题',
              desc: '这是笔记描述',
              type: 'normal',
              user: { user_id: 'u1', nickname: '作者A', avatar: 'http://avatar.url/a.jpg' },
              interact_info: {
                liked_count: '100',
                comment_count: '20',
                collected_count: '50',
                shared_count: '10',
                view_count: '5000',
              },
              cover: { url: 'http://cover.url/c.jpg' },
              image_list: [{ url: 'http://img1.url/i1.jpg' }, { url: 'http://img2.url/i2.jpg' }],
              tag_list: [{ name: '美食' }, { name: '探店' }],
            },
          },
          {
            note_card: {
              note_id: 'note_002',
              title: '第二个笔记',
              type: 'video',
              user: { user_id: 'u2', nickname: '作者B' },
              interact_info: { liked_count: '200' },
              video: { media: { stream: [[{ master_url: 'http://video.url/v.mp4' }]] } },
            },
          },
        ],
        has_more: true,
        cursor: 'next_cursor_abc',
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchNotes('美食探店', 20);

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/search_notes',
        { keyword: '美食探店', page: 1, page_size: 20 },
        undefined,
      );

      expect(result.notes).toHaveLength(2);
      expect(result.notes[0].id).toBe('note_001');
      expect(result.notes[0].title).toBe('测试笔记标题');
      expect(result.notes[0].author.nickname).toBe('作者A');
      expect(result.notes[0].metrics.likes).toBe(100);
      expect(result.notes[0].metrics.comments).toBe(20);
      expect(result.notes[0].metrics.collects).toBe(50);
      expect(result.notes[0].images).toHaveLength(2);
      expect(result.notes[0].tags).toEqual(['美食', '探店']);
      expect(result.notes[0].url).toContain('note_001');

      expect(result.notes[1].id).toBe('note_002');
      expect(result.notes[1].type).toBe('video');
      expect(result.notes[1].videoUrl).toBe('http://video.url/v.mp4');

      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe('next_cursor_abc');
      expect(result.total).toBe(2);
    });

    it('空结果 → 返回空数组', async () => {
      mockGet.mockResolvedValue({ items: [], has_more: false, cursor: '' });

      const result = await service.searchNotes('无结果关键词');

      expect(result.notes).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('limit 限制返回数量', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        note_card: { note_id: `note_${i}`, title: `笔记${i}`, user: { nickname: '作者' } },
      }));
      mockGet.mockResolvedValue({ items });

      const result = await service.searchNotes('测试', 3);

      expect(result.notes).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('limit 上限为 50', async () => {
      mockGet.mockResolvedValue({ items: [] });

      await service.searchNotes('测试', 100);

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/search_notes',
        { keyword: '测试', page: 1, page_size: 50 },
        undefined,
      );
    });

    it('API 错误时抛出异常', async () => {
      const error = new Error('TikHub API 返回 500 错误');
      mockGet.mockRejectedValue(error);

      await expect(service.searchNotes('测试')).rejects.toThrow('TikHub API 返回 500 错误');
    });

    it('兼容 { data: { items: [...] } } 格式', async () => {
      const mockResponse = {
        data: {
          items: [
            {
              note_card: {
                note_id: 'nested_note',
                title: '嵌套格式笔记',
                user: { nickname: '作者' },
                interact_info: { liked_count: '10' },
              },
            },
          ],
          has_more: false,
        },
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchNotes('嵌套');
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].id).toBe('nested_note');
    });
  });

  // ============================================================
  // getNoteDetail
  // ============================================================
  describe('getNoteDetail', () => {
    it('图文笔记端点成功 → 返回详情', async () => {
      const mockResponse = {
        data: {
          items: [
            {
              note_card: {
                note_id: 'note_detail_001',
                title: '详情笔记',
                desc: '详情描述',
                type: 'image',
                user: { user_id: 'u1', nickname: '详情作者' },
                interact_info: { liked_count: '999' },
                cover: { url: 'http://cover.url/d.jpg' },
              },
            },
          ],
        },
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getNoteDetail('note_detail_001');

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/get_image_note_detail',
        { note_id: 'note_detail_001' },
        undefined,
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe('note_detail_001');
      expect(result!.title).toBe('详情笔记');
      expect(result!.metrics.likes).toBe(999);
    });

    it('图文端点失败 → 尝试视频端点', async () => {
      mockGet
        .mockRejectedValueOnce(new Error('404 Not Found'))
        .mockResolvedValueOnce({
          data: {
            items: [
              {
                note_card: {
                  note_id: 'video_note',
                  title: '视频笔记',
                  type: 'video',
                  user: { nickname: '视频作者' },
                  video: { url: 'http://video.url/v.mp4' },
                },
              },
            ],
          },
        });

      const result = await service.getNoteDetail('video_note');

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenNthCalledWith(1, '/xiaohongshu/app_v2/get_image_note_detail', { note_id: 'video_note' }, undefined);
      expect(mockGet).toHaveBeenNthCalledWith(2, '/xiaohongshu/app_v2/get_video_note_detail', { note_id: 'video_note' }, undefined);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('video_note');
      expect(result!.videoUrl).toBe('http://video.url/v.mp4');
    });

    it('两个端点都失败 → 返回 null', async () => {
      mockGet
        .mockRejectedValueOnce(new Error('404'))
        .mockRejectedValueOnce(new Error('404'));

      const result = await service.getNoteDetail('nonexistent');

      expect(result).toBeNull();
    });

    it('noteId 为空 → 抛出错误', async () => {
      await expect(service.getNoteDetail('')).rejects.toThrow('noteId 不能为空');
    });
  });

  // ============================================================
  // getUserInfo
  // ============================================================
  describe('getUserInfo', () => {
    it('成功获取用户信息', async () => {
      const mockResponse = {
        user_info: {
          user_id: 'user_001',
          nickname: '测试用户',
          red_id: 'red123',
          image: 'http://avatar.url/u.jpg',
          desc: '这是用户简介',
          gender: 'female',
          ip_location: '上海',
          fans: 50000,
          follows: 200,
          interaction: 1000000,
          notes: 150,
        },
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getUserInfo('user_001');

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/get_user_info',
        { user_id: 'user_001' },
        undefined,
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe('user_001');
      expect(result!.nickname).toBe('测试用户');
      expect(result!.redId).toBe('red123');
      expect(result!.fans).toBe(50000);
      expect(result!.follows).toBe(200);
      expect(result!.notes).toBe(150);
      expect(result!.ipLocation).toBe('上海');
    });

    it('userId 为空 → 抛出错误', async () => {
      await expect(service.getUserInfo('')).rejects.toThrow('userId 不能为空');
    });

    it('API 错误 → 抛出异常', async () => {
      mockGet.mockRejectedValue(new Error('API Error'));
      await expect(service.getUserInfo('user_001')).rejects.toThrow('API Error');
    });
  });

  // ============================================================
  // getUserNotes
  // ============================================================
  describe('getUserNotes', () => {
    it('成功获取用户笔记列表', async () => {
      const mockResponse = {
        items: [
          {
            note_card: {
              note_id: 'un_001',
              title: '用户笔记1',
              user: { nickname: '用户' },
              interact_info: { liked_count: '50' },
            },
          },
          {
            note_card: {
              note_id: 'un_002',
              title: '用户笔记2',
              user: { nickname: '用户' },
              interact_info: { liked_count: '30' },
            },
          },
        ],
        has_more: true,
        cursor: 'page2_cursor',
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getUserNotes('user_001');

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/get_user_posted_notes',
        { user_id: 'user_001' },
        undefined,
      );
      expect(result.notes).toHaveLength(2);
      expect(result.notes[0].id).toBe('un_001');
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe('page2_cursor');
    });

    it('带游标参数请求下一页', async () => {
      mockGet.mockResolvedValue({ items: [], has_more: false, cursor: '' });

      await service.getUserNotes('user_001', 'existing_cursor');

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/get_user_posted_notes',
        { user_id: 'user_001', cursor: 'existing_cursor' },
        undefined,
      );
    });

    it('userId 为空 → 抛出错误', async () => {
      await expect(service.getUserNotes('')).rejects.toThrow('userId 不能为空');
    });
  });

  // ============================================================
  // getNoteComments
  // ============================================================
  describe('getNoteComments', () => {
    it('成功获取评论列表', async () => {
      const mockResponse = {
        comments: [
          {
            id: 'comment_001',
            content: '好文！学到了',
            user: { user_id: 'cu1', nickname: '评论者A', avatar: 'http://a.url/c1.jpg' },
            like_count: '15',
            create_time: 1705312200,
            sub_comments: [
              {
                id: 'sub_001',
                content: '同意',
                user: { user_id: 'cu2', nickname: '回复者B' },
                like_count: '3',
                create_time: 1705312300,
              },
            ],
          },
          {
            id: 'comment_002',
            content: '感谢分享',
            user: { user_id: 'cu3', nickname: '评论者C' },
            like_count: '8',
          },
        ],
        has_more: false,
        cursor: '',
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getNoteComments('note_001');

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/get_note_comments',
        { note_id: 'note_001' },
        undefined,
      );
      expect(result.comments).toHaveLength(2);
      expect(result.comments[0].id).toBe('comment_001');
      expect(result.comments[0].content).toBe('好文！学到了');
      expect(result.comments[0].author.nickname).toBe('评论者A');
      expect(result.comments[0].likeCount).toBe(15);
      expect(result.comments[0].subComments).toHaveLength(1);
      expect(result.comments[0].subComments[0].content).toBe('同意');
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('带游标参数', async () => {
      mockGet.mockResolvedValue({ comments: [], has_more: false, cursor: '' });

      await service.getNoteComments('note_001', 'comment_cursor');

      expect(mockGet).toHaveBeenCalledWith(
        '/xiaohongshu/app_v2/get_note_comments',
        { note_id: 'note_001', cursor: 'comment_cursor' },
        undefined,
      );
    });

    it('noteId 为空 → 抛出错误', async () => {
      await expect(service.getNoteComments('')).rejects.toThrow('noteId 不能为空');
    });

    it('API 错误 → 抛出异常', async () => {
      mockGet.mockRejectedValue(new Error('API Error'));
      await expect(service.getNoteComments('note_001')).rejects.toThrow('API Error');
    });
  });

  // ============================================================
  // normalizeNote 边界情况
  // ============================================================
  describe('normalizeNote 边界情况', () => {
    it('笔记无 note_id → 被过滤', async () => {
      const mockResponse = {
        items: [
          { note_card: { title: '无ID笔记', user: { nickname: '作者' } } },
          { note_card: { note_id: 'valid_note', title: '有效笔记', user: { nickname: '作者' } } },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchNotes('测试');
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].id).toBe('valid_note');
    });

    it('笔记无 interact_info → metrics 全为 0', async () => {
      const mockResponse = {
        items: [
          { note_card: { note_id: 'no_metrics', title: '无互动数据', user: { nickname: '作者' } } },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchNotes('测试');
      expect(result.notes[0].metrics.likes).toBe(0);
      expect(result.notes[0].metrics.comments).toBe(0);
      expect(result.notes[0].metrics.collects).toBe(0);
      expect(result.notes[0].metrics.shares).toBe(0);
      expect(result.notes[0].metrics.views).toBe(0);
    });

    it('笔记 cover 为字符串 → 直接使用', async () => {
      const mockResponse = {
        items: [
          {
            note_card: {
              note_id: 'str_cover',
              title: '字符串封面',
              cover: 'http://cover.url/str.jpg',
              user: { nickname: '作者' },
            },
          },
        ],
        has_more: false,
      };

      mockGet.mockResolvedValue(mockResponse);

      const result = await service.searchNotes('测试');
      expect(result.notes[0].cover).toBe('http://cover.url/str.jpg');
    });
  });
});
