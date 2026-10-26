/**
 * 趋势模块服务
 * 调用 TikHub 趋势相关端点，将数据标准化为统一排序列表
 *
 * 支持的端点：
 * - TikTok 热门趋势: GET /tiktok/ads/get_popular_trends
 * - TikTok 热门标签: GET /tiktok/ads/get_trends_hashtag_list
 * - TikTok 热门音乐: GET /tiktok/ads/get_sound_rank_list
 * - Twitter 热门话题: GET /twitter/web/fetch_trending
 *
 * 从 social-radar 项目迁移，使用 radar 前缀避免与 content-ops-hub 已有 trend.service.ts 冲突
 * 文件名遵循 content-ops-hub 的 kebab-case 约定
 */

import tikhubClient from './tikhub-client';
import { createServiceLogger } from '../utils/logger';
import type {
  ApiResponse,
  TrendItem,
  TrendResult,
  TrendQueryParams,
  Platform,
} from '../types/radar.types';

const logger = createServiceLogger('radar-trend');

export class TrendService {
  /**
   * 获取趋势数据
   * @param params 查询参数: platform, country, period
   */
  async getTrends(params: TrendQueryParams): Promise<ApiResponse<TrendResult[]>> {
    const startTime = Date.now();
    const platform = params.platform || 'all';
    const country = params.country || 'US';
    const period = params.period || 7;

    logger.info('趋势服务启动', { platform, country, period });

    const tasks: Promise<TrendResult | null>[] = [];

    if (platform === 'all' || platform === 'tiktok') {
      tasks.push(this.getTikTokPopularTrends(period, country));
      tasks.push(this.getTikTokHashtagTrends());
      tasks.push(this.getTikTokSoundRank());
    }

    if (platform === 'all' || platform === 'twitter') {
      tasks.push(this.getTwitterTrending(country));
    }

    const results = await Promise.allSettled(tasks);

    const trends: TrendResult[] = [];
    let totalItems = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        trends.push(result.value);
        totalItems += result.value.trends.length;
      } else if (result.status === 'rejected') {
        const taskNames = ['TikTok热门趋势', 'TikTok热门标签', 'TikTok热门音乐', 'Twitter热门话题'];
        logger.warn(`${taskNames[index] || '趋势任务'}获取失败`, {
          error: (result.reason as Error)?.message,
        });
      }
    });

    const durationMs = Date.now() - startTime;

    return {
      success: trends.length > 0,
      data: trends,
      error: trends.length === 0 ? '所有趋势数据源均获取失败' : undefined,
      meta: {
        platform: 'multi',
        count: totalItems,
        duration_ms: durationMs,
        cached: false,
      },
    };
  }

  /**
   * TikTok 热门趋势
   * GET /tiktok/ads/get_popular_trends?period=7&country_code=US
   */
  async getTikTokPopularTrends(period: number, countryCode: string): Promise<TrendResult> {
    const response = await tikhubClient.get<any>(
      '/tiktok/ads/get_popular_trends',
      { period, country_code: countryCode },
      { useCache: true, cacheTtl: 600000 },
    );

    const trends = this.normalizeTikTokPopularTrends(response);
    trends.sort((a, b) => (b.growth || 0) - (a.growth || 0));

    logger.info(`TikTok热门趋势获取成功: ${trends.length} 条`);

    return {
      platform: 'tiktok',
      trends,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * TikTok 热门标签
   * GET /tiktok/ads/get_trends_hashtag_list
   */
  async getTikTokHashtagTrends(): Promise<TrendResult> {
    const response = await tikhubClient.get<any>(
      '/tiktok/ads/get_trends_hashtag_list',
      undefined,
      { useCache: true, cacheTtl: 600000 },
    );

    const trends = this.normalizeTikTokHashtagTrends(response);
    trends.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));

    logger.info(`TikTok热门标签获取成功: ${trends.length} 条`);

    return {
      platform: 'tiktok',
      trends,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * TikTok 热门音乐
   * GET /tiktok/ads/get_sound_rank_list
   */
  async getTikTokSoundRank(): Promise<TrendResult> {
    const response = await tikhubClient.get<any>(
      '/tiktok/ads/get_sound_rank_list',
      undefined,
      { useCache: true, cacheTtl: 600000 },
    );

    const trends = this.normalizeTikTokSoundRank(response);
    trends.sort((a, b) => a.rank - b.rank);

    logger.info(`TikTok热门音乐获取成功: ${trends.length} 条`);

    return {
      platform: 'tiktok',
      trends,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Twitter 热门话题
   * GET /twitter/web/fetch_trending?country=japan
   */
  async getTwitterTrending(country: string): Promise<TrendResult> {
    const response = await tikhubClient.get<any>(
      '/twitter/web/fetch_trending',
      { country },
      { useCache: true, cacheTtl: 600000 },
    );

    const trends = this.normalizeTwitterTrending(response, country);
    trends.sort((a, b) => (b.postCount || 0) - (a.postCount || 0));

    logger.info(`Twitter热门话题获取成功: ${trends.length} 条 (country=${country})`);

    return {
      platform: 'twitter',
      trends,
      fetchedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // 数据标准化方法
  // ============================================================

  /** 标准化 TikTok 热门趋势数据 */
  private normalizeTikTokPopularTrends(response: any): TrendItem[] {
    const items = this.extractList(response);
    return items.map((item: any, index: number) => ({
      id: String(item.trendId || item.trend_id || item.id || `tt_popular_${index}`),
      platform: 'tiktok' as Platform,
      type: 'keyword' as const,
      name: String(item.trendName || item.trend_name || item.name || item.keyword || `趋势#${index + 1}`),
      rank: index + 1,
      growth: this.safeNumber(item.growthRate || item.growth_rate || item.growth || item.riseRate || item.rise_rate),
      viewCount: this.safeNumber(item.videoViews || item.video_views || item.view_count || item.views),
      postCount: this.safeNumber(item.videoCount || item.video_count || item.post_count || item.videos),
      raw: item,
    }));
  }

  /** 标准化 TikTok 热门标签数据 */
  private normalizeTikTokHashtagTrends(response: any): TrendItem[] {
    const items = this.extractList(response);
    return items.map((item: any, index: number) => ({
      id: String(item.hashtagID || item.hashtag_id || item.challengeId || item.challenge_id || item.id || `tt_hashtag_${index}`),
      platform: 'tiktok' as Platform,
      type: 'hashtag' as const,
      name: String(item.hashtagName || item.hashtag_name || item.challengeName || item.challenge_name || item.name || `#${index + 1}`),
      rank: this.safeNumber(item.rankIndex) || index + 1,
      viewCount: this.safeNumber(item.publishCnt || item.view_count || item.views || item.view_count_value),
      postCount: this.safeNumber(item.publishCnt || item.user_count || item.post_count || item.video_count),
      url: item.url || item.shareUrl || undefined,
      raw: item,
    }));
  }

  /** 标准化 TikTok 热门音乐数据 */
  private normalizeTikTokSoundRank(response: any): TrendItem[] {
    const items = this.extractList(response);
    return items.map((item: any, index: number) => ({
      id: String(item.soundId || item.sound_id || item.musicId || item.music_id || item.id || `tt_sound_${index}`),
      platform: 'tiktok' as Platform,
      type: 'music' as const,
      name: String(item.soundName || item.sound_name || item.musicName || item.music_name || item.title || item.author || `音乐#${index + 1}`),
      rank: this.safeNumber(item.rankIndex || item.rank) || index + 1,
      viewCount: this.safeNumber(item.playCount || item.play_count || item.view_count || item.views),
      postCount: this.safeNumber(item.videoCount || item.video_count || item.post_count || item.useCount || item.use_count),
      url: item.playUrl || item.play_url || item.musicUrl || item.music_url || undefined,
      raw: item,
    }));
  }

  /** 标准化 Twitter 热门话题数据 */
  private normalizeTwitterTrending(response: any, country: string): TrendItem[] {
    const items = this.extractList(response);
    return items.map((item: any, index: number) => ({
      id: String(item.name || item.trend_name || item.url || `tw_trend_${index}`),
      platform: 'twitter' as Platform,
      type: 'topic' as const,
      name: String(item.name || item.trend_name || `话题#${index + 1}`),
      rank: index + 1,
      postCount: this.safeNumber(item.tweet_volume || item.volume || item.tweets),
      url: item.url || undefined,
      raw: item,
    }));
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /** 从 TikHub 响应中提取列表数据（兼容 camelCase / snake_case / 多种嵌套结构） */
  private extractList(response: any): any[] {
    if (!response) return [];
    if (Array.isArray(response)) return response;

    // 直接数组属性（snake_case + camelCase）
    const directKeys = [
      'data', 'list', 'items', 'trends', 'results',
      'hashtagList', 'trendList', 'soundList', 'musicList', 'rankList',
      'aweme_list', 'rank_list', 'video_list',
    ];
    for (const key of directKeys) {
      if (Array.isArray(response[key])) return response[key];
    }

    // 嵌套在 data 对象中
    const dataObj = response.data;
    if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
      const nestedKeys = [
        'list', 'items', 'trends', 'results',
        'hashtagList', 'trendList', 'soundList', 'musicList', 'rankList',
        'aweme_list', 'rank_list', 'video_list',
      ];
      for (const key of nestedKeys) {
        if (Array.isArray(dataObj[key])) return dataObj[key];
      }
      // 兜底：在 data 对象中找第一个数组属性
      for (const key of Object.keys(dataObj)) {
        if (Array.isArray(dataObj[key]) && dataObj[key].length > 0) return dataObj[key];
      }
    }

    // 兜底：在响应中找第一个数组属性
    for (const key of Object.keys(response)) {
      if (Array.isArray(response[key]) && response[key].length > 0) return response[key];
    }

    return [];
  }

  /** 安全转数字 */
  private safeNumber(value: unknown): number {
    if (value === undefined || value === null) return 0;
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }
}

export const trendService = new TrendService();
export default trendService;
