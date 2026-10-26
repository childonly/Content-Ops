/**
 * 流程图首页模块配置
 *
 * 定义 9 个模块节点的元数据、连线关系和内嵌功能类型。
 * 新增模块只需在此文件添加配置项即可。
 */

// ============================================================================
// 类型定义
// ============================================================================

export type ModuleCategory = 'content-ops' | 'xhs-pipeline' | 'radar'
export type ModuleStatus = 'active' | 'warning' | 'error' | 'inactive'
export type EmbeddedFeatureType =
  | 'trend-discover'    // 趋势发现：平台选择 + 发现按钮
  | 'hashtag-search'    // 标签搜索：关键词输入 + 搜索按钮
  | 'content-generate'  // 内容生成：关键词输入 + AI 生成按钮
  | 'publish-stats'     // 发布统计：待发布数量
  | 'analytics-stats'   // 分析统计：总浏览/互动
  | 'pipeline-start'    // 闭环启动：启动按钮 + 运行中数量
  | 'xhs-start'         // 小红书流水线启动 + 登录状态
  | 'draft-stats'       // 草稿统计：待审核数量
  | 'radar-monitor'     // 情报监测：关键词输入 + 监测按钮

/** Skill 类型 */
export type SkillType = 'file' | 'api' | 'local-model'

/** 大模型配置类型 */
export type LlmModelType = 'local' | 'cloud' | 'hybrid' | 'none'

/** 模块的大模型配置信息 */
export interface LlmConfig {
  /** 是否配置了大模型 */
  configured: boolean
  /** 模型类型 */
  modelType: LlmModelType
  /** 模型名称（多个用逗号分隔） */
  modelName?: string
  /** 用途说明 */
  usage?: string
}

/** 模块集成的 Skill 信息（前端展示用） */
export interface ModuleSkill {
  /** Skill 标识名（与后端 skill-bridge.ts 的 SkillName 对应，英文） */
  name: string
  /** 中文显示名称 */
  label: string
  /** 功能描述 */
  description: string
  /** Skill 类型 */
  type: SkillType
  /** 实现方式简述 */
  implementation: string
  /** 本地文件夹绝对路径（null 表示无本地文件） */
  path: string | null
}

/** 模块内部流程步骤类型 */
export type InternalStepType = 'input' | 'process' | 'output' | 'decision'

/** 模块内部流程步骤定义 */
export interface InternalFlowStep {
  /** 步骤唯一 ID（模块内唯一） */
  id: string
  /** 步骤名称 */
  label: string
  /** 步骤描述 */
  description?: string
  /** 步骤类型：输入/处理/输出/决策 */
  type: InternalStepType
  /** 关联的 Skill 名称（对应 ModuleSkill.name，多个用逗号分隔） */
  skillRef?: string
}

/** 模块内部流程边定义 */
export interface InternalFlowEdge {
  /** 源步骤 ID */
  source: string
  /** 目标步骤 ID */
  target: string
  /** 边标签 */
  label?: string
}

/** 模块内部流程定义 */
export interface InternalFlow {
  /** 流程步骤列表 */
  steps: InternalFlowStep[]
  /** 流程步骤间的连线 */
  edges: InternalFlowEdge[]
}

export interface ModuleConfig {
  /** 节点唯一 ID（与路由 name 对应） */
  id: string
  /** 显示名称 */
  label: string
  /** Element Plus 图标名 */
  icon: string
  /** 路由路径 */
  route: string
  /** 功能描述（1-2 句话） */
  description: string
  /** 内部功能列表（显示在信息卡片中） */
  features: string[]
  /** 模块状态 */
  status: ModuleStatus
  /** 功能分组 */
  category: ModuleCategory
  /** 内嵌功能类型 */
  embeddedFeature: EmbeddedFeatureType
  /** dagre 布局排名提示（越小越靠左） */
  rankHint?: number
  /** 该模块集成的 Skill 列表 */
  skills?: ModuleSkill[]
  /** 大模型配置信息 */
  llmConfig?: LlmConfig
  /** 模块内部详细流程步骤（用于"显示内部流程"功能） */
  internalFlows?: InternalFlow
}

export interface ModuleEdgeConfig {
  /** 唯一 ID */
  id: string
  /** 源节点 ID */
  source: string
  /** 目标节点 ID */
  target: string
  /** 边标签 */
  label?: string
  /** 是否动画（数据流动中） */
  animated?: boolean
  /** 边类型：sequential=前后流程关系, data=数据引用/依赖 */
  edgeType?: 'sequential' | 'data'
}

// ============================================================================
// 共享 Skill 数据定义（5 个核心技能 + 7 个扩展技能）
// ============================================================================

