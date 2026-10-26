/**
 * YouTube 数据服务 (TikHub API 扩展)
 *
 * 通过 TikHub API 获取 YouTube 数据，提供：
 * - searchVideos(keyword, limit):    搜索视频      /youtube/web_v2/get_general_search
 * - getVideoInfo(videoId):           获取视频信息  /youtube/web_v2/get_video_info
 * - getChannelInfo(channelId):       获取频道信息  /youtube/web/get_channel_info
 * - getVideoComments(videoId, limit): 获取视频评论  /youtube/web_v2/get_video_comments
 *
 * 端点路径已通过 TikHub API get_all_endpoints_info 验证（2026-07-23）
 * 使用 BaseDataService 基类的 tikhubGet（基于 tikhubClient，自带重试/缓存/错误处理）
 */

import { BaseDataService } from './base-data.service';

// ============================================================================
// 标准化数据结构
// ============================================================================

export interface YouTubeVideoAuthor {
  id: string;
  name: string;
  avatar: string;
  channelUrl: string;
}

export interface YouTubeVideoMetrics {
  views: number;
  likes: number;
  comments: number;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  author: YouTubeVideoAuthor;
  thumbnail: string;
  duration: string;
  publishedAt: string;
  metrics: YouTubeVideoMetrics;
  url: string;
  raw: unknown;
}

export interface YouTubeChannel {
  id: string;
  name: string;
  description: string;
  avatar: string;
  bannerUrl: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  url: string;
  raw: unknown;
}

export interface YouTubeComment {
  id: string;
  videoId: string;
  content: string;
  author: YouTubeVideoAuthor;
  likeCount: number;
  replyCount: number;
  publishedAt: string;
  raw: unknown;
}

export interface YouTubeSearchResult {
  videos: YouTubeVideo[];
  total: number;
  hasMore: boolean;
  cursor: string;
}

export interface YouTubeCommentResult {
  comments: YouTubeComment[];
  total: number;
  hasMore: boolean;
  cursor: string;
}

// ============================================================================
// 服务实现
// ============================================================================

export class YoutubeDataService extends BaseDataService {
  constructor() {
    super('youtube-data');
  }

  // ============================================================
  // 公开方法
  // ============================================================

