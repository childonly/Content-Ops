<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { videoStudioApi, adminFavoriteApi } from '@/api'
import type { UnifiedVideoRecord } from '@/api'

const router = useRouter()

// ============================================================
// 策略选择
// ============================================================

type Strategy = 'transcribe' | 'alchemist'
const activeStrategy = ref<Strategy>('transcribe')

// ============================================================
// URL 提取工具
// ============================================================

/**
 * 从用户输入中提取纯 URL。
 *
 * 用户经常从B站、抖音等平台复制分享文本，格式如：
 *   【《置身事内》为什么买不起房...-哔哩哔哩】 https://b23.tv/fIyXiuv
 *   https://www.douyin.com/video/xxx 复制此链接...
 *
 * 本函数使用正则提取第一个 http(s) URL，去除多余文本。
 */
function extractUrl(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/https?:\/\/[^\s\u3000\uff08\uff09\u3010\u3011\u300a\u300b\u201c\u201d\u2018\u2019]+/i)
  if (match) {
    return match[0]
  }
  return trimmed
}

/**
 * 从用户输入中提取 URL 之前的文字部分作为"链接名"。
 *
 * 用户经常从B站、抖音等平台复制分享文本，格式如：
 *   【《置身事内》为什么买不起房...-哔哩哔哩】 https://b23.tv/fIyXiuv
 *
 * 本函数提取 URL 之前的文字（去除 URL 及之后内容），
 * 如果只有 URL 没有其他文字则返回空字符串。
 */
function extractSourceText(input: string): string {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/https?:\/\/[^\s\u3000\uff08\uff09\u3010\u3011\u300a\u300b\u201c\u201d\u2018\u2019]+/i)
  if (!urlMatch) {
    // 没有 URL，说明纯文字输入，不作为链接名
    return ''
  }
  const urlIndex = trimmed.indexOf(urlMatch[0])
  if (urlIndex <= 0) {
    return ''
  }
  const textBeforeUrl = trimmed.substring(0, urlIndex).trim()
  return textBeforeUrl
}

// ============================================================
// 输入区
// ============================================================
const urlInput = ref<string>('')

// 转录选项
const model = ref<string>('medium')
const language = ref<string>('auto')

const modelOptions = [
  { label: 'tiny（最快，精度低）', value: 'tiny' },
  { label: 'base（较快，精度一般）', value: 'base' },
  { label: 'small（均衡，精度较好）', value: 'small' },
  { label: 'medium（推荐，精度高）', value: 'medium' },
  { label: 'large-v2（很慢，精度很高）', value: 'large-v2' },
  { label: 'large-v3（最慢，精度最高）', value: 'large-v3' },
]

const languageOptions = [
  { label: '自动检测', value: 'auto' },
  { label: '中文', value: 'zh' },
  { label: '英文', value: 'en' },
  { label: '日语', value: 'ja' },
]

// 炼金术选项
const platform = ref<string>('xiaohongshu')

const platformOptions = [
  { label: '小红书', value: 'xiaohongshu' },
  { label: '抖音', value: 'douyin' },
  { label: '微博', value: 'weibo' },
  { label: '微信公众号', value: 'wechat' },
  { label: '知乎', value: 'zhihu' },
]

// ============================================================
// 处理进度（真实进度轮询）
// ============================================================
const processing = ref<boolean>(false)

// 转录进度（真实数据，来自后端轮询）
const progress = ref<number>(0)
const progressStage = ref<string>('')
const progressTip = ref<string>('')
const progressElapsed = ref<number>(0)
const progressEstimated = ref<number | null>(null)
const progressRemaining = ref<number | null>(null)
const progressPosition = ref<number>(0)
const progressTotalDuration = ref<number>(0)
const progressSegmentCount = ref<number>(0)
const progressModel = ref<string>('')
const progressLastLog = ref<string>('')
const progressLogs = ref<string[]>([])
const showLogs = ref<boolean>(false)

let progressTimer: ReturnType<typeof setInterval> | null = null
let logTimer: ReturnType<typeof setInterval> | null = null
let stepTimer: ReturnType<typeof setInterval> | null = null
let currentTranscribeUrl = ''

/** 阶段中文映射 */
const STAGE_LABELS: Record<string, string> = {
  pre_checking: '视频预检查中',
  downloading: '下载音频中',
  loading_model: '加载模型中',
  transcribing: 'ASR 转录中',
  post_processing: '后处理中',
  completed: '已完成',
  failed: '失败',
}