const SKILL_TREND_RESEARCH: ModuleSkill = {
  name: 'trend-research',
  label: '趋势研究',
  description: '调用 TikHub API 获取各平台热门趋势榜单，为内容创作提供灵感来源。',
  type: 'api',
  implementation: 'TikHub API fetch_hot_list',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\trend-research',
}

const SKILL_HASHTAG_RESEARCH: ModuleSkill = {
  name: 'hashtag-research',
  label: '标签研究',
  description: '调用 TikHub API 搜索和分析热门标签（Hashtag），优化内容曝光策略。',
  type: 'api',
  implementation: 'TikHub API fetch_homefeed',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\hashtag-research',
}

const SKILL_XHS_CONTENT: ModuleSkill = {
  name: 'xhs-content',
  label: '小红书内容生成',
  description: '使用 Ollama 本地大模型（qwen2.5-coder:14b）生成小红书风格图文内容，支持加载 prompt.md 模板。',
  type: 'local-model',
  implementation: 'Ollama qwen2.5-coder:14b',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\xhs-content',
}

const SKILL_XIAOHONGSHU: ModuleSkill = {
  name: 'xiaohongshu-skill',
  label: '小红书操作技能',
  description: '通过 Python 子进程调用 xiaohongshu-skill 执行笔记发布、登录管理等操作，支持 Playwright 自动化。',
  type: 'file',
  implementation: 'Python 子进程 (Playwright)',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\xiaohongshu-skill',
}

const SKILL_CREATOR_ANALYTICS: ModuleSkill = {
  name: 'creator-analytics',
  label: '创作者数据分析',
  description: '追踪已发布内容的数据表现（浏览/点赞/评论/分享/收藏），当前为模拟数据模式。',
  type: 'api',
  implementation: '模拟数据生成',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\creator-analytics',
}

// ----------------------------------------------------------------------------
// 新增 7 个技能集成（视频/创意/记忆/图片增强等扩展能力）
// ----------------------------------------------------------------------------

const SKILL_XHS_DATA: ModuleSkill = {
  name: 'xiaohongshu',
  label: '小红书数据',
  description: '扩展 TikHub API 获取小红书笔记详情、用户信息、搜索和评论数据。',
  type: 'api',
  implementation: 'TikHub API search_notes/note_detail/user_info',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\xiaohongshu',
}

const SKILL_YOUTUBE: ModuleSkill = {
  name: 'youtube',
  label: 'YouTube数据',
  description: '通过 TikHub API 获取 YouTube 视频信息、频道数据和评论。',
  type: 'api',
  implementation: 'TikHub API youtube/web/v2',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\youtube',
}

const SKILL_VIDEO_ALCHEMIST: ModuleSkill = {
  name: 'video-content-alchemist',
  label: '视频内容炼金术',
  description: '输入视频URL，自动转录、提炼核心观点，改写为多平台图文内容。',
  type: 'file',
  implementation: 'TikHub + LLM 多平台改写',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\video-content-alchemist',
}

const SKILL_TRANSCRIBER: ModuleSkill = {
  name: 'mrcarlsama-social-transcriber',
  label: '视频转录',
  description: '使用 faster-whisper 本地 ASR 引擎，将视频内容转录为带时间戳的文字。',
  type: 'file',
  implementation: 'Python faster-whisper + yt-dlp',
  path: 'E:\\000 【AI-项目】\\Trae_work\\content-ops-hub\\server\\scripts\\python',
}

const SKILL_BRAINSTORMING: ModuleSkill = {
  name: 'brainstorming',
  label: '创意规划',
  description: '内容生成前进行创意头脑风暴，先发散再收敛，生成多个创意方向。',
  type: 'file',
  implementation: 'LLM 发散-收敛方法论',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\brainstorming',
}

const SKILL_MEMORY: ModuleSkill = {
  name: 'Memory-Assistant',
  label: '记忆增强',
  description: '从历史优质内容中提取风格特征，作为记忆注入到新内容生成中。',
  type: 'file',
  implementation: '历史数据 Facts 注入 LLM',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\Memory-Assistant',
}

const SKILL_GPT_IMAGE: ModuleSkill = {
  name: 'gpt-image-2',
  label: '图片生成(增强)',
  description: '基于 gpt-image-2 结构化提示词模板，增强 CogView-3-Flash 图片生成质量。',
  type: 'local-model',
  implementation: 'CogView-3-Flash + 结构化模板',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\gpt-image-2',
}

// ----------------------------------------------------------------------------
// 补充注册技能 (功能已在 radar-* 服务中实现，补充前端展示)
// ----------------------------------------------------------------------------

const SKILL_SOCIAL_LISTENING: ModuleSkill = {
  name: 'social-listening',
  label: '社交聆听',
  description: '跨平台关键词监听、情感分析、主题聚类，实时追踪品牌提及和舆情动态。',
  type: 'api',
  implementation: 'TikHub API + radar-sentiment',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\social-listening',
}

