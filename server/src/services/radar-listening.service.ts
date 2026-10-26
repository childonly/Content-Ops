/**
 * 舆情监听模块服务
 * 跨平台关键词监听、情感分析、主题聚类
 *
 * 支持的平台：
 * - TikTok: /tiktok/app/v3/search_item
 * - 小红书: /xhs/app_v2/search_notes
 * - Instagram: /instagram/v2/fetch_hashtag_posts
 * - Twitter: /twitter/web/search_v2
 *
 * 从 social-radar 项目迁移
 * 文件名遵循 content-ops-hub 的 kebab-case 约定
 */

import tikhubClient from './tikhub-client';
import { createServiceLogger } from '../utils/logger';
import { analyzeSentiment, batchAnalyzeSentiment } from '../utils/radar-sentiment';
import type {
  ApiResponse,
  ListeningQuery,
  ListeningResult,
  Mention,
  ListeningSummary,
  Platform,
  SentimentLabel,
  StandardPost,
  StandardAuthor,
  EngagementMetrics,
} from '../types/radar.types';

const logger = createServiceLogger('radar-listening');

export class ListeningService {
  /**
   * 舆情监听主入口
   * @param query 监听查询参数
   */
  async listen(query: ListeningQuery): Promise<ApiResponse<ListeningResult>> {
    const startTime = Date.now();
    const keyword = query.keyword.trim();
    if (!keyword) {
      return {
        success: false,
        data: {} as ListeningResult,
        error: '关键词不能为空',
      };
    }

    const platforms = query.platforms || (['tiktok', 'xhs', 'instagram', 'twitter'] as Platform[]);
    logger.info('舆情监听启动', { keyword, platforms });

    // 并发获取各平台数据
    const tasks: Promise<Mention[]>[] = platforms.map((platform) =>
      this.fetchPlatformMentions(platform, keyword, query.limit || 50),
    );

    const results = await Promise.allSettled(tasks);

    const allMentions: Mention[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allMentions.push(...result.value);
      } else {
        logger.warn(`${platforms[index]} 监听获取失败`, {
          error: (result.reason as Error)?.message,
        });
      }
    });

    // 去重（按 url 或 id）
    const dedupedMentions = this.deduplicateMentions(allMentions);

    // 批量情感分析
    const sentimentResults = batchAnalyzeSentiment(
      dedupedMentions.map((m) => ({ id: m.id, text: m.content })),
    );
    const sentimentMap = new Map(sentimentResults.map((s) => [s.id, s]));

    // 注入情感分析结果
    const mentionsWithSentiment = dedupedMentions.map((m) => {
      const sentiment = sentimentMap.get(m.id);
      return {
        ...m,
        sentiment: sentiment?.type || 'neutral',
        sentimentScore: sentiment?.score || 0,
      };
    });

    // 生成摘要
    const summary = this.generateSummary(mentionsWithSentiment, keyword);

    const durationMs = Date.now() - startTime;

    return {
      success: mentionsWithSentiment.length > 0,
      data: {
        keyword,
        query: keyword,
        platforms,
        mentions: mentionsWithSentiment,
        summary,
        total: mentionsWithSentiment.length,
      },
      error: mentionsWithSentiment.length === 0 ? '未找到相关提及' : undefined,
      meta: {
        platform: 'multi',
        count: mentionsWithSentiment.length,
        duration_ms: durationMs,
      },
    };
  }

  /**
   * 获取指定平台的提及
   */
  private async fetchPlatformMentions(
    platform: Platform,
    keyword: string,
    limit: number,
  ): Promise<Mention[]> {
    try {
      switch (platform) {
        case 'tiktok':
          return await this.fetchTikTokMentions(keyword, limit);
        case 'xhs':
          return await this.fetchXhsMentions(keyword, limit);
        case 'instagram':
          return await this.fetchInstagramMentions(keyword, limit);
        case 'twitter':
          return await this.fetchTwitterMentions(keyword, limit);
        default:
          logger.warn(`平台 ${platform} 暂不支持监听`);
          return [];
      }
    } catch (error) {
      logger.warn(`${platform} 提及获取失败`, { error: (error as Error).message });
      return [];
    }
  }

  /**
   * TikTok 提及
   * GET /tiktok/app/v3/search_item?keyword={keyword}&search_type=1&count={limit}&cursor=0
   */
  private async fetchTikTokMentions(keyword: string, limit: number): Promise<Mention[]> {
    const response = await tikhubClient.get<any>(
      '/tiktok/app/v3/search_item',
      { keyword, search_type: 1, count: Math.min(limit, 50), cursor: 0 },
      { useCache: true, cacheTtl: 300000 },
    );

    const items = this.extractList(response);
    return items.map((item: any) => this.normalizeTikTokMention(item)).filter((m): m is Mention => m !== null);
  }

  /**
   * 小红书提及
   * GET /xhs/app_v2/search_notes?keyword={keyword}
   */
  private async fetchXhsMentions(keyword: string, limit: number): Promise<Mention[]> {
    const response = await tikhubClient.get<any>(
      '/xhs/app_v2/search_notes',
      { keyword, page: 1, page_size: Math.min(limit, 50) },
      { useCache: true, cacheTtl: 300000 },
    );

    const items = this.extractList(response);
    return items.map((item: any) => this.normalizeXhsMention(item)).filter((m): m is Mention => m !== null);
  }

  /**
   * Instagram 提及（通过标签帖子）
   * GET /instagram/v2/fetch_hashtag_posts?id={tag_id}
   * 注：Instagram 不支持关键词搜索，需要先用 search_hashtags 获取 ID
   */
  private async fetchInstagramMentions(keyword: string, limit: number): Promise<Mention[]> {
    // 先搜索标签获取 ID
    const searchResponse = await tikhubClient.get<any>(
      '/instagram/v2/search_hashtags',
      { keyword },
      { useCache: true, cacheTtl: 600000 },
    );

    const tags = this.extractList(searchResponse);
    if (tags.length === 0) return [];

    const tagId = String(tags[0].id || tags[0].pk || '');
    if (!tagId) return [];

    // 用标签 ID 获取帖子
    const response = await tikhubClient.get<any>(
      '/instagram/v2/fetch_hashtag_posts',
      { id: tagId },
      { useCache: true, cacheTtl: 300000 },
    );

    const items = this.extractList(response).slice(0, limit);
    return items.map((item: any) => this.normalizeInstagramMention(item, keyword)).filter((m): m is Mention => m !== null);
  }

  /**
   * Twitter 提及
   * GET /twitter/web/search_v2?keyword={keyword}&search_type=1
   */
  private async fetchTwitterMentions(keyword: string, limit: number): Promise<Mention[]> {
    const response = await tikhubClient.get<any>(
      '/twitter/web/search_v2',
      { keyword, search_type: 1, count: Math.min(limit, 50), cursor: 0 },
      { useCache: true, cacheTtl: 300000 },
    );

    const items = this.extractList(response);
    return items.map((item: any) => this.normalizeTwitterMention(item)).filter((m): m is Mention => m !== null);
  }

  // ============================================================
  // 标准化方法
  // ============================================================

  /** 标准化 TikTok 提及 */
  private normalizeTikTokMention(item: any): Mention | null {
    if (!item) return null;
    const stats = item.stats || item.statistics || {};
    const author = item.author || item.userInfo || {};
    const post: StandardPost = {
      id: String(item.video_id || item.aweme_id || item.id || ''),
      platform: 'tiktok',
      author: {
        id: String(author.id || author.uid || author.secUid || author.sec_uid || ''),
        username: String(author.uniqueId || author.unique_id || author.username || ''),
        displayName: String(author.nickname || author.displayName || author.display_name || ''),
        avatar: String(author.avatar || author.avatarUrl || author.avatar_url || ''),
        followerCount: this.safeNumber(author.followerCount || author.follower_count || author.followers || 0),
        platform: 'tiktok',
      },
      caption: String(item.desc || item.caption || item.title || ''),
      description: String(item.desc || item.caption || ''),
      url: item.share_url || item.video?.url || '',
      thumbnail: item.video?.cover || item.video?.origin_cover || item.cover || '',
      createdAt: String(item.create_time ? new Date(item.create_time * 1000).toISOString() : new Date().toISOString()),
      metrics: {
        likes: this.safeNumber(stats.diggCount || stats.like_count || stats.likes || 0),
        comments: this.safeNumber(stats.commentCount || stats.comment_count || stats.comments || 0),
        shares: this.safeNumber(stats.shareCount || stats.share_count || stats.shares || 0),
        views: this.safeNumber(stats.playCount || stats.view_count || stats.views || 0),
      },
    };
    const content = post.caption + ' ' + post.description;
    const sentiment = analyzeSentiment(content);
    return {
      id: post.id,
      platform: 'tiktok',
      author: post.author,
      content,
      url: post.url,
      thumbnail: post.thumbnail,
      publishedAt: post.createdAt,
      metrics: post.metrics,
      sentiment: sentiment.type,
      sentimentScore: sentiment.score,
      post,
    };
  }

  /** 标准化小红书提及 */
  private normalizeXhsMention(item: any): Mention | null {
    if (!item) return null;
    const interactInfo = item.interact_info || item.interaction || {};
    const user = item.user || {};
    const post: StandardPost = {
      id: String(item.note_id || item.id || ''),
      platform: 'xhs',
      author: {
        id: String(user.user_id || user.id || ''),
        username: String(user.nickname || user.name || ''),
        displayName: String(user.nickname || user.name || ''),
        avatar: String(user.avatar || ''),
        followerCount: this.safeNumber(user.fans || user.follower_count || 0),
        platform: 'xhs',
      },
      caption: String(item.title || ''),
      description: String(item.desc || item.content || ''),
      url: item.note_url || `https://www.xiaohongshu.com/explore/${item.note_id || item.id || ''}`,
      thumbnail: item.cover?.url || item.image_url || '',
      createdAt: String(item.time ? new Date(item.time * 1000).toISOString() : new Date().toISOString()),
      metrics: {
        likes: this.safeNumber(interactInfo.liked_count || item.liked_count || 0),
        comments: this.safeNumber(interactInfo.comment_count || item.comment_count || 0),
        shares: this.safeNumber(interactInfo.shared_count || item.share_count || 0),
        views: this.safeNumber(interactInfo.view_count || item.exposure || 0),
      },
    };
    const content = post.caption + ' ' + post.description;
    const sentiment = analyzeSentiment(content);
    return {
      id: post.id,
      platform: 'xhs',
      author: post.author,
      content,
      url: post.url,
      thumbnail: post.thumbnail,
      publishedAt: post.createdAt,
      metrics: post.metrics,
      sentiment: sentiment.type,
      sentimentScore: sentiment.score,
      post,
    };
  }

  /** 标准化 Instagram 提及 */
  private normalizeInstagramMention(item: any, keyword: string): Mention | null {
    if (!item) return null;
    const user = item.user || item.caption?.user || {};
    const post: StandardPost = {
      id: String(item.id || item.pk || ''),
      platform: 'instagram',
      author: {
        id: String(user.pk || user.id || ''),
        username: String(user.username || ''),
        displayName: String(user.full_name || user.username || ''),
        avatar: String(user.profile_pic_url || ''),
        followerCount: this.safeNumber(user.follower_count || 0),
        platform: 'instagram',
      },
      caption: String(item.caption?.text || item.caption || ''),
      description: String(item.caption?.text || ''),
      url: item.permalink || item.shortcode ? `https://www.instagram.com/p/${item.shortcode}/` : '',
      thumbnail: item.thumbnail_url || item.media_url || item.image_url || '',
      createdAt: String(item.taken_at ? new Date(item.taken_at * 1000).toISOString() : new Date().toISOString()),
      metrics: {
        likes: this.safeNumber(item.like_count || item.likes || 0),
        comments: this.safeNumber(item.comment_count || item.comments || 0),
        shares: 0,
        views: this.safeNumber(item.view_count || item.play_count || 0),
      },
    };
    const content = post.caption + ' ' + post.description;
    const sentiment = analyzeSentiment(content);
    return {
      id: post.id,
      platform: 'instagram',
      author: post.author,
      content,
      url: post.url,
      thumbnail: post.thumbnail,
      publishedAt: post.createdAt,
      metrics: post.metrics,
      sentiment: sentiment.type,
      sentimentScore: sentiment.score,
      post,
    };
  }

  /** 标准化 Twitter 提及 */
  private normalizeTwitterMention(item: any): Mention | null {
    if (!item) return null;
    const user = item.user || item.author || {};
    const metrics: EngagementMetrics = {
      likes: this.safeNumber(item.favorite_count || item.like_count || item.favorites || 0),
      comments: this.safeNumber(item.reply_count || item.replies || 0),
      shares: this.safeNumber(item.retweet_count || item.retweetCount || 0),
      views: this.safeNumber(item.view_count || item.views || 0),
    };
    const author: StandardAuthor = {
      id: String(user.id || user.id_str || ''),
      username: String(user.screen_name || item.screen_name || ''),
      displayName: String(user.name || ''),
      avatar: String(user.profile_image_url || user.profile_image_url_https || ''),
      followerCount: this.safeNumber(user.followers_count || 0),
      platform: 'twitter',
    };
    const content = String(item.text || item.content || item.full_text || '');
    const sentiment = analyzeSentiment(content);
    return {
      id: String(item.id || item.tweet_id || item.id_str || ''),
      platform: 'twitter',
      author,
      content,
      url: item.url || (item.id ? `https://twitter.com/i/web/status/${item.id}` : ''),
      thumbnail: '',
      publishedAt: String(item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString()),
      metrics,
      sentiment: sentiment.type,
      sentimentScore: sentiment.score,
      post: {
        id: String(item.id || item.tweet_id || item.id_str || ''),
        platform: 'twitter',
        author,
        caption: content,
        description: content,
        url: item.url || (item.id ? `https://twitter.com/i/web/status/${item.id}` : ''),
        thumbnail: '',
        createdAt: String(item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString()),
        metrics,
      },
    };
  }

  // ============================================================
  // 摘要生成
  // ============================================================

  /** 生成监听摘要 */
  private generateSummary(mentions: Mention[], keyword: string): ListeningSummary {
    const totalMentions = mentions.length;
    const platformCounts: Record<string, number> = {};
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    let totalEngagement = 0;

    mentions.forEach((m) => {
      platformCounts[m.platform] = (platformCounts[m.platform] || 0) + 1;
      if (m.sentiment === 'positive') positiveCount++;
      else if (m.sentiment === 'negative') negativeCount++;
      else neutralCount++;
      totalEngagement += m.metrics.likes + m.metrics.comments + m.metrics.shares;
    });

    const sentimentDistribution = {
      positive: positiveCount,
      negative: negativeCount,
      neutral: neutralCount,
    };

    const sentimentScore =
      totalMentions > 0
        ? Math.round(((positiveCount - negativeCount) / totalMentions) * 100)
        : 0;

    const topMentions = [...mentions]
      .sort((a, b) => {
        const aEng = a.metrics.likes + a.metrics.comments + a.metrics.shares;
        const bEng = b.metrics.likes + b.metrics.comments + b.metrics.shares;
        return bEng - aEng;
      })
      .slice(0, 10);

    return {
      keyword,
      totalMentions,
      platformBreakdown: platformCounts,
      sentimentDistribution,
      sentimentScore,
      averageEngagement: totalMentions > 0 ? Math.round(totalEngagement / totalMentions) : 0,
      topMentions,
    };
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /** 从响应中提取列表 */
  private extractList(response: any): any[] {
    if (!response) return [];
    if (Array.isArray(response)) return response;

    const directKeys = [
      'data', 'list', 'items', 'medias', 'notes',
      'aweme_list', 'video_list', 'tweets', 'statuses',
    ];
    for (const key of directKeys) {
      if (Array.isArray(response[key])) return response[key];
    }

    const dataObj = response.data;
    if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
      const nestedKeys = [
        'list', 'items', 'medias', 'notes',
        'aweme_list', 'video_list', 'tweets', 'statuses',
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

  /** 去重 */
  private deduplicateMentions(mentions: Mention[]): Mention[] {
    const seen = new Set<string>();
    const result: Mention[] = [];
    for (const m of mentions) {
      const key = m.url || m.id;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(m);
      }
    }
    return result;
  }

  /** 安全转数字 */
  private safeNumber(value: unknown): number {
    if (value === undefined || value === null) return 0;
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }
}

export const listeningService = new ListeningService();
export default listeningService;