/** 秒 → 可读时长 (X分Y秒 / X时Y分Z秒) */
function formatElapsed(sec: number): string {
  if (sec <= 0) return '0秒'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}时${m}分${s}秒`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

/** 开始真实进度轮询 */
function startTranscribeProgress(url: string): void {
  stopProgress()
  currentTranscribeUrl = url
  progress.value = 1
  progressStage.value = '初始化中...'
  progressTip.value = '正在准备转录环境'
  progressElapsed.value = 0
  progressEstimated.value = null
  progressRemaining.value = null
  progressPosition.value = 0
  progressTotalDuration.value = 0
  progressSegmentCount.value = 0
  progressModel.value = ''
  progressLastLog.value = ''
  progressLogs.value = []
  showLogs.value = false

  // 每 3 秒轮询进度
  progressTimer = setInterval(async () => {
    if (!currentTranscribeUrl) return
    try {
      const res = await videoStudioApi.getProgress(currentTranscribeUrl)
      if (res.data) {
        progress.value = res.data.percentage || progress.value
        progressStage.value = STAGE_LABELS[res.data.stage] || res.data.stage
        progressElapsed.value = res.data.elapsed_seconds || 0
        progressEstimated.value = res.data.estimated_total_seconds
        progressRemaining.value = res.data.remaining_seconds
        progressPosition.value = res.data.current_position || 0
        progressTotalDuration.value = res.data.total_duration || 0
        progressSegmentCount.value = res.data.segment_count || 0
        progressModel.value = res.data.model || ''
        progressLastLog.value = res.data.last_log || ''

        // 根据阶段设置提示
        if (res.data.stage === 'downloading') {
          progressTip.value = '正在通过 yt-dlp 下载视频音频轨道'
        } else if (res.data.stage === 'loading_model') {
          progressTip.value = `正在加载 Whisper ${res.data.model} 模型，首次加载需要一些时间`
        } else if (res.data.stage === 'transcribing') {
          const pos = formatElapsed(res.data.current_position)
          const total = formatElapsed(res.data.total_duration)
          const est = res.data.estimated_total_seconds ? formatElapsed(res.data.estimated_total_seconds) : null
          const rem = res.data.remaining_seconds ? formatElapsed(res.data.remaining_seconds) : null
          progressTip.value = `faster-whisper 正在识别语音: ${pos} / ${total} | 已处理 ${res.data.segment_count} 个片段` +
            (est ? ` | 预计总用时 ${est}` : '') +
            (rem ? ` | 剩余约 ${rem}` : '')
        } else if (res.data.stage === 'post_processing') {
          progressTip.value = '正在执行说话人检测和章节分析'
        }
      }
    } catch {
      // 轮询失败不影响进度显示
    }
  }, 3000)

  // 每 5 秒轮询 PM2 日志
  logTimer = setInterval(async () => {
    try {
      const res = await videoStudioApi.getLogs(20)
      if (res.data && typeof res.data === 'string') {
        progressLogs.value = res.data
          .split('\n')
          .filter((l) => l.trim())
          .slice(-15) // 只保留最近 15 行
      }
    } catch {
      // 日志获取失败不影响主流程
    }
  }, 5000)
}

// 炼金术进度（el-steps）
const activeStep = ref<number>(-1)

const alchemistSteps = [
  { title: '提取文字', description: '转录视频音频为文字' },
  { title: '提炼观点', description: '识别核心内容要点' },
  { title: '改写内容', description: '适配目标平台风格' },
  { title: '生成配图', description: '生成配套图片素材' },
]

function startAlchemistProgress(): void {
  stopProgress()
  activeStep.value = 0
  stepTimer = setInterval(() => {
    if (activeStep.value < alchemistSteps.length - 1) {
      activeStep.value += 1
    }
  }, 2500)
}

function stopProgress(): void {
  if (progressTimer !== null) {
    clearInterval(progressTimer)
    progressTimer = null
  }
  if (logTimer !== null) {
    clearInterval(logTimer)
    logTimer = null
  }
  if (stepTimer !== null) {
    clearInterval(stepTimer)
    stepTimer = null
  }
  currentTranscribeUrl = ''
}

/** 重置所有进度状态变量到初始值 */
function resetProgressState(): void {
  progress.value = 0
  progressStage.value = ''
  progressTip.value = ''
  progressElapsed.value = 0
  progressEstimated.value = null
  progressRemaining.value = null
  progressPosition.value = 0
  progressTotalDuration.value = 0
  progressSegmentCount.value = 0
  progressModel.value = ''
  progressLastLog.value = ''
  progressLogs.value = []
  showLogs.value = false
  activeStep.value = -1
}

// ============================================================
// 结果展示（右侧抽屉）
// ============================================================
const currentResult = ref<UnifiedVideoRecord | null>(null)
const drawerVisible = ref<boolean>(false)

// 转录结果 Tab
const activeTab = ref<string>('verbatim')

const transcriptText = computed<string>(() => currentResult.value?.transcript || '')
const fullTextContent = computed<string>(() => currentResult.value?.fullText || '')
const summaryContent = computed<string>(() => currentResult.value?.summary || '')

/** 全文稿按段落拆分 */
const fullTextParagraphs = computed<string[]>(() => {
  const text = fullTextContent.value
  if (!text) return []
  return text.split(/\n{2,}/).filter((p) => p.trim())
})

/** 总结稿按段落拆分 */
const summaryParagraphs = computed<string[]>(() => {
  const text = summaryContent.value
  if (!text) return []
  return text.split(/\n{2,}/).filter((p) => p.trim())
})

const speakerCount = computed<number>(() => {
  if (!currentResult.value?.segments) return 0
  const speakers = new Set<string>()
  currentResult.value.segments.forEach(s => {
    if (s.speaker) speakers.add(s.speaker)
  })
  return speakers.size || 1
})

// 炼金术结果
const transcriptCollapsed = ref<boolean>(false)

const rewriteFullText = computed<string>(() => {
  if (!currentResult.value) return ''
  const r = currentResult.value
  const parts: string[] = []
  if (r.rewrittenTitle) parts.push(r.rewrittenTitle)
  if (r.rewrittenBody) parts.push(r.rewrittenBody)
  if (r.rewrittenTags && r.rewrittenTags.length) {
    parts.push(r.rewrittenTags.map((t) => `#${t}`).join(' '))
  }
  return parts.join('\n\n')
})

/** 关闭结果展示，恢复到初始输入状态 */
function closeResult(): void {
  drawerVisible.value = false
  currentResult.value = null
  resetProgressState()
  activeTab.value = 'verbatim'
  transcriptCollapsed.value = false
  selectionMenuVisible.value = false
  selectedText.value = ''
}

// ============================================================
// AI 总结稿生成
// ============================================================
const summarizing = ref<boolean>(false)
const regeneratingFullText = ref<boolean>(false)
const regeneratingFullTextLLM = ref<boolean>(false)

/** 重新生成全文稿（仅标点和分段，不重新 ASR） */
async function handleRegenerateFullText(useLLM: boolean): Promise<void> {
  if (!currentResult.value) return

  if (useLLM) {
    regeneratingFullTextLLM.value = true
  } else {
    regeneratingFullText.value = true
  }

  try {
    const res = await videoStudioApi.regenerateFullText(currentResult.value.uid, useLLM)
    if (res.data) {
      // 只更新 fullText 字段，保留其他所有字段不动
      currentResult.value.fullText = res.data.fullText
      ElMessage.success(useLLM ? 'LLM 标点修复完成' : '规则断句重新生成完成')
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`重新生成全文稿失败: ${errMsg}`)
  } finally {
    regeneratingFullText.value = false
    regeneratingFullTextLLM.value = false
  }
}

async function handleSummarize(): Promise<void> {
  if (!currentResult.value) return
  summarizing.value = true
  try {
    const res = await videoStudioApi.summarize(currentResult.value.uid)
    if (res.data) {
      // 只合并 summary 字段，保留其他所有字段不动（避免覆盖丢失 transcript/fullText 等）
      currentResult.value.summary = res.data.summary
      ElMessage.success('总结稿已生成')
      activeTab.value = 'summary'
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`生成总结稿失败: ${errMsg}`)
  } finally {
    summarizing.value = false
  }
}

// ============================================================
// 提交至内容创作
// ============================================================
const submitting = ref<boolean>(false)

async function handleSubmitToContent(): Promise<void> {
  if (!currentResult.value) return
  submitting.value = true
  try {
    const res = await videoStudioApi.submitToContent(currentResult.value.uid)
    if (res.data) {
      ElMessage.success('已提交至内容工作室，AI 正在分析内容...')
      // 后端异步处理 LLM 回复，前端跳转后自动轮询加载消息
      router.push({ path: '/content', query: { tab: 'chat', convId: String(res.data.conversationId) } })
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`提交失败: ${errMsg}`)
  } finally {
    submitting.value = false
  }
}

