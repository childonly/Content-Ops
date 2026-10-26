/**
 * 竞品分析模块服务
 * 比较多个账号在各平台的表现
 *
 * 支持的平台：
 * - TikTok: /tiktok/app/v3/user/info + /tiktok/app/v3/user/videos
 * - Instagram: /instagram/v2/user/info + /instagram/v2/user/media
 * - 小红书: /xhs/app_v2/user/info + /xhs/app_v2/user/notes
 * - Twitter: /twitter/user/info + /twitter/user/tweets
 *
 * 从 social-radar 项目迁移
 * 文件名遵循 content-ops-hub 的 kebab-case 约定
 */

import tikhubClient from './tikhub-client';
import { createServiceLogger } from '../utils/logger';
import type {
  ApiResponse,
  CompetitorAnalysis,
  CompetitorProfile,
  AccountIdentifier,
  CompetitorQuery,
  Platform,
  EngagementMetrics,
  StandardPost,
  StandardAuthor,
} from '../types/radar.types';

const logger = createServiceLogger('radar-competitor');

export class CompetitorService {
  /**
   * 竞品分析主入口
   * @param query 查询对象，包含 accounts 账号标识列表
   */
  async analyzeCompetitors(
    query: CompetitorQuery,
  ): Promise<ApiResponse<CompetitorAnalysis>> {
    const startTime = Date.now();
    const accounts = query.accounts;

    if (!accounts || accounts.length === 0) {
      return {
        success: false,
        data: {} as CompetitorAnalysis,
        error: '账号列表不能为空',
      };
    }

    logger.info('竞品分析启动', { accountCount: accounts.length });

    // 并发获取各账号资料和最近内容
    const tasks = accounts.map((account) =>
      this.fetchCompetitorProfile(account).then(
        (profile) => ({ account, profile, error: null as string | null }),
        (error) => ({ account, profile: null, error: (error as Error).message }),
      ),
    );

    const results = await Promise.all(tasks);

    const profiles: CompetitorProfile[] = [];
    const errors: Array<{ account: AccountIdentifier; error: string }> = [];

    results.forEach((result) => {
      if (result.profile) {
        profiles.push(result.profile);
      } else {
        errors.push({
          account: result.account,
          error: result.error || '未知错误',
        });
        logger.warn(`账号 ${result.account.handle || '未知'} 获取失败`, { error: result.error });
      }
    });

    // 排序：按粉丝数降序
    profiles.sort((a, b) => (b.followers || 0) - (a.followers || 0));

    // 生成对比分析
    const comparison = this.generateComparison(profiles);

    const durationMs = Date.now() - startTime;

    return {
      success: profiles.length > 0,
      data: {
        profiles,
        comparison,
        errors: errors.length > 0 ? errors : undefined,
      },
      error: profiles.length === 0 ? '所有账号获取失败' : undefined,
      meta: {
        platform: 'multi',
        count: profiles.length,
        duration_ms: durationMs,
      },
    };
  }

  /**
   * 获取单个竞品账号的完整资料
   */
  private async fetchCompetitorProfile(
    account: AccountIdentifier,
  ): Promise<CompetitorProfile> {
    // handle 是必填字段（sec_uid / username / screen_name 等），优先使用
    const username = account.username || account.handle;
    switch (account.platform) {
      case 'tiktok':
        return await this.fetchTikTokProfile(username);
      case 'instagram':
        return await this.fetchInstagramProfile(username);
      case 'xhs':
        return await this.fetchXhsProfile(username);
      case 'twitter':
        return await this.fetchTwitterProfile(username);
      default:
        throw new Error(`平台 ${account.platform} 暂不支持竞品分析`);
    }
  }

  // ============================================================
  // TikTok 竞品
  // ============================================================

