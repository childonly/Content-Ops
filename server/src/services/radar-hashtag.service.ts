/**
 * 标签模块服务
 * 调用 TikHub 标签相关端点，汇总受欢迎度/热门帖子/相关标签
 *
 * 支持的端点：
 * - TikTok 标签详情: GET /tiktok/ads/get_trends_hashtag_detail?hashtag_id={id}
 * - TikTok 标签视频: GET /tiktok/app/v3/fetch_hashtag_video_list?ch_id={id}&cursor=0
 * - Instagram 标签搜索: GET /instagram/v2/search_hashtags?q={keyword}
 * - Instagram 标签帖子: GET /instagram/v2/fetch_hashtag_posts?id={id}
 * - 小红书笔记搜索: GET /xhs/app_v2/search_notes?keyword={keyword}
 *
 * 从 social-radar 项目迁移，使用 radar 前缀避免与 content-ops-hub 已有 hashtag.service.ts 冲突
 * 文件名遵循 content-ops-hub 的 kebab-case 约定
 */

import tikhubClient from './tikhub-client';
import { createServiceLogger } from '../utils/logger';
import type {
  ApiResponse,
  HashtagData,
  HashtagSearchResult,
  StandardPost,
  Platform,
  EngagementMetrics,
  StandardAuthor,
} from '../types/radar.types';

const logger = createServiceLogger('radar-hashtag');