const SKILL_COMPETITOR_ANALYSIS: ModuleSkill = {
  name: 'competitor-analysis',
  label: '竞品分析',
  description: '比较多个账号在各平台的表现，包括粉丝数、互动率、发布频率和热门内容。',
  type: 'api',
  implementation: 'TikHub API 多账号对比',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\competitor-analysis',
}

const SKILL_DOUYIN: ModuleSkill = {
  name: 'douyin',
  label: '抖音数据',
  description: '通过 TikHub API 获取抖音视频信息、用户资料、评论和搜索数据。',
  type: 'api',
  implementation: 'TikHub API douyin/app/v3',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\douyin',
}

const SKILL_INSTAGRAM: ModuleSkill = {
  name: 'instagram',
  label: 'Instagram数据',
  description: '通过 TikHub API 获取 Instagram 用户信息、帖子、标签和位置数据。',
  type: 'api',
  implementation: 'TikHub API instagram/v2',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\instagram',
}

const SKILL_TIKTOK: ModuleSkill = {
  name: 'tiktok',
  label: 'TikTok数据',
  description: '通过 TikHub API 获取 TikTok 视频、用户、评论和趋势数据。',
  type: 'api',
  implementation: 'TikHub API tiktok/app/v3',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\tiktok',
}

const SKILL_TWITTER: ModuleSkill = {
  name: 'twitter-threads',
  label: 'Twitter/X数据',
  description: '通过 TikHub API 获取 Twitter/X 推文、用户时间线、评论和热门话题。',
  type: 'api',
  implementation: 'TikHub API twitter/web',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\twitter-threads',
}

// ----------------------------------------------------------------------------
// 新集成技能 (创建了完整的 service + route)
// ----------------------------------------------------------------------------

const SKILL_COMMENTS_ANALYSIS: ModuleSkill = {
  name: 'comments-analysis',
  label: '评论分析',
  description: '拉取指定帖子/视频的评论数据，进行情感分析、主题聚类和关键词提取。',
  type: 'api',
  implementation: 'TikHub API + radar-sentiment',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\comments-analysis',
}

const SKILL_MEDIA_DOWNLOAD: ModuleSkill = {
  name: 'social-media-downloader',
  label: '媒体下载',
  description: '通过 TikHub API 获取各平台视频/图片的无水印下载链接，支持下载到本地。',
  type: 'api',
  implementation: 'TikHub API 无水印 URL',
  path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\social-media-downloader',
}

// ============================================================================
// 模块节点配置
// ============================================================================

// ----------------------------------------------------------------------------
// 大模型配置常量
// ----------------------------------------------------------------------------

const LLM_NONE: LlmConfig = { configured: false, modelType: 'none' }

const LLM_OLLAMA_CONTENT: LlmConfig = {
  configured: true,
  modelType: 'local',
  modelName: 'Ollama qwen2.5-coder:14b',
  usage: '内容生成、创意规划、记忆增强',
}

const LLM_OLLAMA_PIPELINE: LlmConfig = {
  configured: true,
  modelType: 'local',
  modelName: 'Ollama qwen2.5-coder:14b',
  usage: '流水线内容生成阶段',
}

const LLM_WHISPER_SUMMARY: LlmConfig = {
  configured: true,
  modelType: 'hybrid',
  modelName: 'faster-whisper medium + GLM-4.6V-Flash/DeepSeek/Ollama',
  usage: '本地ASR转录 + 云端/本地LLM摘要生成',
}

// ----------------------------------------------------------------------------
// 各模块内部详细流程定义
// ----------------------------------------------------------------------------

/** 情报中心内部流程 */
const FLOW_RADAR: InternalFlow = {
  steps: [
    { id: 'radar-1', label: '选择平台', description: '选择抖音/小红书/TikTok等目标平台', type: 'input' },
    { id: 'radar-2', label: '输入关键词', description: '输入监测关键词或主题', type: 'input' },
    { id: 'radar-3', label: '获取热榜', description: '调用TikHub API获取各平台热门榜单', type: 'process', skillRef: 'trend-research,douyin,tiktok,instagram' },
    { id: 'radar-4', label: '社交聆听', description: '跨平台关键词监听与情感分析', type: 'process', skillRef: 'social-listening,comments-analysis' },
    { id: 'radar-5', label: '竞品分析', description: '比较多个账号在各平台的表现', type: 'decision', skillRef: 'competitor-analysis' },
    { id: 'radar-6', label: '输出情报报告', description: '生成趋势/标签/情感分析报告', type: 'output', skillRef: 'social-media-downloader' },
  ],
  edges: [
    { source: 'radar-1', target: 'radar-3' },
    { source: 'radar-2', target: 'radar-4' },
    { source: 'radar-3', target: 'radar-5' },
    { source: 'radar-4', target: 'radar-5' },
    { source: 'radar-5', target: 'radar-6', label: '分析完成' },
  ],
}

