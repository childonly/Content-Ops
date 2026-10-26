/**
 * 小红书数据服务 (TikHub API 扩展)
 *
 * 通过 TikHub API 获取小红书数据，提供：
 * - searchNotes(keyword, limit): 搜索笔记       /xiaohongshu/app_v2/search_notes
 * - getNoteDetail(noteId):        获取笔记详情   /xiaohongshu/app_v2/get_image_note_detail + get_video_note_detail
 * - getUserInfo(userId):          获取用户信息   /xiaohongshu/app_v2/get_user_info
 * - getUserNotes(userId, cursor): 获取用户笔记   /xiaohongshu/app_v2/get_user_posted_notes
 * - getNoteComments(noteId, cursor): 获取评论    /xiaohongshu/app_v2/get_note_comments
 *
 * 端点路径已通过 TikHub API get_all_endpoints_info 验证（2026-07-23）
 * 使用 BaseDataService 基类的 tikhubGet（基于 tikhubClient，自带重试/缓存/错误处理）
 */

import { BaseDataService } from './base-data.service';

// ============================================================================
// 标准化数据结构
// ============================================================================

export interface XhsNoteAuthor {
  id: string;
  nickname: string;
  avatar: string;
  userId: string;
}

export interface XhsNoteMetrics {
  likes: number;
  comments: number;
  collects: number;
  shares: number;
  views: number;
}

export interface XhsNote {
  id: string;
  title: string;
  desc: string;
  type: string;
  author: XhsNoteAuthor;
  cover: string;
  images: string[];
  videoUrl: string;
  metrics: XhsNoteMetrics;
  tags: string[];
  url: string;
  createdAt: string;
  raw: unknown;
}

export interface XhsUser {
  id: string;
  nickname: string;
  redId: string;
  avatar: string;
  desc: string;
  gender: string;
  ipLocation: string;
  fans: number;
  follows: number;
  interaction: number;
  notes: number;
  raw: unknown;
}

export interface XhsComment {
  id: string;
  noteId: string;
  content: string;
  author: XhsNoteAuthor;
  likeCount: number;
  subComments: XhsComment[];
  createdAt: string;
  raw: unknown;
}

export interface XhsSearchResult {
  notes: XhsNote[];
  total: number;
  hasMore: boolean;
  cursor: string;
}

export interface XhsUserNotesResult {
  notes: XhsNote[];
  hasMore: boolean;
  cursor: string;
}

export interface XhsCommentResult {
  comments: XhsComment[];
  total: number;
  hasMore: boolean;
  cursor: string;
}

// ============================================================================
// 服务实现
// ============================================================================

export class XhsDataService extends BaseDataService {
  constructor() {
    super('xhs-data');
  }

  // ============================================================
  // 公开方法
  // ============================================================

