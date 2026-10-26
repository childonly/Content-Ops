/**
 * Content Ops Hub - 核心类型定义
 * 定义整个项目的数据契约，前后端共享
 */

// ============================================================================
// Pipeline 相关
// ============================================================================

export enum PipelineStage {
  TREND_DISCOVERY = 'trend_discovery',
  HASHTAG_RESEARCH = 'hashtag_research',
  CONTENT_GENERATION = 'content_generation',
  PUBLISHING = 'publishing',
  PERFORMANCE_TRACKING = 'performance_tracking',
  ITERATION = 'iteration',
}

export enum PipelineStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum StageStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export interface PipelineStageRecord {
  stage: PipelineStage;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  errorMessage?: string;
}

export interface PipelineRun {
  id: number;
  status: PipelineStatus;
  currentStage: PipelineStage;
  trendId?: number;
  hashtagIds?: string;
  contentId?: number;
  publicationId?: number;
  analyticsId?: number;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  keyword?: string;
  pipelineType?: string;
  stages: PipelineStageRecord[];
}

// ============================================================================
// 技能 (Skill) 相关
// ============================================================================

export type SkillName =
  | 'trend-research'
  | 'hashtag-research'
  | 'xhs-content'
  | 'xiaohongshu-skill'
  | 'creator-analytics';

export interface SkillParams {
  [key: string]: any;
}

export interface SkillResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata: {
    duration: number;
    skillName: string;
    timestamp: string;
  };
}

export interface SkillBridge {
  invoke<T>(skillName: SkillName, params: SkillParams): Promise<SkillResult<T>>;
}

// ============================================================================
// 趋势 (Trend) 相关
// ============================================================================

export interface Trend {
  id: number;
  title: string;
  description: string;
  platform: string;
  category: string;
  heat: number;
  growthRate: number;
  status: 'new' | 'tracked' | 'archived';
  discoveredAt: string;
  metadata?: string;
}

export interface TrendDiscoveryParams {
  platform?: string;
  category?: string;
  limit?: number;
}

export interface TrendDiscoveryResult {
  trends: Trend[];
}

// ============================================================================
// 标签 (Hashtag) 相关
// ============================================================================

export interface Hashtag {
  id: number;
  tag: string;
  platform: string;
  volume: number;
  growthRate: number;
  relatedTags: string[];
  trendId?: number;
  researchedAt: string;
}

export interface HashtagResearchParams {
  keyword: string;
  platform?: string;
  trendId?: number;
  limit?: number;
}

export interface HashtagResearchResult {
  hashtags: Hashtag[];
}

// ============================================================================
// 内容 (Content) 相关
// ============================================================================

export interface Content {
  id: number;
  title: string;
  body: string;
  tags: string[];
  images: string[];
  trendId?: number;
  hashtagIds: string;
  status: 'draft' | 'reviewing' | 'approved' | 'published' | 'rejected';
  generatedAt: string;
  publishedAt?: string;
  isFavorited: boolean;
  favoritedAt?: string;
  groupName?: string;
  sortOrder?: number;
}

/** 统一内容条目 - 合并 contents 表和 drafts 表的统一视图 */
export interface UnifiedContent {
  id: number;
  title: string;
  tags: string[];
  images: string[];
  isFavorited: boolean;
  status: string;
  generatedAt: string;
  source: 'content_studio' | 'pipeline';
  groupName: string;
  sortOrder: number;
}

export interface ContentGenerationParams {
  trendId?: number;
  hashtagIds?: number[];
  keywords?: string[];
  style?: string;
  tone?: string;
}

export interface ContentGenerationResult {
  content: Content;
}

// ============================================================================
// 发布 (Publication) 相关
// ============================================================================

export interface Publication {
  id: number;
  contentId: number;
  platform: string;
  engine?: string;
  postUrl?: string;
  status: 'pending' | 'publishing' | 'published' | 'failed';
  scheduledAt?: string;
  publishedAt?: string;
  errorMessage?: string;
}

export interface PublishParams {
  contentId: number;
  platform?: string;
  scheduledAt?: string;
  engine?: string;
}

export interface PublishResult {
  publication: Publication;
}

// ============================================================================
// 分析 (Analytics) 相关
// ============================================================================

export interface AnalyticsRecord {
  id: number;
  publicationId: number;
  contentId: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collects: number;
  engagementRate: number;
  trackedAt: string;
  // 可选字段: 用于标识模拟数据和错误信息
  errorMessage?: string;
  isMockData?: boolean;
}

export interface AnalyticsTrackParams {
  publicationId: number;
  days?: number;
}

export interface AnalyticsTrackResult {
  analytics: AnalyticsRecord;
}

// ============================================================================
// API 通用响应
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// 仪表盘 (Dashboard) 相关
// ============================================================================

export interface DashboardStats {
  totalTrends: number;
  totalContents: number;
  totalPublications: number;
  totalViews: number;
  totalLikes: number;
  avgEngagementRate: number;
  activePipelines: number;
  completedPipelines: number;
}

export interface PipelineStageInfo {
  stage: PipelineStage;
  label: string;
  skillName: SkillName;
  description: string;
  icon: string;
}

export const PIPELINE_STAGES: PipelineStageInfo[] = [
  {
    stage: PipelineStage.TREND_DISCOVERY,
    label: '趋势发现',
    skillName: 'trend-research',
    description: '发现各平台热门趋势和话题',
    icon: 'TrendCharts',
  },
  {
    stage: PipelineStage.HASHTAG_RESEARCH,
    label: '标签研究',
    skillName: 'hashtag-research',
    description: '研究热门标签和相关标签',
    icon: 'Hashtag',
  },
  {
    stage: PipelineStage.CONTENT_GENERATION,
    label: '内容生成',
    skillName: 'xhs-content',
    description: '生成小红书风格图文笔记',
    icon: 'EditPen',
  },
  {
    stage: PipelineStage.PUBLISHING,
    label: '发布执行',
    skillName: 'xiaohongshu-skill',
    description: '通过 Playwright 发布到小红书',
    icon: 'Promotion',
  },
  {
    stage: PipelineStage.PERFORMANCE_TRACKING,
    label: '效果追踪',
    skillName: 'creator-analytics',
    description: '追踪互动数据和创作者表现',
    icon: 'DataAnalysis',
  },
  {
    stage: PipelineStage.ITERATION,
    label: '迭代优化',
    skillName: 'trend-research',
    description: '数据反馈到趋势发现，持续优化',
    icon: 'Refresh',
  },
];
