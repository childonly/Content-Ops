<script setup lang="ts">
/**
 * XhsPipelineView - 小红书自动化流水线原生组件
 *
 * 替换原有的 iframe 嵌入方式，直接调用 xhs-auto-pipeline 后端 API。
 * 通过 content-ops-hub 的 API 网关代理（/api/xhs-pipeline/*）访问后端。
 *
 * 功能模块：
 * 1. 仪表盘统计 - 展示流水线运行、草稿、关键词等汇总数据
 * 2. 关键词管理 - 增删改查关键词、切换启用状态
 * 3. 定时任务管理 - 切换启用状态、手动触发
 * 4. 登录状态 - 查看 cookie 状态、刷新登录、扫码登录
 * 5. 快速操作 - 启动流水线
 */
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Refresh,
  Plus,
  Delete,
  VideoPlay,
  Switch,
  Iphone,
  MagicStick,
  DataLine,
  Key,
  Timer,
  User,
  TrendCharts,
  View,
  Edit,
  Check,
  Promotion
} from '@element-plus/icons-vue'

// ============================================================
// 类型定义
// ============================================================

interface DashboardStats {
  total_runs: number
  completed_runs: number
  failed_runs: number
  total_drafts: number
  published_drafts: number
  pending_drafts: number
  recent_runs: RecentRun[]
  keyword_count: number
  schedule_count: number
}

interface RecentRun {
  id: number
  keyword: string
  status: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  sources_count: number
  created_at: string
}

interface Keyword {
  id: number
  keyword: string
  category: string | null
  enabled: boolean
  last_used_at: string | null
  created_at: string
}

interface Schedule {
  id: number
  name: string
  keyword: string
  cron_expression: string
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
}

