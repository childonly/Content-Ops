import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  Platform,
  Trend,
  TrendStatus,
  TrendListParams,
  TrendDiscoveryParams,
  Hashtag,
  HashtagListParams,
  HashtagResearchParams,
  Content,
  ContentStatus,
  ContentListParams,
  ContentGenerationParams,
  UnifiedContent,
  UnifiedContentStats,
  Publication,
  PublishListParams,
  AnalyticsRecord,
  AnalyticsListParams,
  PipelineRun,
  StartPipelineParams,
  DashboardStats,
  PipelineStageInfo,
  Conversation,
  ChatMessage,
  ChatMode,
  SendMessageResult,
  LlmStatus,
  GenerateFromChatResult,
  ImageUploadResult,
} from '@/types'

// ============================================================
// Axios 实例
// ============================================================

const request: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('token')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器：统一以 success 字段判断业务成败
// 注意：不在此处弹出 ElMessage.error，由各调用方自行处理错误提示
// 避免后台统计加载失败时弹出大量错误提示
request.interceptors.response.use(
  (response: AxiosResponse) => {
    const res = response.data as { success?: boolean; error?: string; message?: string }
    // 业务失败（HTTP 200 但 success=false）
    if (res && res.success === false) {
      const msg = res.error || res.message || '请求失败'
      return Promise.reject(new Error(msg))
    }
    return response
  },
  (error) => {
    // 不在此处弹出错误提示，由各页面的 catch 块自行处理
    // 但需要从 HTTP 错误响应中提取后端返回的错误消息，供调用方使用
    if (error.response?.data) {
      const data = error.response.data as { error?: string; message?: string }
      const msg = data.error || data.message
      if (msg) {
        return Promise.reject(new Error(msg))
      }
    }
    return Promise.reject(error)
  }
)

// ============================================================
// 类型安全的请求辅助函数
// ============================================================

/** GET 单资源：返回 ApiResponse<T> */
async function httpGet<T>(url: string, params?: object): Promise<ApiResponse<T>> {
  const res = await request.get<ApiResponse<T>>(url, { params })
  return res.data
}

/** GET 分页列表：返回 PaginatedResponse<T>（已含 success/data/total/page/pageSize） */
async function httpGetPaged<T>(url: string, params?: object): Promise<PaginatedResponse<T>> {
  const res = await request.get<PaginatedResponse<T>>(url, { params })
  return res.data
}

/** POST：返回 ApiResponse<T> */
async function httpPost<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const res = await request.post<ApiResponse<T>>(url, data)
  return res.data
}

/** PATCH：返回 ApiResponse<T> */
async function httpPatch<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const res = await request.patch<ApiResponse<T>>(url, data)
  return res.data
}

/** PUT：返回 ApiResponse<T> */
async function httpPut<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const res = await request.put<ApiResponse<T>>(url, data)
  return res.data
}

// ============================================================
// API 方法封装
// ============================================================

/** 趋势相关 API */
export const trendsApi = {
  /** 获取趋势列表（分页） */
  getList(params: TrendListParams): Promise<PaginatedResponse<Trend>> {
    return httpGetPaged<Trend>('/trends', params)
  },
  /** 获取趋势详情 */
  getById(id: number): Promise<ApiResponse<Trend>> {
    return httpGet<Trend>(`/trends/${id}`)
  },
  /** 发现新趋势 */
  discover(data: TrendDiscoveryParams): Promise<ApiResponse<Trend[]>> {
    return httpPost<Trend[]>('/trends/discover', data)
  },
  /** 更新趋势状态 */
  updateStatus(id: number, status: TrendStatus): Promise<ApiResponse<Trend>> {
    return httpPatch<Trend>(`/trends/${id}/status`, { status })
  },
  /** 删除趋势 */
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/trends/${id}`).then(res => res.data)
  },
  /** 批量删除趋势 */
  batchDelete(ids: number[]): Promise<ApiResponse<{ deleted: number }>> {
    return request.delete('/trends/batch', { data: { ids } }).then(res => res.data)
  }
}

/** 标签相关 API */
export const hashtagsApi = {
  /** 获取标签列表（分页，可按 trendId 过滤） */
  getList(params: HashtagListParams): Promise<PaginatedResponse<Hashtag>> {
    return httpGetPaged<Hashtag>('/hashtags', params)
  },
  /** 研究标签 */
  research(data: HashtagResearchParams): Promise<ApiResponse<Hashtag[]>> {
    return httpPost<Hashtag[]>('/hashtags/research', data)
  },
  /** 批量删除标签 */
  batchDelete(ids: number[]): Promise<ApiResponse<{ deleted: number }>> {
    return request.delete('/hashtags/batch', { data: { ids } }).then(res => res.data)
  }
}

/** 内容相关 API */
export const contentsApi = {
  /** 获取内容列表（分页，可按 status 过滤） */
  getList(params: ContentListParams): Promise<PaginatedResponse<Content>> {
    return httpGetPaged<Content>('/contents', params)
  },
  /** 获取内容详情 */
  getById(id: number): Promise<ApiResponse<Content>> {
    return httpGet<Content>(`/contents/${id}`)
  },
  /** 生成内容 */
  generate(data: ContentGenerationParams): Promise<ApiResponse<Content>> {
    return httpPost<Content>('/contents/generate', data)
  },
  /** 更新内容状态 */
  updateStatus(id: number, status: ContentStatus): Promise<ApiResponse<Content>> {
    return httpPatch<Content>(`/contents/${id}/status`, { status })
  },
  /** 更新内容（标题、正文、标签、图片） */
  update(id: number, data: { title?: string; body?: string; tags?: string[]; images?: string[] }): Promise<ApiResponse<Content>> {
    return httpPut<Content>(`/contents/${id}`, data)
  },
  /** 切换收藏状态 */
  toggleFavorite(id: number): Promise<ApiResponse<Content>> {
    return httpPost<Content>(`/contents/${id}/favorite`)
  },
  /** 删除内容 */
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/contents/${id}`).then(res => res.data)
  },
  /** 为内容生成配图 */
  generateImages(id: number): Promise<ApiResponse<{ images: string[]; newImages: string[] }>> {
    return httpPost<{ images: string[]; newImages: string[] }>(`/contents/${id}/generate-images`)
  },
  /** 上传图片（base64） */
  uploadImage(base64: string, filename?: string): Promise<ApiResponse<ImageUploadResult>> {
    return httpPost<ImageUploadResult>('/contents/upload-image', { base64, filename })
  },
  /** 删除内容的图片 */
  deleteImage(id: number, index: number): Promise<ApiResponse<{ images: string[] }>> {
    return request.delete(`/contents/${id}/images/${index}`).then(res => res.data)
  },
  /** 获取统一内容列表（合并 contents 和 drafts） */
  getUnifiedList(params: { page: number; pageSize: number; status?: string; favorited?: boolean; source?: string; groupName?: string }): Promise<PaginatedResponse<UnifiedContent>> {
    return httpGetPaged<UnifiedContent>('/contents/unified', params)
  },
  /** 获取统一内容统计 */
  getUnifiedStats(): Promise<ApiResponse<UnifiedContentStats>> {
    return httpGet<UnifiedContentStats>('/contents/unified/stats')
  },
  /** 获取所有分组列表 */
  getGroups(): Promise<ApiResponse<string[]>> {
    return httpGet<string[]>('/contents/groups')
  },
  /** 更新内容的分组 */
  updateGroup(id: number, groupName: string): Promise<ApiResponse<Content>> {
    return httpPatch<Content>(`/contents/${id}/group`, { group_name: groupName })
  },
  /** 批量更新排序 */
  reorder(items: Array<{ id: number; sort_order: number }>): Promise<ApiResponse<void>> {
    return httpPut<void>('/contents/reorder', { items })
  },
  /** 批量删除内容 */
  batchDelete(ids: number[]): Promise<ApiResponse<{ deleted: number }>> {
    return httpPost<{ deleted: number }>('/contents/batch-delete', { ids })
  },
}

