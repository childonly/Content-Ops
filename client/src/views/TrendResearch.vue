<script setup lang="ts">
/**
 * 趋势发现页面
 *
 * 功能:
 *   1. 发现新趋势（调用后端 discover API）
 *   2. 卡片网格展示 + 多选批量操作
 *   3. 追踪趋势 / 基于趋势生成内容
 *   4. 筛选（平台、分类）
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import TrendCard from '@/components/TrendCard.vue'
import { trendsApi, contentsApi } from '@/api'
import type { Trend, Platform } from '@/types'

const router = useRouter()

// 加载状态
const loading = ref<boolean>(false)
const discovering = ref<boolean>(false)
const generatingIds = ref<Set<number>>(new Set())

// 趋势列表
const trendList = ref<Trend[]>([])
const detailVisible = ref(false)
const detailTrend = ref<Trend | null>(null)
const detailMetadata = computed<Record<string, unknown>>(() => {
  const value = detailTrend.value?.metadata
  if (!value) return {}
  try { return typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown> } catch { return { raw: value } }
})

// 选中的趋势 ID 集合
const selectedIds = ref<Set<number>>(new Set())

// 是否全选
const allSelected = computed<boolean>(() => {
  return trendList.value.length > 0 && trendList.value.every(t => selectedIds.value.has(t.id))
})

// 选中的趋势数量
const selectedCount = computed<number>(() => selectedIds.value.size)

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 12,
  total: 0
})

// 筛选条件
const filters = reactive({
  platform: '' as Platform | '',
  category: ''
})

// 平台选项
const platformOptions = [
  { label: '全部平台', value: '' },
  { label: '抖音', value: 'douyin' },
  { label: '小红书', value: 'xiaohongshu' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Twitter', value: 'twitter' }
]

// 分类选项
const categoryOptions = [
  { label: '全部分类', value: '' },
  { label: '科技', value: 'tech' },
  { label: '生活', value: 'lifestyle' },
  { label: '美食', value: 'food' },
  { label: '时尚', value: 'fashion' },
  { label: '娱乐', value: 'entertainment' },
  { label: '教育', value: 'education' }
]

/** 加载趋势列表 */
async function loadTrends(): Promise<void> {
  loading.value = true
  try {
    const res = await trendsApi.getList({
      page: pagination.page,
      pageSize: pagination.pageSize,
      platform: filters.platform || undefined,
      category: filters.category || undefined
    })
    trendList.value = res.data
    pagination.total = res.total
    // 加载新数据后清空选择
    selectedIds.value.clear()
  } catch (error) {
    console.error('加载趋势列表失败:', error)
  } finally {
    loading.value = false
  }
}