interface LoginStatus {
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

interface PipelineStartResponse {
  id: number
  keyword: string
  status: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  sources_count: number
  created_at: string
}

/** 草稿记录(对应后端 DraftRecord) */
interface DraftRecord {
  id: number
  pipeline_run_id: number
  title: string
  content: string
  tags: string
  images: string
  status: string
  published_at: string | null
  publish_url: string | null
  publish_error: string | null
  created_at: string
  updated_at: string
}

/** 流水线运行记录(含草稿,对应后端 /runs 端点返回格式) */
interface RunWithDrafts {
  run: {
    id: number
    pipeline_type: string
    keyword: string | null
    status: string
    current_stage: string
    sources_count: number
    report_content: string | null
    started_at: string | null
    completed_at: string | null
    error_message: string | null
  }
  drafts: DraftRecord[]
}

// ============================================================
// API 请求封装
// ============================================================

/**
 * 三项目融合第二阶段: API 路径已分散到多个独立路由
 *   - /api/xhs-pipeline/*   流水线(启动/运行/草稿/仪表盘)
 *   - /api/xhs-keywords/*   关键词管理
 *   - /api/xhs-schedules/*  定时任务
 *   - /api/xhs-login/*      登录管理
 *
 * 统一响应格式: { success: boolean, data?: T, error?: string }
 */

/** 统一请求函数,自动解包 { success, data } 响应格式 */
async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // path 以 /api/ 开头时直接使用,否则拼接默认前缀
  const url = path.startsWith('/api/') ? path : `/api/xhs-pipeline${path}`

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}: 请求失败`
    try {
      const errorData = await res.json()
      errorMsg = errorData.detail || errorData.error || errorData.message || errorMsg
    } catch {
      // 响应可能不是 JSON
    }
    throw new Error(errorMsg)
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T
  }

  const json = await res.json() as { success?: boolean; data?: T; error?: string; message?: string }

  // 新统一格式: { success, data } - 解包返回 data
  if (json && typeof json.success === 'boolean') {
    if (!json.success) {
      throw new Error(json.error || json.message || '请求失败')
    }
    return json.data as T
  }

  // 旧格式: 直接返回(兼容)
  return json as unknown as T
}

function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path)
}

function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined
  })
}

function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined
  })
}

function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' })
}

// ============================================================
// 工具函数
// ============================================================

type TagType = '' | 'primary' | 'success' | 'info' | 'warning' | 'danger'

/** 流水线状态映射 */
const pipelineStatusMap: Record<string, { label: string; type: TagType }> = {
  pending: { label: '等待开始', type: 'info' },
  researching: { label: '搜索笔记', type: 'primary' },
  reporting: { label: '生成报告', type: 'primary' },
  drafting: { label: '生成草稿', type: 'primary' },
  reviewing: { label: '等待审核', type: 'warning' },
  publishing: { label: '发布中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'danger' }
}

function statusLabel(status: string): string {
  return pipelineStatusMap[status]?.label || status
}

function statusTagType(status: string): TagType {
  return pipelineStatusMap[status]?.type || 'info'
}

/** 草稿状态映射 */
const draftStatusMap: Record<string, { label: string; type: TagType }> = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已通过', type: 'primary' },
  rejected: { label: '已拒绝', type: 'info' },
  published: { label: '已发布', type: 'success' },
  published_failed: { label: '发布失败', type: 'danger' }
}

function draftStatusLabel(status: string): string {
  return draftStatusMap[status]?.label || status
}

function draftStatusTagType(status: string): TagType {
  return draftStatusMap[status]?.type || 'info'
}

/** 格式化日期时间 */
function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  } catch {
    return dateStr
  }
}

/** 统一错误处理 */
function handleError(action: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error)
  ElMessage.error(`${action}失败: ${msg}`)
  console.error(`${action}失败:`, error)
}

// ============================================================
// Tab 1: 仪表盘统计
// ============================================================

const statsLoading = ref<boolean>(false)
const stats = ref<DashboardStats>({
  total_runs: 0,
  completed_runs: 0,
  failed_runs: 0,
  total_drafts: 0,
  published_drafts: 0,
  pending_drafts: 0,
  recent_runs: [],
  keyword_count: 0,
  schedule_count: 0
})

async function loadStats(): Promise<void> {
  statsLoading.value = true
  try {
    stats.value = await apiGet<DashboardStats>('/dashboard/stats')
  } catch (error) {
    handleError('加载仪表盘统计', error)
  } finally {
    statsLoading.value = false
  }
}

// ---- 统计详情对话框(点击统计卡片展示对应列表) ----

const statsDetailVisible = ref<boolean>(false)
const statsDetailTitle = ref<string>('')
const statsDetailLoading = ref<boolean>(false)
/** 详情数据类型: 'runs' 显示运行列表, 'drafts' 显示草稿列表 */
const statsDetailKind = ref<'runs' | 'drafts'>('runs')
const statsDetailRuns = ref<RunWithDrafts['run'][]>([])
const statsDetailDrafts = ref<DraftRecord[]>([])

/**
 * 点击统计卡片,加载并展示对应分类的列表。
 * 由于后端没有按状态过滤的 API,统一调用 /runs?limit=50 后前端过滤。
 */
async function handleStatClick(type: string): Promise<void> {
  statsDetailVisible.value = true
  statsDetailLoading.value = true

  try {
    const runs = await apiGet<RunWithDrafts[]>('/runs?limit=50')

    // 展平所有草稿(防御性检查)
    const allDrafts: DraftRecord[] = []
    for (const item of runs) {
      if (item.drafts && Array.isArray(item.drafts)) {
        allDrafts.push(...item.drafts)
      }
    }
    allDrafts.sort((a, b) => b.id - a.id)

    switch (type) {
      case 'total_runs':
        statsDetailTitle.value = '所有流水线运行'
        statsDetailKind.value = 'runs'
        statsDetailRuns.value = runs.map((item) => item.run)
        break
      case 'completed_runs':
        statsDetailTitle.value = '已完成的流水线运行'
        statsDetailKind.value = 'runs'
        statsDetailRuns.value = runs
          .filter((item) => item.run.status === 'completed')
          .map((item) => item.run)
        break
      case 'failed_runs':
        statsDetailTitle.value = '失败的流水线运行'
        statsDetailKind.value = 'runs'
        statsDetailRuns.value = runs
          .filter((item) => item.run.status === 'failed')
          .map((item) => item.run)
        break
      case 'total_drafts':
        statsDetailTitle.value = '所有草稿'
        statsDetailKind.value = 'drafts'
        statsDetailDrafts.value = allDrafts
        break
      case 'published_drafts':
        statsDetailTitle.value = '已发布草稿'
        statsDetailKind.value = 'drafts'
        statsDetailDrafts.value = allDrafts.filter((d) => d.status === 'published')
        break
      case 'pending_drafts':
        statsDetailTitle.value = '待审核草稿'
        statsDetailKind.value = 'drafts'
        statsDetailDrafts.value = allDrafts.filter((d) => d.status === 'pending')
        break
      default:
        statsDetailTitle.value = '详情列表'
        statsDetailKind.value = 'runs'
        statsDetailRuns.value = runs.map((item) => item.run)
    }
  } catch (error) {
    handleError('加载统计详情', error)
  } finally {
    statsDetailLoading.value = false
  }
}

// ============================================================
// Tab 2: 关键词管理
// ============================================================

const keywordsLoading = ref<boolean>(false)
const keywords = ref<Keyword[]>([])
const keywordDialogVisible = ref<boolean>(false)
const keywordForm = reactive({
  keyword: '',
  category: ''
})
const keywordSubmitting = ref<boolean>(false)

async function loadKeywords(): Promise<void> {
  keywordsLoading.value = true
  try {
    keywords.value = await apiGet<Keyword[]>('/api/xhs-keywords')
  } catch (error) {
    handleError('加载关键词列表', error)
  } finally {
    keywordsLoading.value = false
  }
}

function openKeywordDialog(): void {
  keywordForm.keyword = ''
  keywordForm.category = ''
  keywordDialogVisible.value = true
}

async function handleAddKeyword(): Promise<void> {
  if (!keywordForm.keyword.trim()) {
    ElMessage.warning('请输入关键词')
    return
  }
  keywordSubmitting.value = true
  try {
    await apiPost<Keyword>('/api/xhs-keywords', {
      keyword: keywordForm.keyword.trim(),
      category: keywordForm.category.trim() || null
    })
    ElMessage.success('关键词添加成功')
    keywordDialogVisible.value = false
    await loadKeywords()
  } catch (error) {
    handleError('添加关键词', error)
  } finally {
    keywordSubmitting.value = false
  }
}

async function handleDeleteKeyword(row: Keyword): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要删除关键词 "${row.keyword}" 吗？`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await apiDelete<void>(`/api/xhs-keywords/${row.id}`)
    ElMessage.success('关键词已删除')
    await loadKeywords()
  } catch (error) {
    handleError('删除关键词', error)
  }
}