// ============================================================
// 工具函数
// ============================================================
const statusConfig: Record<string, { label: string; type: 'info' | 'warning' | 'success' | 'danger' }> = {
  pending: { label: '待处理', type: 'info' },
  processing: { label: '处理中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'danger' },
}

function statusLabel(s?: string): string {
  return statusConfig[s || '']?.label || s || '-'
}

function statusType(s?: string): 'info' | 'warning' | 'success' | 'danger' {
  return statusConfig[s || '']?.type || 'info'
}

function modelLabel(m?: string): string {
  return m || '-'
}

function strategyLabel(s?: string): string {
  if (s === 'transcribe') return '转录'
  if (s === 'alchemist') return '炼金术'
  return '-'
}

function strategyTagType(s?: string): 'primary' | 'warning' {
  return s === 'alchemist' ? 'warning' : 'primary'
}

function platformLabel(p?: string): string {
  if (!p) return '-'
  const map: Record<string, string> = {
    xiaohongshu: '小红书',
    douyin: '抖音',
    weibo: '微博',
    wechat: '微信公众号',
    zhihu: '知乎',
  }
  return map[p] || p
}

/** 从 URL 中提取可读的域名/平台名称 */
function extractDomainName(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host.includes('bilibili') || host.includes('b23.tv')) return 'B站'
    if (host.includes('douyin')) return '抖音'
    if (host.includes('xiaohongshu') || host.includes('xhslink')) return '小红书'
    if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube'
    if (host.includes('tiktok')) return 'TikTok'
    return host
  } catch {
    return url.substring(0, 30)
  }
}

/** 秒 → HH:MM:SS */
function formatTimestamp(sec?: number): string {
  if (sec === undefined || sec === null || isNaN(sec)) return '00:00:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// ============================================================
// 说话人标签（多角色区分）
// ============================================================
const speakerMap = ref<Record<string, number>>({})
let speakerNextIndex = 0

function getSpeakerIndex(speaker: string): number {
  if (!speakerMap.value[speaker]) {
    speakerMap.value[speaker] = speakerNextIndex++
  }
  return speakerMap.value[speaker]
}

/** 秒 → X分Y秒 */
function formatDuration(sec?: number): string {
  if (sec === undefined || sec === null || isNaN(sec)) return '-'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}分${s}秒`
}

function formatDateTime(utcStr?: string): string {
  if (!utcStr) return '-'
  try {
    const normalized = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z'
    const date = new Date(normalized)
    if (isNaN(date.getTime())) return utcStr
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${y}-${m}-${d} ${h}:${min}:${s}`
  } catch {
    return utcStr
  }
}

function copyText(text: string): void {
  if (!text) {
    ElMessage.warning('暂无内容可复制')
    return
  }
  navigator.clipboard
    .writeText(text)
    .then(() => ElMessage.success('已复制到剪贴板'))
    .catch(() => ElMessage.error('复制失败'))
}

// ============================================================
// 历史记录（统一列表）
// ============================================================
const loading = ref<boolean>(false)
const viewing = ref<string>('')
const runList = ref<UnifiedVideoRecord[]>([])
const selectedRows = ref<UnifiedVideoRecord[]>([])
const listFilter = ref<Strategy | ''>('')

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
})

async function loadList(): Promise<void> {
  loading.value = true
  try {
    const res = await videoStudioApi.getRecords({
      page: pagination.page,
      pageSize: pagination.pageSize,
      strategy: listFilter.value || undefined,
    })
    runList.value = res.data
    pagination.total = res.total
  } catch (error) {
    console.error('加载历史记录失败:', error)
  } finally {
    loading.value = false
  }
}

/** 表格选择变化 */
function handleSelectionChange(rows: UnifiedVideoRecord[]): void {
  selectedRows.value = rows
}

/** 批量删除 */
async function handleBatchDelete(): Promise<void> {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先选择要删除的记录')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedRows.value.length} 条记录吗？此操作不可恢复。`,
      '批量删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }

  try {
    const uids = selectedRows.value.map((r) => r.uid)
    const res = await videoStudioApi.batchDelete(uids)
    ElMessage.success(`已删除 ${res.data?.deleted ?? uids.length} 条记录`)
    selectedRows.value = []
    await loadList()
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`批量删除失败: ${errMsg}`)
  }
}

/** 筛选变化 */
function handleFilterChange(): void {
  pagination.page = 1
  loadList()
}

// ============================================================
// 收藏功能
// ============================================================
const favoritedRecords = ref<Set<string>>(new Set())
const favoriteLoading = ref(false)

/** 加载已收藏的视频记录 UID 集合 */
async function loadFavorites(): Promise<void> {
  try {
    const res = await adminFavoriteApi.getList('video_record')
    if (res.success && res.data) {
      favoritedRecords.value = new Set(res.data.map((f: any) => f.target_id))
    }
  } catch (error) {
    console.error('加载收藏列表失败:', error)
  }
}

/** 切换收藏状态 */
async function toggleFavorite(uid: string): Promise<void> {
  if (!uid) return
  favoriteLoading.value = true
  try {
    if (favoritedRecords.value.has(uid)) {
      await adminFavoriteApi.remove('video_record', uid)
      favoritedRecords.value.delete(uid)
      favoritedRecords.value = new Set(favoritedRecords.value)
      ElMessage.success('已取消收藏')
    } else {
      const record = runList.value.find(r => r.uid === uid) || currentResult.value
      const name = record?.sourceText || record?.url?.substring(0, 50) || uid
      await adminFavoriteApi.add('video_record', uid, name)
      favoritedRecords.value.add(uid)
      favoritedRecords.value = new Set(favoritedRecords.value)
      ElMessage.success('已收藏')
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`收藏操作失败: ${errMsg}`)
  } finally {
    favoriteLoading.value = false
  }
}

/** 判断是否已收藏 */
function isFavorited(uid: string): boolean {
  return favoritedRecords.value.has(uid)
}

// ============================================================
// 文本选择收藏到笔记
// ============================================================
const selectedText = ref('')
const selectedTimestamp = ref<number | null>(null)
const selectionMenuVisible = ref(false)
const selectionMenuX = ref(0)
const selectionMenuY = ref(0)
const savingNote = ref(false)

/** 转录区域文本选择处理 — 显示浮动收藏按钮 */
function handleTranscriptSelection(): void {
  // 延迟一帧让浏览器完成选区计算
  setTimeout(() => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() || ''
    if (text.length > 0 && selection && selection.rangeCount > 0) {
      selectedText.value = text

      // 尝试从最近的 verbatim-line 元素提取时间戳
      let ts: number | null = null
      const anchor = selection.anchorNode
      if (anchor) {
        const el = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as HTMLElement) : anchor.parentElement
        const line = el?.closest('.verbatim-line')
        if (line) {
          ts = parseFloat(line.getAttribute('data-start') || '') || null
        }
      }
      selectedTimestamp.value = ts

      // 定位浮动按钮到选区上方居中
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      selectionMenuX.value = rect.left + rect.width / 2
      selectionMenuY.value = rect.top
      selectionMenuVisible.value = true
    } else {
      selectionMenuVisible.value = false
    }
  }, 10)
}

/** 关闭浮动菜单 */
function closeSelectionMenu(): void {
  selectionMenuVisible.value = false
}

