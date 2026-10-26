<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { transcriberApi } from '@/api'
import type { TranscriberRun } from '@/api'

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
  // 正则匹配 http:// 或 https:// 开头的 URL（含中文路径）
  const match = trimmed.match(/https?:\/\/[^\s\u3000\uff08\uff09\u3010\u3011\u300a\u300b\u201c\u201d\u2018\u2019]+/i)
  if (match) {
    return match[0]
  }
  // 没有匹配到 URL，返回原值（让后端报错提示）
  return trimmed
}

// ============================================================
// 输入区
// ============================================================
const urlInput = ref<string>('')
const model = ref<string>('medium')
const language = ref<string>('auto')

const modelOptions = [
  { label: 'tiny（最快，精度低）', value: 'tiny' },
  { label: 'base（较快，精度一般）', value: 'base' },
  { label: 'small（均衡，精度较好）', value: 'small' },
  { label: 'medium（推荐，精度高）', value: 'medium' },
  { label: 'large-v2（很慢，精度很高）', value: 'large-v2' },
  { label: 'large-v3（最慢，精度最高）', value: 'large-v3' }
]

const languageOptions = [
  { label: '自动检测', value: 'auto' },
  { label: '中文', value: 'zh' },
  { label: '英文', value: 'en' },
  { label: '日语', value: 'ja' }
]

// ============================================================
// 转录进度（el-progress）
// ============================================================
const transcribing = ref<boolean>(false)
const progress = ref<number>(0)
const progressStage = ref<string>('')
const progressTip = ref<string>('')
let progressTimer: ReturnType<typeof setInterval> | null = null

function startProgress(): void {
  stopProgress()
  progress.value = 5
  progressStage.value = '初始化中...'
  progressTip.value = '正在准备转录环境'
  // 转录耗时较长，逐步推进进度指示（仅作视觉反馈，最终以 API 返回为准）
  // 使用更平滑的进度增长，避免用户以为卡死
  let elapsed = 0
  progressTimer = setInterval(() => {
    elapsed += 1.5
    if (progress.value < 90) {
      // 前 5 秒快速到 20%
      if (elapsed <= 5) {
        progress.value = Math.min(20, progress.value + 3)
        progressStage.value = '下载音频中...'
        progressTip.value = '正在通过 yt-dlp 下载视频音频轨道'
      }
      // 5-30 秒缓慢到 50%
      else if (elapsed <= 30) {
        progress.value = Math.min(50, progress.value + 1)
        progressStage.value = '下载音频中...'
        progressTip.value = '音频下载中，较大视频需要更长时间'
      }
      // 30 秒后缓慢到 85%
      else if (elapsed <= 120) {
        progress.value = Math.min(85, progress.value + 1)
        progressStage.value = 'ASR 转录中...'
        progressTip.value = 'faster-whisper 正在识别语音内容'
      }
      // 2-10 分钟缓慢到 90%
      else if (elapsed <= 600) {
        progress.value = Math.min(90, progress.value + 0.5)
        progressStage.value = 'ASR 转录中...'
        progressTip.value = '转录进行中，大模型(medium)在CPU上较慢，请耐心等待'
      }
      // 10 分钟后保持 92%
      else {
        progress.value = Math.min(92, progress.value + 0.1)
        progressStage.value = 'ASR 转录中...'
        progressTip.value = '大模型转录耗时较长（最长45分钟），请耐心等待'
      }
    }
  }, 1500)
}

