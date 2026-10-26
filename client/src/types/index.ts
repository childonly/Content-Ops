// ============================================================
// Content Ops Hub - 前端类型定义
// ============================================================

/** 平台类型 */
export type Platform = 'douyin' | 'xiaohongshu' | 'tiktok' | 'instagram' | 'twitter'

/** 趋势状态 */
export type TrendStatus = 'new' | 'tracked' | 'archived'

/** 内容状态 */
export type ContentStatus = 'draft' | 'reviewing' | 'approved' | 'published' | 'rejected'

/** 发布状态 */
export type PublishStatus = 'pending' | 'publishing' | 'published' | 'failed'

// ============================================================
// Pipeline 相关枚举
// ============================================================

/** 闭环阶段 */
export enum PipelineStage {
  TREND_DISCOVERY = 'trend_discovery',
  HASHTAG_RESEARCH = 'hashtag_research',
  CONTENT_GENERATION = 'content_generation',
  PUBLISHING = 'publishing',
  PERFORMANCE_TRACKING = 'performance_tracking',
  ITERATION = 'iteration'
}

/** 闭环运行状态 */
export enum PipelineStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/** 阶段执行状态 */
export enum StageStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped'
}

/** 阶段元信息类型 */
export interface PipelineStageInfo {
  stage: PipelineStage
  label: string
  skillName: string
  description: string
  icon: string
}

/** 阶段元信息常量数组 */
export const PIPELINE_STAGES: PipelineStageInfo[] = [
  { stage: PipelineStage.TREND_DISCOVERY, label: '趋势发现', skillName: 'trend-research', description: '发现各平台热门趋势和话题', icon: 'TrendCharts' },
  { stage: PipelineStage.HASHTAG_RESEARCH, label: '标签研究', skillName: 'hashtag-research', description: '研究热门标签和相关标签', icon: 'Hashtag' },
  { stage: PipelineStage.CONTENT_GENERATION, label: '内容生成', skillName: 'xhs-content', description: '生成小红书风格图文笔记', icon: 'EditPen' },
  { stage: PipelineStage.PUBLISHING, label: '发布执行', skillName: 'xiaohongshu-skill', description: '通过 Playwright 发布到小红书', icon: 'Promotion' },
  { stage: PipelineStage.PERFORMANCE_TRACKING, label: '效果追踪', skillName: 'creator-analytics', description: '追踪互动数据和创作者表现', icon: 'DataAnalysis' },
  { stage: PipelineStage.ITERATION, label: '迭代优化', skillName: 'trend-research', description: '数据反馈到趋势发现，持续优化', icon: 'Refresh' }
]

// ============================================================
// 核心实体类型
// ============================================================

/** 趋势 */
export interface Trend {
  id: number
  title: string
  description: string
  platform: Platform
  category: string
  heat: number
  growthRate: number
  status: TrendStatus
  discoveredAt: string
  metadata?: string
}

/** 标签 */
export interface Hashtag {
  id: number
  tag: string
  platform: Platform
  volume: number
  growthRate: number
  relatedTags: string[]
  trendId?: number
  researchedAt: string
}

/** 内容 */
export interface Content {
  id: number
  title: string
  body: string
  tags: string[]
  images: string[]
  trendId?: number
  hashtagIds: string
  status: ContentStatus
  generatedAt: string
  publishedAt?: string
  isFavorited?: boolean
  favoritedAt?: string
  templateId?: number
  optimizationScore?: number
  optimizationNotes?: string
  groupName?: string
  sortOrder?: number
}

/** 统一内容条目 - 合并 contents 表和 drafts 表的统一视图 */
export interface UnifiedContent {
  id: number
  title: string
  tags: string[]
  images: string[]
  isFavorited: boolean
  status: string
  generatedAt: string
  source: 'content_studio' | 'pipeline'
  groupName: string
  sortOrder: number
}

/** 统一内容统计 */
export interface UnifiedContentStats {
  total: number
  contentStudio: number
  pipeline: number
  byStatus: Record<string, number>
  bySourceStatus: {
    content_studio: Record<string, number>
    pipeline: Record<string, number>
  }
}

/** 发布记录 */
export interface Publication {
  id: number
  contentId: number
  platform: Platform
  engine?: string
  postUrl?: string
  status: PublishStatus
  scheduledAt?: string
  publishedAt?: string
  errorMessage?: string
}