async function handleToggleKeyword(row: Keyword): Promise<void> {
  try {
    await apiPut<Keyword>(`/api/xhs-keywords/${row.id}`, { enabled: row.enabled })
    ElMessage.success(`关键词已${row.enabled ? '启用' : '禁用'}`)
  } catch (error) {
    // 恢复原状态
    row.enabled = !row.enabled
    handleError('切换关键词状态', error)
  }
}

// ============================================================
// Tab 3: 定时任务管理
// ============================================================

const schedulesLoading = ref<boolean>(false)
const schedules = ref<Schedule[]>([])
const triggeringId = ref<number>(0)

async function loadSchedules(): Promise<void> {
  schedulesLoading.value = true
  try {
    schedules.value = await apiGet<Schedule[]>('/api/xhs-schedules')
  } catch (error) {
    handleError('加载定时任务列表', error)
  } finally {
    schedulesLoading.value = false
  }
}

async function handleToggleSchedule(row: Schedule): Promise<void> {
  try {
    await apiPut<Schedule>(`/api/xhs-schedules/${row.id}`, { enabled: row.enabled })
    ElMessage.success(`定时任务已${row.enabled ? '启用' : '禁用'}`)
    await loadSchedules()
  } catch (error) {
    row.enabled = !row.enabled
    handleError('切换定时任务状态', error)
  }
}

async function handleTriggerSchedule(row: Schedule): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要手动触发定时任务 "${row.name}" 吗？\n将立即执行关键词 "${row.keyword}" 的流水线。`,
      '触发确认',
      { confirmButtonText: '触发', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  triggeringId.value = row.id
  try {
    await apiPost<{ message: string }>(`/api/xhs-schedules/${row.id}/trigger`)
    ElMessage.success('定时任务已触发')
  } catch (error) {
    handleError('触发定时任务', error)
  } finally {
    triggeringId.value = 0
  }
}

// ============================================================
// Tab 4: 登录状态
// ============================================================

const loginLoading = ref<boolean>(false)
const refreshingLogin = ref<boolean>(false)
const qrLoggingIn = ref<boolean>(false)
const loginStatus = ref<LoginStatus>({
  is_logged_in: false,
  cookie_age_days: 0,
  cookie_age_hours: 0,
  will_expire_soon: false,
  is_expired: true,
  last_login_time: '',
  browser: 'Unknown',
  consecutive_failures: 0,
  max_cookie_age_days: 7,
  warning_threshold_days: 5
})

async function loadLoginStatus(): Promise<void> {
  loginLoading.value = true
  try {
    // 新路由 /api/xhs-login/status 已由 apiRequest 自动解包 data
    loginStatus.value = await apiGet<LoginStatus>('/api/xhs-login/status')
  } catch (error) {
    handleError('加载登录状态', error)
  } finally {
    loginLoading.value = false
  }
}

async function handleRefreshLogin(): Promise<void> {
  refreshingLogin.value = true
  try {
    const res = await apiPost<{ success: boolean; message: string }>(
      '/api/xhs-login/refresh'
    )
    // apiPost 已解包 data,此处 res 是 { success, message }
    if (res?.success) {
      ElMessage.success(res.message || '登录刷新成功')
    } else {
      ElMessage.warning(res?.message || '登录刷新失败，可能需要重新扫码登录')
    }
    await loadLoginStatus()
  } catch (error) {
    handleError('刷新登录', error)
  } finally {
    refreshingLogin.value = false
  }
}

async function handleQrLogin(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将启动小红书扫码登录流程，浏览器会打开二维码页面，请用小红书 App 扫码确认。是否继续？',
      '扫码登录',
      { confirmButtonText: '开始扫码', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }
  qrLoggingIn.value = true
  try {
    const res = await apiPost<{ success: boolean; message: string; is_logged_in: boolean }>(
      '/api/xhs-login/qr'
    )
    ElMessage.success(res?.message || '扫码登录流程已完成')
    await loadLoginStatus()
  } catch (error) {
    handleError('扫码登录', error)
  } finally {
    qrLoggingIn.value = false
  }
}

/** 计算 cookie 有效期百分比（用于进度条） */
function cookieHealthPercent(): number {
  const max = loginStatus.value.max_cookie_age_days || 7
  const used = loginStatus.value.cookie_age_days
  const remaining = Math.max(0, max - used)
  return Math.round((remaining / max) * 100)
}

// ============================================================
// Tab 5: 快速操作
// ============================================================

const pipelineStarting = ref<boolean>(false)
const pipelineKeyword = ref<string>('')
const lastRunResult = ref<PipelineStartResponse | null>(null)

async function handleStartPipeline(): Promise<void> {
  if (!pipelineKeyword.value.trim()) {
    ElMessage.warning('请输入关键词')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将启动关键词为 "${pipelineKeyword.value.trim()}" 的流水线，会自动执行搜索、生成草稿等步骤。是否继续？`,
      '启动流水线',
      { confirmButtonText: '启动', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  pipelineStarting.value = true
  try {
    // 新路由 /api/xhs-pipeline/start, apiRequest 已自动解包 data
    const res = await apiPost<{ run_id: number; keyword: string; status: string }>(
      '/start',
      { keyword: pipelineKeyword.value.trim() }
    )
    lastRunResult.value = {
      id: res.run_id,
      keyword: res.keyword,
      status: res.status,
      started_at: null,
      completed_at: null,
      error_message: null,
      sources_count: 0,
      created_at: new Date().toISOString()
    }
    ElMessage.success(`流水线已启动（ID: ${res.run_id}）`)
    // 刷新仪表盘统计
    await loadStats()
  } catch (error) {
    handleError('启动流水线', error)
  } finally {
    pipelineStarting.value = false
  }
}

