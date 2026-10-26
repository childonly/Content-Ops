<script setup lang="ts">
/**
 * DraftReview - 草稿审核页面
 *
 * 三项目融合第二阶段新增页面,用于审核流水线生成的笔记草稿。
 *
 * 功能:
 * 1. 展示待审核草稿列表
 * 2. 查看草稿详情(标题、内容、标签、图片)
 * 3. 审核通过并发布到小红书
 * 4. 拒绝草稿(不发布)
 * 5. 查看流水线运行报告
 */
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Refresh,
  Check,
  Close,
  Document,
  Picture,
  Promotion,
  View
} from '@element-plus/icons-vue'

// ============================================================
// 类型定义
// ============================================================

interface Draft {
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
  review_notes: string | null
  created_at: string
  updated_at: string
}

interface PipelineRun {
  id: number
  keyword: string | null
  status: string
  current_stage: string
  sources_count: number
  report_content: string | null
  started_at: string
  completed_at: string | null
}

// ============================================================
// API 请求封装 (与 XhsPipelineView 一致的风格)
// ============================================================

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api/') ? path : `/api/xhs-pipeline${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}: 请求失败`
    try {
      const errorData = await res.json()
      errorMsg = errorData.error || errorData.message || errorMsg
    } catch {
      // 非 JSON 响应
    }
    throw new Error(errorMsg)
  }

  if (res.status === 204) return undefined as unknown as T

  const json = await res.json() as { success?: boolean; data?: T; error?: string }
  if (json && typeof json.success === 'boolean') {
    if (!json.success) throw new Error(json.error || '请求失败')
    return json.data as T
  }
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

// ============================================================
// 状态
// ============================================================

const loading = ref<boolean>(false)
const drafts = ref<Draft[]>([])
const selectedDraft = ref<Draft | null>(null)
const detailDrawerVisible = ref<boolean>(false)
const approving = ref<number>(0)
const rejecting = ref<number>(0)
const reportDrawerVisible = ref<boolean>(false)
const currentReport = ref<string>('')
const currentRunKeyword = ref<string>('')

// 筛选
const statusFilter = ref<string>('pending')

// ============================================================
// 工具函数
// ============================================================

type TagType = '' | 'primary' | 'success' | 'info' | 'warning' | 'danger'

const draftStatusMap: Record<string, { label: string; type: TagType }> = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已通过', type: 'primary' },
  rejected: { label: '已拒绝', type: 'info' },
  published: { label: '已发布', type: 'success' },
  published_failed: { label: '发布失败', type: 'danger' },
}

function statusLabel(status: string): string {
  return draftStatusMap[status]?.label || status
}

function statusTagType(status: string): TagType {
  return draftStatusMap[status]?.type || 'info'
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return dateStr
  }
}

function getImageList(images: string): string[] {
  if (!images) return []
  return images.split(',').filter(Boolean)
}

function getTagList(tags: string): string[] {
  if (!tags) return []
  return tags.split(',').map(t => t.trim()).filter(Boolean)
}

function handleError(action: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error)
  ElMessage.error(`${action}失败: ${msg}`)
  console.error(`${action}失败:`, error)
}

// 筛选后的草稿列表
const filteredDrafts = computed(() => {
  if (statusFilter.value === 'all') return drafts.value
  return drafts.value.filter(d => d.status === statusFilter.value)
})

// 统计
const stats = computed(() => {
  const total = drafts.value.length
  const pending = drafts.value.filter(d => d.status === 'pending').length
  const published = drafts.value.filter(d => d.status === 'published').length
  const failed = drafts.value.filter(d => d.status === 'published_failed').length
  return { total, pending, published, failed }
})

// ============================================================
// 数据加载
// ============================================================

async function loadDrafts(): Promise<void> {
  loading.value = true
  try {
    // 获取所有最近的流水线运行的草稿
    const runs = await apiGet<Array<{ run: PipelineRun; drafts: Draft[] }>>('/runs?limit=20')

    // 展平所有草稿(防御性检查: 确保 item.drafts 是数组)
    const allDrafts: Draft[] = []
    for (const item of runs) {
      if (item.drafts && Array.isArray(item.drafts)) {
        for (const draft of item.drafts) {
          allDrafts.push(draft)
        }
      }
    }

    // 按 id 倒序
    allDrafts.sort((a, b) => b.id - a.id)
    drafts.value = allDrafts
  } catch (error) {
    handleError('加载草稿列表', error)
  } finally {
    loading.value = false
  }
}