/** 收藏选中文本到笔记 */
async function handleSaveToNotes(): Promise<void> {
  if (!selectedText.value || !currentResult.value) return
  savingNote.value = true
  try {
    const videoTitle =
      currentResult.value.sourceText ||
      extractDomainName(currentResult.value.url) ||
      currentResult.value.url
    await videoStudioApi.saveNote({
      videoUid: currentResult.value.uid,
      videoTitle,
      sourceUrl: currentResult.value.url,
      timestamp: selectedTimestamp.value,
      selectedText: selectedText.value,
    })
    ElMessage.success('已收藏到笔记')
    closeSelectionMenu()
    window.getSelection()?.removeAllRanges()
    selectedText.value = ''
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`收藏到笔记失败: ${errMsg}`)
  } finally {
    savingNote.value = false
  }
}

/** 文档级 mousedown — 点击浮动菜单外部时关闭 */
function handleDocumentMousedown(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (selectionMenuVisible.value && !target.closest('.selection-menu')) {
    selectionMenuVisible.value = false
  }
}

// ============================================================
// 开始处理
// ============================================================
async function handleProcess(): Promise<void> {
  if (!urlInput.value.trim()) {
    ElMessage.warning('请输入视频 URL')
    return
  }

  const cleanUrl = extractUrl(urlInput.value)
  if (!cleanUrl.startsWith('http')) {
    ElMessage.warning('未识别到有效的视频 URL，请检查输入')
    return
  }

  // ⚠️ 必须在覆盖 urlInput 之前提取 sourceText
  // 因为 extractSourceText 依赖原始输入中的 URL 之前的文字
  const sourceText = extractSourceText(urlInput.value)

  if (cleanUrl !== urlInput.value.trim()) {
    urlInput.value = cleanUrl
  }

  // === 转录策略：先预检查视频时长 ===
  if (activeStrategy.value === 'transcribe') {
    processing.value = true
    progressStage.value = '视频预检查中'
    progressTip.value = '正在获取视频时长和元数据'
    progress.value = 0

    try {
      const checkRes = await videoStudioApi.checkVideo(cleanUrl, model.value)
      const checkData = checkRes.data

      if (checkData?.error) {
        // 预检查失败（可能是网络问题），不阻断流程，继续尝试转录
        console.warn('预检查失败，继续尝试转录:', checkData.error)
      } else if (checkData?.exceedsLimit) {
        // 视频时长超过限制
        processing.value = false
        progress.value = 0
        progressStage.value = ''
        progressTip.value = ''
        const durationMin = Math.round(checkData.duration / 60)
        const maxMin = Math.round(checkData.maxDuration / 60)
        ElMessage.error(
          `视频时长 ${durationMin} 分钟超过最大支持时长 ${maxMin} 分钟，不支持转录。请选择较短的视频。`
        )
        return
      } else if (checkData?.isLongVideo) {
        // 长视频警告，需要用户确认
        const durationMin = Math.round(checkData.duration / 60)
        const estimatedMin = Math.round(checkData.estimatedTranscriptionTime / 60)
        const titleStr = checkData.title ? `《${checkData.title.substring(0, 30)}》` : '该视频'

        try {
          await ElMessageBox.confirm(
            `${titleStr}时长 ${durationMin} 分钟，使用 ${model.value} 模型预计转录约 ${estimatedMin} 分钟。\n\n` +
            '转录期间请勿关闭浏览器页面。系统会持续显示实时进度。\n\n' +
            '确认要开始转录吗？',
            '长视频转录确认',
            {
              confirmButtonText: '开始转录',
              cancelButtonText: '取消',
              type: 'warning',
            }
          )
        } catch {
          // 用户取消
          processing.value = false
          progress.value = 0
          progressStage.value = ''
          progressTip.value = ''
          return
        }
      }
    } catch {
      // 预检查异常不阻断流程，继续尝试转录
      console.warn('预检查异常，继续尝试转录')
    }

    // 预检查通过（或跳过），开始实际转录
    processing.value = true
    currentResult.value = null
    startTranscribeProgress(cleanUrl)
  } else {
    // 炼金术策略不需要预检查
    processing.value = true
    currentResult.value = null
    startAlchemistProgress()
  }

  try {
    const res = await videoStudioApi.process({
      url: cleanUrl,
      strategy: activeStrategy.value,
      model: activeStrategy.value === 'transcribe' ? model.value : undefined,
      language: activeStrategy.value === 'transcribe'
        ? (language.value !== 'auto' ? language.value : undefined)
        : undefined,
      sourceText: sourceText || undefined,
      platform: activeStrategy.value === 'alchemist' ? platform.value : undefined,
    })

    stopProgress()

    if (activeStrategy.value === 'transcribe') {
      progress.value = 100
      progressStage.value = '完成'
      progressTip.value = ''
    } else {
      activeStep.value = alchemistSteps.length
    }

    currentResult.value = res.data ?? null

    if (res.data?.status === 'failed') {
      // 检查是否是时长超限错误
      const errMsg = res.data.errorMessage || '未知错误'
      if (errMsg.includes('超过最大支持时长')) {
        ElMessage.error(errMsg)
      } else {
        ElMessage.error(`处理失败: ${errMsg}`)
      }
    } else if (activeStrategy.value === 'transcribe') {
      const segCount = res.data?.segments?.length ?? 0
      ElMessage.success(`转录完成（${segCount} 个片段）`)
    } else {
      ElMessage.success('处理完成')
    }

    await loadList()
    drawerVisible.value = true
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('处理失败:', error)

    // 判断错误类型
    const isNetworkError = errMsg.includes('Network Error') || errMsg.includes('ECONNABORTED')
    const isTimeout = errMsg.includes('timeout') || errMsg.includes('超时')
    const isConnectError = errMsg.includes('ConnectTimeout') || errMsg.includes('WinError 10060')

    if (isConnectError) {
      // 网络连接问题（下载模型时常见）
      stopProgress()
      resetProgressState()
      ElMessage.error('处理失败: 网络连接超时，可能是在下载 Whisper 模型。请使用 tiny 模型（本地已缓存）后重试。')
    } else if (isNetworkError || isTimeout) {
      // HTTP 连接断开或超时，但后端 Python 转录进程可能仍在运行
      // 不停止进度轮询，让用户继续看到真实进度
      ElMessage.warning(
        '与服务器连接中断，但转录进程可能仍在后台运行。请观察下方进度信息，' +
        '如进度仍在更新则请耐心等待；如长时间无更新请刷新页面查看历史记录。'
      )
      // 保持进度轮询运行，不重置进度状态
      // 用户可通过进度条判断转录是否仍在进行
    } else {
      // 其他错误（如转录失败）
      stopProgress()
      resetProgressState()
      ElMessage.error(`处理失败: ${errMsg}`)
    }
  } finally {
    processing.value = false
  }
}