/** 趋势发现内部流程 */
const FLOW_TRENDS: InternalFlow = {
  steps: [
    { id: 'trends-1', label: '选择平台', description: '选择目标平台查看趋势', type: 'input' },
    { id: 'trends-2', label: '获取热榜', description: '调用TikHub API获取平台热门内容', type: 'process', skillRef: 'trend-research,youtube,douyin,tiktok' },
    { id: 'trends-3', label: '分类筛选', description: '按分类筛选趋势内容', type: 'decision' },
    { id: 'trends-4', label: '筛选趋势', description: '根据热度/增长筛选优质趋势', type: 'process' },
    { id: 'trends-5', label: '标记重要', description: '标记值得关注的重要趋势', type: 'process' },
    { id: 'trends-6', label: '一键转内容', description: '将趋势灵感转为内容创作', type: 'output', skillRef: 'xhs-content' },
  ],
  edges: [
    { source: 'trends-1', target: 'trends-2' },
    { source: 'trends-2', target: 'trends-3' },
    { source: 'trends-3', target: 'trends-4', label: '通过筛选' },
    { source: 'trends-4', target: 'trends-5' },
    { source: 'trends-5', target: 'trends-6' },
  ],
}

/** 标签研究内部流程 */
const FLOW_HASHTAGS: InternalFlow = {
  steps: [
    { id: 'hashtags-1', label: '输入关键词', description: '输入要研究的关键词', type: 'input' },
    { id: 'hashtags-2', label: '搜索标签', description: '调用TikHub API搜索相关标签', type: 'process', skillRef: 'hashtag-research' },
    { id: 'hashtags-3', label: '热度排行', description: '按热度对标签排序', type: 'process', skillRef: 'hashtag-research' },
    { id: 'hashtags-4', label: '增长分析', description: '分析标签增长趋势', type: 'decision', skillRef: 'hashtag-research' },
    { id: 'hashtags-5', label: '平台筛选', description: '跨平台对比标签表现', type: 'process' },
    { id: 'hashtags-6', label: '输出标签策略', description: '推荐最优标签组合', type: 'output' },
  ],
  edges: [
    { source: 'hashtags-1', target: 'hashtags-2' },
    { source: 'hashtags-2', target: 'hashtags-3' },
    { source: 'hashtags-3', target: 'hashtags-4' },
    { source: 'hashtags-4', target: 'hashtags-5', label: '增长良好' },
    { source: 'hashtags-5', target: 'hashtags-6' },
  ],
}

/** 内容工作室内部流程 */
const FLOW_CONTENT: InternalFlow = {
  steps: [
    { id: 'content-1', label: '输入关键词', description: '输入内容创作关键词', type: 'input' },
    { id: 'content-2', label: '创意头脑风暴', description: 'LLM发散-收敛生成多个创意方向', type: 'process', skillRef: 'brainstorming' },
    { id: 'content-3', label: '记忆增强', description: '从历史优质内容提取风格特征注入', type: 'process', skillRef: 'Memory-Assistant' },
    { id: 'content-4', label: 'AI生成内容', description: 'Ollama生成小红书风格图文', type: 'process', skillRef: 'xhs-content' },
    { id: 'content-5', label: '生成配图', description: 'CogView-3-Flash 增强图片生成', type: 'process', skillRef: 'gpt-image-2' },
    { id: 'content-6', label: '编辑优化', description: '手动编辑与状态流转', type: 'decision' },
    { id: 'content-7', label: '标签管理', description: '管理内容标签', type: 'output' },
  ],
  edges: [
    { source: 'content-1', target: 'content-2' },
    { source: 'content-2', target: 'content-3' },
    { source: 'content-3', target: 'content-4' },
    { source: 'content-4', target: 'content-5' },
    { source: 'content-5', target: 'content-6' },
    { source: 'content-6', target: 'content-7', label: '通过审核' },
  ],
}

/** 发布队列内部流程 */
const FLOW_PUBLISH: InternalFlow = {
  steps: [
    { id: 'publish-1', label: '选择内容', description: '从内容库选择待发布内容', type: 'input' },
    { id: 'publish-2', label: '选择平台', description: '选择发布目标平台', type: 'input' },
    { id: 'publish-3', label: '定时/即时', description: '选择定时发布或即时发布', type: 'decision' },
    { id: 'publish-4', label: '执行发布', description: '调用小红书Playwright执行发布', type: 'process', skillRef: 'xiaohongshu-skill' },
    { id: 'publish-5', label: '失败重试', description: '发布失败自动重试机制', type: 'process', skillRef: 'xiaohongshu-skill' },
    { id: 'publish-6', label: '更新状态', description: '更新发布状态为成功/失败', type: 'output' },
  ],
  edges: [
    { source: 'publish-1', target: 'publish-2' },
    { source: 'publish-2', target: 'publish-3' },
    { source: 'publish-3', target: 'publish-4', label: '即时发布' },
    { source: 'publish-3', target: 'publish-4', label: '到点执行' },
    { source: 'publish-4', target: 'publish-5', label: '失败时' },
    { source: 'publish-4', target: 'publish-6', label: '成功' },
    { source: 'publish-5', target: 'publish-4', label: '重试' },
  ],
}