/** 发布相关 API */
export const publishApi = {
  /** 获取发布记录列表（分页，可按 status 过滤） */
  getList(params: PublishListParams): Promise<PaginatedResponse<Publication>> {
    return httpGetPaged<Publication>('/publish', params)
  },
  /** 获取发布队列 */
  getQueue(): Promise<ApiResponse<Publication[]>> {
    return httpGet<Publication[]>('/publish/queue')
  },
  /** 执行发布（传入 contentId 等参数） */
  execute(
    contentId: number,
    platform?: Platform,
    scheduledAt?: string,
    engine?: string,
  ): Promise<ApiResponse<Publication>> {
    return httpPost<Publication>('/publish/execute', { contentId, platform, scheduledAt, engine })
  },
  /** 删除发布记录 */
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/publish/${id}`).then(res => res.data)
  }
}

/** 分析相关 API */
export const analyticsApi = {
  /** 获取分析数据列表（分页，可按 publicationId 过滤） */
  getList(params: AnalyticsListParams): Promise<PaginatedResponse<AnalyticsRecord>> {
    return httpGetPaged<AnalyticsRecord>('/analytics', params)
  },
  /** 按日期范围查询分析数据 */
  getByDateRange(startDate: string, endDate: string): Promise<PaginatedResponse<AnalyticsRecord>> {
    return httpGetPaged<AnalyticsRecord>('/analytics/date-range', { startDate, endDate })
  },
  /** 追踪效果（传入 publicationId 等参数） */
  track(publicationId: number, days?: number): Promise<ApiResponse<AnalyticsRecord>> {
    return httpPost<AnalyticsRecord>('/analytics/track', { publicationId, days })
  },
  /** 删除分析记录 */
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/analytics/${id}`).then(res => res.data)
  }
}

/** 闭环管理 API */
export const pipelineApi = {
  /** 获取 Pipeline 运行列表（分页） */
  getRuns(params: PaginationParams): Promise<PaginatedResponse<PipelineRun>> {
    return httpGetPaged<PipelineRun>('/pipeline', params)
  },
  /** 获取运行详情 */
  getById(id: number): Promise<ApiResponse<PipelineRun>> {
    return httpGet<PipelineRun>(`/pipeline/${id}`)
  },
  /** 启动新 Pipeline */
  run(data: StartPipelineParams): Promise<ApiResponse<PipelineRun>> {
    return httpPost<PipelineRun>('/pipeline/run', data)
  },
  /** 推进下一阶段 */
  advance(id: number): Promise<ApiResponse<PipelineRun>> {
    return httpPost<PipelineRun>(`/pipeline/${id}/advance`)
  },
  /** 暂停运行 */
  pause(id: number): Promise<ApiResponse<PipelineRun>> {
    return httpPost<PipelineRun>(`/pipeline/${id}/pause`)
  },
  /** 恢复运行（从暂停状态恢复） */
  resume(id: number): Promise<ApiResponse<PipelineRun>> {
    return httpPost<PipelineRun>(`/pipeline/${id}/resume`)
  },
  /** 删除 Pipeline 运行记录 */
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/pipeline/${id}`).then(res => res.data)
  },
  batchDelete(ids: number[]): Promise<ApiResponse<{ deleted: number }>> {
    return request.delete('/pipeline/batch', { data: { ids } }).then(res => res.data)
  },
  update(id: number, data: { keyword?: string; trendId?: number | null }): Promise<ApiResponse<PipelineRun>> {
    return request.put(`/pipeline/${id}`, data).then(res => res.data)
  }
}

/** 仪表盘 API */
export const dashboardApi = {
  /** 获取仪表盘统计数据 */
  getStats(): Promise<ApiResponse<DashboardStats>> {
    return httpGet<DashboardStats>('/dashboard/stats')
  },
  /** 获取 Pipeline 阶段定义 */
  getPipelineStages(): Promise<ApiResponse<PipelineStageInfo[]>> {
    return httpGet<PipelineStageInfo[]>('/dashboard/pipeline-stages')
  }
}

// ============================================================
// Skill 管理 API
// ============================================================

/** Skill 元数据（与后端 SkillMeta 对应） */
export interface SkillMetaDTO {
  name: string
  label: string
  description: string
  type: 'file' | 'api' | 'local-model'
  implementation: string
  path: string | null
  modules: string[]
}

/** Skill 管理 API */
export const skillApi = {
  /** 获取所有技能列表 */
  getAll(): Promise<ApiResponse<SkillMetaDTO[]>> {
    return httpGet<SkillMetaDTO[]>('/skills')
  },
  /** 获取单个技能详情 */
  getByName(name: string): Promise<ApiResponse<SkillMetaDTO>> {
    return httpGet<SkillMetaDTO>(`/skills/${name}`)
  },
  /** 在系统文件管理器中打开技能文件夹 */
  async openFolder(skillName: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const res = await request.post('/skills/open', { skillName })
      return res.data
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || '打开文件夹失败'
      return { success: false, error: msg }
    }
  },
}

// ============================================================
// 视频工具 API（视频内容炼金术 + 视频转录）
// ============================================================

/** 视频炼金术运行记录 */
export interface VideoAlchemistRun {
  id: number
  url: string
  platform: string
  status: string
  createdAt: string
  /** 原始转录文本 */
  transcript?: string
  /** 提炼出的核心观点列表 */
  keyPoints?: string[]
  /** 改写后的标题 */
  rewrittenTitle?: string
  /** 改写后的正文 */
  rewrittenBody?: string
  /** 改写后的标签 */
  rewrittenTags?: string[]
  /** 生成的配图 URL 列表 */
  images?: string[]
  /** 失败时的错误信息 */
  errorMessage?: string
  [key: string]: unknown
}

/** 视频转录运行记录 */
export interface TranscriberRun {
  id: number
  url: string
  /** 原始链接名（用户输入的原始文本，如B站分享文本） */
  sourceText?: string
  model: string
  language: string
  status: string
  createdAt: string
  /** 完整逐字稿文本 */
  transcript?: string
  /** 带时间戳的分段列表 */
  segments?: Array<{ start: number; end: number; text: string; speaker?: string }>
  /** 全文稿：去除时间戳的纯文本拼接 */
  fullText?: string
  /** 总结稿：AI LLM 生成的内容摘要 */
  summary?: string
  /** SRT 格式字幕 */
  srt?: string
  /** 音频时长（秒） */
  duration?: number
  /** 检测到的语言 */
  detectedLanguage?: string
  /** 分段数量 */
  segmentCount?: number
  /** 失败时的错误信息 */
  errorMessage?: string
  [key: string]: unknown
}

/** 视频炼金术 API */
export const videoAlchemistApi = {
  /** 处理视频：转录→提炼观点→改写→配图 */
  process(data: { url: string; platform?: string }): Promise<ApiResponse<VideoAlchemistRun>> {
    return httpPost<VideoAlchemistRun>('/video-alchemist/process', data)
  },
  /** 获取运行记录列表（分页） */
  getRuns(params: { page: number; pageSize: number; status?: string }): Promise<PaginatedResponse<VideoAlchemistRun>> {
    return httpGetPaged<VideoAlchemistRun>('/video-alchemist/runs', params)
  },
  /** 获取单条运行记录详情 */
  getRun(id: number): Promise<ApiResponse<VideoAlchemistRun>> {
    return httpGet<VideoAlchemistRun>(`/video-alchemist/runs/${id}`)
  },
  /** 删除运行记录 */
  deleteRun(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/video-alchemist/runs/${id}`).then((res) => res.data)
  }
}