// ============================================================
// 查看 / 删除
// ============================================================
async function handleView(row: UnifiedVideoRecord): Promise<void> {
  viewing.value = row.uid
  try {
    const res = await videoStudioApi.getRecord(row.uid)
    currentResult.value = res.data ?? null

    // 根据来源设置展示状态
    if (currentResult.value?.source === 'transcription') {
      activeStrategy.value = 'transcribe'
      if (res.data?.status === 'completed') {
        progress.value = 100
        progressStage.value = '完成'
      } else {
        progress.value = 0
        progressStage.value = ''
      }
    } else {
      activeStrategy.value = 'alchemist'
      activeStep.value = res.data?.status === 'completed' ? alchemistSteps.length : -1
      transcriptCollapsed.value = false
    }

    ElMessage.success('已加载记录')
    drawerVisible.value = true
  } catch (error) {
    console.error('加载记录失败:', error)
  } finally {
    viewing.value = ''
  }
}

async function handleDelete(row: UnifiedVideoRecord): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除该条记录吗？此操作不可恢复。', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  try {
    await videoStudioApi.deleteRecord(row.uid)
    ElMessage.success('删除成功')
    if (currentResult.value?.uid === row.uid) {
      currentResult.value = null
      progress.value = 0
      progressStage.value = ''
      activeStep.value = -1
    }
    await loadList()
  } catch (error) {
    console.error('删除失败:', error)
  }
}

// ============================================================
// 重新生成（基于缓存继续生成，仅转录策略可用）
// ============================================================
const regenerating = ref<string>('')