export class HashtagService {
  /**
   * 搜索标签
   * @param keyword 搜索关键词
   * @param platform 指定平台（默认全部）
   */
  async searchHashtags(
    keyword: string,
    platform?: Platform,
  ): Promise<ApiResponse<HashtagSearchResult>> {
    const startTime = Date.now();
    logger.info('标签搜索启动', { keyword, platform });

    const tasks: Promise<HashtagData[]>[] = [];

    if (!platform || platform === 'instagram') {
      tasks.push(this.searchInstagramHashtags(keyword));
    }
    if (!platform || platform === 'xhs') {
      tasks.push(this.searchXhsHashtags(keyword));
    }
    if (!platform || platform === 'tiktok') {
      tasks.push(this.searchTikTokHashtags(keyword));
    }

    const results = await Promise.allSettled(tasks);

    const allResults: HashtagData[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      } else {
        const platformNames = ['Instagram', '小红书', 'TikTok'];
        logger.warn(`${platformNames[index]} 标签搜索失败`, {
          error: (result.reason as Error)?.message,
        });
      }
    });

    const durationMs = Date.now() - startTime;

    return {
      success: allResults.length > 0,
      data: {
        query: keyword,
        results: allResults,
      },
      error: allResults.length === 0 ? '未找到匹配的标签' : undefined,
      meta: {
        platform: 'multi',
        count: allResults.length,
        duration_ms: durationMs,
      },
    };
  }

  /**
   * 获取标签详情
   * @param id 标签 ID
   * @param platform 平台
   */
  async getHashtagDetail(
    id: string,
    platform: Platform,
  ): Promise<ApiResponse<HashtagData>> {
    const startTime = Date.now();
    logger.info('标签详情获取', { id, platform });

    let hashtagData: HashtagData | null = null;

    if (platform === 'tiktok') {
      hashtagData = await this.getTikTokHashtagDetail(id);
    } else if (platform === 'instagram') {
      hashtagData = await this.getInstagramHashtagDetail(id);
    } else {
      return {
        success: false,
        data: {} as HashtagData,
        error: `平台 ${platform} 暂不支持标签详情查询`,
      };
    }

    const durationMs = Date.now() - startTime;

    return {
      success: hashtagData !== null,
      data: hashtagData || ({} as HashtagData),
      meta: {
        platform,
        count: 1,
        duration_ms: durationMs,
      },
    };
  }

  // ============================================================
  // TikTok 标签
  // ============================================================

  /** TikTok 标签搜索（通过热门标签列表过滤） */
  private async searchTikTokHashtags(keyword: string): Promise<HashtagData[]> {
    try {
      const response = await tikhubClient.get<any>(
        '/tiktok/ads/get_trends_hashtag_list',
        undefined,
        { useCache: true, cacheTtl: 600000 },
      );

      const items = this.extractList(response);
      // 关键词为空时返回所有热门标签，否则按关键词过滤
      const filtered = keyword.trim().length > 0
        ? items.filter((item: any) => {
            const name = String(item.hashtagName || item.hashtag_name || item.challengeName || item.challenge_name || item.name || '');
            return name.toLowerCase().includes(keyword.toLowerCase());
          })
        : items;

      return filtered.map((item: any) => ({
        id: String(item.hashtagID || item.hashtag_id || item.challengeId || item.challenge_id || item.id || ''),
        platform: 'tiktok' as Platform,
        name: String(item.hashtagName || item.hashtag_name || item.challengeName || item.challenge_name || item.name || keyword),
        viewCount: this.safeNumber(item.publishCnt || item.view_count || item.views),
        postCount: this.safeNumber(item.publishCnt || item.user_count || item.post_count || item.video_count),
        trending: this.safeNumber(item.publishCnt || item.view_count) > 1000000,
        relatedHashtags: [],
        topPosts: [],
        raw: item,
      }));
    } catch (error) {
      logger.warn('TikTok 标签搜索失败', { error: (error as Error).message });
      return [];
    }
  }

  /** TikTok 标签详情 + 热门视频 */
  private async getTikTokHashtagDetail(id: string): Promise<HashtagData | null> {
    try {
      // 并发获取详情和视频列表
      const [detailResponse, videoResponse] = await Promise.allSettled([
        tikhubClient.get<any>(
          '/tiktok/ads/get_trends_hashtag_detail',
          { hashtag_id: id },
          { useCache: true, cacheTtl: 600000 },
        ),
        tikhubClient.get<any>(
          '/tiktok/app/v3/fetch_hashtag_video_list',
          { ch_id: id, cursor: 0 },
          { useCache: true, cacheTtl: 300000 },
        ),
      ]);

      let detail: any = null;
      if (detailResponse.status === 'fulfilled') {
        detail = detailResponse.value;
      }

      let videos: any[] = [];
      if (videoResponse.status === 'fulfilled') {
        videos = this.extractList(videoResponse.value);
      }

      const detailData = this.extractObject(detail);
      const topPosts = videos.map((v: any) => this.normalizeTikTokPost(v)).filter((p): p is StandardPost => p !== null);

      return {
        id,
        platform: 'tiktok',
        name: String(detailData.hashtagName || detailData.hashtag_name || detailData.challengeName || detailData.challenge_name || detailData.title || `#${id}`),
        viewCount: this.safeNumber(detailData.publishCnt || detailData.view_count || detailData.views),
        postCount: this.safeNumber(detailData.publishCnt || detailData.user_count || detailData.video_count || detailData.post_count),
        trending: this.safeNumber(detailData.publishCnt || detailData.view_count) > 1000000,
        relatedHashtags: this.extractRelatedHashtags(detailData),
        topPosts,
        raw: detailData,
      };
    } catch (error) {
      logger.warn('TikTok 标签详情获取失败', { id, error: (error as Error).message });
      return null;
    }
  }

  // ============================================================
  // Instagram 标签
  // ============================================================

  /** Instagram 标签搜索 */
  private async searchInstagramHashtags(keyword: string): Promise<HashtagData[]> {
    try {
      const response = await tikhubClient.get<any>(
        '/instagram/v2/search_hashtags',
        { keyword },
        { useCache: true, cacheTtl: 600000 },
      );

      const items = this.extractList(response);
      return items.map((item: any) => ({
        id: String(item.id || item.pk || ''),
        platform: 'instagram' as Platform,
        name: String(item.name || item.hashtagName || item.hashtag_name || keyword),
        viewCount: this.safeNumber(item.mediaCount || item.media_count || item.post_count),
        postCount: this.safeNumber(item.mediaCount || item.media_count || item.post_count),
        trending: this.safeNumber(item.mediaCount || item.media_count) > 100000,
        relatedHashtags: [],
        topPosts: [],
        raw: item,
      }));
    } catch (error) {
      logger.warn('Instagram 标签搜索失败', { error: (error as Error).message });
      return [];
    }
  }

  /** Instagram 标签详情 + 帖子 */
  private async getInstagramHashtagDetail(id: string): Promise<HashtagData | null> {
    try {
      const response = await tikhubClient.get<any>(
        '/instagram/v2/fetch_hashtag_posts',
        { id },
        { useCache: true, cacheTtl: 300000 },
      );

      const posts = this.extractList(response);
      const topPosts = posts.map((p: any) => this.normalizeInstagramPost(p)).filter((p): p is StandardPost => p !== null);

      return {
        id,
        platform: 'instagram',
        name: `#${id}`,
        viewCount: 0,
        postCount: posts.length,
        trending: topPosts.length > 10,
        relatedHashtags: [],
        topPosts,
        raw: response,
      };
    } catch (error) {
      logger.warn('Instagram 标签详情获取失败', { id, error: (error as Error).message });
      return null;
    }
  }

  // ============================================================
  // 小红书标签（通过笔记搜索）
  // ============================================================

  /** 小红书标签搜索（通过笔记搜索关键词） */
  private async searchXhsHashtags(keyword: string): Promise<HashtagData[]> {
    try {
      const response = await tikhubClient.get<any>(
        '/xhs/app_v2/search_notes',
        { keyword },
        { useCache: true, cacheTtl: 600000 },
      );

      const items = this.extractList(response);
      const topPosts = items.map((item: any) => this.normalizeXhsPost(item)).filter((p): p is StandardPost => p !== null);

      // 小红书没有原生标签搜索，用搜索结果模拟
      return [{
        id: `xhs_${keyword}`,
        platform: 'xhs' as Platform,
        name: `#${keyword}`,
        viewCount: 0,
        postCount: items.length,
        trending: items.length > 20,
        relatedHashtags: [],
        topPosts,
        raw: response,
      }];
    } catch (error) {
      logger.warn('小红书标签搜索失败', { error: (error as Error).message });
      return [];
    }
  }

  // ============================================================
  // 数据标准化方法
  // ============================================================

  /** 标准化 TikTok 帖子 */
  private normalizeTikTokPost(item: any): StandardPost | null {
    if (!item) return null;
    const stats = item.stats || item.statistics || {};
    const author = item.author || item.userInfo || {};
    const metrics: EngagementMetrics = {
      likes: this.safeNumber(stats.diggCount || stats.like_count || stats.likes || 0),
      comments: this.safeNumber(stats.commentCount || stats.comment_count || stats.comments || 0),
      shares: this.safeNumber(stats.shareCount || stats.share_count || stats.shares || 0),
      views: this.safeNumber(stats.playCount || stats.view_count || stats.views || 0),
    };
    const standardAuthor: StandardAuthor = {
      id: String(author.id || author.uid || author.secUid || author.sec_uid || ''),
      username: String(author.uniqueId || author.unique_id || author.username || ''),
      displayName: String(author.nickname || author.displayName || author.display_name || ''),
      avatar: String(author.avatar || author.avatarUrl || author.avatar_url || ''),
      followerCount: this.safeNumber(author.followerCount || author.follower_count || author.followers || 0),
      platform: 'tiktok',
    };
    return {
      id: String(item.video_id || item.aweme_id || item.id || ''),
      platform: 'tiktok',
      author: standardAuthor,
      caption: String(item.desc || item.caption || item.title || ''),
      description: String(item.desc || item.caption || ''),
      url: item.share_url || item.video?.url || '',
      thumbnail: item.video?.cover || item.video?.origin_cover || item.cover || '',
      createdAt: String(item.create_time ? new Date(item.create_time * 1000).toISOString() : new Date().toISOString()),
      metrics,
    };
  }

  /** 标准化 Instagram 帖子 */
  private normalizeInstagramPost(item: any): StandardPost | null {
    if (!item) return null;
    const metrics: EngagementMetrics = {
      likes: this.safeNumber(item.like_count || item.likes || 0),
      comments: this.safeNumber(item.comment_count || item.comments || 0),
      shares: 0,
      views: this.safeNumber(item.view_count || item.play_count || 0),
    };
    const user = item.user || item.caption?.user || {};
    const standardAuthor: StandardAuthor = {
      id: String(user.pk || user.id || ''),
      username: String(user.username || ''),
      displayName: String(user.full_name || user.username || ''),
      avatar: String(user.profile_pic_url || ''),
      followerCount: this.safeNumber(user.follower_count || 0),
      platform: 'instagram',
    };
    return {
      id: String(item.id || item.pk || ''),
      platform: 'instagram',
      author: standardAuthor,
      caption: String(item.caption?.text || item.caption || ''),
      description: String(item.caption?.text || ''),
      url: item.permalink || item.shortcode ? `https://www.instagram.com/p/${item.shortcode}/` : '',
      thumbnail: item.thumbnail_url || item.media_url || item.image_url || '',
      createdAt: String(item.taken_at ? new Date(item.taken_at * 1000).toISOString() : new Date().toISOString()),
      metrics,
    };
  }

  /** 标准化小红书帖子 */
  private normalizeXhsPost(item: any): StandardPost | null {
    if (!item) return null;
    const interactInfo = item.interact_info || item.interaction || {};
    const user = item.user || {};
    const metrics: EngagementMetrics = {
      likes: this.safeNumber(interactInfo.liked_count || item.liked_count || 0),
      comments: this.safeNumber(interactInfo.comment_count || item.comment_count || 0),
      shares: this.safeNumber(interactInfo.shared_count || item.share_count || 0),
      views: this.safeNumber(interactInfo.view_count || item.exposure || 0),
    };
    const standardAuthor: StandardAuthor = {
      id: String(user.user_id || user.id || ''),
      username: String(user.nickname || user.name || ''),
      displayName: String(user.nickname || user.name || ''),
      avatar: String(user.avatar || ''),
      followerCount: this.safeNumber(user.fans || user.follower_count || 0),
      platform: 'xhs',
    };
    return {
      id: String(item.note_id || item.id || ''),
      platform: 'xhs',
      author: standardAuthor,
      caption: String(item.title || ''),
      description: String(item.desc || item.content || ''),
      url: item.note_url || `https://www.xiaohongshu.com/explore/${item.note_id || item.id || ''}`,
      thumbnail: item.cover?.url || item.image_url || '',
      createdAt: String(item.time ? new Date(item.time * 1000).toISOString() : new Date().toISOString()),
      metrics,
    };
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /** 从响应中提取列表（兼容 camelCase / snake_case / 多种嵌套结构） */
  private extractList(response: any): any[] {
    if (!response) return [];
    if (Array.isArray(response)) return response;

    const directKeys = [
      'data', 'list', 'items', 'medias', 'notes',
      'hashtagList', 'mediaList', 'noteList', 'postList',
      'aweme_list', 'video_list',
    ];
    for (const key of directKeys) {
      if (Array.isArray(response[key])) return response[key];
    }

    const dataObj = response.data;
    if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
      const nestedKeys = [
        'list', 'items', 'medias', 'notes',
        'hashtagList', 'mediaList', 'noteList', 'postList',
        'aweme_list', 'video_list',
      ];
      for (const key of nestedKeys) {
        if (Array.isArray(dataObj[key])) return dataObj[key];
      }
      for (const key of Object.keys(dataObj)) {
        if (Array.isArray(dataObj[key]) && dataObj[key].length > 0) return dataObj[key];
      }
    }

    for (const key of Object.keys(response)) {
      if (Array.isArray(response[key]) && response[key].length > 0) return response[key];
    }

    return [];
  }

  /** 从响应中提取对象（详情类型） */
  private extractObject(response: any): any {
    if (!response) return {};
    if (typeof response === 'object' && !Array.isArray(response)) {
      if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        return response.data;
      }
      return response;
    }
    return {};
  }

  /** 提取相关标签 */
  private extractRelatedHashtags(detail: any): Array<{ id: string; name: string; viewCount: number }> {
    const related = detail.relatedHashtags || detail.related_hashtags || detail.related || detail.associatedChallenges || detail.associated_challenges || [];
    if (!Array.isArray(related)) return [];
    return related.map((item: any) => ({
      id: String(item.hashtagID || item.hashtag_id || item.challengeId || item.challenge_id || item.id || ''),
      name: String(item.hashtagName || item.hashtag_name || item.challengeName || item.challenge_name || item.name || ''),
      viewCount: this.safeNumber(item.publishCnt || item.view_count || item.views || 0),
    }));
  }

  /** 安全转数字 */
  private safeNumber(value: unknown): number {
    if (value === undefined || value === null) return 0;
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }
}

export const hashtagService = new HashtagService();
export default hashtagService;