/** 发现新趋势 */
async function handleDiscover(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将调用多平台数据源发现最新热门趋势，是否继续？',
      '发现新趋势',
      { confirmButtonText: '开始发现', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }

  discovering.value = true
  try {
    const res = await trendsApi.discover({
      platform: filters.platform || undefined,
      category: filters.category || undefined
    })
    const newCount = res.data!.filter(t => t.status === 'new').length
    const updateCount = res.data!.length - newCount
    ElMessage.success(`发现 ${res.data!.length} 条趋势（${newCount} 条新增，${updateCount} 条更新）`)
    await loadTrends()
  } catch (error) {
    console.error('发现趋势失败:', error)
    ElMessage.error('发现趋势失败: ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    discovering.value = false
  }
}

/** 处理追踪趋势 */
async function handleTrack(trend: Trend): Promise<void> {
  try {
    await trendsApi.updateStatus(trend.id, 'tracked')
    ElMessage.success('已开始追踪该趋势')
    await loadTrends()
  } catch (error) {
    console.error('追踪趋势失败:', error)
  }
}

/** 处理生成内容（单个趋势） */
async function handleGenerate(trend: Trend): Promise<void> {
  generatingIds.value.add(trend.id)
  try {
    await ElMessageBox.confirm(
      `将基于趋势"${trend.title}"生成内容草稿，是否继续？`,
      '生成内容',
      { confirmButtonText: '生成', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    generatingIds.value.delete(trend.id)
    return
  }

  try {
    // 传入趋势标题作为关键词，确保生成内容与趋势相关
    await contentsApi.generate({
      trendId: trend.id,
      keywords: [trend.title]
    } as any)
    ElMessage.success('内容生成成功，正在跳转到内容工作室')
    // 跳转并自动切换到列表视图
    router.push({ path: '/content', query: { tab: 'list' } })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`生成内容失败: ${errMsg}`)
  } finally {
    generatingIds.value.delete(trend.id)
  }
}

function handleDetail(trend: Trend): void {
  detailTrend.value = trend
  detailVisible.value = true
}

/** 切换单个趋势的选中状态 */
function toggleSelect(trend: Trend): void {
  if (selectedIds.value.has(trend.id)) {
    selectedIds.value.delete(trend.id)
  } else {
    selectedIds.value.add(trend.id)
  }
}

/** 全选/取消全选 */
function toggleSelectAll(): void {
  if (allSelected.value) {
    selectedIds.value.clear()
  } else {
    trendList.value.forEach(t => selectedIds.value.add(t.id))
  }
}

/** 批量删除 */
async function handleBatchDelete(): Promise<void> {
  if (!selectedCount.value) {
    ElMessage.warning('请先选择要删除的趋势')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedCount.value} 条趋势吗？此操作不可恢复。`,
      '批量删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  try {
    const ids = Array.from(selectedIds.value)
    const res = await trendsApi.batchDelete(ids)
    ElMessage.success(`已删除 ${res.data?.deleted ?? ids.length} 条趋势`)
    selectedIds.value.clear()
    await loadTrends()
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`批量删除失败: ${errMsg}`)
  }
}

/** 批量生成内容 */
async function handleBatchGenerate(): Promise<void> {
  if (!selectedCount.value) {
    ElMessage.warning('请先选择要生成内容的趋势')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将基于选中的 ${selectedCount.value} 条趋势分别生成内容草稿，是否继续？`,
      '批量生成内容',
      { confirmButtonText: '生成', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  const ids = Array.from(selectedIds.value)
  let successCount = 0
  let failCount = 0

  for (const id of ids) {
    const trend = trendList.value.find(t => t.id === id)
    if (!trend) continue

    generatingIds.value.add(id)
    try {
      await contentsApi.generate({
        trendId: trend.id,
        keywords: [trend.title]
      } as any)
      successCount++
    } catch (error) {
      console.error(`生成内容失败 (趋势: ${trend.title}):`, error)
      failCount++
    } finally {
      generatingIds.value.delete(id)
    }
  }

  if (successCount > 0) {
    ElMessage.success(`批量生成完成: ${successCount} 条成功${failCount > 0 ? `, ${failCount} 条失败` : ''}`)
    router.push({ path: '/content', query: { tab: 'list' } })
  } else {
    ElMessage.error('批量生成全部失败')
  }
}

/** 筛选变化 */
function handleFilterChange(): void {
  pagination.page = 1
  loadTrends()
}

/** 分页变化 */
function handlePageChange(page: number): void {
  pagination.page = page
  loadTrends()
}

onMounted(() => {
  loadTrends()
})
</script>

<template>
  <div class="page-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <span class="page-title">趋势发现</span>
      <el-button type="primary" :loading="discovering" @click="handleDiscover">
        <el-icon v-if="!discovering"><Search /></el-icon>
        {{ discovering ? '发现中...' : '发现新趋势' }}
      </el-button>
    </div>

    <!-- 筛选栏 + 批量操作 -->
    <div class="filter-bar">
      <el-select
        v-model="filters.platform"
        placeholder="选择平台"
        style="width: 160px"
        @change="handleFilterChange"
      >
        <el-option
          v-for="opt in platformOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-select
        v-model="filters.category"
        placeholder="选择分类"
        style="width: 160px"
        @change="handleFilterChange"
      >
        <el-option
          v-for="opt in categoryOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>

      <!-- 批量操作区域 -->
      <div class="batch-ops" v-if="trendList.length">
        <el-checkbox
          :model-value="allSelected"
          @change="toggleSelectAll"
        >
          全选
        </el-checkbox>
        <template v-if="selectedCount > 0">
          <span class="selected-count">已选 {{ selectedCount }} 项</span>
          <el-button type="primary" size="default" @click="handleBatchGenerate">
            <el-icon><EditPen /></el-icon>
            批量生成内容
          </el-button>
          <el-button type="danger" size="default" @click="handleBatchDelete">
            <el-icon><Delete /></el-icon>
            批量删除
          </el-button>
        </template>
      </div>
    </div>

    <!-- 趋势卡片网格 -->
    <div v-loading="loading">
      <div v-if="trendList.length" class="card-grid">
        <div
          v-for="trend in trendList"
          :key="trend.id"
          class="trend-card-wrapper"
          :class="{ 'is-selected': selectedIds.has(trend.id) }"
        >
          <!-- 选择复选框 -->
          <div class="card-checkbox" @click.stop>
            <el-checkbox
              :model-value="selectedIds.has(trend.id)"
              @change="toggleSelect(trend)"
            />
          </div>
          <TrendCard
            :trend="trend"
            @track="handleTrack"
            @generate="handleGenerate"
            @detail="handleDetail"
          />
          <!-- 生成中遮罩 -->
          <div v-if="generatingIds.has(trend.id)" class="card-loading-mask">
            <el-icon class="is-loading" :size="24"><Loading /></el-icon>
            <span>生成中...</span>
          </div>
        </div>
      </div>
      <el-empty v-else description="暂无趋势数据，点击「发现新趋势」开始探索" />
    </div>

    <!-- 分页器 -->
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
    <el-dialog v-model="detailVisible" title="趋势详情与来源" width="620px">
      <template v-if="detailTrend">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="标题">{{ detailTrend.title }}</el-descriptions-item>
          <el-descriptions-item label="平台">{{ detailTrend.platform }}</el-descriptions-item>
          <el-descriptions-item label="热度">{{ detailTrend.heat }}</el-descriptions-item>
          <el-descriptions-item label="增长率">{{ detailMetadata.growthAvailable ? `${detailTrend.growthRate}%` : '平台未提供' }}</el-descriptions-item>
          <el-descriptions-item label="采集时间">{{ new Date(detailTrend.discoveredAt).toLocaleString('zh-CN') }}</el-descriptions-item>
          <el-descriptions-item label="真实性"><el-tag type="success">observed</el-tag></el-descriptions-item>
        </el-descriptions>
        <p class="detail-description">{{ detailTrend.description }}</p>
        <el-link v-if="detailMetadata.sourceUrl" :href="String(detailMetadata.sourceUrl)" target="_blank" type="primary">打开原始来源</el-link>
        <pre class="detail-raw">{{ JSON.stringify(detailMetadata, null, 2) }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.batch-ops {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.selected-count {
  font-size: 13px;
  color: var(--el-color-primary);
  font-weight: 600;
}

.trend-card-wrapper {
  position: relative;
  transition: outline 0.15s ease;
  outline: 2px solid transparent;
  outline-offset: -2px;
  border-radius: 8px;
}

.trend-card-wrapper.is-selected {
  outline-color: var(--el-color-primary);
}

.card-checkbox {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  padding: 2px 6px;
}

.card-loading-mask {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  z-index: 20;
  font-size: 14px;
  color: var(--el-color-primary);
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
.detail-description { color: var(--color-text-secondary); line-height: 1.6; }
.detail-raw { max-height: 260px; overflow: auto; padding: 12px; border-radius: 8px; background: var(--color-bg-subtle); color: var(--color-text-secondary); font-size: 11px; white-space: pre-wrap; }
</style>