async function handleRegenerate(row: UnifiedVideoRecord): Promise<void> {
  regenerating.value = row.uid
  try {
    await ElMessageBox.confirm(
      '确定重新生成此记录吗？如果有缓存将基于缓存继续生成。',
      '重新生成确认',
      {
        confirmButtonText: '重新生成',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    // 用户取消
    regenerating.value = ''
    return
  }

  try {
    const res = await videoStudioApi.regenerate(row.uid)
    if (res.data) {
      currentResult.value = res.data
      ElMessage.success('已开始重新生成，请关注下方进度')
      // 启动进度跟踪（仅转录来源有 URL 可用于轮询）
      if (currentResult.value.source === 'transcription' && currentResult.value.url) {
        startTranscribeProgress(currentResult.value.url)
      }
      await loadList()
      // 重新生成完成后不自动打开抽屉；用户可点击"查看"按钮
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`重新生成失败: ${errMsg}`)
  } finally {
    regenerating.value = ''
  }
}

// ============================================================
// 分页
// ============================================================
function handlePageChange(page: number): void {
  pagination.page = page
  loadList()
}

onMounted(() => {
  loadList()
  loadFavorites()
  document.addEventListener('mousedown', handleDocumentMousedown)
})

onUnmounted(() => {
  stopProgress()
  document.removeEventListener('mousedown', handleDocumentMousedown)
})
</script>

<template>
  <div class="page-container">
    <!-- 头部 -->
    <div class="page-header">
      <div>
        <span class="page-title">视频工作室</span>
        <p class="page-desc">统一视频处理入口 — 转录（本地 ASR）与炼金术（提取+改写）一站式完成</p>
      </div>
    </div>

    <!-- 策略选择 + 输入区 -->
    <el-card shadow="never" class="mb-16">
      <!-- 策略切换 -->
      <div class="strategy-tabs">
        <div
          class="strategy-tab"
          :class="{ active: activeStrategy === 'transcribe' }"
          @click="activeStrategy = 'transcribe'"
        >
          <el-icon><Microphone /></el-icon>
          <div class="strategy-tab-info">
            <span class="strategy-tab-label">视频转录</span>
            <span class="strategy-tab-desc">本地 ASR 引擎，高精度语音转文字</span>
          </div>
        </div>
        <div
          class="strategy-tab"
          :class="{ active: activeStrategy === 'alchemist' }"
          @click="activeStrategy = 'alchemist'"
        >
          <el-icon><MagicStick /></el-icon>
          <div class="strategy-tab-info">
            <span class="strategy-tab-label">视频炼金术</span>
            <span class="strategy-tab-desc">提取内容、提炼观点、改写多平台图文</span>
          </div>
        </div>
      </div>

      <el-divider style="margin: 16px 0" />

      <!-- 输入栏 -->
      <div class="input-bar">
        <el-input
          v-model="urlInput"
          placeholder="请输入视频 URL（支持B站分享文本自动提取链接）"
          clearable
          style="flex: 1; min-width: 280px"
          @keyup.enter="handleProcess"
        >
          <template #prefix>
            <el-icon><Link /></el-icon>
          </template>
        </el-input>

        <!-- 转录模式选项 -->
        <template v-if="activeStrategy === 'transcribe'">
          <el-select v-model="model" style="width: 210px">
            <el-option
              v-for="opt in modelOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-select v-model="language" style="width: 140px">
            <el-option
              v-for="opt in languageOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </template>

        <!-- 炼金术模式选项 -->
        <template v-else>
          <el-select v-model="platform" style="width: 160px">
            <el-option
              v-for="opt in platformOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </template>

        <el-button type="primary" :loading="processing" @click="handleProcess">
          <el-icon v-if="!processing">
            <Microphone v-if="activeStrategy === 'transcribe'" />
            <MagicStick v-else />
          </el-icon>
          {{ processing ? '处理中...' : (activeStrategy === 'transcribe' ? '开始转录' : '开始处理') }}
        </el-button>
      </div>
    </el-card>

    <!-- 处理进度 -->
    <el-card v-if="processing || progress > 0 || activeStep >= 0" shadow="never" class="mb-16">
      <!-- 转录进度条（真实数据） -->
      <template v-if="activeStrategy === 'transcribe'">
        <div class="progress-block">
          <div class="progress-header">
            <span class="progress-stage">{{ progressStage || '准备中...' }}</span>
            <span v-if="progressModel" class="progress-model">模型: {{ progressModel }}</span>
          </div>
          <el-progress
            :percentage="Math.round(progress)"
            :status="progress >= 100 ? 'success' : ''"
            :stroke-width="18"
            :text-inside="true"
            :format="(p: number) => `${Math.round(p)}%`"
          />

          <!-- 详细进度信息 -->
          <div class="progress-details" v-if="progress < 100 && progress > 0">
            <div class="progress-detail-row" v-if="progressTotalDuration > 0">
              <span class="progress-detail-label">转录位置</span>
              <span class="progress-detail-value">{{ formatElapsed(progressPosition) }} / {{ formatElapsed(progressTotalDuration) }}</span>
            </div>
            <div class="progress-detail-row" v-if="progressElapsed > 0">
              <span class="progress-detail-label">已耗时</span>
              <span class="progress-detail-value">{{ formatElapsed(progressElapsed) }}</span>
            </div>
            <div class="progress-detail-row" v-if="progressEstimated && progressEstimated > 0">
              <span class="progress-detail-label">预计总用时</span>
              <span class="progress-detail-value">{{ formatElapsed(progressEstimated) }}</span>
            </div>
            <div class="progress-detail-row" v-if="progressRemaining !== null && progressRemaining > 0">
              <span class="progress-detail-label">剩余用时</span>
              <span class="progress-detail-value">{{ formatElapsed(progressRemaining) }}</span>
            </div>
            <div class="progress-detail-row" v-if="progressSegmentCount > 0">
              <span class="progress-detail-label">已处理片段</span>
              <span class="progress-detail-value">{{ progressSegmentCount }} 个</span>
            </div>
          </div>

          <div v-if="progressTip && progress < 100" class="progress-tip">{{ progressTip }}</div>

          <!-- 最近日志行 -->
          <div v-if="progressLastLog && progress < 100" class="progress-last-log">
            <el-icon><InfoFilled /></el-icon>
            <span>{{ progressLastLog }}</span>
          </div>

          <!-- PM2 日志查看（可折叠） -->
          <div class="progress-logs-section" v-if="progress < 100">
            <el-button text size="small" @click="showLogs = !showLogs">
              <el-icon><Document /></el-icon>
              {{ showLogs ? '隐藏' : '查看' }} PM2 实时日志
            </el-button>
            <div v-if="showLogs && progressLogs.length" class="progress-logs">
              <div v-for="(line, i) in progressLogs" :key="i" class="progress-log-line">{{ line }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- 炼金术步骤 -->
      <template v-else>
        <el-steps :active="activeStep" finish-status="success" align-center>
          <el-step
            v-for="(step, idx) in alchemistSteps"
            :key="idx"
            :title="step.title"
            :description="step.description"
          />
        </el-steps>
      </template>
    </el-card>

    <!-- 历史记录（统一列表） -->
    <el-card shadow="never">
      <template #header>
        <div class="card-header-flex">
          <span class="card-title">历史记录</span>
          <div class="card-header-actions">
            <el-radio-group v-model="listFilter" size="small" @change="handleFilterChange">
              <el-radio-button label="">全部</el-radio-button>
              <el-radio-button label="transcribe">转录</el-radio-button>
              <el-radio-button label="alchemist">炼金术</el-radio-button>
            </el-radio-group>
            <el-button
              v-if="selectedRows.length"
              type="danger"
              size="small"
              @click="handleBatchDelete"
            >
              <el-icon><Delete /></el-icon> 批量删除 ({{ selectedRows.length }})
            </el-button>
          </div>
        </div>
      </template>
      <el-table
        :data="runList"
        v-loading="loading"
        stripe
        style="width: 100%"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag :type="strategyTagType(row.strategy)" size="small">
              {{ strategyLabel(row.strategy) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="链接名" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.sourceText || extractDomainName(row.url) }}
          </template>
        </el-table-column>
        <el-table-column label="URL" width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.url }}</template>
        </el-table-column>
        <el-table-column label="模型/平台" width="110">
          <template #default="{ row }">
            {{ row.strategy === 'transcribe' ? modelLabel(row.model) : platformLabel(row.platform) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <div class="action-buttons">
              <el-button
                size="small"
                text
                type="primary"
                :loading="viewing === row.uid"
                @click="handleView(row)"
              >
                <el-icon><View /></el-icon> 查看
              </el-button>
              <el-button
                v-if="row.strategy === 'transcribe'"
                size="small"
                text
                type="warning"
                :loading="regenerating === row.uid"
                @click="handleRegenerate(row)"
              >
                <el-icon><Refresh /></el-icon> 重新生成
              </el-button>
              <el-button
                size="small"
                text
                :type="isFavorited(row.uid) ? 'warning' : 'info'"
                @click="toggleFavorite(row.uid)"
              >
                <el-icon><Star v-if="!isFavorited(row.uid)" /><StarFilled v-else /></el-icon>
                {{ isFavorited(row.uid) ? '已收藏' : '收藏' }}
              </el-button>
              <el-button size="small" text type="danger" @click="handleDelete(row)">
                <el-icon><Delete /></el-icon> 删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !runList.length" description="暂无历史记录" />
    </el-card>

    <!-- 分页 -->
    <div class="pagination-wrapper" v-if="pagination.total > 0">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="pagination.total"
        :page-size="pagination.pageSize"
        :current-page="pagination.page"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 结果展示抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      :title="currentResult?.sourceText || currentResult?.url || '结果展示'"
      direction="rtl"
      size="70%"
      :before-close="closeResult"
      destroy-on-close
    >
      <template v-if="currentResult">
        <!-- 结果工具栏 -->
        <div class="drawer-toolbar">
          <div class="drawer-toolbar-left">
            <el-tag :type="statusType(currentResult.status)" size="small">
              {{ statusLabel(currentResult.status) }}
            </el-tag>
            <span v-if="currentResult.source === 'transcription'" class="drawer-meta">
              {{ modelLabel(currentResult.model) }} · {{ formatDuration(currentResult.duration) }} · {{ currentResult.segments?.length || 0 }} 分段
            </span>
            <span v-else class="drawer-meta">
              {{ platformLabel(currentResult.platform) }}
            </span>
          </div>
          <div class="drawer-toolbar-right">
            <el-button
              :type="isFavorited(currentResult.uid) ? 'warning' : 'default'"
              size="small"
              :loading="favoriteLoading"
              @click="toggleFavorite(currentResult.uid)"
            >
              <el-icon><Star v-if="!isFavorited(currentResult.uid)" /><StarFilled v-else /></el-icon>
              {{ isFavorited(currentResult.uid) ? '已收藏' : '收藏' }}
            </el-button>
            <el-button
              v-if="currentResult.strategy === 'transcribe'"
              type="warning"
              size="small"
              :loading="regenerating === currentResult.uid"
              @click="handleRegenerate(currentResult)"
            >
              <el-icon><Refresh /></el-icon> 重新生成
            </el-button>
            <el-button
              type="success"
              size="small"
              :loading="submitting"
              :disabled="!currentResult.transcript && !currentResult.fullText && !currentResult.summary && !currentResult.rewrittenBody"
              @click="handleSubmitToContent"
            >
              <el-icon v-if="!submitting"><Promotion /></el-icon>
              提交至内容创作
            </el-button>
          </div>
        </div>

        <!-- ===== 转录结果 ===== -->
        <template v-if="currentResult.source === 'transcription'">
          <!-- 失败错误提示 -->
          <el-alert
            v-if="currentResult.status === 'failed'"
            :title="`转录失败：${currentResult.errorMessage || '未知错误'}`"
            type="error"
            show-icon
            :closable="false"
            class="mb-16"
          />

          <!-- 三 Tab 台账 -->
          <el-card shadow="never" class="mb-16 tabs-card">
            <el-tabs v-model="activeTab" type="card">
              <!-- Tab 1: 逐字稿 - 简洁版 -->
              <el-tab-pane label="逐字稿" name="verbatim">
                <div class="tab-header-flex">
                  <span class="tab-desc">带时间戳和说话人标记的分段转录文本</span>
                  <el-button text size="small" @click="copyText(transcriptText)">
                    <el-icon><CopyDocument /></el-icon> 复制全文
                  </el-button>
                </div>
                <div v-if="currentResult.segments && currentResult.segments.length" class="verbatim-simple" @mouseup="handleTranscriptSelection">
                  <div
                    v-for="(seg, i) in currentResult.segments"
                    :key="i"
                    class="verbatim-line"
                    :data-start="seg.start"
                    :class="{ 'speaker-change': i > 0 && seg.speaker && currentResult.segments[i-1].speaker !== seg.speaker }"
                  >
                    <span class="v-time">[{{ formatTimestamp(seg.start) }}]</span>
                    <span v-if="seg.speaker && speakerCount > 1" class="v-speaker" :class="'spk-' + ((getSpeakerIndex(seg.speaker) % 4) + 1)">{{ seg.speaker }}:</span>
                    <span class="v-text">{{ seg.text }}</span>
                  </div>
                </div>
                <div v-else class="transcript-text" @mouseup="handleTranscriptSelection">
                  {{ currentResult.transcript || '暂无逐字稿内容' }}
                </div>
              </el-tab-pane>

              <!-- Tab 2: 全文稿 -->
              <el-tab-pane label="全文稿" name="fulltext">
                <div class="tab-header-flex">
                  <span class="tab-desc">自动断句分段，添加标点符号的完整文本</span>
                  <div class="tab-header-actions">
                    <el-button
                      text
                      size="small"
                      :loading="regeneratingFullText"
                      :disabled="regeneratingFullTextLLM || currentResult.source !== 'transcription'"
                      @click="handleRegenerateFullText(false)"
                    >
                      <el-icon><Refresh /></el-icon> 规则断句
                    </el-button>
                    <el-button
                      text
                      size="small"
                      :loading="regeneratingFullTextLLM"
                      :disabled="regeneratingFullText || currentResult.source !== 'transcription'"
                      @click="handleRegenerateFullText(true)"
                    >
                      <el-icon><MagicStick /></el-icon> AI标点修复
                    </el-button>
                    <el-button text size="small" @click="copyText(fullTextContent)">
                      <el-icon><CopyDocument /></el-icon> 复制全文
                    </el-button>
                  </div>
                </div>
                <div v-if="fullTextContent" class="full-text-content" @mouseup="handleTranscriptSelection">
                  <p v-for="(para, pi) in fullTextParagraphs" :key="pi" class="full-text-para">{{ para }}</p>
                </div>
                <el-empty v-else description="暂无全文稿内容" :image-size="60" />
              </el-tab-pane>

              <!-- Tab 3: 总结稿 -->
              <el-tab-pane name="summary">
                <template #label>
                  <span>总结稿</span>
                  <el-tag v-if="summaryContent" size="small" type="success" style="margin-left: 6px">已生成</el-tag>
                </template>
                <div class="tab-header-flex">
                  <span class="tab-desc">AI 自动生成的内容摘要（核心观点、要点清单）</span>
                  <el-button
                    type="primary"
                    size="small"
                    :loading="summarizing"
                    :disabled="currentResult.status !== 'completed'"
                    @click="handleSummarize"
                  >
                    <el-icon v-if="!summarizing"><MagicStick /></el-icon>
                    {{ summaryContent ? '重新生成' : '生成总结稿' }}
                  </el-button>
                </div>
                <div v-if="summarizing" class="summary-loading">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  <span>AI 正在分析转录内容，生成总结稿...</span>
                </div>
                <div v-else-if="summaryContent" class="summary-content" @mouseup="handleTranscriptSelection">
                  <p v-for="(para, pi) in summaryParagraphs" :key="pi" class="summary-para">{{ para }}</p>
                </div>
                <el-empty v-else description="点击上方按钮生成 AI 总结稿" :image-size="60" />
              </el-tab-pane>
            </el-tabs>
          </el-card>
        </template>

        <!-- ===== 炼金术结果 ===== -->
        <template v-else>
          <!-- 原始转录 -->
          <el-card shadow="never" class="mb-16">
            <template #header>
              <div class="card-header-flex">
                <span class="card-title">原始转录</span>
                <div class="card-header-actions">
                  <el-button text size="small" @click="copyText(currentResult.transcript || '')">
                    <el-icon><CopyDocument /></el-icon> 复制
                  </el-button>
                  <el-button text size="small" @click="transcriptCollapsed = !transcriptCollapsed">
                    {{ transcriptCollapsed ? '展开' : '折叠' }}
                    <el-icon><ArrowDown v-if="transcriptCollapsed" /><ArrowUp v-else /></el-icon>
                  </el-button>
                </div>
              </div>
            </template>
            <div v-show="!transcriptCollapsed" class="transcript-text" @mouseup="handleTranscriptSelection">
              {{ currentResult.transcript || '暂无转录内容' }}
            </div>
          </el-card>

          <!-- 核心观点 -->
          <el-card shadow="never" class="mb-16">
            <template #header><span class="card-title">核心观点</span></template>
            <div v-if="currentResult.keyPoints && currentResult.keyPoints.length" class="key-points">
              <el-tag
                v-for="(point, i) in currentResult.keyPoints"
                :key="i"
                size="large"
                effect="plain"
                class="key-point-tag"
              >
                {{ point }}
              </el-tag>
            </div>
            <el-empty v-else description="暂无核心观点" :image-size="60" />
          </el-card>

          <!-- 改写结果 -->
          <el-card
            v-if="currentResult.rewrittenTitle || currentResult.rewrittenBody || (currentResult.keyPoints && currentResult.keyPoints.length)"
            shadow="never"
            class="mb-16"
          >
            <template #header>
              <div class="card-header-flex">
                <span class="card-title">改写结果（{{ platformLabel(currentResult.platform) }}）</span>
                <el-button text size="small" @click="copyText(rewriteFullText)">
                  <el-icon><CopyDocument /></el-icon> 复制
                </el-button>
              </div>
            </template>
            <div class="rewrite-content">
              <div class="rewrite-title">{{ currentResult.rewrittenTitle || '（无标题）' }}</div>
              <div class="rewrite-body">{{ currentResult.rewrittenBody || '（无正文）' }}</div>
              <div
                v-if="currentResult.rewrittenTags && currentResult.rewrittenTags.length"
                class="rewrite-tags"
              >
                <el-tag
                  v-for="tag in currentResult.rewrittenTags"
                  :key="tag"
                  size="small"
                  type="info"
                  effect="plain"
                >
                  #{{ tag }}
                </el-tag>
              </div>
            </div>
          </el-card>
          <el-empty
            v-else
            description="该记录暂无改写结果数据"
            :image-size="80"
            class="mb-16"
          />

          <!-- 配图预览 -->
          <el-card
            v-if="currentResult.images && currentResult.images.length"
            shadow="never"
            class="mb-16"
          >
            <template #header><span class="card-title">配图预览</span></template>
            <div class="image-preview-grid">
              <el-image
                v-for="(img, i) in currentResult.images"
                :key="i"
                :src="img"
                :preview-src-list="currentResult.images"
                :initial-index="i"
                fit="cover"
                class="preview-image"
              >
                <template #error>
                  <div class="image-error">
                    <el-icon><Picture /></el-icon>
                    <span>加载失败</span>
                  </div>
                </template>
              </el-image>
            </div>
          </el-card>
        </template>
      </template>
    </el-drawer>

    <!-- 文本选择浮动按钮：收藏到笔记 -->
    <Teleport to="body">
      <div
        v-if="selectionMenuVisible"
        class="selection-menu"
        :style="{ left: selectionMenuX + 'px', top: selectionMenuY + 'px' }"
      >
        <el-button
          type="primary"
          size="small"
          :loading="savingNote"
          @mousedown.stop
          @click="handleSaveToNotes"
        >
          <el-icon><Star /></el-icon>
          收藏到笔记
        </el-button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page-desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  font-weight: 400;
}

/* 策略切换 */
.strategy-tabs {
  display: flex;
  gap: 16px;
}

.strategy-tab {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border: 2px solid var(--el-border-color-light);
  border-radius: var(--border-radius-base);
  cursor: pointer;
  transition: all 0.25s ease;
  flex: 1;
  min-width: 0;
}

.strategy-tab:hover {
  border-color: var(--color-primary-light-5);
  background-color: var(--color-primary-light-9);
}

.strategy-tab.active {
  border-color: var(--color-primary);
  background-color: var(--color-primary-light-9);
}

.strategy-tab .el-icon {
  font-size: 24px;
  color: var(--color-text-secondary);
  transition: color 0.25s ease;
}

.strategy-tab.active .el-icon {
  color: var(--color-primary);
}

.strategy-tab-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.strategy-tab-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.strategy-tab-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 输入栏 */
.input-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.card-header-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* 进度 */
.progress-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.progress-stage {
  font-size: 14px;
  color: var(--color-text-regular);
  font-weight: 500;
}

.progress-model {
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-bg-page);
  padding: 2px 8px;
  border-radius: 4px;
}

/* 进度条百分比文字微调：位置提前 + 字体变小，防止 0% 时白色文字溢出 */
.progress-block :deep(.el-progress-bar__outer) {
  position: relative;
}

.progress-block :deep(.el-progress-bar__inner) {
  overflow: visible;
}

.progress-block :deep(.el-progress-bar__innerText) {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  white-space: nowrap;
}

.progress-details {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  padding: 12px;
  background-color: var(--color-bg-page);
  border-radius: var(--border-radius-base);
}

.progress-detail-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.progress-detail-label {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.progress-detail-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
}

.progress-tip {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.progress-last-log {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
  background-color: var(--color-primary-light-9);
  border-radius: var(--border-radius-small);
  font-size: 12px;
  color: var(--color-text-regular);
  line-height: 1.5;
}

.progress-last-log .el-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-primary);
}