// ============================================================
// Tab 切换时加载数据
// ============================================================

const activeTab = ref<string>('dashboard')

function handleTabChange(tab: string): void {
  switch (tab) {
    case 'dashboard':
      loadStats()
      break
    case 'keywords':
      loadKeywords()
      break
    case 'schedules':
      loadSchedules()
      break
    case 'login':
      loadLoginStatus()
      break
    // quick-action 不需要预加载
  }
}

// ============================================================
// 运行详情与操作(最近运行记录表格的按钮)
// ============================================================

const router = useRouter()

/** 运行详情抽屉 */
const runDetailVisible = ref<boolean>(false)
const currentRunDetail = ref<RunWithDrafts | null>(null)
const runDetailLoading = ref<boolean>(false)

/** 查看运行详情(含草稿列表) */
async function handleViewRunDetail(run: RecentRun): Promise<void> {
  runDetailVisible.value = true
  runDetailLoading.value = true
  currentRunDetail.value = null
  try {
    const detail = await apiGet<RunWithDrafts>(`/runs/${run.id}`)
    currentRunDetail.value = detail
  } catch (error) {
    handleError('查看运行详情', error)
  } finally {
    runDetailLoading.value = false
  }
}

/** 编辑运行(跳转到快速操作 Tab,预填关键词) */
function handleEditRun(run: RecentRun): void {
  activeTab.value = 'quick-action'
  pipelineKeyword.value = run.keyword || ''
  ElMessage.info(`已预填关键词 "${run.keyword}",可在下方启动新流水线`)
}

/** 审核运行(跳转到草稿审核页面,并传递 run_id) */
function handleReviewRun(run: RecentRun): void {
  router.push({ name: 'DraftReview', query: { run_id: String(run.id) } })
}

/** 发布运行(跳转到发布队列页面) */
function handlePublishRun(run: RecentRun): void {
  router.push({ name: 'PublishQueue', query: { run_id: String(run.id) } })
}

// ============================================================
// 初始化
// ============================================================

const route = useRoute()

onMounted(() => {
  loadStats()

  // 检查 URL query 参数 action=start，自动聚焦到流水线启动区域
  if (route.query.action === 'start') {
    activeTab.value = 'pipeline'
    // 延迟提示，等待页面渲染完成
    setTimeout(() => {
      ElMessage.info('请在下方输入关键词并启动流水线')
    }, 500)
  }
})
</script>