/** 视频转录 API */
export const transcriberApi = {
  /** 开始转录：下载音频→ASR→生成逐字稿/字幕 */
  transcribe(data: { url: string; model?: string; language?: string; sourceText?: string }): Promise<ApiResponse<TranscriberRun>> {
    // 转录耗时较长（下载音频+ASR），大模型(medium/large)在CPU上可能需要45分钟
    return request.post<ApiResponse<TranscriberRun>>('/transcriber/transcribe', data, {
      timeout: 2_700_000,
    }).then((res) => res.data)
  },
  /** 获取转录记录列表（分页） */
  getList(params: { page: number; pageSize: number; status?: string }): Promise<PaginatedResponse<TranscriberRun>> {
    return httpGetPaged<TranscriberRun>('/transcriber/transcriptions', params)
  },
  /** 获取单条转录记录详情 */
  getOne(id: number): Promise<ApiResponse<TranscriberRun>> {
    return httpGet<TranscriberRun>(`/transcriber/transcriptions/${id}`)
  },
  /** 删除转录记录 */
  deleteOne(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/transcriber/transcriptions/${id}`).then((res) => res.data)
  },
  /** 批量删除转录记录 */
  batchDelete(ids: number[]): Promise<ApiResponse<{ deleted: number }>> {
    return request.delete('/transcriber/transcriptions/batch', { data: { ids } }).then((res) => res.data)
  },
  /** 生成 AI 总结稿（调用 LLM 对全文稿进行摘要） */
  summarize(id: number): Promise<ApiResponse<TranscriberRun>> {
    return request.post<ApiResponse<TranscriberRun>>(`/transcriber/transcriptions/${id}/summarize`).then((res) => res.data)
  }
}

/** 视频工作室统一记录（合并转录 + 炼金术） */
export interface UnifiedVideoRecord {
  /** 统一 ID: 't{id}' for transcriptions, 'a{id}' for alchemist */
  uid: string
  /** 原始表中的 ID */
  id: number
  /** 来源表 */
  source: 'transcription' | 'alchemist'
  /** 使用的策略/工具 */
  strategy: 'transcribe' | 'alchemist'
  /** 视频 URL */
  url: string
  /** 原始链接名（仅转录有） */
  sourceText?: string
  /** 处理状态 */
  status: string
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt?: string
  /** 错误信息 */
  errorMessage?: string
  // --- 转录特有字段 ---
  model?: string
  language?: string
  duration?: number
  transcript?: string
  segments?: Array<{ start: number; end: number; text: string; speaker?: string }>
  fullText?: string
  summary?: string
  // --- 炼金术特有字段 ---
  platform?: string
  keyPoints?: string[]
  rewrittenTitle?: string
  rewrittenBody?: string
  rewrittenTags?: string[]
  images?: string[]
  [key: string]: unknown
}

/** 视频工作室 API — 统一入口 */
export const videoStudioApi = {
  /** 统一处理视频 (strategy 选择 transcribe/alchemist)
   *
   * 超时设置：24 小时（86_400_000ms），与后端 PYTHON_EXEC_TIMEOUT_MAX 一致。
   * 长视频（如 4 小时）在 CPU 上用 medium 模型转录可能需要 14+ 小时，
   * 设置足够长的超时确保 HTTP 连接不会在转录完成前断开。
   * 同时前端通过 /progress 端点每 3 秒轮询真实进度，用户随时可见状态。
   */
  process(data: {
    url: string
    strategy?: 'transcribe' | 'alchemist'
    model?: string
    language?: string
    sourceText?: string
    platform?: string
  }): Promise<ApiResponse<UnifiedVideoRecord>> {
    return request.post<ApiResponse<UnifiedVideoRecord>>('/video-studio/process', data, {
      timeout: 86_400_000, // 24 小时，匹配后端最大超时
    }).then((res) => res.data)
  },
  /** 获取统一记录列表 (UNION 两张表) */
  getRecords(params: {
    page: number
    pageSize: number
    strategy?: 'transcribe' | 'alchemist'
  }): Promise<PaginatedResponse<UnifiedVideoRecord>> {
    return httpGetPaged<UnifiedVideoRecord>('/video-studio/records', params)
  },
  /** 获取单条统一记录 */
  getRecord(uid: string): Promise<ApiResponse<UnifiedVideoRecord>> {
    return httpGet<UnifiedVideoRecord>(`/video-studio/records/${uid}`)
  },
  /** 删除单条记录 */
  deleteRecord(uid: string): Promise<ApiResponse<void>> {
    return request.delete(`/video-studio/records/${uid}`).then((res) => res.data)
  },
  /** 批量删除记录 */
  batchDelete(uids: string[]): Promise<ApiResponse<{ deleted: number }>> {
    return request.delete('/video-studio/records/batch', { data: { uids } }).then((res) => res.data)
  },
  /** 生成 AI 总结稿 (仅转录记录) */
  summarize(uid: string): Promise<ApiResponse<UnifiedVideoRecord>> {
    return request.post<ApiResponse<UnifiedVideoRecord>>(`/video-studio/records/${uid}/summarize`).then((res) => res.data)
  },
  /** 提交至内容工作室 */
  submitToContent(uid: string): Promise<ApiResponse<{ conversationId: number; conversationTitle: string }>> {
    return request.post<ApiResponse<{ conversationId: number; conversationTitle: string }>>(`/video-studio/records/${uid}/submit-to-content`).then((res) => res.data)
  },
  /** 获取转录实时进度 */
  getProgress(url: string): Promise<ApiResponse<{
    stage: string
    percentage: number
    elapsed_seconds: number
    estimated_total_seconds: number | null
    remaining_seconds: number | null
    current_position: number
    total_duration: number
    segment_count: number
    model: string
    last_log: string
    timestamp: string
  } | null>> {
    return request.get('/video-studio/progress', { params: { url } }).then((res) => res.data)
  },
  /** 获取 PM2 实时日志 */
  getLogs(lines: number = 50): Promise<ApiResponse<string>> {
    return request.get('/video-studio/logs', { params: { lines } }).then((res) => res.data)
  },
  /** 预检查视频时长（不下载不转录） */
  checkVideo(url: string, model?: string): Promise<ApiResponse<{
    duration: number
    title: string
    exceedsLimit: boolean
    maxDuration: number
    isLongVideo: boolean
    estimatedTranscriptionTime: number
    model: string
    error?: string
  }>> {
    return request.post('/video-studio/check-video', { url, model }).then((res) => res.data)
  },
  /** 重新生成记录（基于缓存继续） */
  regenerate(uid: string): Promise<ApiResponse<UnifiedVideoRecord & {
    cacheInfo?: {
      audioCached: boolean
      audioPath: string
      checkpointExists: boolean
      checkpointSegments: number
    }
  }>> {
    return request.post(`/video-studio/records/${uid}/regenerate`, {}, {
      timeout: 86_400_000, // 24 小时，匹配后端最大超时
    }).then((res) => res.data)
  },
  /** 重新生成全文稿（仅标点和分段，不重新 ASR）
   * useLLM=true 使用 LLM 进行标点修复（更准确但更慢）
   * useLLM=false 使用规则断句（快速）
   */
  regenerateFullText(uid: string, useLLM?: boolean): Promise<ApiResponse<UnifiedVideoRecord>> {
    return request.post<ApiResponse<UnifiedVideoRecord>>(`/video-studio/records/${uid}/regenerate-fulltext`, {
      useLLM: useLLM ?? false,
    }, {
      timeout: 300_000, // LLM 标点修复最多 5 分钟
    }).then((res) => res.data)
  },
  /** 获取记录的缓存信息 */
  getCacheInfo(uid: string): Promise<ApiResponse<{
    audioCached: boolean
    audioPath: string
    audioCacheSize: number
    checkpointExists: boolean
    checkpointSegments: number
    checkpointLastUpdate: string
    progressStage: string
    progressPct: number
    canRegenerate: boolean
  }>> {
    return request.get(`/video-studio/records/${uid}/cache-info`).then((res) => res.data)
  },
  /** 收藏转录文本片段到笔记 */
  saveNote(data: {
    videoUid: string
    videoTitle: string
    sourceUrl: string
    timestamp: number | null
    selectedText: string
  }): Promise<ApiResponse<{ id: number }>> {
    return request.post('/video-studio/notes', data).then((res) => res.data)
  },
}

// ============================================================
// 图片工作室 API
// ============================================================

/** 生成的图片记录 */
export interface GeneratedImage {
  uid: string
  title?: string
  prompt: string
  url?: string
  thumbnailUrl?: string
  mode: 'text-to-image' | 'card' | 'edit'
  status: 'generating' | 'completed' | 'failed'
  engine?: string
  size?: string
  style?: string
  theme?: string
  createdAt: string
}

/** 图片引擎信息 */
export interface ImageEngineInfo {
  name: string
  label: string
  description: string
  available: boolean
  isDefault: boolean
  modes: string[]
  capabilities: string[]
}

/** 图片工作室 API */
export const imageStudioApi = {
  /** 获取可用引擎列表 */
  getEngines(): Promise<ApiResponse<ImageEngineInfo[]>> {
    return request.get('/image-studio/engines').then((res) => res.data)
  },
  /** 设置默认引擎 */
  setDefaultEngine(engine: string): Promise<ApiResponse<void>> {
    return request.post('/image-studio/engines/default', { engine }).then((res) => res.data)
  },
  /** 生成图片 */
  generate(data: Record<string, unknown>): Promise<ApiResponse<GeneratedImage>> {
    return request.post<ApiResponse<GeneratedImage>>('/image-studio/generate', data, {
      timeout: 300_000, // 5 分钟超时
    }).then((res) => res.data)
  },
  /** 获取历史记录 */
  getRecords(params: {
    page: number
    pageSize: number
  }): Promise<{ data: GeneratedImage[]; total: number }> {
    return httpGetPaged<GeneratedImage>('/image-studio/records', params)
  },
  /** 获取单条记录 */
  getRecord(uid: string): Promise<ApiResponse<GeneratedImage>> {
    return httpGet<GeneratedImage>(`/image-studio/records/${uid}`)
  },
  /** 删除记录 */
  deleteRecord(uid: string): Promise<ApiResponse<void>> {
    return request.delete(`/image-studio/records/${uid}`).then((res) => res.data)
  },
  /** 获取 Auto-Redbook 主题列表 */
  getAutoRedbookThemes(): Promise<ApiResponse<{ name: string; label: string; description: string }[]>> {
    return request.get('/image-studio/auto-redbook/themes').then((res) => res.data)
  },
  /** Auto-Redbook 卡片渲染（返回全部图片） */
  renderAutoRedbookCards(data: {
    title?: string
    subtitle?: string
    emoji?: string
    content: string
    theme?: string
    mode?: string
  }): Promise<ApiResponse<{
    cover?: string
    cards: string[]
    allImages: string[]
    cardCount: number
  }>> {
    return request.post('/image-studio/auto-redbook/render', data, {
      timeout: 120_000, // 2 分钟超时
    }).then((res) => res.data)
  },
}

// ============================================================
// 发布引擎 API（多引擎并行共存）
// ============================================================

/** 发布引擎信息 */
export interface PublishEngineInfo {
  name: string
  label: string
  description: string
  available: boolean
  isDefault: boolean
  features: string[]
}

export const publishEngineApi = {
  /** 获取可用发布引擎列表 */
  getEngines(): Promise<ApiResponse<PublishEngineInfo[]>> {
    return request.get('/publish/engines').then((res) => res.data)
  },
  /** 设置默认发布引擎 */
  setDefaultEngine(engine: string): Promise<ApiResponse<void>> {
    return request.post('/publish/engines/default', { engine }).then((res) => res.data)
  },
  /** 使用指定引擎发布 */
  publishWithEngine(data: {
    title: string
    content: string
    tags?: string[]
    images?: string[]
    engine?: string
    autoPublish?: boolean
    headless?: boolean
  }): Promise<ApiResponse<any>> {
    return request.post('/publish/execute-with-engine', data, {
      timeout: 600_000, // 10 分钟超时
    }).then((res) => res.data)
  },
}

// ============================================================
// 内容生产链路增强 API（Auto-Redbook + summarizer + baoyu）
// ============================================================

/** 增强结果 */
export interface PipelineEnhanceResult {
  success: boolean
  title: string
  content: string
  tags: string[]
  images?: string[]
  summary?: string
  keyPoints?: string[]
  actionItems?: string[]
  theme?: string
  engine?: string
  error?: string
}

/** 增强模式 */
export type EnhanceMode = 'auto-redbook' | 'summarizer' | 'baoyu-illustration' | 'full'

export const pipelineEnhancerApi = {
  /** 执行内容增强 */
  enhance(data: {
    mode: EnhanceMode
    title: string
    content: string
    tags?: string[]
    theme?: string
    platform?: string
    generateImage?: boolean
    imageEngine?: string
  }): Promise<ApiResponse<PipelineEnhanceResult>> {
    return request.post<ApiResponse<PipelineEnhanceResult>>(
      '/pipeline-enhancer/enhance',
      data,
      { timeout: 300_000 }
    ).then((res) => res.data)
  },
  /** 获取可用的 Auto-Redbook 主题列表 */
  getThemes(): Promise<ApiResponse<string[]>> {
    return httpGet<string[]>('/pipeline-enhancer/themes')
  },
  /** 获取可用的 Baoyu 布局列表 */
  getLayouts(): Promise<ApiResponse<string[]>> {
    return httpGet<string[]>('/pipeline-enhancer/layouts')
  },
  /** 获取可用的 Baoyu 风格列表 */
  getStyles(): Promise<ApiResponse<string[]>> {
    return httpGet<string[]>('/pipeline-enhancer/styles')
  },
}

// ============================================================
// 服务状态 API（复用 port-manager）
// ============================================================

export const serviceStatusApi = {
  /** 获取所有项目端口状态 */
  getStatus(): Promise<ApiResponse<{
    portManagerOnline: boolean
    services: Array<{
      name: string
      port: number
      online: boolean
      type: string
      tech?: string
    }>
    summary: {
      total: number
      online: number
    }
  }>> {
    return request.get('/service-status').then((res) => res.data)
  },
  /** 一键启动全部服务 */
  startAll(): Promise<ApiResponse<any>> {
    return request.post('/service-status/start-all').then((res) => res.data)
  },
  /** 一键停止全部服务 */
  stopAll(): Promise<ApiResponse<any>> {
    return request.post('/service-status/stop-all').then((res) => res.data)
  },
}

// ============================================================
// 业务流线 API
// ============================================================

/** 业务流线 DTO（与后端 BusinessFlow 对应） */
export interface BusinessFlowDTO {
  id: number
  name: string
  description: string
  nodes: any[]
  edges: any[]
  status: string
  lastRunAt: string | null
  runCount: number
  createdAt: string
  updatedAt: string
}

export interface BusinessFlowStepResultDTO {
  nodeId: string
  nodeLabel: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  result?: unknown
  error?: string
  startedAt: string
  completedAt: string
  durationMs?: number
  attempt?: number
  provider?: string
  model?: string
}

export interface BusinessFlowRunSummaryDTO {
  id: number
  flowId: number
  status: BusinessFlowStepResultDTO['status']
  startedAt: string
  completedAt?: string
  durationMs?: number
  error?: string
  stepCount: number
}

export interface BusinessFlowRunDetailDTO extends BusinessFlowRunSummaryDTO {
  inputData?: Record<string, unknown>
  steps: BusinessFlowStepResultDTO[]
}

export interface BusinessFlowExecutionResultDTO {
  flowId: number
  runId?: number
  status: BusinessFlowStepResultDTO['status']
  steps: BusinessFlowStepResultDTO[]
  startedAt: string
  completedAt: string
  durationMs?: number
}

/** 业务流线 API */
export const businessFlowApi = {
  /** 获取业务流线列表（分页） */
  getList(params?: { page?: number; pageSize?: number; status?: string }): Promise<PaginatedResponse<BusinessFlowDTO>> {
    return httpGetPaged<BusinessFlowDTO>('/business-flows', params)
  },
  /** 获取单个业务流线详情 */
  getById(id: number): Promise<ApiResponse<BusinessFlowDTO>> {
    return httpGet<BusinessFlowDTO>(`/business-flows/${id}`)
  },
  /** 创建业务流线 */
  create(data: { name: string; description: string; nodes: any[]; edges: any[] }): Promise<ApiResponse<BusinessFlowDTO>> {
    return httpPost<BusinessFlowDTO>('/business-flows', data)
  },
  /** 更新业务流线 */
  update(id: number, data: Partial<{ name: string; description: string; nodes: any[]; edges: any[]; status: string }>): Promise<ApiResponse<BusinessFlowDTO>> {
    return httpPut<BusinessFlowDTO>(`/business-flows/${id}`, data)
  },
  /** 删除业务流线 */
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/business-flows/${id}`).then(res => res.data)
  },
  /** 执行业务流线 */
  execute(id: number, inputData?: Record<string, unknown>): Promise<ApiResponse<BusinessFlowExecutionResultDTO>> {
    return httpPost<BusinessFlowExecutionResultDTO>(`/business-flows/${id}/execute`, { inputData })
  },
  /** 获取业务流线运行历史 */
  getRuns(id: number, limit = 20): Promise<ApiResponse<BusinessFlowRunSummaryDTO[]>> {
    return httpGet<BusinessFlowRunSummaryDTO[]>(`/business-flows/${id}/runs?limit=${limit}`)
  },
  /** 获取单次运行逐节点详情 */
  getRun(runId: number): Promise<ApiResponse<BusinessFlowRunDetailDTO>> {
    return httpGet<BusinessFlowRunDetailDTO>(`/business-flows/runs/${runId}`)
  },
}