  private async fetchTikTokProfile(username: string): Promise<CompetitorProfile> {
    // 获取用户信息
    const userInfo = await tikhubClient.get<any>(
      '/tiktok/app/v3/user/info',
      { username },
      { useCache: true, cacheTtl: 600000 },
    );

    const user = this.extractObject(userInfo);
    const stats = user.stats || user.statistics || {};

    // 获取最近视频
    const videosResponse = await tikhubClient.get<any>(
      '/tiktok/app/v3/user/videos',
      { secUid: user.secUid || user.sec_uid || user.uid || user.id, count: 20, cursor: 0 },
      { useCache: true, cacheTtl: 300000 },
    );

    const videos = this.extractList(videosResponse);
    const recentPosts: StandardPost[] = videos
      .map((v: any) => this.normalizeTikTokPost(v))
      .filter((p): p is StandardPost => p !== null);

    return {
      platform: 'tiktok',
      username,
      displayName: String(user.nickname || user.uniqueId || user.unique_id || username),
      avatar: String(user.avatar || user.avatarUrl || user.avatar_url || ''),
      bio: String(user.signature || user.bio || ''),
      followers: this.safeNumber(stats.followerCount || stats.follower_count || user.follower_count || 0),
      following: this.safeNumber(stats.followingCount || stats.following_count || user.following_count || 0),
      posts: this.safeNumber(stats.videoCount || stats.video_count || user.aweme_count || 0),
      engagement: this.calculateEngagement(recentPosts),
      recentPosts,
      raw: user,
    };
  }

  // ============================================================
  // Instagram 竞品
  // ============================================================

  private async fetchInstagramProfile(username: string): Promise<CompetitorProfile> {
    const userInfo = await tikhubClient.get<any>(
      '/instagram/v2/user/info',
      { username },
      { useCache: true, cacheTtl: 600000 },
    );

    const user = this.extractObject(userInfo);
    const edgeFollowed = user.edge_followed_by || {};
    const edgeFollow = user.edge_follow || {};
    const edgeOwnerToTimelineMedia = user.edge_owner_to_timeline_media || {};

    // 获取最近帖子
    const mediaResponse = await tikhubClient.get<any>(
      '/instagram/v2/user/media',
      { username },
      { useCache: true, cacheTtl: 300000 },
    );

    const media = this.extractList(mediaResponse);
    const recentPosts: StandardPost[] = media
      .map((m: any) => this.normalizeInstagramPost(m))
      .filter((p): p is StandardPost => p !== null);

    return {
      platform: 'instagram',
      username,
      displayName: String(user.full_name || user.username || username),
      avatar: String(user.profile_pic_url || ''),
      bio: String(user.biography || ''),
      followers: this.safeNumber(edgeFollowed.count || user.follower_count || 0),
      following: this.safeNumber(edgeFollow.count || user.following_count || 0),
      posts: this.safeNumber(edgeOwnerToTimelineMedia.count || user.media_count || 0),
      engagement: this.calculateEngagement(recentPosts),
      recentPosts,
      raw: user,
    };
  }

  // ============================================================
  // 小红书竞品
  // ============================================================

  private async fetchXhsProfile(username: string): Promise<CompetitorProfile> {
    const userInfo = await tikhubClient.get<any>(
      '/xhs/app_v2/user/info',
      { username },
      { useCache: true, cacheTtl: 600000 },
    );

    const user = this.extractObject(userInfo);
    const interact = user.interact_info || user.interaction || {};

    // 获取最近笔记
    const notesResponse = await tikhubClient.get<any>(
      '/xhs/app_v2/user/notes',
      { user_id: user.user_id || user.id, count: 20 },
      { useCache: true, cacheTtl: 300000 },
    );

    const notes = this.extractList(notesResponse);
    const recentPosts: StandardPost[] = notes
      .map((n: any) => this.normalizeXhsPost(n))
      .filter((p): p is StandardPost => p !== null);

    return {
      platform: 'xhs',
      username,
      displayName: String(user.nickname || user.name || username),
      avatar: String(user.avatar || ''),
      bio: String(user.desc || user.description || ''),
      followers: this.safeNumber(interact.fans || user.fans || user.follower_count || 0),
      following: this.safeNumber(interact.follows || user.follows || user.following_count || 0),
      posts: this.safeNumber(interact.note_count || user.note_count || user.notes || 0),
      engagement: this.calculateEngagement(recentPosts),
      recentPosts,
      raw: user,
    };
  }