/** 数据分析内部流程 */
const FLOW_ANALYTICS: InternalFlow = {
  steps: [
    { id: 'analytics-1', label: '获取数据', description: '拉取已发布内容的互动数据', type: 'process', skillRef: 'creator-analytics' },
    { id: 'analytics-2', label: '时间筛选', description: '按时间范围筛选数据', type: 'input' },
    { id: 'analytics-3', label: '互动趋势', description: '可视化浏览/点赞/评论/分享趋势', type: 'process', skillRef: 'creator-analytics' },
    { id: 'analytics-4', label: '数据缩放', description: '图表数据缩放查看', type: 'decision' },
    { id: 'analytics-5', label: '评论分析', description: '拉取评论进行情感分析', type: 'process', skillRef: 'comments-analysis' },
    { id: 'analytics-6', label: '手动追踪', description: '手动追踪单条内容效果', type: 'process', skillRef: 'creator-analytics' },
    { id: 'analytics-7', label: '输出分析报告', description: '生成数据洞察报告', type: 'output' },
  ],
  edges: [
    { source: 'analytics-1', target: 'analytics-2' },
    { source: 'analytics-2', target: 'analytics-3' },
    { source: 'analytics-3', target: 'analytics-4' },
    { source: 'analytics-4', target: 'analytics-5', label: '深入分析' },
    { source: 'analytics-5', target: 'analytics-6' },
    { source: 'analytics-6', target: 'analytics-7' },
  ],
}

/** 闭环管理内部流程（5步流水线） */
const FLOW_PIPELINE: InternalFlow = {
  steps: [
    { id: 'pipeline-1', label: '趋势研究', description: '调用TikHub获取平台热门趋势', type: 'input', skillRef: 'trend-research' },
    { id: 'pipeline-2', label: '标签研究', description: '研究相关热门标签', type: 'process', skillRef: 'hashtag-research' },
    { id: 'pipeline-3', label: '内容生成', description: 'Ollama生成小红书风格内容', type: 'process', skillRef: 'xhs-content' },
    { id: 'pipeline-4', label: '自动发布', description: 'Playwright自动发布到小红书', type: 'process', skillRef: 'xiaohongshu-skill' },
    { id: 'pipeline-5', label: '数据分析', description: '追踪发布内容数据表现', type: 'output', skillRef: 'creator-analytics' },
  ],
  edges: [
    { source: 'pipeline-1', target: 'pipeline-2', label: '阶段推进' },
    { source: 'pipeline-2', target: 'pipeline-3', label: '阶段推进' },
    { source: 'pipeline-3', target: 'pipeline-4', label: '阶段推进' },
    { source: 'pipeline-4', target: 'pipeline-5', label: '阶段推进' },
  ],
}

/** 流水线控制台内部流程 */
const FLOW_XHS_PIPELINE: InternalFlow = {
  steps: [
    { id: 'xhs-1', label: '关键词管理', description: '管理流水线监控关键词', type: 'input' },
    { id: 'xhs-2', label: '登录状态检测', description: '检测小红书登录状态', type: 'decision', skillRef: 'xiaohongshu-skill' },
    { id: 'xhs-3', label: '定时任务', description: '设置定时执行任务', type: 'input' },
    { id: 'xhs-4', label: '启动流水线', description: '一键启动小红书自动化流水线', type: 'process', skillRef: 'xiaohongshu-skill' },
    { id: 'xhs-5', label: '内容生成', description: 'Ollama生成笔记内容', type: 'process', skillRef: 'xhs-content' },
    { id: 'xhs-6', label: '生成草稿', description: '生成待审核草稿', type: 'output', skillRef: 'xhs-content' },
  ],
  edges: [
    { source: 'xhs-1', target: 'xhs-2' },
    { source: 'xhs-2', target: 'xhs-4', label: '已登录' },
    { source: 'xhs-3', target: 'xhs-4', label: '到点执行' },
    { source: 'xhs-4', target: 'xhs-5' },
    { source: 'xhs-5', target: 'xhs-6' },
  ],
}