  /**
   * 搜索 YouTube 视频
   * TikHub: GET /youtube/web_v2/get_general_search
   * @param keyword 搜索关键词
   * @param limit 返回数量上限，默认 20
   */
  async searchVideos(keyword: string, limit: number = 20): Promise<YouTubeSearchResult> {
    const startTime = Date.now();
    const pageLimit = Math.min(Math.max(limit, 1), 50);
    this.logger.info('搜索 YouTube 视频', { keyword, limit: pageLimit });

    try {
      const result = await this.tikhubGet<unknown>(
        '/youtube/web_v2/get_general_search',
        { search_query: keyword },
      );

      const rawVideos = this.extractList(result);
      const videos = rawVideos
        .map((item: any) => this.normalizeVideo(item))
        .filter((v: YouTubeVideo | null): v is YouTubeVideo => v !== null)
        .slice(0, limit);

      const hasMore = this.extractBool(result, ['has_more', 'hasMore', 'nextPageToken']);
      const cursor = this.extractString(result, ['cursor', 'next_cursor', 'nextPageToken']);

      const duration = Date.now() - startTime;
      this.logger.info('搜索 YouTube 视频完成', { count: videos.length, duration: `${duration}ms` });

      return {
        videos,
        total: videos.length,
        hasMore,
        cursor,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('搜索 YouTube 视频失败', { keyword, error: message });
      throw error;
    }
  }

  /**
   * 获取视频信息
   * TikHub: GET /youtube/web_v2/get_video_info
   * @param videoId 视频 ID
   */
  async getVideoInfo(videoId: string): Promise<YouTubeVideo | null> {
    const startTime = Date.now();
    if (!videoId) {
      throw new Error('videoId 不能为空');
    }
    this.logger.info('获取 YouTube 视频信息', { videoId });

    try {
      const result = await this.tikhubGet<unknown>(
        '/youtube/web_v2/get_video_info',
        { video_id: videoId },
      );

      const videoRaw = this.extractDetailObject(result, videoId, 'video_id');
      const video = this.normalizeVideo(videoRaw);

      const duration = Date.now() - startTime;
      this.logger.info('获取 YouTube 视频信息完成', {
        videoId,
        found: !!video,
        duration: `${duration}ms`,
      });

      return video;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('获取 YouTube 视频信息失败', { videoId, error: message });
      throw error;
    }
  }

  /**
   * 获取频道信息
   * TikHub: GET /youtube/web/get_channel_info
   * @param channelId 频道 ID
   */
  async getChannelInfo(channelId: string): Promise<YouTubeChannel | null> {
    const startTime = Date.now();
    if (!channelId) {
      throw new Error('channelId 不能为空');
    }
    this.logger.info('获取 YouTube 频道信息', { channelId });

    try {
      const result = await this.tikhubGet<unknown>(
        '/youtube/web/get_channel_info',
        { channel_id: channelId },
      );

      const channelRaw = this.extractDetailObject(result, channelId, 'channel_id');
      const channel = this.normalizeChannel(channelRaw);

      const duration = Date.now() - startTime;
      this.logger.info('获取 YouTube 频道信息完成', {
        channelId,
        found: !!channel,
        duration: `${duration}ms`,
      });

      return channel;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('获取 YouTube 频道信息失败', { channelId, error: message });
      throw error;
    }
  }

  /**
   * 获取视频评论
   * TikHub: GET /youtube/web_v2/get_video_comments
   * @param videoId 视频 ID
   * @param limit 返回数量上限，默认 20
   */
  async getVideoComments(videoId: string, limit: number = 20): Promise<YouTubeCommentResult> {
    const startTime = Date.now();
    if (!videoId) {
      throw new Error('videoId 不能为空');
    }
    const pageLimit = Math.min(Math.max(limit, 1), 100);
    this.logger.info('获取 YouTube 视频评论', { videoId, limit: pageLimit });

    try {
      const result = await this.tikhubGet<unknown>(
        '/youtube/web_v2/get_video_comments',
        { video_id: videoId, count: pageLimit },
      );

      const rawComments = this.extractList(result);
      const comments = rawComments
        .map((item: any) => this.normalizeComment(item, videoId))
        .filter((c: YouTubeComment | null): c is YouTubeComment => c !== null)
        .slice(0, limit);

      const hasMore = this.extractBool(result, ['has_more', 'hasMore', 'nextPageToken']);
      const cursor = this.extractString(result, ['cursor', 'next_cursor', 'nextPageToken']);

      const duration = Date.now() - startTime;
      this.logger.info('获取 YouTube 视频评论完成', {
        videoId,
        count: comments.length,
        duration: `${duration}ms`,
      });

      return {
        comments,
        total: comments.length,
        hasMore,
        cursor,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('获取 YouTube 视频评论失败', { videoId, error: message });
      throw error;
    }
  }

  // ============================================================
  // 标准化方法（平台特定）
  // ============================================================

  /** 标准化视频 */
  private normalizeVideo(item: any): YouTubeVideo | null {
    if (!item) return null;
    const videoId = String(
      item.video_id || item.id || item.vid || item.videoId || '',
    );
    if (!videoId) return null;

    const author = item.author || item.channel || item.channel_info || {};
    const stats = item.stats || item.statistics || item.metrics || {};
    const thumbnails = item.thumbnails || item.thumbnail || item.snippet?.thumbnails || {};

    return {
      id: videoId,
      title: this.safeString(item.title || item.snippet?.title),
      description: this.safeString(
        item.description || item.desc || item.snippet?.description,
      ),
      author: {
        id: String(author.channel_id || author.id || ''),
        name: String(author.title || author.name || author.channel_name || ''),
        avatar: String(author.avatar || author.thumbnails?.[0]?.url || ''),
        channelUrl: String(
          author.channel_url ||
            (author.channel_id || author.id
              ? `https://www.youtube.com/channel/${author.channel_id || author.id}`
              : ''),
        ),
      },
      thumbnail: this.extractThumbnail(thumbnails),
      duration: this.safeString(item.duration || item.length_seconds || item.content_details?.duration),
      publishedAt: this.normalizeDate(
        item.published_at || item.publish_date || item.snippet?.publishedAt || item.publishedAt,
      ),
      metrics: {
        views: this.safeNumber(stats.view_count || stats.views || item.view_count),
        likes: this.safeNumber(stats.like_count || stats.likes || item.like_count),
        comments: this.safeNumber(stats.comment_count || stats.comments || item.comment_count),
      },
      url: String(
        item.video_url ||
          item.url ||
          `https://www.youtube.com/watch?v=${videoId}`,
      ),
      raw: item,
    };
  }

  /** 标准化频道 */
  private normalizeChannel(item: any): YouTubeChannel | null {
    if (!item) return null;
    const channel = item.channel_info || item.channelInfo || item.channel || item;
    const channelId = String(
      channel.channel_id || channel.id || item.channel_id || item.id || '',
    );
    if (!channelId) return null;

    const stats = channel.stats || channel.statistics || {};
    const thumbnails = channel.thumbnails || channel.avatar || {};
    const banner = channel.banner || channel.banner_url || {};

    return {
      id: channelId,
      name: this.safeString(channel.title || channel.name || channel.channel_name),
      description: this.safeString(channel.description || channel.desc),
      avatar: this.extractThumbnail(thumbnails),
      bannerUrl: typeof banner === 'string' ? banner : this.safeString(banner.url || banner.image),
      subscriberCount: this.safeNumber(
        stats.subscriber_count || channel.subscriber_count || channel.subscribers,
      ),
      videoCount: this.safeNumber(stats.video_count || channel.video_count || channel.videos),
      viewCount: this.safeNumber(stats.view_count || channel.view_count || channel.views),
      url: String(
        channel.channel_url ||
          channel.url ||
          `https://www.youtube.com/channel/${channelId}`,
      ),
      raw: item,
    };
  }

  /** 标准化评论 */
  private normalizeComment(item: any, videoId: string): YouTubeComment | null {
    if (!item) return null;
    const commentId = String(item.id || item.comment_id || item.commentId || '');
    if (!commentId) return null;

    const author = item.author || item.author_channel || item.authorDetails || {};
    const stats = item.stats || item.statistics || {};

    return {
      id: commentId,
      videoId: this.safeString(item.video_id || videoId),
      content: this.safeString(
        item.content || item.text || item.text_display || item.textOriginal,
      ),
      author: {
        id: String(author.channel_id || author.id || author.authorChannelId?.value || ''),
        name: String(
          author.name ||
            author.display_name ||
            author.displayName ||
            author.authorDisplayName ||
            '',
        ),
        avatar: String(author.avatar || author.profile_image_url || author.authorProfileImageUrl || ''),
        channelUrl: String(
          author.channel_url ||
            (author.channel_id || author.id
              ? `https://www.youtube.com/channel/${author.channel_id || author.id}`
              : ''),
        ),
      },
      likeCount: this.safeNumber(stats.like_count || item.like_count || item.likes),
      replyCount: this.safeNumber(
        stats.reply_count || item.reply_count || item.total_reply_count,
      ),
      publishedAt: this.normalizeDate(
        item.published_at || item.publish_date || item.publishedAt || item.updatedAt,
      ),
      raw: item,
    };
  }

  /** 提取缩略图 URL */
  private extractThumbnail(thumbnails: any): string {
    if (!thumbnails) return '';
    if (typeof thumbnails === 'string') return thumbnails;
    // thumbnails 可能是 { default: {url}, medium: {url}, high: {url} } 结构
    const priorities = ['high', 'medium', 'default', 'maxres', 'standard'];
    if (typeof thumbnails === 'object') {
      // 标准 YouTube 缩略图结构
      for (const key of priorities) {
        if (thumbnails[key]?.url) return String(thumbnails[key].url);
      }
      // 数组结构
      if (Array.isArray(thumbnails)) {
        const last = thumbnails[thumbnails.length - 1];
        if (last?.url) return String(last.url);
        if (typeof last === 'string') return last;
      }
      // 直接 url 字段
      if (thumbnails.url) return String(thumbnails.url);
    }
    return '';
  }
}

/** 全局 YouTube 数据服务实例 */
export const youtubeDataService = new YoutubeDataService();
export default youtubeDataService;
