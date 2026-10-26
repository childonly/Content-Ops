<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { hashtagsApi, trendsApi } from '@/api'
import type { Hashtag, Platform, Trend } from '@/types'

const router = useRouter()

// 加载状态
const loading = ref<boolean>(false)
const researching = ref<boolean>(false)

// 标签列表
const hashtagList = ref<Hashtag[]>([])
const selectedRows = ref<Hashtag[]>([])

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

// 搜索与筛选
const searchKeyword = ref<string>('')
const filterPlatform = ref<Platform | ''>('')

// 数据源详情弹窗
const sourceDialogVisible = ref<boolean>(false)
const sourceTrend = ref<Trend | null>(null)
const sourceLoading = ref<boolean>(false)

// 平台选项
const platformOptions = [
  { label: '全部平台', value: '' },
  { label: '抖音', value: 'douyin' },
  { label: '小红书', value: 'xiaohongshu' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Twitter', value: 'twitter' }
]

/** 平台名称 */
function platformLabel(platform: string): string {
  const map: Record<string, string> = {
    douyin: '抖音',
    xiaohongshu: '小红书',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    twitter: 'Twitter'
  }
  return map[platform] || platform
}

/** 格式化数字 */
function formatNumber(num: number): string {
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toLocaleString()
}

/** 加载标签列表 */
async function loadHashtags(): Promise<void> {
  loading.value = true
  try {
    const res = await hashtagsApi.getList({
      page: pagination.page,
      pageSize: pagination.pageSize,
      platform: filterPlatform.value || undefined,
      keyword: searchKeyword.value || undefined
    } as any)
    hashtagList.value = res.data
    pagination.total = res.total
  } catch (error) {
    console.error('加载标签列表失败:', error)
  } finally {
    loading.value = false
  }
}

/** 研究标签 */
async function handleResearch(): Promise<void> {
  if (!searchKeyword.value.trim()) {
    ElMessage.warning('请输入要研究的关键词')
    return
  }

  researching.value = true
  try {
    const res = await hashtagsApi.research({
      keyword: searchKeyword.value,
      platform: filterPlatform.value || undefined
    } as any)
    ElMessage.success(`研究完成，发现 ${res.data!.length} 个相关标签`)
    await loadHashtags()
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`研究标签失败: ${errMsg}`)
  } finally {
    researching.value = false
  }
}

/** 搜索 */
function handleSearch(): void {
  pagination.page = 1
  loadHashtags()
}

/** 筛选变化 */
function handleFilterChange(): void {
  pagination.page = 1
  loadHashtags()
}

/** 分页变化 */
function handlePageChange(page: number): void {
  pagination.page = page
  loadHashtags()
}

/** 表格选择变化 */
function handleSelectionChange(rows: Hashtag[]): void {
  selectedRows.value = rows
}

/** 批量删除 */
async function handleBatchDelete(): Promise<void> {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先选择要删除的标签')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedRows.value.length} 条标签吗？此操作不可恢复。`,
      '批量删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  try {
    const ids = selectedRows.value.map((r) => r.id)
    const res = await hashtagsApi.batchDelete(ids)
    ElMessage.success(`已删除 ${res.data?.deleted ?? ids.length} 条标签`)
    selectedRows.value = []
    await loadHashtags()
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`批量删除失败: ${errMsg}`)
  }
}

/** 查看数据源（跳转到关联的趋势） */
async function handleViewSource(row: Hashtag): Promise<void> {
  if (!row.trendId) {
    ElMessage.info('该标签未关联趋势数据源')
    return
  }

  sourceLoading.value = true
  sourceDialogVisible.value = true
  try {
    const res = await trendsApi.getById(row.trendId)
    sourceTrend.value = res.data ?? null
  } catch (error) {
    console.error('加载趋势详情失败:', error)
    sourceTrend.value = null
  } finally {
    sourceLoading.value = false
  }
}

/** 跳转到趋势详情 */
function goToTrend(): void {
  if (sourceTrend.value) {
    sourceDialogVisible.value = false
    router.push('/trends')
  }
}

onMounted(() => {
  loadHashtags()
})
</script>

