<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { videoAlchemistApi } from '@/api'
import type { VideoAlchemistRun } from '@/api'

// ============================================================
// 输入区
// ============================================================
const urlInput = ref<string>('')
const platform = ref<string>('xiaohongshu')

const platformOptions = [
  { label: '小红书', value: 'xiaohongshu' },
  { label: '抖音', value: 'douyin' },
  { label: '微博', value: 'weibo' },
  { label: '微信公众号', value: 'wechat' },
  { label: '知乎', value: 'zhihu' }
]

// ============================================================
// 处理进度（el-steps）
// ============================================================
const processing = ref<boolean>(false)
const activeStep = ref<number>(-1)
let stepTimer: ReturnType<typeof setInterval> | null = null

const steps = [
  { title: '提取文字', description: '转录视频音频为文字' },
  { title: '提炼观点', description: '识别核心内容要点' },
  { title: '改写内容', description: '适配目标平台风格' },
  { title: '生成配图', description: '生成配套图片素材' }
]

function startStepTimer(): void {
  stopStepTimer()
  activeStep.value = 0
  // 处理过程通常较长，逐步推进进度指示（仅作视觉反馈，最终以 API 返回为准）
  stepTimer = setInterval(() => {
    if (activeStep.value < steps.length - 1) {
      activeStep.value += 1
    }
  }, 2500)
}

function stopStepTimer(): void {
  if (stepTimer !== null) {
    clearInterval(stepTimer)
    stepTimer = null
  }
}

// ============================================================
// 结果展示
// ============================================================
const currentResult = ref<VideoAlchemistRun | null>(null)
const transcriptCollapsed = ref<boolean>(false)

/** 改写结果完整文本（用于复制） */
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

// ============================================================
// 工具函数
// ============================================================
function platformLabel(p?: string): string {
  if (!p) return '-'
  const map: Record<string, string> = {
    xiaohongshu: '小红书',
    douyin: '抖音',
    weibo: '微博',
    wechat: '微信公众号',
    zhihu: '知乎'
  }
  return map[p] || p
}

const statusConfig: Record<string, { label: string; type: 'info' | 'warning' | 'success' | 'danger' }> = {
  pending: { label: '待处理', type: 'info' },
  processing: { label: '处理中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  failed: { label: '失败', type: 'danger' }
}

function statusLabel(s?: string): string {
  return statusConfig[s || '']?.label || s || '-'
}

function statusType(s?: string): 'info' | 'warning' | 'success' | 'danger' {
  return statusConfig[s || '']?.type || 'info'
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
const runList = ref<VideoAlchemistRun[]>([])
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

async function loadRuns(): Promise<void> {
  loading.value = true
  try {
    const res = await videoAlchemistApi.getRuns({
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    runList.value = res.data
    pagination.total = res.total
  } catch (error) {
    console.error('加载视频炼金术历史失败:', error)
  } finally {
    loading.value = false
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

  processing.value = true
  currentResult.value = null
  transcriptCollapsed.value = false
  startStepTimer()
  try {
    const res = await videoAlchemistApi.process({
      url: urlInput.value.trim(),
      platform: platform.value
    })
    stopStepTimer()
    activeStep.value = steps.length
    currentResult.value = res.data ?? null
    ElMessage.success('处理完成')
    await loadRuns()
  } catch (error) {
    stopStepTimer()
    console.error('视频处理失败:', error)
  } finally {
    processing.value = false
  }
}

// ============================================================
// 查看 / 删除
// ============================================================
async function handleView(run: VideoAlchemistRun): Promise<void> {
  viewing.value = run.id
  try {
    const res = await videoAlchemistApi.getRun(run.id)
    currentResult.value = res.data ?? null
    transcriptCollapsed.value = false
    activeStep.value = res.data?.status === 'completed' ? steps.length : -1
    ElMessage.success('已加载记录')
  } catch (error) {
    console.error('加载记录失败:', error)
  } finally {
    viewing.value = 0
  }
}

async function handleDelete(run: VideoAlchemistRun): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除该条记录吗？此操作不可恢复。', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  try {
    await videoAlchemistApi.deleteRun(run.id)
    ElMessage.success('删除成功')
    if (currentResult.value?.id === run.id) {
      currentResult.value = null
      activeStep.value = -1
    }
    await loadRuns()
  } catch (error) {
    console.error('删除失败:', error)
  }
}

// ============================================================
// 分页
// ============================================================
function handlePageChange(page: number): void {
  pagination.page = page
  loadRuns()
}

onMounted(() => {
  loadRuns()
})

onUnmounted(() => {
  stopStepTimer()
})
</script>

<template>
  <div class="page-container">
    <!-- 头部 -->
    <div class="page-header">
      <div>
        <span class="page-title">视频内容炼金术</span>
        <p class="page-desc">从视频 URL 提取内容，自动转录、提炼核心观点，改写为多平台图文</p>
      </div>
    </div>

    <!-- 输入区 -->
    <el-card shadow="never" class="mb-16">
      <div class="input-bar">
        <el-input
          v-model="urlInput"
          placeholder="请输入视频 URL（B站 / 抖音 / 小红书 等）"
          clearable
          style="flex: 1; min-width: 320px"
          @keyup.enter="handleProcess"
        >
          <template #prefix>
            <el-icon><Link /></el-icon>
          </template>
        </el-input>
        <el-select v-model="platform" style="width: 160px">
          <el-option
            v-for="opt in platformOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-button type="primary" :loading="processing" @click="handleProcess">
          <el-icon v-if="!processing"><MagicStick /></el-icon>
          {{ processing ? '处理中...' : '开始处理' }}
        </el-button>
      </div>
    </el-card>

    <!-- 处理进度 -->
    <el-card v-if="processing || activeStep >= 0" shadow="never" class="mb-16">
      <el-steps :active="activeStep" finish-status="success" align-center>
        <el-step
          v-for="(step, idx) in steps"
          :key="idx"
          :title="step.title"
          :description="step.description"
        />
      </el-steps>
    </el-card>

    <!-- 结果展示区 -->
    <div v-if="currentResult" class="result-section">
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
        <div v-show="!transcriptCollapsed" class="transcript-text">
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
      <el-card shadow="never" class="mb-16">
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
    </div>

    <!-- 历史记录 -->
    <el-card shadow="never">
      <template #header><span class="card-title">历史记录</span></template>
      <el-table :data="runList" v-loading="loading" stripe style="width: 100%">
        <el-table-column label="URL" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">{{ row.url }}</template>
        </el-table-column>
        <el-table-column label="平台" width="120">
          <template #default="{ row }">{{ platformLabel(row.platform) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ row.createdAt || '-' }}</template>
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

.card-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.transcript-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
  color: var(--color-text-regular);
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 8px;
}

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
}
</style>