<template>
  <div class="page-container xhs-pipeline-view">
    <!-- 页面头部 -->
    <div class="page-header">
      <span class="page-title">小红书流水线控制台</span>
      <el-button :icon="Refresh" @click="loadStats" :loading="statsLoading">
        刷新数据
      </el-button>
    </div>

    <!-- 选项卡布局 -->
    <el-tabs v-model="activeTab" @tab-change="handleTabChange" class="pipeline-tabs">
      <!-- ==================================================== -->
      <!-- Tab 1: 仪表盘统计 -->
      <!-- ==================================================== -->
      <el-tab-pane label="仪表盘统计" name="dashboard">
        <div v-loading="statsLoading">
          <!-- 统计卡片网格 -->
          <el-row :gutter="16" class="mb-20">
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card clickable" @click="handleStatClick('total_runs')">
                <el-statistic title="流水线运行" :value="stats.total_runs">
                  <template #prefix>
                    <el-icon class="stat-icon stat-icon-primary"><TrendCharts /></el-icon>
                  </template>
                </el-statistic>
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card clickable" @click="handleStatClick('completed_runs')">
                <el-statistic title="已完成" :value="stats.completed_runs" />
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card clickable" @click="handleStatClick('failed_runs')">
                <el-statistic title="失败" :value="stats.failed_runs">
                  <template #suffix>
                    <span v-if="stats.failed_runs > 0" class="text-danger text-sm">条</span>
                  </template>
                </el-statistic>
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card clickable" @click="handleStatClick('total_drafts')">
                <el-statistic title="草稿总数" :value="stats.total_drafts" />
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card clickable" @click="handleStatClick('published_drafts')">
                <el-statistic title="已发布" :value="stats.published_drafts" />
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card clickable" @click="handleStatClick('pending_drafts')">
                <el-statistic title="待处理草稿" :value="stats.pending_drafts">
                  <template #suffix>
                    <span v-if="stats.pending_drafts > 0" class="text-warning text-sm">条</span>
                  </template>
                </el-statistic>
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card">
                <el-statistic title="关键词数" :value="stats.keyword_count">
                  <template #prefix>
                    <el-icon class="stat-icon stat-icon-info"><Key /></el-icon>
                  </template>
                </el-statistic>
              </el-card>
            </el-col>
            <el-col :xs="12" :sm="6" :md="6" :lg="3">
              <el-card shadow="hover" class="stat-card">
                <el-statistic title="定时任务" :value="stats.schedule_count">
                  <template #prefix>
                    <el-icon class="stat-icon stat-icon-warning"><Timer /></el-icon>
                  </template>
                </el-statistic>
              </el-card>
            </el-col>
          </el-row>

          <!-- 最近运行记录 -->
          <el-card shadow="never">
            <template #header>
              <div class="flex-between">
                <span class="font-large font-bold">最近运行记录</span>
                <el-tag type="info" size="small">最多显示 10 条</el-tag>
              </div>
            </template>
            <el-table :data="stats.recent_runs" style="width: 100%" stripe>
              <el-table-column label="ID" prop="id" width="70" />
              <el-table-column label="关键词" prop="keyword" min-width="140" show-overflow-tooltip />
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag :type="statusTagType(row.status)" size="small">
                    {{ statusLabel(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="来源数" prop="sources_count" width="90" />
              <el-table-column label="开始时间" min-width="160">
                <template #default="{ row }">
                  {{ formatDateTime(row.started_at) }}
                </template>
              </el-table-column>
              <el-table-column label="完成时间" min-width="160">
                <template #default="{ row }">
                  {{ formatDateTime(row.completed_at) }}
                </template>
              </el-table-column>
              <el-table-column label="错误信息" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">
                  <span v-if="row.error_message" class="text-danger">{{ row.error_message }}</span>
                  <span v-else class="text-secondary">-</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="280" fixed="right">
                <template #default="{ row }">
                  <el-button
                    size="small"
                    :icon="View"
                    @click="handleViewRunDetail(row)"
                  >
                    详情
                  </el-button>
                  <el-button
                    size="small"
                    type="primary"
                    :icon="Edit"
                    @click="handleEditRun(row)"
                  >
                    编辑
                  </el-button>
                  <el-button
                    size="small"
                    type="warning"
                    :icon="Check"
                    @click="handleReviewRun(row)"
                  >
                    审核
                  </el-button>
                  <el-button
                    size="small"
                    type="success"
                    :icon="Promotion"
                    @click="handlePublishRun(row)"
                  >
                    发布
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-empty
              v-if="!statsLoading && stats.recent_runs.length === 0"
              description="暂无运行记录"
              :image-size="80"
            />
          </el-card>
        </div>
      </el-tab-pane>

      <!-- ==================================================== -->
      <!-- Tab 2: 关键词管理 -->
      <!-- ==================================================== -->
      <el-tab-pane label="关键词管理" name="keywords">
        <el-card shadow="never" v-loading="keywordsLoading">
          <template #header>
            <div class="flex-between">
              <span class="font-large font-bold">关键词列表</span>
              <el-button type="primary" :icon="Plus" @click="openKeywordDialog">
                添加关键词
              </el-button>
            </div>
          </template>
          <el-table :data="keywords" style="width: 100%" stripe>
            <el-table-column label="ID" prop="id" width="70" />
            <el-table-column label="关键词" prop="keyword" min-width="160" show-overflow-tooltip />
            <el-table-column label="分类" min-width="120">
              <template #default="{ row }">
                <el-tag v-if="row.category" size="small" type="info">{{ row.category }}</el-tag>
                <span v-else class="text-secondary">-</span>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="100">
              <template #default="{ row }">
                <el-switch
                  v-model="row.enabled"
                  @change="handleToggleKeyword(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="最后使用" min-width="160">
              <template #default="{ row }">
                {{ formatDateTime(row.last_used_at) }}
              </template>
            </el-table-column>
            <el-table-column label="创建时间" min-width="160">
              <template #default="{ row }">
                {{ formatDateTime(row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  :icon="Delete"
                  circle
                  @click="handleDeleteKeyword(row)"
                />
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-if="!keywordsLoading && keywords.length === 0"
            description="暂无关键词，请点击「添加关键词」按钮添加"
            :image-size="80"
          >
            <el-button type="primary" :icon="Plus" @click="openKeywordDialog">添加关键词</el-button>
          </el-empty>
        </el-card>

        <!-- 添加关键词对话框 -->
        <el-dialog
          v-model="keywordDialogVisible"
          title="添加关键词"
          width="460px"
          :close-on-click-modal="false"
        >
          <el-form :model="keywordForm" label-width="80px" @submit.prevent="handleAddKeyword">
            <el-form-item label="关键词" required>
              <el-input
                v-model="keywordForm.keyword"
                placeholder="请输入关键词（1-100 字符）"
                maxlength="100"
                show-word-limit
                @keyup.enter="handleAddKeyword"
              />
            </el-form-item>
            <el-form-item label="分类">
              <el-input
                v-model="keywordForm.category"
                placeholder="可选，例如：美食、旅行、穿搭"
                maxlength="50"
                show-word-limit
              />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="keywordDialogVisible = false">取消</el-button>
            <el-button
              type="primary"
              :loading="keywordSubmitting"
              @click="handleAddKeyword"
            >
              确认添加
            </el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- ==================================================== -->
      <!-- Tab 3: 定时任务管理 -->
      <!-- ==================================================== -->
      <el-tab-pane label="定时任务管理" name="schedules">
        <el-card shadow="never" v-loading="schedulesLoading">
          <template #header>
            <span class="font-large font-bold">定时任务列表</span>
          </template>
          <el-table :data="schedules" style="width: 100%" stripe>
            <el-table-column label="ID" prop="id" width="70" />
            <el-table-column label="任务名称" prop="name" min-width="140" show-overflow-tooltip />
            <el-table-column label="关键词" prop="keyword" min-width="140" show-overflow-tooltip />
            <el-table-column label="Cron 表达式" min-width="140">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.cron_expression }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="100">
              <template #default="{ row }">
                <el-switch
                  v-model="row.enabled"
                  @change="handleToggleSchedule(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="上次运行" min-width="160">
              <template #default="{ row }">
                {{ formatDateTime(row.last_run_at) }}
              </template>
            </el-table-column>
            <el-table-column label="下次运行" min-width="160">
              <template #default="{ row }">
                {{ formatDateTime(row.next_run_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="primary"
                  :icon="VideoPlay"
                  :loading="triggeringId === row.id"
                  @click="handleTriggerSchedule(row)"
                >
                  触发
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-if="!schedulesLoading && schedules.length === 0"
            description="暂无定时任务"
            :image-size="80"
          />
        </el-card>
      </el-tab-pane>

      <!-- ==================================================== -->
      <!-- Tab 4: 登录状态 -->
      <!-- ==================================================== -->
      <el-tab-pane label="登录状态" name="login">
        <el-row :gutter="16" v-loading="loginLoading">
          <!-- 登录状态卡片 -->
          <el-col :xs="24" :md="12">
            <el-card shadow="never" class="mb-20">
              <template #header>
                <div class="flex-between">
                  <span class="font-large font-bold">小红书登录状态</span>
                  <el-icon class="header-icon"><User /></el-icon>
                </div>
              </template>
              <el-descriptions :column="1" border>
                <el-descriptions-item label="登录状态">
                  <el-tag
                    :type="loginStatus.is_logged_in ? 'success' : 'danger'"
                    size="small"
                  >
                    {{ loginStatus.is_logged_in ? '已登录' : '未登录' }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="检测浏览器">
                  <el-tag size="small" type="info">{{ loginStatus.browser }}</el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="Cookie 天数">
                  <span :class="{ 'text-warning': loginStatus.will_expire_soon, 'text-danger': loginStatus.is_expired }">
                    {{ loginStatus.cookie_age_days }} 天
                  </span>
                  <span class="text-secondary text-sm ml-16">
                    ({{ loginStatus.cookie_age_hours }} 小时)
                  </span>
                </el-descriptions-item>
                <el-descriptions-item label="上次登录时间">
                  {{ formatDateTime(loginStatus.last_login_time) }}
                </el-descriptions-item>
                <el-descriptions-item label="连续失败次数">
                  <span :class="{ 'text-danger': loginStatus.consecutive_failures > 0 }">
                    {{ loginStatus.consecutive_failures }}
                  </span>
                </el-descriptions-item>
              </el-descriptions>

              <!-- 操作按钮 -->
              <div class="login-actions mt-20">
                <el-button
                  type="primary"
                  :icon="Refresh"
                  :loading="refreshingLogin"
                  @click="handleRefreshLogin"
                >
                  刷新登录
                </el-button>
                <el-button
                  type="warning"
                  :icon="Iphone"
                  :loading="qrLoggingIn"
                  @click="handleQrLogin"
                >
                  扫码登录
                </el-button>
              </div>
            </el-card>
          </el-col>

          <!-- Cookie 健康度卡片 -->
          <el-col :xs="24" :md="12">
            <el-card shadow="never" class="mb-20">
              <template #header>
                <span class="font-large font-bold">Cookie 健康度</span>
              </template>
              <div class="cookie-health">
                <div class="health-status">
                  <el-tag
                    v-if="loginStatus.is_expired"
                    type="danger"
                    size="large"
                  >
                    Cookie 已过期
                  </el-tag>
                  <el-tag
                    v-else-if="loginStatus.will_expire_soon"
                    type="warning"
                    size="large"
                  >
                    即将过期，请刷新
                  </el-tag>
                  <el-tag
                    v-else-if="loginStatus.is_logged_in"
                    type="success"
                    size="large"
                  >
                    状态良好
                  </el-tag>
                  <el-tag v-else type="danger" size="large">
                    未登录
                  </el-tag>
                </div>
                <el-progress
                  :percentage="cookieHealthPercent()"
                  :color="loginStatus.is_expired ? '#f56c6c' : loginStatus.will_expire_soon ? '#e6a23c' : '#67c23a'"
                  :stroke-width="20"
                  :format="(p: number) => `剩余 ${p}%`"
                  class="mt-20"
                />
                <div class="health-hint mt-16">
                  <el-icon><Switch /></el-icon>
                  <span class="text-secondary text-sm">
                    Cookie 最长有效期 {{ loginStatus.max_cookie_age_days }} 天，
                    超过 {{ loginStatus.warning_threshold_days }} 天后将提醒刷新。
                  </span>
                </div>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- ==================================================== -->
      <!-- Tab 5: 快速操作 -->
      <!-- ==================================================== -->
      <el-tab-pane label="快速操作" name="quick-action">
        <el-card shadow="never">
          <template #header>
            <span class="font-large font-bold">启动流水线</span>
          </template>
          <div class="quick-action">
            <div class="action-hint mb-16 text-secondary">
              <el-icon><MagicStick /></el-icon>
              <span>输入关键词后启动流水线，系统将自动完成搜索、生成草稿、发布等步骤。</span>
            </div>
            <el-input
              v-model="pipelineKeyword"
              placeholder="请输入流水线关键词，例如：秋季穿搭、健康早餐、旅行攻略"
              size="large"
              maxlength="100"
              show-word-limit
              clearable
              class="keyword-input"
              @keyup.enter="handleStartPipeline"
            />
            <div class="mt-20">
              <el-button
                type="primary"
                size="large"
                :icon="VideoPlay"
                :loading="pipelineStarting"
                @click="handleStartPipeline"
              >
                {{ pipelineStarting ? '启动中...' : '启动流水线' }}
              </el-button>
              <el-button
                size="large"
                :icon="DataLine"
                @click="activeTab = 'dashboard'; loadStats()"
              >
                查看运行记录
              </el-button>
            </div>

            <!-- 最近启动结果 -->
            <el-card v-if="lastRunResult" shadow="hover" class="mt-20 result-card">
              <template #header>
                <span class="font-bold">最近启动结果</span>
              </template>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="运行 ID">{{ lastRunResult.id }}</el-descriptions-item>
                <el-descriptions-item label="关键词">{{ lastRunResult.keyword }}</el-descriptions-item>
                <el-descriptions-item label="状态">
                  <el-tag :type="statusTagType(lastRunResult.status)" size="small">
                    {{ statusLabel(lastRunResult.status) }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="创建时间">
                  {{ formatDateTime(lastRunResult.created_at) }}
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 统计详情对话框(点击统计卡片弹出) -->
    <el-dialog
      v-model="statsDetailVisible"
      :title="statsDetailTitle"
      width="80%"
      top="5vh"
      destroy-on-close
    >
      <div v-loading="statsDetailLoading">
        <!-- 运行列表 -->
        <el-table v-if="statsDetailKind === 'runs'" :data="statsDetailRuns" style="width: 100%" stripe max-height="60vh">
          <el-table-column label="ID" prop="id" width="70" />
          <el-table-column label="关键词" prop="keyword" min-width="140" show-overflow-tooltip />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源数" prop="sources_count" width="90" />
          <el-table-column label="开始时间" min-width="160">
            <template #default="{ row }">
              {{ formatDateTime(row.started_at) }}
            </template>
          </el-table-column>
          <el-table-column label="完成时间" min-width="160">
            <template #default="{ row }">
              {{ formatDateTime(row.completed_at) }}
            </template>
          </el-table-column>
          <el-table-column label="错误信息" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.error_message" class="text-danger">{{ row.error_message }}</span>
              <span v-else class="text-secondary">-</span>
            </template>
          </el-table-column>
        </el-table>

        <!-- 草稿列表 -->
        <el-table v-else :data="statsDetailDrafts" style="width: 100%" stripe max-height="60vh">
          <el-table-column label="ID" prop="id" width="70" />
          <el-table-column label="标题" prop="title" min-width="200" show-overflow-tooltip />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="draftStatusTagType(row.status)" size="small">
                {{ draftStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="流水线" prop="pipeline_run_id" width="100" />
          <el-table-column label="创建时间" min-width="160">
            <template #default="{ row }">
              {{ formatDateTime(row.created_at) }}
            </template>
          </el-table-column>
          <el-table-column label="发布时间" min-width="160">
            <template #default="{ row }">
              {{ formatDateTime(row.published_at) }}
            </template>
          </el-table-column>
        </el-table>

        <el-empty
          v-if="!statsDetailLoading && (statsDetailKind === 'runs' ? statsDetailRuns.length === 0 : statsDetailDrafts.length === 0)"
          description="暂无数据"
          :image-size="80"
        />
      </div>
    </el-dialog>

    <!-- 运行详情抽屉(点击"详情"按钮弹出) -->
    <el-drawer
      v-model="runDetailVisible"
      :title="`运行详情 #${currentRunDetail?.run?.id || ''}`"
      direction="rtl"
      size="50%"
      destroy-on-close
    >
      <div v-loading="runDetailLoading">
        <template v-if="currentRunDetail">
        <el-descriptions :column="1" border class="mb-20">
          <el-descriptions-item label="运行 ID">{{ currentRunDetail.run.id }}</el-descriptions-item>
          <el-descriptions-item label="关键词">{{ currentRunDetail.run.keyword || '-' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(currentRunDetail.run.status)" size="small">
              {{ statusLabel(currentRunDetail.run.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前阶段">{{ currentRunDetail.run.current_stage }}</el-descriptions-item>
          <el-descriptions-item label="来源数">{{ currentRunDetail.run.sources_count }}</el-descriptions-item>
          <el-descriptions-item label="开始时间">{{ formatDateTime(currentRunDetail.run.started_at) }}</el-descriptions-item>
          <el-descriptions-item label="完成时间">{{ formatDateTime(currentRunDetail.run.completed_at) }}</el-descriptions-item>
          <el-descriptions-item label="错误信息" v-if="currentRunDetail.run.error_message">
            <span class="text-danger">{{ currentRunDetail.run.error_message }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 草稿列表 -->
        <div class="run-detail-drafts">
          <h4 class="font-bold mb-12">草稿列表 ({{ currentRunDetail.drafts.length }})</h4>
          <el-table :data="currentRunDetail.drafts" style="width: 100%" stripe size="small">
            <el-table-column label="ID" prop="id" width="60" />
            <el-table-column label="标题" prop="title" min-width="180" show-overflow-tooltip />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="draftStatusTagType(row.status)" size="small">
                  {{ draftStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" min-width="140">
              <template #default="{ row }">
                {{ formatDateTime(row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-if="currentRunDetail.drafts.length === 0"
            description="该运行暂无草稿"
            :image-size="60"
          />
        </div>
      </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.xhs-pipeline-view {
  padding: 20px;
}

.pipeline-tabs {
  margin-top: 8px;
}

/* 统计卡片 */
.stat-card {
  text-align: center;
  margin-bottom: 16px;
  transition: all 0.3s;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-card :deep(.el-statistic__head) {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.stat-card :deep(.el-statistic__content) {
  font-size: 26px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.stat-icon {
  font-size: 22px;
  margin-right: 4px;
}

.stat-icon-primary {
  color: var(--color-primary);
}

.stat-icon-info {
  color: var(--color-info);
}

.stat-icon-warning {
  color: var(--color-warning);
}

/* 登录状态 */
.login-actions {
  display: flex;
  gap: 12px;
}

.header-icon {
  font-size: 20px;
  color: var(--color-text-secondary);
}

.cookie-health {
  padding: 8px 0;
}

.health-status {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.health-hint {
  display: flex;
  align-items: center;
  gap: 6px;
}

.health-hint .el-icon {
  color: var(--color-info);
}

/* 快速操作 */
.quick-action {
  padding: 16px 0;
}

.action-hint {
  display: flex;
  align-items: center;
  gap: 6px;
}

.keyword-input {
  max-width: 600px;
}

.result-card {
  max-width: 600px;
}

/* 文本工具类 */
.text-sm {
  font-size: 13px;
}

/* 可点击的统计卡片 */
.stat-card.clickable {
  cursor: pointer;
}

.stat-card.clickable:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

/* 运行详情抽屉中的草稿列表区域 */
.run-detail-drafts {
  margin-top: 16px;
}

.font-bold {
  font-weight: 600;
}

.mb-12 {
  margin-bottom: 12px;
}
</style>