function stopProgress(): void {
  if (progressTimer !== null) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

// ============================================================
// 结果展示 — 三 Tab 台账
// ============================================================
const currentResult = ref<TranscriberRun | null>(null)
const resultSectionRef = ref<HTMLElement | null>(null)
const activeTab = ref<string>('verbatim')

/** 逐字稿纯文本（用于复制） */
const transcriptText = computed<string>(() => currentResult.value?.transcript || '')

/** 全文稿纯文本（用于复制） */
const fullTextContent = computed<string>(() => currentResult.value?.fullText || '')

/** 总结稿内容 */
const summaryContent = computed<string>(() => currentResult.value?.summary || '')

/** 滚动到结果展示区域 */
async function scrollToResult(): Promise<void> {
  await nextTick()
  if (resultSectionRef.value) {
    resultSectionRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// ============================================================
// AI 总结稿生成
// ============================================================
const summarizing = ref<boolean>(false)

async function handleSummarize(): Promise<void> {
  if (!currentResult.value) return

  summarizing.value = true
  try {
    const res = await transcriberApi.summarize(currentResult.value.id)
    if (res.data) {
      currentResult.value = res.data
      ElMessage.success('总结稿已生成')
      // 自动切换到总结稿 Tab
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
// 工具函数
// ============================================================
const statusConfig: Record<string, { label: string; type: 'info' | 'warning' | 'success' | 'danger' }> = {
  pending: { label: '待处理', type: 'info' },
  processing: { label: '转录中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'danger' }
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

/** 从 URL 中提取可读的域名/平台名称（用于无原始链接名时的回退显示） */
function extractDomainName(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    // 识别常见平台
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

function languageLabel(l?: string): string {
  const map: Record<string, string> = {
    auto: '自动检测',
    zh: '中文',
    en: '英文',
    ja: '日语'
  }
  return map[l || ''] || l || '-'
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

/** 秒 → X分Y秒 */
function formatDuration(sec?: number): string {
  if (sec === undefined || sec === null || isNaN(sec)) return '-'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}分${s}秒`
}

/**
 * 将 UTC 时间字符串转换为本地时间显示。
 *
 * 后端 SQLite 使用 datetime('now') 存储 UTC 时间（如 "2026-07-24 02:16:25"），
 * 前端需要转换为本地时区（Asia/Shanghai, UTC+8）显示。
 *
 * 输入格式: "2026-07-24 02:16:25" 或 "2026-07-24T02:16:25.000Z"
 * 输出格式: "2026-07-24 10:16:25"
 */
function formatDateTime(utcStr?: string): string {
  if (!utcStr) return '-'
  try {
    // SQLite datetime('now') 格式为 "YYYY-MM-DD HH:MM:SS"（无时区后缀）
    // 需要补上 'Z' 后缀让 JS 正确解析为 UTC
    const normalized = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z'
    const date = new Date(normalized)
    if (isNaN(date.getTime())) return utcStr
    // 使用本地时区格式化
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
// 历史记录
// ============================================================
const loading = ref<boolean>(false)
const viewing = ref<number>(0)
const runList = ref<TranscriberRun[]>([])
const selectedRows = ref<TranscriberRun[]>([])
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

async function loadList(): Promise<void> {
  loading.value = true
  try {
    const res = await transcriberApi.getList({
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    runList.value = res.data
    pagination.total = res.total
  } catch (error) {
    console.error('加载转录历史失败:', error)
  } finally {
    loading.value = false
  }
}

/** 表格选择变化 */
function handleSelectionChange(rows: TranscriberRun[]): void {
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
      `确定删除选中的 ${selectedRows.value.length} 条转录记录吗？此操作不可恢复。`,
      '批量删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  try {
    const ids = selectedRows.value.map((r) => r.id)
    const res = await transcriberApi.batchDelete(ids)
    ElMessage.success(`已删除 ${res.data?.deleted ?? ids.length} 条记录`)
    selectedRows.value = []
    await loadList()
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`批量删除失败: ${errMsg}`)
  }
}

// ============================================================
// 开始转录
// ============================================================
async function handleTranscribe(): Promise<void> {
  if (!urlInput.value.trim()) {
    ElMessage.warning('请输入视频 URL')
    return
  }

  // 从用户输入中提取纯 URL（处理B站分享文本等场景）
  const cleanUrl = extractUrl(urlInput.value)
  if (!cleanUrl.startsWith('http')) {
    ElMessage.warning('未识别到有效的视频 URL，请检查输入')
    return
  }
  // 如果提取到的URL与输入不同，更新输入框显示纯URL
  if (cleanUrl !== urlInput.value.trim()) {
    urlInput.value = cleanUrl
  }

  transcribing.value = true
  currentResult.value = null
  startProgress()
  try {
    // 保存原始输入文本（含B站分享文本等），用于历史记录展示
    const originalInput = urlInput.value.trim()
    const res = await transcriberApi.transcribe({
      url: cleanUrl,
      model: model.value,
      language: language.value,
      sourceText: originalInput !== cleanUrl ? originalInput : undefined,
    })
    stopProgress()
    progress.value = 100
    progressStage.value = '完成'
    progressTip.value = ''
    currentResult.value = res.data ?? null

    // 检查后端返回的转录结果状态
    if (res.data?.status === 'failed') {
      ElMessage.error(`转录失败: ${res.data.errorMessage || '未知错误'}`)
    } else {
      ElMessage.success(`转录完成（${res.data?.segmentCount ?? res.data?.segments?.length ?? 0} 个片段）`)
    }
    await loadList()
    // 自动滚动到结果区域
    await scrollToResult()
  } catch (error) {
    stopProgress()
    progress.value = 0
    progressStage.value = ''
    progressTip.value = ''
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('转录失败:', error)
    // 提供更有帮助的错误提示
    if (errMsg.includes('ConnectTimeout') || errMsg.includes('WinError 10060')) {
      ElMessage.error('转录失败: 网络连接超时，可能是在下载 Whisper 模型。请使用 tiny 模型（本地已缓存）后重试。')
    } else if (errMsg.includes('invalid choice')) {
      ElMessage.error('转录失败: 模型路径错误，请刷新页面后重试。')
    } else {
      ElMessage.error(`转录失败: ${errMsg}`)
    }
  } finally {
    transcribing.value = false
  }
}

// ============================================================
// 查看 / 删除
// ============================================================
async function handleView(run: TranscriberRun): Promise<void> {
  viewing.value = run.id
  try {
    const res = await transcriberApi.getOne(run.id)
    currentResult.value = res.data ?? null
    if (res.data?.status === 'completed') {
      progress.value = 100
      progressStage.value = '完成'
    } else {
      progress.value = 0
      progressStage.value = ''
    }
    ElMessage.success('已加载记录')
    // 自动滚动到结果区域
    await scrollToResult()
  } catch (error) {
    console.error('加载记录失败:', error)
  } finally {
    viewing.value = 0
  }
}

async function handleDelete(run: TranscriberRun): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除该条转录记录吗？此操作不可恢复。', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  try {
    await transcriberApi.deleteOne(run.id)
    ElMessage.success('删除成功')
    if (currentResult.value?.id === run.id) {
      currentResult.value = null
      progress.value = 0
      progressStage.value = ''
    }
    await loadList()
  } catch (error) {
    console.error('删除失败:', error)
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
})

onUnmounted(() => {
  stopProgress()
})
</script>

<template>
  <div class="page-container">
    <!-- 头部 -->
    <div class="page-header">
      <div>
        <span class="page-title">视频转录</span>
        <p class="page-desc">使用 faster-whisper 本地 ASR 引擎，将视频内容转录为文字（繁体自动转简体）</p>
      </div>
    </div>

    <!-- 输入区 -->
    <el-card shadow="never" class="mb-16">
      <div class="input-bar">
        <el-input
          v-model="urlInput"
          placeholder="请输入视频 URL（支持B站分享文本自动提取链接）"
          clearable
          style="flex: 1; min-width: 280px"
          @keyup.enter="handleTranscribe"
        >
          <template #prefix>
            <el-icon><Link /></el-icon>
          </template>
        </el-input>
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
        <el-button type="primary" :loading="transcribing" @click="handleTranscribe">
          <el-icon v-if="!transcribing"><Microphone /></el-icon>
          {{ transcribing ? '转录中...' : '开始转录' }}
        </el-button>
      </div>
    </el-card>

    <!-- 转录进度 -->
    <el-card v-if="transcribing || progress > 0" shadow="never" class="mb-16">
      <div class="progress-block">
        <div class="progress-stage">{{ progressStage || '准备中...' }}</div>
        <el-progress
          :percentage="progress"
          :status="progress >= 100 ? 'success' : ''"
          :stroke-width="14"
        />
        <div v-if="progressTip && progress < 100" class="progress-tip">{{ progressTip }}</div>
      </div>
    </el-card>

    <!-- 结果展示区 — 三 Tab 台账 -->
    <div v-if="currentResult" ref="resultSectionRef" class="result-section">
      <!-- 元数据 -->
      <el-card shadow="never" class="mb-16">
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">检测语言</span>
            <span class="meta-value">
              {{ languageLabel(currentResult.detectedLanguage || currentResult.language) }}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">音频时长</span>
            <span class="meta-value">{{ formatDuration(currentResult.duration) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">分段数</span>
            <span class="meta-value">
              {{ currentResult.segmentCount ?? (currentResult.segments?.length || 0) }}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">使用模型</span>
            <span class="meta-value">{{ modelLabel(currentResult.model) }}</span>
          </div>
        </div>
      </el-card>

      <!-- 三 Tab 台账 -->
      <el-card shadow="never" class="mb-16">
        <el-tabs v-model="activeTab" type="border-card">
          <!-- Tab 1: 逐字稿（带时间戳） -->
          <el-tab-pane label="逐字稿" name="verbatim">
            <div class="tab-header-flex">
              <span class="tab-desc">带时间戳的分段转录文本</span>
              <el-button text size="small" @click="copyText(transcriptText)">
                <el-icon><CopyDocument /></el-icon> 复制全文
              </el-button>
            </div>
            <div v-if="currentResult.segments && currentResult.segments.length" class="segment-list">
              <div v-for="(seg, i) in currentResult.segments" :key="i" class="segment-item">
                <span class="segment-time">
                  [{{ formatTimestamp(seg.start) }} - {{ formatTimestamp(seg.end) }}]
                </span>
                <span class="segment-text">{{ seg.text }}</span>
              </div>
            </div>
            <div v-else class="transcript-text">
              {{ currentResult.transcript || '暂无逐字稿内容' }}
            </div>
          </el-tab-pane>

          <!-- Tab 2: 全文稿（纯文本） -->
          <el-tab-pane label="全文稿" name="fulltext">
            <div class="tab-header-flex">
              <span class="tab-desc">去除时间戳的纯文本拼接（已转简体）</span>
              <el-button text size="small" @click="copyText(fullTextContent)">
                <el-icon><CopyDocument /></el-icon> 复制全文
              </el-button>
            </div>
            <div v-if="fullTextContent" class="full-text-content">
              {{ fullTextContent }}
            </div>
            <el-empty v-else description="暂无全文稿内容" :image-size="60" />
          </el-tab-pane>

          <!-- Tab 3: 总结稿（AI LLM 生成） -->
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
            <div v-else-if="summaryContent" class="summary-content">
              {{ summaryContent }}
            </div>
            <el-empty v-else description="点击上方按钮生成 AI 总结稿" :image-size="60" />
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <!-- 历史记录 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-header-flex">
          <span class="card-title">历史记录</span>
          <el-button
            v-if="selectedRows.length"
            type="danger"
            size="small"
            @click="handleBatchDelete"
          >
            <el-icon><Delete /></el-icon> 批量删除 ({{ selectedRows.length }})
          </el-button>
        </div>
      </template>
      <el-table
        :data="runList"
        v-loading="loading"
        stripe
        style="width: 100%"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column label="链接名" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.sourceText || extractDomainName(row.url) }}
          </template>
        </el-table-column>
        <el-table-column label="URL" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.url }}</template>
        </el-table-column>
        <el-table-column label="模型" width="110">
          <template #default="{ row }">{{ modelLabel(row.model) }}</template>
        </el-table-column>
        <el-table-column label="语言" width="100">
          <template #default="{ row }">{{ languageLabel(row.language) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              text
              type="primary"
              :loading="viewing === row.id"
              @click="handleView(row)"
            >
              <el-icon><View /></el-icon> 查看
            </el-button>
            <el-button size="small" text type="danger" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon> 删除
            </el-button>
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
  </div>
</template>

<style scoped>
.page-desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  font-weight: 400;
}

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

.progress-stage {
  font-size: 14px;
  color: var(--color-text-regular);
  font-weight: 500;
}

.progress-tip {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
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

.segment-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 520px;
  overflow-y: auto;
  padding: 4px 8px;
}

.segment-item {
  display: flex;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--border-radius-small);
  transition: background-color 0.2s ease;
}

.segment-item:hover {
  background-color: var(--color-bg-card-hover);
}

.segment-time {
  flex-shrink: 0;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
  font-size: 12px;
  color: var(--color-primary);
  font-weight: 600;
  white-space: nowrap;
  padding-top: 2px;
}

.segment-text {
  flex: 1;
  line-height: 1.7;
  color: var(--color-text-regular);
  word-break: break-word;
}

/* 全文稿 */
.full-text-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.9;
  color: var(--color-text-regular);
  max-height: 520px;
  overflow-y: auto;
  padding: 8px 12px;
  background-color: var(--color-bg-page);
  border-radius: var(--border-radius-base);
  font-size: 14px;
}

/* 总结稿 */
.summary-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.9;
  color: var(--color-text-regular);
  max-height: 520px;
  overflow-y: auto;
  padding: 8px 12px;
  background-color: var(--color-bg-page);
  border-radius: var(--border-radius-base);
  font-size: 14px;
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

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

@media (max-width: 768px) {
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
</style>