/** 分析记录 */
export interface AnalyticsRecord {
  id: number
  publicationId: number
  contentId: number
  views: number
  likes: number
  comments: number
  shares: number
  collects: number
  engagementRate: number
  trackedAt: string
}

// ============================================================
// Pipeline 相关类型
// ============================================================

/** 阶段执行记录 */
export interface PipelineStageRecord {
  stage: PipelineStage
  status: StageStatus
  startedAt?: string
  completedAt?: string
  result?: string
  errorMessage?: string
}

/** 闭环运行记录 */
export interface PipelineRun {
  id: number
  status: PipelineStatus
  currentStage: PipelineStage
  trendId?: number
  hashtagIds?: string
  contentId?: number
  publicationId?: number
  analyticsId?: number
  startedAt: string
  completedAt?: string
  errorMessage?: string
  keyword?: string
  pipelineType?: string
  stages: PipelineStageRecord[]
}

// ============================================================
// 仪表盘统计
// ============================================================

export interface DashboardStats {
  totalTrends: number
  totalContents: number
  totalPublications: number
  totalViews: number
  totalLikes: number
  avgEngagementRate: number
  activePipelines: number
  completedPipelines: number
}

// ============================================================
// API 通用响应类型
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: string
}

export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  total: number
  page: number
  pageSize: number
}

/** 分页查询参数 */
export interface PaginationParams {
  page: number
  pageSize: number
  status?: string
  platform?: string
  category?: string
  keyword?: string
  trendId?: number
  publicationId?: number
  limit?: number
}

// ============================================================
// API 方法参数类型
// ============================================================

/** 趋势列表查询参数 */
export interface TrendListParams {
  page: number
  pageSize: number
  status?: TrendStatus
  platform?: Platform
  category?: string
}

/** 趋势发现参数 */
export interface TrendDiscoveryParams {
  platform?: Platform
  category?: string
  limit?: number
}

/** 标签列表查询参数 */
export interface HashtagListParams {
  page: number
  pageSize: number
  trendId?: number
  platform?: Platform
  keyword?: string
}

/** 标签研究参数 */
export interface HashtagResearchParams {
  keyword: string
  platform?: Platform
  trendId?: number
  limit?: number
}

/** 内容列表查询参数 */
export interface ContentListParams {
  page: number
  pageSize: number
  status?: ContentStatus
  favorited?: boolean
}

/** 内容生成参数 */
export interface ContentGenerationParams {
  trendId?: number
  hashtagIds?: string
  keywords?: string[]
}

/** 发布列表查询参数 */
export interface PublishListParams {
  page: number
  pageSize: number
  status?: PublishStatus
}

/** 发布执行参数 */
export interface PublishParams {
  contentId: number
  platform?: Platform
  scheduledAt?: string
}

/** 分析列表查询参数 */
export interface AnalyticsListParams {
  page: number
  pageSize: number
  publicationId?: number
}

/** 分析追踪参数 */
export interface AnalyticsTrackParams {
  publicationId: number
  days?: number
}

/** 启动闭环参数 */
export interface StartPipelineParams {
  trendId?: number
}

// ============================================================
// 对话式内容创作类型
// ============================================================

/** 对话模式 */
export type ChatMode = 'discuss' | 'keyword'

/** 对话消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system'

/** 对话 */
export interface Conversation {
  id: number
  title: string
  mode: ChatMode
  status: 'active' | 'confirmed' | 'archived'
  confirmedMessageId?: number
  generatedContentId?: number
  messageCount: number
  createdAt: string
  updatedAt: string
}

/** 对话消息 */
export interface ChatMessage {
  id: number
  conversationId: number
  role: MessageRole
  content: string
  mode?: ChatMode
  extractedKeywords?: string[]
  confirmed: boolean
  llmProvider?: string
  durationMs?: number
  createdAt: string
}

/** 发送消息结果 */
export interface SendMessageResult {
  userMessage: ChatMessage
  assistantMessage: ChatMessage
}

/** LLM 配置状态 */
export interface LlmStatus {
  provider: string
  availableProviders: string[]
  hasZhipu: boolean
  hasDeepseek: boolean
  hasOllama: boolean
  zhipuModel: string
  deepseekModel: string
  ollamaModel: string
}

/** 从对话生成内容的结果 */
export interface GenerateFromChatResult {
  contentId: number
  title: string
  body: string
  tags: string[]
}

/** 图片上传结果 */
export interface ImageUploadResult {
  path: string
  fileName: string
  size: number
}