// ============================================================
// 草稿详情
// ============================================================

function showDetail(draft: Draft): void {
  selectedDraft.value = draft
  detailDrawerVisible.value = true
}

// ============================================================
// 审核通过并发布
// ============================================================

async function handleApprove(draft: Draft): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要审核通过并发布草稿 "${draft.title}" 吗？\n\n系统将自动发布到小红书,发布过程可能需要 1-5 分钟。`,
      '审核通过并发布',
      {
        confirmButtonText: '通过并发布',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--success'
      }
    )
  } catch {
    return
  }

  approving.value = draft.id
  try {
    const updated = await apiPost<Draft>(`/drafts/${draft.id}/approve`)

    // 更新列表中的草稿
    const idx = drafts.value.findIndex(d => d.id === draft.id)
    if (idx >= 0) {
      drafts.value[idx] = updated
    }

    if (updated.status === 'published') {
      ElMessage.success(`草稿 "${draft.title}" 已成功发布到小红书！`)
    } else if (updated.status === 'published_failed') {
      ElMessage.error(`发布失败: ${updated.publish_error || '未知错误'}`)
    }

    // 关闭详情抽屉
    if (selectedDraft.value?.id === draft.id) {
      detailDrawerVisible.value = false
    }
  } catch (error) {
    handleError('审核发布', error)
  } finally {
    approving.value = 0
  }
}

// ============================================================
// 拒绝草稿
// ============================================================

async function handleReject(draft: Draft): Promise<void> {
  let reviewNotes = ''
  try {
    const result = await ElMessageBox.prompt(
      `请输入拒绝理由(可选):`,
      `拒绝草稿 "${draft.title}"`,
      {
        confirmButtonText: '确认拒绝',
        cancelButtonText: '取消',
        type: 'warning',
        inputPlaceholder: '拒绝理由(可选)',
        inputType: 'textarea',
        inputValidator: () => true,
      }
    )
    reviewNotes = result.value || ''
  } catch {
    return
  }

  rejecting.value = draft.id
  try {
    const updated = await apiPost<Draft>(
      `/drafts/${draft.id}/reject`,
      { review_notes: reviewNotes }
    )

    const idx = drafts.value.findIndex(d => d.id === draft.id)
    if (idx >= 0) {
      drafts.value[idx] = updated
    }

    ElMessage.info(`草稿 "${draft.title}" 已拒绝`)

    if (selectedDraft.value?.id === draft.id) {
      detailDrawerVisible.value = false
    }
  } catch (error) {
    handleError('拒绝草稿', error)
  } finally {
    rejecting.value = 0
  }
}

// ============================================================
// 查看报告
// ============================================================

async function viewReport(runId: number): Promise<void> {
  try {
    const result = await apiGet<{ run: PipelineRun; drafts: Draft[] }>(`/runs/${runId}`)
    if (result.run.report_content) {
      currentReport.value = result.run.report_content
      currentRunKeyword.value = result.run.keyword || ''
      reportDrawerVisible.value = true
    } else {
      ElMessage.info('该流水线运行没有研究报告')
    }
  } catch (error) {
    handleError('查看报告', error)
  }
}

// ============================================================
// 初始化
// ============================================================

onMounted(() => {
  loadDrafts()
})
</script>

<template>
  <div class="page-container draft-review-view">
    <!-- 页面头部 -->
    <div class="page-header">
      <span class="page-title">草稿审核</span>
      <el-button :icon="Refresh" @click="loadDrafts" :loading="loading">
        刷新列表
      </el-button>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="mb-20">
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="草稿总数" :value="stats.total" />
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="待审核" :value="stats.pending">
            <template #suffix>
              <span v-if="stats.pending > 0" class="text-warning text-sm">条</span>
            </template>
          </el-statistic>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="已发布" :value="stats.published" />
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="发布失败" :value="stats.failed">
            <template #suffix>
              <span v-if="stats.failed > 0" class="text-danger text-sm">条</span>
            </template>
          </el-statistic>
        </el-card>
      </el-col>
    </el-row>

    <!-- 筛选与列表 -->
    <el-card shadow="never" v-loading="loading">
      <template #header>
        <div class="flex-between">
          <span class="font-large font-bold">草稿列表</span>
          <el-radio-group v-model="statusFilter" size="small">
            <el-radio-button label="pending">待审核</el-radio-button>
            <el-radio-button label="published">已发布</el-radio-button>
            <el-radio-button label="published_failed">发布失败</el-radio-button>
            <el-radio-button label="rejected">已拒绝</el-radio-button>
            <el-radio-button label="all">全部</el-radio-button>
          </el-radio-group>
        </div>
      </template>

      <el-table :data="filteredDrafts" style="width: 100%" stripe>
        <el-table-column label="ID" prop="id" width="70" />
        <el-table-column label="标题" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" @click="showDetail(row)">{{ row.title }}</el-link>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="标签" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag
              v-for="tag in getTagList(row.tags).slice(0, 3)"
              :key="tag"
              size="small"
              type="info"
              class="mr-4"
            >
              {{ tag }}
            </el-tag>
            <span v-if="getTagList(row.tags).length > 3" class="text-secondary text-sm">
              +{{ getTagList(row.tags).length - 3 }}
            </span>
            <span v-if="getTagList(row.tags).length === 0" class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="图片" width="80" align="center">
          <template #default="{ row }">
            <el-badge :value="getImageList(row.images).length" :hidden="getImageList(row.images).length === 0">
              <el-icon :size="18" :color="getImageList(row.images).length > 0 ? '#409eff' : '#c0c4cc'">
                <Picture />
              </el-icon>
            </el-badge>
          </template>
        </el-table-column>
        <el-table-column label="流水线" width="100">
          <template #default="{ row }">
            <el-link type="info" @click="viewReport(row.pipeline_run_id)">
              #{{ row.pipeline_run_id }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="160">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              :icon="View"
              @click="showDetail(row)"
            >
              详情
            </el-button>
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="success"
              :icon="Check"
              :loading="approving === row.id"
              @click="handleApprove(row)"
            >
              通过
            </el-button>
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="danger"
              :icon="Close"
              :loading="rejecting === row.id"
              @click="handleReject(row)"
            >
              拒绝
            </el-button>
            <el-link
              v-if="row.status === 'published' && row.publish_url"
              type="primary"
              :href="row.publish_url"
              target="_blank"
              class="ml-8"
            >
              <el-icon><Promotion /></el-icon> 查看
            </el-link>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="!loading && filteredDrafts.length === 0"
        :description="statusFilter === 'pending' ? '暂无待审核草稿' : '暂无草稿'"
        :image-size="80"
      />
    </el-card>

    <!-- 草稿详情抽屉 -->
    <el-drawer
      v-model="detailDrawerVisible"
      title="草稿详情"
      direction="rtl"
      size="50%"
    >
      <template v-if="selectedDraft">
        <el-descriptions :column="1" border class="mb-20">
          <el-descriptions-item label="草稿 ID">{{ selectedDraft.id }}</el-descriptions-item>
          <el-descriptions-item label="流水线 ID">
            <el-link type="info" @click="viewReport(selectedDraft.pipeline_run_id)">
              #{{ selectedDraft.pipeline_run_id }}
            </el-link>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(selectedDraft.status)" size="small">
              {{ statusLabel(selectedDraft.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(selectedDraft.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="发布时间" v-if="selectedDraft.published_at">
            {{ formatDateTime(selectedDraft.published_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="发布链接" v-if="selectedDraft.publish_url">
            <el-link type="primary" :href="selectedDraft.publish_url" target="_blank">
              {{ selectedDraft.publish_url }}
            </el-link>
          </el-descriptions-item>
          <el-descriptions-item label="发布错误" v-if="selectedDraft.publish_error">
            <span class="text-danger">{{ selectedDraft.publish_error }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 标题 -->
        <div class="draft-section">
          <h3 class="section-title">
            <el-icon><Document /></el-icon> 标题
          </h3>
          <div class="section-content">{{ selectedDraft.title }}</div>
        </div>

        <!-- 正文 -->
        <div class="draft-section">
          <h3 class="section-title">
            <el-icon><Document /></el-icon> 正文
          </h3>
          <div class="section-content draft-content">{{ selectedDraft.content }}</div>
        </div>

        <!-- 标签 -->
        <div class="draft-section" v-if="getTagList(selectedDraft.tags).length > 0">
          <h3 class="section-title">
            <el-icon><Document /></el-icon> 标签
          </h3>
          <div class="section-content">
            <el-tag
              v-for="tag in getTagList(selectedDraft.tags)"
              :key="tag"
              type="info"
              class="mr-8 mb-8"
            >
              {{ tag }}
            </el-tag>
          </div>
        </div>

        <!-- 图片 -->
        <div class="draft-section" v-if="getImageList(selectedDraft.images).length > 0">
          <h3 class="section-title">
            <el-icon><Picture /></el-icon> 配图
          </h3>
          <div class="section-content image-list">
            <el-image
              v-for="(img, idx) in getImageList(selectedDraft.images)"
              :key="idx"
              :src="`/api/xhs-pipeline/images/${encodeURIComponent(img)}`"
              fit="cover"
              class="draft-image"
              :preview-src-list="getImageList(selectedDraft.images).map(i => `/api/xhs-pipeline/images/${encodeURIComponent(i)}`)"
              :initial-index="idx"
            >
              <template #error>
                <div class="image-error">
                  <el-icon><Picture /></el-icon>
                  <span>图片加载失败</span>
                </div>
              </template>
            </el-image>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="detail-actions" v-if="selectedDraft.status === 'pending'">
          <el-button
            type="success"
            :icon="Check"
            :loading="approving === selectedDraft.id"
            @click="handleApprove(selectedDraft)"
          >
            审核通过并发布
          </el-button>
          <el-button
            type="danger"
            :icon="Close"
            :loading="rejecting === selectedDraft.id"
            @click="handleReject(selectedDraft)"
          >
            拒绝草稿
          </el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 研究报告抽屉 -->
    <el-drawer
      v-model="reportDrawerVisible"
      :title="`研究报告 - ${currentRunKeyword}`"
      direction="rtl"
      size="60%"
    >
      <div class="report-content" v-html="renderMarkdown(currentReport)"></div>
    </el-drawer>
  </div>
</template>

<script lang="ts">
// 简单的 Markdown 渲染(避免引入额外依赖)
function renderMarkdown(md: string): string {
  if (!md) return '<p class="text-secondary">暂无报告内容</p>'
  let html = md
    // 转义 HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 标题
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 列表
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    // 段落
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
  return html
}

export default {
  methods: { renderMarkdown }
}
</script>

<style scoped>
.draft-review-view {
  padding: 20px;
}

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
}

.draft-section {
  margin-bottom: 24px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--color-text-primary);
}

.section-content {
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  line-height: 1.8;
  font-size: 14px;
}

.draft-content {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}

.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  background: transparent;
  padding: 0;
}

.draft-image {
  width: 150px;
  height: 150px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
}

.image-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--color-text-secondary);
  gap: 4px;
  font-size: 12px;
}

.detail-actions {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--el-border-color);
  margin-top: 16px;
}

.report-content {
  padding: 16px;
  line-height: 1.8;
  font-size: 14px;
}

.report-content :deep(h1),
.report-content :deep(h2),
.report-content :deep(h3) {
  margin: 16px 0 8px;
  font-weight: 600;
}

.report-content :deep(h1) { font-size: 20px; }
.report-content :deep(h2) { font-size: 17px; }
.report-content :deep(h3) { font-size: 15px; }

.report-content :deep(ul) {
  padding-left: 20px;
  margin: 8px 0;
}

.report-content :deep(li) {
  margin: 4px 0;
}

.text-sm {
  font-size: 13px;
}

.mr-4 {
  margin-right: 4px;
}

.mr-8 {
  margin-right: 8px;
}

.mb-8 {
  margin-bottom: 8px;
}

.ml-8 {
  margin-left: 8px;
}
</style>