.progress-logs-section {
  margin-top: 8px;
}

.progress-logs {
  max-height: 200px;
  overflow-y: auto;
  background-color: #1e1e1e;
  border-radius: var(--border-radius-small);
  padding: 10px;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
  font-size: 11px;
  line-height: 1.6;
}

.progress-log-line {
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 元数据 */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  background-color: var(--color-bg-page);
  border-radius: var(--border-radius-base);
}

.meta-label {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.meta-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Tab 头部 */
.tab-header-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.tab-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tab-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
}

/* 逐字稿 */
.transcript-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
  color: var(--color-text-regular);
  max-height: 520px;
  overflow-y: auto;
  padding: 4px 8px;
}

/* === 逐字稿 - 简洁版 === */
.verbatim-simple {
  max-height: 520px;
  overflow-y: auto;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--color-text-regular);
  background-color: var(--color-bg-page);
  border-radius: var(--border-radius-base);
}

.verbatim-line {
  padding: 3px 0;
}

.verbatim-line.speaker-change {
  padding-top: 12px;
  margin-top: 4px;
  border-top: 1px dashed var(--el-border-color-light);
}

.v-time {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--color-primary-light-3);
  margin-right: 6px;
  white-space: nowrap;
  opacity: 0.7;
}

.v-speaker {
  font-size: 12px;
  font-weight: 600;
  margin-right: 2px;
}