  /**
   * 搜索小红书笔记
   * TikHub: GET /xiaohongshu/app_v2/search_notes
   * @param keyword 搜索关键词
   * @param limit 返回数量上限，默认 20
   */
  async searchNotes(keyword: string, limit: number = 20): Promise<XhsSearchResult> {
    const startTime = Date.now();
    const pageLimit = Math.min(Math.max(limit, 1), 50);
    this.logger.info('搜索小红书笔记', { keyword, limit: pageLimit });

    try {
      const result = await this.tikhubGet<unknown>(
        '/xiaohongshu/app_v2/search_notes',
        { keyword, page: 1, page_size: pageLimit },
      );

      const rawNotes = this.extractList(result);
      const notes = rawNotes
        .map((item: any) => this.normalizeNote(item))
        .filter((n: XhsNote | null): n is XhsNote => n !== null)
        .slice(0, limit);

      const hasMore = this.extractBool(result, ['has_more', 'hasMore']);
      const cursor = this.extractString(result, ['cursor', 'next_cursor']);

      const duration = Date.now() - startTime;
      this.logger.info('搜索小红书笔记完成', { count: notes.length, duration: `${duration}ms` });

      return {
        notes,
        total: notes.length,
        hasMore,
        cursor,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('搜索小红书笔记失败', { keyword, error: message });
      throw error;
    }
  }

  /**
   * 获取笔记详情
   * TikHub: GET /xiaohongshu/app_v2/get_image_note_detail (图文笔记)
   *         GET /xiaohongshu/app_v2/get_video_note_detail (视频笔记)
   * 自动尝试两种端点，返回先成功的那个
   * @param noteId 笔记 ID
   */
  async getNoteDetail(noteId: string): Promise<XhsNote | null> {
    const startTime = Date.now();
    if (!noteId) {
      throw new Error('noteId 不能为空');
    }
    this.logger.info('获取小红书笔记详情', { noteId });

    // 尝试图文笔记端点，失败则尝试视频笔记端点
    const endpoints = [
      '/xiaohongshu/app_v2/get_image_note_detail',
      '/xiaohongshu/app_v2/get_video_note_detail',
    ];

    for (const endpoint of endpoints) {
      try {
        const result = await this.tikhubGet<unknown>(endpoint, { note_id: noteId });
        const noteRaw = this.extractDetailObject(result, noteId, 'note_id');
        const note = this.normalizeNote(noteRaw);

        if (note) {
          const duration = Date.now() - startTime;
          this.logger.info('获取小红书笔记详情完成', {
            noteId,
            found: true,
            endpoint,
            duration: `${duration}ms`,
          });
          return note;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug('笔记详情端点未命中，尝试下一个', { endpoint, noteId, error: message });
      }
    }

    const duration = Date.now() - startTime;
    this.logger.info('获取小红书笔记详情完成', { noteId, found: false, duration: `${duration}ms` });
    return null;
  }

  /**
   * 获取用户信息
   * TikHub: GET /xiaohongshu/app_v2/get_user_info
   * @param userId 用户 ID
   */
  async getUserInfo(userId: string): Promise<XhsUser | null> {
    const startTime = Date.now();
    if (!userId) {
      throw new Error('userId 不能为空');
    }
    this.logger.info('获取小红书用户信息', { userId });

    try {
      const result = await this.tikhubGet<unknown>(
        '/xiaohongshu/app_v2/get_user_info',
        { user_id: userId },
      );

      const userRaw = this.extractDetailObject(result);
      const user = this.normalizeUser(userRaw);

      const duration = Date.now() - startTime;
      this.logger.info('获取小红书用户信息完成', { userId, found: !!user, duration: `${duration}ms` });

      return user;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('获取小红书用户信息失败', { userId, error: message });
      throw error;
    }
  }

  /**
   * 获取用户笔记列表
   * TikHub: GET /xiaohongshu/app_v2/get_user_posted_notes
   * @param userId 用户 ID
   * @param cursor 分页游标（可选，首次请求传空字符串）
   */
  async getUserNotes(userId: string, cursor: string = ''): Promise<XhsUserNotesResult> {
    const startTime = Date.now();
    if (!userId) {
      throw new Error('userId 不能为空');
    }
    this.logger.info('获取小红书用户笔记列表', { userId, cursor });

    try {
      const params: Record<string, string | number | boolean> = { user_id: userId };
      if (cursor) {
        params.cursor = cursor;
      }

      const result = await this.tikhubGet<unknown>(
        '/xiaohongshu/app_v2/get_user_posted_notes',
        params,
      );

      const rawNotes = this.extractList(result);
      const notes = rawNotes
        .map((item: any) => this.normalizeNote(item))
        .filter((n: XhsNote | null): n is XhsNote => n !== null);

      const hasMore = this.extractBool(result, ['has_more', 'hasMore']);
      const nextCursor = this.extractString(result, ['cursor', 'next_cursor']);

      const duration = Date.now() - startTime;
      this.logger.info('获取小红书用户笔记列表完成', {
        userId,
        count: notes.length,
        duration: `${duration}ms`,
      });

      return {
        notes,
        hasMore,
        cursor: nextCursor,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('获取小红书用户笔记列表失败', { userId, error: message });
      throw error;
    }
  }

  /**
   * 获取笔记评论
   * TikHub: GET /xiaohongshu/app_v2/get_note_comments
   * @param noteId 笔记 ID
   * @param cursor 分页游标（可选）
   */
  async getNoteComments(noteId: string, cursor: string = ''): Promise<XhsCommentResult> {
    const startTime = Date.now();
    if (!noteId) {
      throw new Error('noteId 不能为空');
    }
    this.logger.info('获取小红书笔记评论', { noteId, cursor });

    try {
      const params: Record<string, string | number | boolean> = { note_id: noteId };
      if (cursor) {
        params.cursor = cursor;
      }

      const result = await this.tikhubGet<unknown>(
        '/xiaohongshu/app_v2/get_note_comments',
        params,
      );

      const rawComments = this.extractList(result);
      const comments = rawComments
        .map((item: any) => this.normalizeComment(item, noteId))
        .filter((c: XhsComment | null): c is XhsComment => c !== null);

      const hasMore = this.extractBool(result, ['has_more', 'hasMore']);
      const nextCursor = this.extractString(result, ['cursor', 'next_cursor']);

      const duration = Date.now() - startTime;
      this.logger.info('获取小红书笔记评论完成', {
        noteId,
        count: comments.length,
        duration: `${duration}ms`,
      });

      return {
        comments,
        total: comments.length,
        hasMore,
        cursor: nextCursor,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('获取小红书笔记评论失败', { noteId, error: message });
      throw error;
    }
  }

  // ============================================================
  // 标准化方法（平台特定）
  // ============================================================

  /** 标准化笔记 */
  private normalizeNote(item: any): XhsNote | null {
    if (!item) return null;
    const card = item.note_card || item.noteCard || item.note || item;
    const noteId = String(
      card.note_id || card.id || item.note_id || item.id || '',
    );
    if (!noteId) return null;

    const user = card.user || item.user || {};
    const interact = card.interact_info || card.interaction || item.interact_info || {};
    const cover = card.cover || item.cover || {};
    const imageList = card.image_list || card.images || item.image_list || [];
    const video = card.video || item.video || {};
    const tagList = card.tag_list || card.tags || item.tag_list || [];

    const author: XhsNoteAuthor = {
      id: String(user.user_id || user.id || ''),
      nickname: String(user.nickname || user.name || ''),
      avatar: String(user.avatar || ''),
      userId: String(user.user_id || user.id || ''),
    };

    const metrics: XhsNoteMetrics = {
      likes: this.safeNumber(interact.liked_count),
      comments: this.safeNumber(interact.comment_count),
      collects: this.safeNumber(interact.collected_count),
      shares: this.safeNumber(interact.shared_count),
      views: this.safeNumber(interact.view_count || interact.exposure),
    };

    const coverUrl =
      typeof cover === 'string'
        ? cover
        : String(cover.url || cover.info_list?.[0]?.url || item.cover_url || '');

    return {
      id: noteId,
      title: this.safeString(card.title || item.title),
      desc: this.safeString(card.desc || card.content || item.desc),
      type: this.safeString(card.type || item.type, 'normal'),
      author,
      cover: coverUrl,
      images: Array.isArray(imageList)
        ? imageList
            .map((img: any) =>
              typeof img === 'string' ? img : String(img?.url || img?.info_list?.[0]?.url || ''),
            )
            .filter(Boolean)
        : [],
      videoUrl: String(
        video.media?.stream?.[0]?.[0]?.master_url ||
          video.url ||
          video.play_url ||
          '',
      ),
      metrics,
      tags: Array.isArray(tagList)
        ? tagList
            .map((t: any) =>
              typeof t === 'string' ? t : String(t?.name || t?.title || ''),
            )
            .filter(Boolean)
        : [],
      url: String(
        item.note_url ||
          card.note_url ||
          `https://www.xiaohongshu.com/explore/${noteId}`,
      ),
      createdAt: card.time || item.time
        ? new Date(this.safeNumber(card.time || item.time) * 1000).toISOString()
        : new Date().toISOString(),
      raw: item,
    };
  }

  /** 标准化用户 */
  private normalizeUser(item: any): XhsUser | null {
    if (!item) return null;
    const user = item.user_info || item.userInfo || item.user || item;
    const userId = String(user.user_id || user.id || item.id || '');
    if (!userId) return null;

    return {
      id: userId,
      nickname: this.safeString(user.nickname || user.name),
      redId: this.safeString(user.red_id || user.redId || user.xhs_id),
      avatar: this.safeString(user.image || user.avatar || user.imageb),
      desc: this.safeString(user.desc || user.description),
      gender: this.safeString(user.gender),
      ipLocation: this.safeString(user.ip_location || user.ipLocation),
      fans: this.safeNumber(user.fans || user.fansCount || user.follower_count),
      follows: this.safeNumber(user.follows || user.followCount || user.following_count),
      interaction: this.safeNumber(user.interaction),
      notes: this.safeNumber(user.notes || user.note_count),
      raw: item,
    };
  }

  /** 标准化评论 */
  private normalizeComment(item: any, noteId: string): XhsComment | null {
    if (!item) return null;
    const commentId = String(item.id || item.comment_id || item.note_id || '');
    if (!commentId) return null;

    const user = item.user || {};
    const subComments = item.sub_comments || item.subComments || [];

    const author: XhsNoteAuthor = {
      id: String(user.user_id || user.id || ''),
      nickname: String(user.nickname || user.name || ''),
      avatar: String(user.avatar || ''),
      userId: String(user.user_id || user.id || ''),
    };

    const subList: XhsComment[] = Array.isArray(subComments)
      ? subComments
          .map((sub: any) => this.normalizeComment(sub, noteId))
          .filter((c: XhsComment | null): c is XhsComment => c !== null)
      : [];

    return {
      id: commentId,
      noteId: this.safeString(item.note_id || noteId),
      content: this.safeString(item.content || item.text || item.desc),
      author,
      likeCount: this.safeNumber(item.like_count || item.likeCount || item.liked_count),
      subComments: subList,
      createdAt: item.create_time || item.time
        ? new Date(this.safeNumber(item.create_time || item.time) * 1000).toISOString()
        : new Date().toISOString(),
      raw: item,
    };
  }
}

/** 全局小红书数据服务实例 */
export const xhsDataService = new XhsDataService();
export default xhsDataService;