  // ============================================================
  // Twitter 竞品
  // ============================================================

  private async fetchTwitterProfile(username: string): Promise<CompetitorProfile> {
    const userInfo = await tikhubClient.get<any>(
      '/twitter/user/info',
      { username },
      { useCache: true, cacheTtl: 600000 },
    );

    const user = this.extractObject(userInfo);

    // 获取最近推文
    const tweetsResponse = await tikhubClient.get<any>(
      '/twitter/user/tweets',
      { username, count: 20 },
      { useCache: true, cacheTtl: 300000 },
    );

    const tweets = this.extractList(tweetsResponse);
    const recentPosts: StandardPost[] = tweets
      .map((t: any) => this.normalizeTwitterPost(t))
      .filter((p): p is StandardPost => p !== null);

    return {
      platform: 'twitter',
      username,
      displayName: String(user.name || user.screen_name || username),
      avatar: String(user.profile_image_url || user.profile_image_url_https || ''),
      bio: String(user.description || ''),
      followers: this.safeNumber(user.followers_count || 0),
      following: this.safeNumber(user.friends_count || user.following_count || 0),
      posts: this.safeNumber(user.statuses_count || user.tweet_count || 0),
      engagement: this.calculateEngagement(recentPosts),
      recentPosts,
      raw: user,
    };
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
      likes: this.safeNumber(item.like_count || item.likes || (item.edge_media_preview_like?.count) || 0),
      comments: this.safeNumber(item.comment_count || item.comments || (item.edge_media_to_comment?.count) || 0),
      shares: 0,
      views: this.safeNumber(item.view_count || item.play_count || (item.video_view_count) || 0),
    };
    const user = item.user || item.owner || {};
    const standardAuthor: StandardAuthor = {
      id: String(user.pk || user.id || user.id_str || ''),
      username: String(user.username || item.owner?.username || ''),
      displayName: String(user.full_name || user.username || ''),
      avatar: String(user.profile_pic_url || ''),
      followerCount: this.safeNumber(user.follower_count || 0),
      platform: 'instagram',
    };
    return {
      id: String(item.id || item.pk || ''),
      platform: 'instagram',
      author: standardAuthor,
      caption: String(item.caption?.text || item.caption || item.edge_media_to_caption?.edges?.[0]?.node?.text || ''),
      description: String(item.caption?.text || ''),
      url: item.permalink || item.shortcode ? `https://www.instagram.com/p/${item.shortcode}/` : '',
      thumbnail: item.thumbnail_url || item.media_url || item.image_url || item.display_url || '',
      createdAt: String(item.taken_at ? new Date(item.taken_at * 1000).toISOString() : (item.taken_at_timestamp ? new Date(item.taken_at_timestamp * 1000).toISOString() : new Date().toISOString())),
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

  /** 标准化 Twitter 帖子 */
  private normalizeTwitterPost(item: any): StandardPost | null {
    if (!item) return null;
    const user = item.user || item.author || {};
    const metrics: EngagementMetrics = {
      likes: this.safeNumber(item.favorite_count || item.like_count || item.favorites || 0),
      comments: this.safeNumber(item.reply_count || item.replies || 0),
      shares: this.safeNumber(item.retweet_count || item.retweetCount || 0),
      views: this.safeNumber(item.view_count || item.views || 0),
    };
    const standardAuthor: StandardAuthor = {
      id: String(user.id || user.id_str || ''),
      username: String(user.screen_name || item.screen_name || ''),
      displayName: String(user.name || ''),
      avatar: String(user.profile_image_url || user.profile_image_url_https || ''),
      followerCount: this.safeNumber(user.followers_count || 0),
      platform: 'twitter',
    };
    const content = String(item.text || item.content || item.full_text || '');
    return {
      id: String(item.id || item.tweet_id || item.id_str || ''),
      platform: 'twitter',
      author: standardAuthor,
      caption: content,
      description: content,
      url: item.url || (item.id ? `https://twitter.com/i/web/status/${item.id}` : ''),
      thumbnail: '',
      createdAt: String(item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString()),
      metrics,
    };
  }

  // ============================================================
  // 对比分析
  // ============================================================

  /** 计算互动率 */
  private calculateEngagement(posts: StandardPost[]): number {
    if (posts.length === 0) return 0;
    const totalEngagement = posts.reduce((sum, p) => {
      return sum + p.metrics.likes + p.metrics.comments + p.metrics.shares;
    }, 0);
    const totalViews = posts.reduce((sum, p) => sum + (p.metrics.views || 0), 0);
    if (totalViews === 0) return 0;
    return Math.round((totalEngagement / totalViews) * 10000) / 100; // 百分比，保留两位小数
  }

  /** 生成对比分析 */
  private generateComparison(profiles: CompetitorProfile[]): CompetitorAnalysis['comparison'] {
    if (profiles.length === 0) {
      return {
        rankings: { followers: [], engagement: [], posts: [] },
        averages: { followers: 0, engagement: 0, posts: 0 },
        insights: [],
      };
    }

    const rankings = {
      followers: [...profiles].sort((a, b) => (b.followers || 0) - (a.followers || 0)).map((p, i) => ({ rank: i + 1, username: p.username, value: p.followers || 0 })),
      engagement: [...profiles].sort((a, b) => (b.engagement || 0) - (a.engagement || 0)).map((p, i) => ({ rank: i + 1, username: p.username, value: p.engagement || 0 })),
      posts: [...profiles].sort((a, b) => (b.posts || 0) - (a.posts || 0)).map((p, i) => ({ rank: i + 1, username: p.username, value: p.posts || 0 })),
    };

    const averages = {
      followers: Math.round(profiles.reduce((sum, p) => sum + (p.followers || 0), 0) / profiles.length),
      engagement: Math.round((profiles.reduce((sum, p) => sum + (p.engagement || 0), 0) / profiles.length) * 100) / 100,
      posts: Math.round(profiles.reduce((sum, p) => sum + (p.posts || 0), 0) / profiles.length),
    };

    const insights: string[] = [];
    const topFollower = rankings.followers[0];
    if (topFollower) {
      insights.push(`${topFollower.username} 粉丝数最多 (${this.formatNumber(topFollower.value)})`);
    }
    const topEngagement = rankings.engagement[0];
    if (topEngagement && topEngagement.value > 0) {
      insights.push(`${topEngagement.username} 互动率最高 (${topEngagement.value}%)`);
    }
    const topPosts = rankings.posts[0];
    if (topPosts) {
      insights.push(`${topPosts.username} 发布内容最多 (${this.formatNumber(topPosts.value)} 条)`);
    }

    return { rankings, averages, insights };
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
      'aweme_list', 'video_list', 'tweets', 'statuses', 'edges',
    ];
    for (const key of directKeys) {
      if (Array.isArray(response[key])) return response[key];
    }

    const dataObj = response.data;
    if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
      const nestedKeys = [
        'list', 'items', 'medias', 'notes',
        'aweme_list', 'video_list', 'tweets', 'statuses', 'edges',
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

  /** 从响应中提取对象 */
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

  /** 安全转数字 */
  private safeNumber(value: unknown): number {
    if (value === undefined || value === null) return 0;
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }

  /** 格式化数字 */
  private formatNumber(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
}

export const competitorService = new CompetitorService();
export default competitorService;