/** 草稿审核内部流程 */
const FLOW_DRAFT_REVIEW: InternalFlow = {
  steps: [
    { id: 'draft-1', label: '获取草稿列表', description: '加载流水线生成的草稿', type: 'process' },
    { id: 'draft-2', label: '查看详情', description: '查看草稿标题/正文/标签/图片', type: 'process' },
    { id: 'draft-3', label: '通过/拒绝', description: '审核决策：通过或拒绝', type: 'decision' },
    { id: 'draft-4', label: '通过发布', description: '通过后自动发布', type: 'output', skillRef: 'xiaohongshu-skill' },
    { id: 'draft-5', label: '拒绝丢弃', description: '拒绝后丢弃草稿', type: 'output' },
    { id: 'draft-6', label: '来源追踪', description: '记录草稿来源与处理结果', type: 'output' },
  ],
  edges: [
    { source: 'draft-1', target: 'draft-2' },
    { source: 'draft-2', target: 'draft-3' },
    { source: 'draft-3', target: 'draft-4', label: '通过' },
    { source: 'draft-3', target: 'draft-5', label: '拒绝' },
    { source: 'draft-4', target: 'draft-6' },
    { source: 'draft-5', target: 'draft-6' },
  ],
}

/** 视频工作室内部流程 */
const FLOW_VIDEO_STUDIO: InternalFlow = {
  steps: [
    { id: 'video-1', label: '输入URL', description: '输入B站/抖音/小红书视频链接', type: 'input' },
    { id: 'video-2', label: '下载音频', description: 'yt-dlp下载视频音频流', type: 'process', skillRef: 'social-media-downloader' },
    { id: 'video-3', label: 'ASR转录', description: 'faster-whisper本地语音转文字', type: 'process', skillRef: 'mrcarlsama-social-transcriber' },
    { id: 'video-4', label: 'AI总结稿', description: 'LLM生成内容摘要', type: 'process', skillRef: 'video-content-alchemist' },
    { id: 'video-5', label: '观点提炼', description: 'LLM提炼核心观点', type: 'process', skillRef: 'video-content-alchemist' },
    { id: 'video-6', label: '多平台改写', description: '改写为多平台适配内容', type: 'process', skillRef: 'video-content-alchemist' },
    { id: 'video-7', label: '自动配图', description: '为改写内容生成配图', type: 'output', skillRef: 'gpt-image-2' },
  ],
  edges: [
    { source: 'video-1', target: 'video-2' },
    { source: 'video-2', target: 'video-3' },
    { source: 'video-3', target: 'video-4' },
    { source: 'video-4', target: 'video-5' },
    { source: 'video-5', target: 'video-6' },
    { source: 'video-6', target: 'video-7' },
  ],
}