export type ProjectNodeStatus = 'pending' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'skipped' | 'blocked'

export interface ProjectWorkflowNodeDTO {
  id: number
  workflowId: number
  nodeId: string
  nodeType: string
  moduleId: string
  label: string
  position: { x?: number; y?: number }
  status: ProjectNodeStatus
  prompt?: string
  config: Record<string, unknown>
  input?: unknown
  output?: unknown
  outputType?: string
  artifactRefs: unknown[]
  sourceRefs: unknown[]
  provider?: string
  model?: string
  error?: string
  attempt: number
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

export interface ProjectWorkbenchInputDTO {
  id: string
  nodeId: string
  nodeLabel: string
  type: string
  title: string
  summary: string
  value: unknown
  sourceRefs: unknown[]
}

export interface ProjectPromptRecommendationDTO {
  id: string
  title: string
  prompt: string
  reason: string
  fallback?: boolean
}

export interface ProjectNodeWorkbenchDTO {
  workflowId: number
  node: ProjectWorkflowNodeDTO
  inputs: ProjectWorkbenchInputDTO[]
  capabilities: {
    moduleId: string
    label: string
    inputRequired: boolean
    supportsPromptRecommendations: boolean
    supportsVideoGeneration: boolean
    blockedReason?: string
  }
  recommendations?: ProjectPromptRecommendationDTO[]
  recommendationMeta?: { provider?: string; model?: string; fallback?: boolean }
}

export interface ProjectWorkflowDTO {
  id: number
  flowId: number
  flowName?: string
  name: string
  description?: string
  status: 'draft' | 'running' | 'waiting_review' | 'ready_to_publish' | 'completed' | 'failed'
  mode: 'step' | 'continuous'
  initialInput: Record<string, unknown>
  nodesSnapshot: any[]
  edgesSnapshot: any[]
  currentNodeId?: string
  finalContentId?: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  nodes?: ProjectWorkflowNodeDTO[]
}

export const projectWorkflowApi = {
  getList(): Promise<ApiResponse<ProjectWorkflowDTO[]>> { return httpGet<ProjectWorkflowDTO[]>('/project-workflows') },
  getById(id: number): Promise<ApiResponse<ProjectWorkflowDTO>> { return httpGet<ProjectWorkflowDTO>(`/project-workflows/${id}`) },
  create(data: { flowId: number; name: string; description?: string; initialInput?: Record<string, unknown> }): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return httpPost<ProjectWorkflowDTO>('/project-workflows', data)
  },
  delete(id: number): Promise<ApiResponse<void>> { return request.delete(`/project-workflows/${id}`).then(res => res.data) },
  executeNode(id: number, nodeId: string, data?: { prompt?: string; config?: Record<string, unknown>; selectedInput?: ProjectWorkbenchInputDTO }): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return httpPost<ProjectWorkflowDTO>(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/execute`, data || {})
  },
  getWorkbench(id: number, nodeId: string): Promise<ApiResponse<ProjectNodeWorkbenchDTO>> {
    return httpGet<ProjectNodeWorkbenchDTO>(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/workbench`)
  },
  selectInput(id: number, nodeId: string, input: { id: string; value?: unknown }): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return request.put(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/input`, input).then(res => res.data)
  },
  recommendPrompts(id: number, nodeId: string): Promise<ApiResponse<{ recommendations: ProjectPromptRecommendationDTO[]; provider?: string; model?: string; fallback: boolean }>> {
    return httpPost(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/prompt-recommendations`, {})
  },
  generateVideo(id: number, nodeId: string, data: { url: string; strategy?: 'transcribe' | 'alchemist'; model?: string; language?: string; platform?: string; sourceText?: string }): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return request.post(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/video/generate`, data, { timeout: 86_400_000 }).then(res => res.data)
  },
  reuseVideo(id: number, nodeId: string, uid: string): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return httpPost<ProjectWorkflowDTO>(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/video/reuse`, { uid })
  },
  selectResult(id: number, nodeId: string, candidateId: string): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return httpPost<ProjectWorkflowDTO>(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/select-result`, { candidateId })
  },
  confirmNode(id: number, nodeId: string): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return httpPost<ProjectWorkflowDTO>(`/project-workflows/${id}/nodes/${encodeURIComponent(nodeId)}/confirm`, {})
  },
  executeContinuously(id: number): Promise<ApiResponse<ProjectWorkflowDTO>> {
    return httpPost<ProjectWorkflowDTO>(`/project-workflows/${id}/execute-continuously`, {})
  },
}

// ============================================================
// 对话式内容创作 API
// ============================================================

/** 对话 API */
export const chatApi = {
  /** 获取对话列表 */
  getConversations(): Promise<ApiResponse<Conversation[]>> {
    return httpGet<Conversation[]>('/chat/conversations')
  },
  /** 创建新对话 */
  createConversation(data: { title?: string; mode?: ChatMode }): Promise<ApiResponse<Conversation>> {
    return httpPost<Conversation>('/chat/conversations', data)
  },
  /** 获取对话详情 */
  getConversation(id: number): Promise<ApiResponse<Conversation>> {
    return httpGet<Conversation>(`/chat/conversations/${id}`)
  },
  /** 重命名对话 */
  rename(id: number, title: string): Promise<ApiResponse<Conversation>> {
    return httpPut<Conversation>(`/chat/conversations/${id}`, { title })
  },
  /** 删除对话 */
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/chat/conversations/${id}`).then(res => res.data)
  },
  /** 获取对话消息列表 */
  getMessages(conversationId: number): Promise<ApiResponse<ChatMessage[]>> {
    return httpGet<ChatMessage[]>(`/chat/conversations/${conversationId}/messages`)
  },
  /** 发送消息（非流式，等待 LLM 完整响应） */
  sendMessage(conversationId: number, content: string, mode?: ChatMode): Promise<ApiResponse<SendMessageResult>> {
    return request.post<ApiResponse<SendMessageResult>>(
      `/chat/conversations/${conversationId}/messages`,
      { content, mode },
      { timeout: 180_000 }
    ).then(res => res.data)
  },
  /** 确认某轮对话 */
  confirm(conversationId: number, messageId: number): Promise<ApiResponse<Conversation>> {
    return httpPost<Conversation>(`/chat/conversations/${conversationId}/confirm`, { messageId })
  },
  /** 重新生成助手消息 */
  regenerate(conversationId: number, messageId: number): Promise<ApiResponse<{ assistantMessage: ChatMessage }>> {
    return request.post<ApiResponse<{ assistantMessage: ChatMessage }>>(
      `/chat/conversations/${conversationId}/regenerate`,
      { messageId },
      { timeout: 180_000 }
    ).then(res => res.data)
  },
  /** 从对话生成内容 */
  generateContent(conversationId: number): Promise<ApiResponse<GenerateFromChatResult>> {
    return request.post<ApiResponse<GenerateFromChatResult>>(
      `/chat/conversations/${conversationId}/generate`,
      {},
      { timeout: 180_000 }
    ).then(res => res.data)
  },
  /** 获取 LLM 配置状态 */
  getLlmStatus(): Promise<ApiResponse<LlmStatus>> {
    return httpGet<LlmStatus>('/chat/llm-status')
  },
}

