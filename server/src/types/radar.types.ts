/**
 * Social Radar - 全局类型定义
 * 从 social-radar 项目迁移，用于 TikHub API 多平台趋势/标签/社交聆听/竞品分析
 */

// ============================================================
// 平台枚举
// ============================================================

export type Platform =
  | 'tiktok'
  | 'douyin'
  | 'instagram'
  | 'twitter'
  | 'youtube'
  | 'xhs';

export const ALL_PLATFORMS: Platform[] = [
  'tiktok',
  'douyin',
  'instagram',
  'twitter',
  'youtube',
  'xhs',
];

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  douyin: '抖音',
  instagram: 'Instagram',
  twitter: 'Twitter/X',
  youtube: 'YouTube',
  xhs: '小红书',
};

// ============================================================
// 统一 API 响应格式
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
  meta?: ResponseMeta;
}

export interface ResponseMeta {
  platform?: Platform | 'multi';
  count?: number;
  cached?: boolean;
  duration_ms?: number;
  cost_estimate?: number;
  [key: string]: unknown;
}

// ============================================================
// 通用标准化数据结构
// ============================================================

/** 标准化的互动数据 */
export interface EngagementMetrics {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}

/** 标准化的帖子/视频内容 */
export interface StandardPost {
  id: string;
  platform: Platform;
  author: StandardAuthor;
  caption: string;
  description: string;
  url: string;
  thumbnail: string;
  createdAt: string;
  metrics: EngagementMetrics;
}

/** 标准化的作者信息 */
export interface StandardAuthor {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  followerCount: number;
  platform: Platform;
}

// ============================================================
// 趋势模块类型 (TrendService)
// ============================================================

export interface TrendItem {
  id: string;
  platform: Platform;
  type: 'hashtag' | 'music' | 'topic' | 'keyword';
  name: string;
  rank: number;
  growth?: number;
  viewCount?: number;
  postCount?: number;
  url?: string;
  raw?: unknown;
}

export interface TrendResult {
  platform: Platform;
  trends: TrendItem[];
  fetchedAt: string;
}

export interface TrendQueryParams {
  platform?: Platform | 'all';
  country?: string;
  period?: number;
}

// ============================================================
// 标签模块类型 (HashtagService)
// ============================================================

export interface HashtagData {
  id: string;
  platform: Platform;
  name: string;
  viewCount: number;
  postCount: number;
  trending: boolean;
  relatedHashtags: RelatedHashtag[];
  topPosts: StandardPost[];
  raw?: unknown;
}

export interface RelatedHashtag {
  id: string;
  name: string;
  viewCount: number;
}

export interface HashtagSearchResult {
  query: string;
  results: HashtagData[];
}

// ============================================================
// 舆情模块类型 (ListeningService)
// ============================================================

export type SentimentType = 'positive' | 'negative' | 'neutral';
export type SentimentLabel = SentimentType;

export interface Mention {
  id: string;
  platform: Platform;
  author: StandardAuthor;
  content: string;
  url: string;
  publishedAt?: string;
  createdAt?: string;
  thumbnail?: string;
  metrics: EngagementMetrics;
  sentiment: SentimentType;
  sentimentScore: number;
  topics?: string[];
  post?: StandardPost;
}

export interface TopicCluster {
  topic: string;
  count: number;
  mentions: Mention[];
  sentimentBreakdown: SentimentBreakdown;
}

export interface SentimentBreakdown {
  positive: number;
  negative: number;
  neutral: number;
}

export interface ListeningResult {
  keyword: string;
  query?: string;
  totalMentions?: number;
  total?: number;
  mentions: Mention[];
  sentimentBreakdown?: SentimentBreakdown;
  summary?: ListeningSummary;
  topicClusters?: TopicCluster[];
  platforms: Platform[];
}

export interface ListeningSummary {
  keyword: string;
  totalMentions: number;
  platformBreakdown: Record<string, number>;
  sentimentDistribution: SentimentBreakdown;
  sentimentScore: number;
  averageEngagement: number;
  topMentions: Mention[];
}

export interface ListeningQuery {
  keyword: string;
  platforms: Platform[];
  limit: number;
}

// ============================================================
// 竞品模块类型 (CompetitorService)
// ============================================================

export interface CompetitorProfile {
  platform: Platform;
  id?: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  engagementRate?: number;
  avgEngagement?: number;
  medianEngagement?: number;
  postingFrequency?: PostingFrequency;
  topPosts?: StandardPost[];
  recentPosts?: StandardPost[];
  // 兼容 social-radar 原始字段名（迁移代码使用）
  followers?: number;
  following?: number;
  posts?: number;
  engagement?: number;
  raw?: unknown;
}

export interface PostingFrequency {
  postsPerWeek: number;
  avgHoursBetweenPosts: number;
  lastPostAt: string | null;
}

export interface AccountIdentifier {
  platform: Platform;
  handle: string;
  username?: string;
}

export interface CompetitorAnalysis {
  profiles: CompetitorProfile[];
  comparison: CompetitorComparison;
  errors?: Array<{ account: AccountIdentifier; error: string }>;
}

export interface CompetitorResult {
  accounts: CompetitorProfile[];
  comparison: CompetitorComparison;
}

export interface CompetitorComparison {
  totalFollowers?: number;
  avgEngagementRate?: number;
  topAccount?: {
    platform: Platform;
    username: string;
    metric: string;
    value: number;
  } | null;
  rankedByFollowers?: RankedAccount[];
  rankedByEngagement?: RankedAccount[];
  // 兼容 social-radar 原始结构（迁移代码使用）
  rankings?: {
    followers: Array<{ rank: number; username: string; value: number }>;
    engagement: Array<{ rank: number; username: string; value: number }>;
    posts: Array<{ rank: number; username: string; value: number }>;
  };
  averages?: {
    followers: number;
    engagement: number;
    posts: number;
  };
  insights?: string[];
}

export interface RankedAccount {
  platform: Platform;
  username: string;
  value: number;
}

export interface CompetitorQuery {
  accounts: Array<{
    platform: Platform;
    handle: string;
  }>;
}

// ============================================================
// TikHub API 相关类型
// ============================================================

export interface TikhubErrorResponse {
  status_code: number;
  message: string;
  data: unknown;
}

export interface TikhubConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  retries: number;
}

export interface CostEstimate {
  endpoint: string;
  estimatedCost: number;
  currency: string;
}

export interface DailyUsage {
  balance: number;
  usedToday: number;
  limit: number;
  // TikHub 可能返回的额外字段
  email?: string;
  costToday?: number;
  requestsToday?: number;
  // 原始数据兜底
  [key: string]: unknown;
}

// ============================================================
// 缓存类型
// ============================================================

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// ============================================================
// 错误类型
// ============================================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class TikhubApiError extends AppError {
  constructor(message: string, statusCode: number, details?: unknown) {
    super(message, statusCode, 'TIKHUB_API_ERROR', details);
    this.name = 'TikhubApiError';
  }
}