export const moduleConfigs: ModuleConfig[] = [
  {
    id: 'radar',
    label: '情报中心',
    icon: 'Search',
    route: '/radar',
    description: '一站式社媒情报平台，支持跨平台趋势监测、标签分析、情感分析和社交聆听。',
    features: ['趋势监测', '标签分析', '情感分析', '社交聆听'],
    status: 'active',
    category: 'radar',
    embeddedFeature: 'radar-monitor',
    rankHint: 0,
    skills: [SKILL_TREND_RESEARCH, SKILL_HASHTAG_RESEARCH, SKILL_XHS_DATA, SKILL_YOUTUBE, SKILL_SOCIAL_LISTENING, SKILL_COMPETITOR_ANALYSIS, SKILL_DOUYIN, SKILL_INSTAGRAM, SKILL_TIKTOK, SKILL_TWITTER, SKILL_COMMENTS_ANALYSIS, SKILL_MEDIA_DOWNLOAD],
    llmConfig: LLM_NONE,
    internalFlows: FLOW_RADAR,
  },
  {
    id: 'trends',
    label: '趋势发现',
    icon: 'TrendCharts',
    route: '/trends',
    description: '浏览和发现各平台的热门趋势，为内容创作提供灵感。',
    features: ['多平台趋势', '分类筛选', '一键转内容', '分页浏览'],
    status: 'active',
    category: 'content-ops',
    embeddedFeature: 'trend-discover',
    rankHint: 1,
    skills: [SKILL_TREND_RESEARCH, SKILL_YOUTUBE, SKILL_DOUYIN, SKILL_TIKTOK],
    llmConfig: LLM_NONE,
    internalFlows: FLOW_TRENDS,
  },
  {
    id: 'hashtags',
    label: '标签研究',
    icon: 'Hashtag',
    route: '/hashtags',
    description: '研究各平台的热门标签（Hashtag），优化内容曝光策略。',
    features: ['标签搜索', '热度排行', '增长分析', '平台筛选'],
    status: 'active',
    category: 'content-ops',
    embeddedFeature: 'hashtag-search',
    rankHint: 2,
    skills: [SKILL_HASHTAG_RESEARCH],
    llmConfig: LLM_NONE,
    internalFlows: FLOW_HASHTAGS,
  },
  {
    id: 'content',
    label: '内容工作室',
    icon: 'EditPen',
    route: '/content',
    description: '内容创作和管理的核心工作台，支持 AI 辅助生成、编辑、状态管理。',
    features: ['AI 生成', '手动编辑', '状态流转', '标签管理'],
    status: 'active',
    category: 'content-ops',
    embeddedFeature: 'content-generate',
    rankHint: 3,
    skills: [SKILL_XHS_CONTENT, SKILL_BRAINSTORMING, SKILL_MEMORY, SKILL_GPT_IMAGE],
    llmConfig: LLM_OLLAMA_CONTENT,
    internalFlows: FLOW_CONTENT,
  },
  {
    id: 'publish',
    label: '发布队列',
    icon: 'Promotion',
    route: '/publish',
    description: '管理内容的发布任务，支持定时发布和即时发布。',
    features: ['任务队列', '定时发布', '即时发布', '失败重试'],
    status: 'active',
    category: 'content-ops',
    embeddedFeature: 'publish-stats',
    rankHint: 4,
    skills: [SKILL_XIAOHONGSHU],
    llmConfig: LLM_NONE,
    internalFlows: FLOW_PUBLISH,
  },
  {
    id: 'analytics',
    label: '数据分析',
    icon: 'DataAnalysis',
    route: '/analytics',
    description: '通过可视化图表分析内容表现和运营效果。',
    features: ['互动趋势', '时间筛选', '数据缩放', '手动追踪'],
    status: 'active',
    category: 'content-ops',
    embeddedFeature: 'analytics-stats',
    rankHint: 5,
    skills: [SKILL_CREATOR_ANALYTICS, SKILL_COMMENTS_ANALYSIS],
    llmConfig: LLM_NONE,
    internalFlows: FLOW_ANALYTICS,
  },
  {
    id: 'pipeline',
    label: '闭环管理',
    icon: 'Connection',
    route: '/pipeline',
    description: '管理内容运营的端到端闭环流水线，从趋势到发布全自动化。',
    features: ['5 步流水线', '自动执行', '阶段推进', '状态监控'],
    status: 'active',
    category: 'content-ops',
    embeddedFeature: 'pipeline-start',
    rankHint: 2,
    skills: [SKILL_TREND_RESEARCH, SKILL_HASHTAG_RESEARCH, SKILL_XHS_CONTENT, SKILL_XIAOHONGSHU, SKILL_CREATOR_ANALYTICS],
    llmConfig: LLM_OLLAMA_PIPELINE,
    internalFlows: FLOW_PIPELINE,
  },
  {
    id: 'xhs-pipeline',
    label: '流水线控制台',
    icon: 'Document',
    route: '/xhs-pipeline',
    description: '小红书自动化流水线的总控中心，管理关键词、定时任务和登录状态。',
    features: ['关键词管理', '定时任务', '登录状态', '一键启动'],
    status: 'warning',
    category: 'xhs-pipeline',
    embeddedFeature: 'xhs-start',
    rankHint: 3,
    skills: [SKILL_XIAOHONGSHU, SKILL_XHS_CONTENT],
    llmConfig: LLM_OLLAMA_PIPELINE,
    internalFlows: FLOW_XHS_PIPELINE,
  },
  {
    id: 'draft-review',
    label: '草稿审核',
    icon: 'Edit',
    route: '/draft-review',
    description: '审核流水线自动生成的小红书笔记草稿，决定是否发布。',
    features: ['草稿列表', '通过发布', '拒绝丢弃', '来源追踪'],
    status: 'active',
    category: 'xhs-pipeline',
    embeddedFeature: 'draft-stats',
    rankHint: 4,
    skills: [SKILL_XIAOHONGSHU],
    llmConfig: LLM_NONE,
    internalFlows: FLOW_DRAFT_REVIEW,
  },
  {
    id: 'video-studio',
    label: '视频工作室',
    icon: 'Film',
    route: '/video-studio',
    description: '统一视频处理入口：本地 ASR 转录（faster-whisper）+ 视频炼金术（提取、改写、配图）。',
    features: ['视频转录', '观点提炼', '多平台改写', '自动配图', 'AI 总结稿'],
    status: 'active',
    category: 'content-ops',
    embeddedFeature: 'content-generate',
    rankHint: 6,
    skills: [SKILL_VIDEO_ALCHEMIST, SKILL_TRANSCRIBER, SKILL_COMMENTS_ANALYSIS, SKILL_MEDIA_DOWNLOAD],
    llmConfig: LLM_WHISPER_SUMMARY,
    internalFlows: FLOW_VIDEO_STUDIO,
  },
]

// ============================================================================
// 模块连线配置（数据流向）
// ============================================================================