<template>
  <div class="page-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <span class="page-title">标签研究</span>
      <el-button type="primary" :loading="researching" @click="handleResearch">
        <el-icon v-if="!researching"><Search /></el-icon>
        {{ researching ? '研究中...' : '研究标签' }}
      </el-button>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="输入关键词搜索标签"
        style="width: 260px"
        clearable
        @keyup.enter="handleSearch"
        @clear="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-select
        v-model="filterPlatform"
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
      <el-button type="primary" @click="handleSearch">
        <el-icon><Search /></el-icon>
        搜索
      </el-button>
      <el-button
        v-if="selectedRows.length"
        type="danger"
        size="default"
        @click="handleBatchDelete"
      >
        <el-icon><Delete /></el-icon> 批量删除 ({{ selectedRows.length }})
      </el-button>
    </div>

    <!-- 标签列表 -->
    <el-card shadow="never">
      <el-alert title="标签来自平台推荐流；平台未提供指标时显示“无数据”，不再生成随机热度或增长率。" type="info" :closable="false" class="data-note" />
      <el-table
        :data="hashtagList"
        v-loading="loading"
        style="width: 100%"
        stripe
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column label="标签名" min-width="160">
          <template #default="{ row }">
            <span class="font-bold text-primary">#{{ row.tag }}</span>
          </template>
        </el-table-column>
        <el-table-column label="平台" width="100">
          <template #default="{ row }">
            {{ platformLabel(row.platform) }}
          </template>
        </el-table-column>
        <el-table-column label="热度" width="100" align="right">
          <template #default="{ row }">
            {{ formatNumber(row.volume) }}
          </template>
        </el-table-column>
        <el-table-column label="增长率" width="100" align="right">
          <template #default="{ row }">
            <span v-if="row.growthRate" :class="row.growthRate >= 0 ? 'text-success' : 'text-danger'">
              {{ row.growthRate >= 0 ? '+' : '' }}{{ row.growthRate }}%
            </span>
            <span v-else class="text-secondary">无数据</span>
          </template>
        </el-table-column>
        <el-table-column label="相关标签" min-width="200">
          <template #default="{ row }">
            <div class="related-tags" v-if="row.relatedTags && row.relatedTags.length">
              <el-tag
                v-for="tag in row.relatedTags.slice(0, 4)"
                :key="tag"
                size="small"
                type="info"
                effect="plain"
                class="mr-8"
              >
                #{{ tag }}
              </el-tag>
            </div>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="数据源" width="120">
          <template #default="{ row }">
            <el-button
              v-if="row.trendId"
              size="small"
              text
              type="primary"
              @click="handleViewSource(row)"
            >
              <el-icon><Link /></el-icon> 查看来源
            </el-button>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !hashtagList.length" description="暂无标签数据，输入关键词开始研究" />
    </el-card>

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

    <!-- 数据源详情弹窗 -->
    <el-dialog v-model="sourceDialogVisible" title="数据源详情" width="500px">
      <div v-loading="sourceLoading">
        <template v-if="sourceTrend">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="趋势标题">{{ sourceTrend.title }}</el-descriptions-item>
            <el-descriptions-item label="平台">{{ platformLabel(sourceTrend.platform) }}</el-descriptions-item>
            <el-descriptions-item label="分类">{{ sourceTrend.category || '-' }}</el-descriptions-item>
            <el-descriptions-item label="热度">{{ formatNumber(sourceTrend.heat) }}</el-descriptions-item>
            <el-descriptions-item label="增长率">
              <span :class="sourceTrend.growthRate >= 0 ? 'text-success' : 'text-danger'">
                {{ sourceTrend.growthRate >= 0 ? '+' : '' }}{{ sourceTrend.growthRate }}%
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="状态">{{ sourceTrend.status }}</el-descriptions-item>
            <el-descriptions-item label="描述">{{ sourceTrend.description || '-' }}</el-descriptions-item>
            <el-descriptions-item label="发现时间">{{ sourceTrend.discoveredAt }}</el-descriptions-item>
          </el-descriptions>
        </template>
        <el-empty v-else description="未找到关联的趋势数据" :image-size="60" />
      </div>
      <template #footer>
        <el-button @click="sourceDialogVisible = false">关闭</el-button>
        <el-button v-if="sourceTrend" type="primary" @click="goToTrend">跳转到趋势列表</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.related-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
</style>