// ============================================================
// 内容模板 API
// ============================================================

export interface ContentTemplateDTO {
  id: number
  name: string
  description: string
  category: string
  subcategory?: string
  titleFormula?: string
  contentStructure?: string
  tags?: string
  emojiStyle?: string
  wordCountRange?: string
  bestFor?: string
  sampleTitle?: string
  sampleBody?: string
  usageCount: number
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

export const templateApi = {
  getList(params?: { category?: string; keyword?: string; page?: number; pageSize?: number }): Promise<ApiResponse<{ data: ContentTemplateDTO[]; total: number }>> {
    return httpGet<{ data: ContentTemplateDTO[]; total: number }>('/templates', params)
  },
  getCategories(): Promise<ApiResponse<string[]>> {
    return httpGet<string[]>('/templates/categories')
  },
  getById(id: number): Promise<ApiResponse<ContentTemplateDTO>> {
    return httpGet<ContentTemplateDTO>(`/templates/${id}`)
  },
  create(data: Partial<ContentTemplateDTO>): Promise<ApiResponse<ContentTemplateDTO>> {
    return httpPost<ContentTemplateDTO>('/templates', data)
  },
  update(id: number, data: Partial<ContentTemplateDTO>): Promise<ApiResponse<ContentTemplateDTO>> {
    return httpPut<ContentTemplateDTO>(`/templates/${id}`, data)
  },
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/templates/${id}`).then(res => res.data)
  },
  recordUse(id: number): Promise<ApiResponse<void>> {
    return httpPost(`/templates/${id}/use`)
  },
}

// ============================================================
// 内容优化 API
// ============================================================

export interface ContentOptimizeResult {
  score: number
  titleScore: number
  bodyScore: number
  structureScore: number
  suggestions: string[]
  optimizedTitle?: string
  optimizedBody?: string
}

export const optimizeApi = {
  optimize(data: { title: string; body: string; templateId?: number }): Promise<ApiResponse<ContentOptimizeResult>> {
    return httpPost<ContentOptimizeResult>('/contents/optimize', data)
  },
}

// ============================================================
// 系统管理 API（模板/Skill/LLM/模块统一管理）
// ============================================================

/** 模板管理（admin） */
export const adminTemplateApi = {
  getList(): Promise<ApiResponse<any[]>> {
    return request.get('/admin/templates').then((res) => res.data)
  },
  update(id: number, data: Record<string, any>): Promise<ApiResponse<any>> {
    return request.put(`/admin/templates/${id}`, data).then((res) => res.data)
  },
  create(data: Record<string, any>): Promise<ApiResponse<any>> {
    return request.post('/admin/templates', data).then((res) => res.data)
  },
  delete(id: number): Promise<ApiResponse<any>> {
    return request.delete(`/admin/templates/${id}`).then((res) => res.data)
  },
}

/** 技能管理（admin） */
export const adminSkillApi = {
  getList(): Promise<ApiResponse<any[]>> {
    return request.get('/admin/skills').then((res) => res.data)
  },
  update(name: string, data: Record<string, any>): Promise<ApiResponse<any>> {
    return request.put(`/admin/skills/${name}`, data).then((res) => res.data)
  },
}

/** LLM 配置（admin） */
export const adminLLMApi = {
  getList(): Promise<ApiResponse<any[]>> {
    return request.get('/admin/llm-config').then((res) => res.data)
  },
  update(provider: string, data: Record<string, any>): Promise<ApiResponse<any>> {
    return request.put(`/admin/llm-config/${provider}`, data).then((res) => res.data)
  },
  getDefault(): Promise<ApiResponse<{ provider: string }>> { return request.get('/admin/llm-default').then(res => res.data) },
  setDefault(provider: string): Promise<ApiResponse<{ provider: string }>> { return request.put('/admin/llm-default', { provider }).then(res => res.data) },
}

/** 模块管理（admin） */
export const adminModuleApi = {
  getList(): Promise<ApiResponse<any[]>> {
    return request.get('/admin/modules').then((res) => res.data)
  },
  update(id: string, data: Record<string, any>): Promise<ApiResponse<any>> {
    return request.put(`/admin/modules/${id}`, data).then((res) => res.data)
  },
}

/** 收藏管理（admin） */
export const adminFavoriteApi = {
  getList(type?: string): Promise<ApiResponse<any[]>> {
    const params = type ? { type } : {}
    return request.get('/admin/favorites', { params }).then((res) => res.data)
  },
  add(target_type: string, target_id: string, target_name: string): Promise<ApiResponse<any>> {
    return request.post('/admin/favorites', { target_type, target_id, target_name }).then((res) => res.data)
  },
  remove(type: string, id: string): Promise<ApiResponse<any>> {
    return request.delete(`/admin/favorites/${type}/${id}`).then((res) => res.data)
  },
}

/** 提示词管理（admin） */
export interface SystemPromptDTO {
  id: number
  name: string
  label: string
  category: string
  content: string
  description: string
  variables: string
  enabled: number
  display_order: number
  created_at: string
  updated_at: string
}

export const adminPromptApi = {
  getList(params?: { category?: string; enabled?: string }): Promise<ApiResponse<SystemPromptDTO[]>> {
    return request.get('/admin/prompts', { params }).then((res) => res.data)
  },
  create(data: { name: string; label: string; category?: string; content?: string; description?: string; variables?: string[] }): Promise<ApiResponse<SystemPromptDTO>> {
    return request.post('/admin/prompts', data).then((res) => res.data)
  },
  update(id: number, data: Partial<{ label: string; category: string; content: string; description: string; variables: string[]; enabled: boolean; display_order: number }>): Promise<ApiResponse<SystemPromptDTO>> {
    return request.put(`/admin/prompts/${id}`, data).then((res) => res.data)
  },
  delete(id: number): Promise<ApiResponse<void>> {
    return request.delete(`/admin/prompts/${id}`).then((res) => res.data)
  },
}

/** 系统统计 */
export const adminStatsApi = {
  get(): Promise<ApiResponse<any>> {
    return request.get('/admin/stats').then((res) => res.data)
  },
}

// ============================================================
// API 密钥管理（admin）- 集中管理 TikHub 等外部服务密钥
// ============================================================

/** API 密钥条目（前端展示用，密钥已掩码） */
export interface ApiKeyDTO {
  key_name: string
  label: string
  category: string
  api_key: string // 掩码后的密钥（如 tik1****abcd）
  has_key: number // 0=未设置, 1=已设置
  description?: string
  enabled: number
  display_order: number
  updated_at: string
}

/** API 密钥管理（admin） */
export const adminApiKeyApi = {
  /** 获取所有 API 密钥列表（密钥已掩码） */
  getList(): Promise<ApiResponse<ApiKeyDTO[]>> {
    return request.get('/admin/api-keys').then((res) => res.data)
  },
  /** 更新 API 密钥（传入新密钥会覆盖旧值，传掩码或空字符串则保持不变） */
  update(keyName: string, data: { api_key?: string; enabled?: number; label?: string; description?: string }): Promise<ApiResponse<ApiKeyDTO>> {
    return request.put(`/admin/api-keys/${keyName}`, data).then((res) => res.data)
  },
}

// ============================================================
// 系统设置管理（admin）- 运行时可编辑的系统级偏好
// ============================================================

/** 系统设置条目 */
export interface SystemSettingDTO {
  key: string
  value: string
  category: string
  label: string
  description?: string
  input_type: string // 'text' | 'number' | 'switch' | 'select'
  display_order: number
  updated_at: string
}

/** 系统设置管理（admin） */
export const adminSystemSettingsApi = {
  /** 获取所有系统设置 */
  getList(): Promise<ApiResponse<SystemSettingDTO[]>> {
    return request.get('/admin/system-settings').then((res) => res.data)
  },
  /** 更新单个系统设置项 */
  update(key: string, value: string): Promise<ApiResponse<SystemSettingDTO>> {
    return request.put(`/admin/system-settings/${key}`, { value }).then((res) => res.data)
  },
}

/** 系统信息（只读，运行时配置概览） */
export const adminSystemInfoApi = {
  get(): Promise<ApiResponse<Record<string, unknown>>> {
    return request.get('/admin/system-info').then((res) => res.data)
  },
}

// ============================================================
// 小红书流水线配置（复用 xhs-keywords / xhs-schedules / xhs-login API）
// ============================================================

/** 关键词条目 */
export interface XhsKeywordDTO {
  id: number
  keyword: string
  name?: string
  description?: string
  category?: string
  enabled: number
  last_used_at?: string
  use_count: number
  created_at: string
  updated_at: string
}

/** 定时任务条目 */
export interface XhsScheduleDTO {
  id: number
  name: string
  keyword: string
  cron_expression: string
  enabled: number
  last_run_at?: string
  next_run_at?: string
  run_count: number
  last_run_status?: string
  last_error?: string
  config?: string
  created_at: string
  updated_at: string
}

/** 小红书登录状态 */
export interface XhsLoginStatusDTO {
  is_logged_in: boolean
  cookie_age_days: number
  cookie_age_hours: number
  will_expire_soon: boolean
  is_expired: boolean
  last_login_time: string
  browser: string
  consecutive_failures: number
  max_cookie_age_days: number
  warning_threshold_days: number
}

/** 小红书关键词管理 API */
export const xhsKeywordsApi = {
  getList(params?: { enabled?: number }): Promise<ApiResponse<XhsKeywordDTO[]>> {
    return request.get('/xhs-keywords', { params }).then((res) => res.data)
  },
  create(data: { keyword: string; name?: string; description?: string; category?: string; enabled?: boolean }): Promise<ApiResponse<any>> {
    return request.post('/xhs-keywords', data).then((res) => res.data)
  },
  update(id: number, data: Partial<{ keyword: string; name: string; description: string; category: string; enabled: boolean }>): Promise<ApiResponse<any>> {
    return request.put(`/xhs-keywords/${id}`, data).then((res) => res.data)
  },
  delete(id: number): Promise<ApiResponse<any>> {
    return request.delete(`/xhs-keywords/${id}`).then((res) => res.data)
  },
  trigger(id: number): Promise<ApiResponse<any>> {
    return request.post(`/xhs-keywords/${id}/trigger`).then((res) => res.data)
  },
}

/** 小红书定时任务管理 API */
export const xhsSchedulesApi = {
  getList(): Promise<ApiResponse<XhsScheduleDTO[]>> {
    return request.get('/xhs-schedules').then((res) => res.data)
  },
  getStatus(): Promise<ApiResponse<any>> {
    return request.get('/xhs-schedules/status').then((res) => res.data)
  },
  create(data: { name: string; keyword: string; cron_expression: string; enabled?: boolean; config?: any }): Promise<ApiResponse<any>> {
    return request.post('/xhs-schedules', data).then((res) => res.data)
  },
  update(id: number, data: Partial<{ name: string; keyword: string; cron_expression: string; enabled: boolean; config: any }>): Promise<ApiResponse<any>> {
    return request.put(`/xhs-schedules/${id}`, data).then((res) => res.data)
  },
  delete(id: number): Promise<ApiResponse<any>> {
    return request.delete(`/xhs-schedules/${id}`).then((res) => res.data)
  },
  trigger(id: number): Promise<ApiResponse<any>> {
    return request.post(`/xhs-schedules/${id}/trigger`).then((res) => res.data)
  },
}

/** 小红书登录状态 API */
export const xhsLoginApi = {
  getStatus(): Promise<ApiResponse<XhsLoginStatusDTO>> {
    return request.get('/xhs-login/status').then((res) => res.data)
  },
  startQrLogin(): Promise<ApiResponse<any>> {
    return request.post('/xhs-login/qr').then((res) => res.data)
  },
  refresh(): Promise<ApiResponse<any>> {
    return request.post('/xhs-login/refresh').then((res) => res.data)
  },
  detectBrowser(): Promise<ApiResponse<{ browser: string; platform: string }>> {
    return request.get('/xhs-login/browser').then((res) => res.data)
  },
}

// ============================================================
// 流程编排分析 API
// ============================================================

/** 编排分析结果 */
export interface OrchestrationAnalysis {
  /** 是否合理 */
  reasonable: boolean
  /** LLM 分析文本 */
  analysis: string
  /** 存在的问题列表 */
  issues: string[]
  /** 优化建议列表 */
  suggestions: string[]
  /** 使用的 LLM 提供商 */
  provider?: string
  /** 实际使用的模型 */
  model?: string
  /** 调用耗时 */
  durationMs?: number
  /** 自动模式尝试过的提供商 */
  attemptedProviders?: string[]
}

/** 编排对话消息 */
export interface OrchestrationChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

/** 流程编排 API */
export const orchestrationApi = {
  /** 调用 LLM 分析编排方案 */
  analyze(data: {
    name: string
    description: string
    nodes: any[]
    edges: any[]
    requirementDoc?: string
    llmProvider?: string
    llmModel?: string
  }): Promise<ApiResponse<OrchestrationAnalysis>> {
    return request.post<ApiResponse<OrchestrationAnalysis>>(
      '/business-flows/analyze',
      data,
      { timeout: 180_000 }
    ).then(res => res.data)
  },
  /** 与 LLM 对话讨论编排方案 */
  chat(data: {
    name: string
    description: string
    nodes: any[]
    edges: any[]
    history: OrchestrationChatMessage[]
    message: string
    llmProvider?: string
    llmModel?: string
  }): Promise<ApiResponse<{ reply: string; provider?: string; model?: string; durationMs?: number; attemptedProviders?: string[] }>> {
    return request.post<ApiResponse<{ reply: string; provider?: string; model?: string; durationMs?: number; attemptedProviders?: string[] }>>(
      '/business-flows/orchestrate-chat',
      data,
      { timeout: 180_000 }
    ).then(res => res.data)
  },
}

export default {
  trends: trendsApi,
  hashtags: hashtagsApi,
  contents: contentsApi,
  publish: publishApi,
  analytics: analyticsApi,
  pipeline: pipelineApi,
  dashboard: dashboardApi,
  skills: skillApi,
  videoAlchemist: videoAlchemistApi,
  transcriber: transcriberApi,
  videoStudio: videoStudioApi,
  imageStudio: imageStudioApi,
  pipelineEnhancer: pipelineEnhancerApi,
  serviceStatus: serviceStatusApi,
  businessFlows: businessFlowApi,
  chat: chatApi,
  templates: templateApi,
  optimize: optimizeApi,
  orchestration: orchestrationApi,
}