.spk-1 { color: var(--color-primary); }
.spk-2 { color: var(--color-primary-hover); }
.spk-3 { color: var(--color-primary-light); }
.spk-4 { color: var(--color-info); }

.v-text {
  color: var(--color-text-regular);
}

/* 全文稿 - 段落式 */
.full-text-content {
  max-height: 520px;
  overflow-y: auto;
  padding: 12px 16px;
  background-color: var(--color-bg-page);
  border-radius: var(--border-radius-base);
  font-size: 14px;
}

.full-text-para {
  margin: 0 0 12px 0;
  line-height: 1.9;
  text-indent: 2em;
  color: var(--color-text-regular);
}

/* 总结稿 - 段落式 */
.summary-content {
  max-height: 520px;
  overflow-y: auto;
  padding: 12px 16px;
  background-color: var(--color-bg-page);
  border-radius: var(--border-radius-base);
  font-size: 14px;
}

.summary-para {
  margin: 0 0 12px 0;
  line-height: 1.9;
  color: var(--color-text-regular);
}

/* tabs 卡片 */
.tabs-card :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.summary-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 40px 0;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.summary-loading .el-icon {
  font-size: 20px;
  color: var(--color-primary);
}

/* 炼金术结果 */
.key-points {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.key-point-tag {
  white-space: normal;
  line-height: 1.5;
  padding: 6px 12px;
}

.rewrite-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rewrite-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.4;
}

.rewrite-body {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
  color: var(--color-text-regular);
}

.rewrite-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.image-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.preview-image {
  width: 100%;
  height: 160px;
  border-radius: var(--border-radius-base);
  overflow: hidden;
}

.image-error {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--color-text-placeholder);
  background-color: var(--color-bg-page);
  font-size: 12px;
}

/* 抽屉工具栏 */
.drawer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--el-border-color-light);
  flex-wrap: wrap;
  gap: 8px;
}

.drawer-toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.drawer-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-meta {
  font-size: 13px;
  color: var(--color-text-secondary);
}

/* 操作按钮组 */
.action-buttons {
  display: flex;
  gap: 4px;
  white-space: nowrap;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

@media (max-width: 768px) {
  .strategy-tabs {
    flex-direction: column;
  }
  .input-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .input-bar .el-select,
  .input-bar .el-button {
    width: 100%;
  }
  .meta-grid {
    grid-template-columns: 1fr 1fr;
  }
}

/* 文本选择浮动菜单（Teleport 到 body，选中文本后显示） */
.selection-menu {
  position: fixed;
  transform: translate(-50%, -100%);
  z-index: 3000;
  margin-top: -4px;
}

.selection-menu :deep(.el-button) {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}
</style>