export const moduleEdges: ModuleEdgeConfig[] = [
  // === 前后流程关系（sequential） ===
  { id: 'e-radar-trends', source: 'radar', target: 'trends', label: '情报输入', animated: true, edgeType: 'sequential' },
  { id: 'e-trends-hashtags', source: 'trends', target: 'hashtags', label: '趋势驱动', edgeType: 'sequential' },
  { id: 'e-trends-content', source: 'trends', target: 'content', label: '灵感', edgeType: 'sequential' },
  { id: 'e-hashtags-content', source: 'hashtags', target: 'content', label: '标签引用', edgeType: 'sequential' },
  { id: 'e-content-publish', source: 'content', target: 'publish', label: '发布', edgeType: 'sequential' },
  { id: 'e-content-draft', source: 'content', target: 'draft-review', label: '草稿', edgeType: 'sequential' },
  { id: 'e-xhs-draft', source: 'xhs-pipeline', target: 'draft-review', label: '生成草稿', animated: true, edgeType: 'sequential' },
  { id: 'e-draft-publish', source: 'draft-review', target: 'publish', label: '审核通过', edgeType: 'sequential' },
  { id: 'e-publish-analytics', source: 'publish', target: 'analytics', label: '追踪数据', edgeType: 'sequential' },
  { id: 'e-analytics-pipeline', source: 'analytics', target: 'pipeline', label: '数据反馈', edgeType: 'sequential' },
  { id: 'e-pipeline-trends', source: 'pipeline', target: 'trends', label: '触发研究', animated: true, edgeType: 'sequential' },
  // === 数据引用/依赖关系（data） ===
  { id: 'e-radar-video-studio', source: 'radar', target: 'video-studio', label: '视频源', edgeType: 'data' },
  { id: 'e-video-studio-content', source: 'video-studio', target: 'content', label: '改写内容', edgeType: 'data' },
]

// ============================================================================
// 分类颜色映射
// ============================================================================

export const categoryColors: Record<ModuleCategory, { bg: string; border: string; text: string }> = {
  'content-ops': { bg: 'var(--color-primary-soft)', border: 'var(--color-primary)', text: 'var(--color-primary)' },
  'xhs-pipeline': { bg: 'var(--color-primary-soft)', border: 'var(--color-primary)', text: 'var(--color-primary)' },
  'radar': { bg: 'var(--color-primary-soft)', border: 'var(--color-primary)', text: 'var(--color-primary)' },
}

// ============================================================================
// 状态徽章映射
// ============================================================================

export const statusConfig: Record<ModuleStatus, { label: string; color: string; bg: string }> = {
  active: { label: '运行中', color: 'var(--color-success)', bg: 'var(--color-success-soft)' },
  warning: { label: '需关注', color: 'var(--color-warning)', bg: 'var(--color-warning-soft)' },
  error: { label: '异常', color: 'var(--color-danger)', bg: 'var(--color-danger-soft)' },
  inactive: { label: '未启用', color: 'var(--color-info)', bg: 'var(--color-info-soft)' },
}

// ============================================================================
// Skill 类型显示配置
// ============================================================================

export const skillTypeConfig: Record<SkillType, { label: string; color: string; bg: string; icon: string }> = {
  'file': { label: '本地文件', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'FolderOpened' },
  'api': { label: 'API 调用', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Connection' },
  'local-model': { label: '本地模型', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Cpu' },
}

/** 大模型类型显示配置 */
export const llmTypeConfig: Record<LlmModelType, { label: string; color: string; bg: string; icon: string }> = {
  'local': { label: '本地模型', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Cpu' },
  'cloud': { label: '云端模型', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Cloudy' },
  'hybrid': { label: '混合模型', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Connection' },
  'none': { label: '未配置', color: 'var(--color-info)', bg: 'var(--color-info-soft)', icon: 'CircleClose' },
}

/** 边类型显示配置 */
export const edgeTypeConfig: Record<'sequential' | 'data', { label: string; color: string; strokeStyle: string }> = {
  'sequential': { label: '前后流程', color: 'var(--color-primary)', strokeStyle: 'solid' },
  'data': { label: '数据引用', color: 'var(--color-info)', strokeStyle: 'dashed' },
}

/** 内部流程步骤类型显示配置 */
export const internalStepTypeConfig: Record<InternalStepType, { label: string; color: string; bg: string; icon: string }> = {
  'input': { label: '输入', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Upload' },
  'process': { label: '处理', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Loading' },
  'output': { label: '输出', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Download' },
  'decision': { label: '决策', color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: 'Select' },
}

/** 根据 ID 获取模块配置 */
export function getModuleConfig(id: string): ModuleConfig | undefined {
  return moduleConfigs.find(m => m.id === id)
}

/** 收集所有模块中的技能（去重） */
export function getAllSkills(): ModuleSkill[] {
  const seen = new Set<string>()
  const all: ModuleSkill[] = []
  for (const mod of moduleConfigs) {
    if (mod.skills) {
      for (const skill of mod.skills) {
        if (!seen.has(skill.name)) {
          seen.add(skill.name)
          all.push(skill)
        }
      }
    }
  }
  return all
}
