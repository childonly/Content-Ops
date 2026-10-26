<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { publishApi, contentsApi, publishEngineApi } from '@/api'
import type { PublishEngineInfo } from '@/api'
import type { Publication, PublishStatus, Content } from '@/types'

// 加载状态
const loading = ref<boolean>(false)
const executing = ref<number>(0)

// 发布列表
const publishList = ref<Publication[]>([])

// 当前 Tab
const activeTab = ref<PublishStatus | 'all'>('all')

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

// Tab 配置
const tabOptions = [
  { label: '全部', value: 'all' },
  { label: '待发布', value: 'pending' },
  { label: '已发布', value: 'published' },
  { label: '发布失败', value: 'failed' }
]

// 状态配置
const statusConfig: Record<string, { label: string; type: 'info' | 'success' | 'danger' | 'warning' }> = {
  pending: { label: '待发布', type: 'warning' },
  publishing: { label: '发布中', type: 'info' },
  published: { label: '已发布', type: 'success' },
  failed: { label: '发布失败', type: 'danger' }
}

// 平台选项
const platformOptions = [
  { label: '小红书', value: 'xiaohongshu' }
]

// 新建发布对话框
const createDialogVisible = ref<boolean>(false)
const creating = ref<boolean>(false)
const contentList = ref<Content[]>([])
const publishEngines = ref<PublishEngineInfo[]>([])
const loadingEngines = ref<boolean>(false)
const createForm = reactive({
  contentId: 0,
  platform: 'xiaohongshu',
  scheduledAt: '',
  engine: ''
})

const availablePublishEngines = computed(() =>
  publishEngines.value.filter((engine) => engine.available)
)

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

/** 当前过滤后的列表 */
const filteredList = computed(() => {
  if (activeTab.value === 'all') return publishList.value
  return publishList.value.filter((item) => item.status === activeTab.value)
})

/** 加载发布列表 */
async function loadPublishList(): Promise<void> {
  loading.value = true
  try {
    const res = await publishApi.getList({
      page: pagination.page,
      pageSize: pagination.pageSize,
      status: activeTab.value === 'all' ? undefined : activeTab.value
    })
    publishList.value = res.data
    pagination.total = res.total
  } catch (error) {
    console.error('加载发布列表失败:', error)
  } finally {
    loading.value = false
  }
}

/** 加载真实发布引擎及默认选择 */
async function loadPublishEngines(): Promise<void> {
  loadingEngines.value = true
  try {
    const res = await publishEngineApi.getEngines()
    publishEngines.value = res.data || []
    const preferred = publishEngines.value.find((engine) => engine.isDefault && engine.available)
      || availablePublishEngines.value[0]
    createForm.engine = preferred?.name || ''
  } catch (error) {
    publishEngines.value = []
    createForm.engine = ''
    ElMessage.error('加载发布引擎失败: ' + (error as Error).message)
  } finally {
    loadingEngines.value = false
  }
}

async function handleEngineChange(engineName: string): Promise<void> {
  const previous = publishEngines.value.find((engine) => engine.isDefault)?.name || ''
  try {
    const res = await publishEngineApi.setDefaultEngine(engineName)
    if (!res.success) throw new Error(res.error || '保存失败')
    publishEngines.value = publishEngines.value.map((engine) => ({
      ...engine,
      isDefault: engine.name === engineName,
    }))
    ElMessage.success('默认发布引擎已保存')
  } catch (error) {
    createForm.engine = previous
    ElMessage.error('保存默认发布引擎失败: ' + (error as Error).message)
  }
}

/** 执行发布 */
async function handleExecute(pub: Publication): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要发布内容 #${pub.contentId}到${platformLabel(pub.platform)}吗？`,
      '确认发布',
      { confirmButtonText: '发布', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  executing.value = pub.id
  try {
    await publishApi.execute(pub.contentId, 'xiaohongshu', undefined, pub.engine || createForm.engine)
    ElMessage.success('发布成功')
    await loadPublishList()
  } catch (error) {
    console.error('发布失败:', error)
  } finally {
    executing.value = 0
  }
}

/** 重试发布 */
async function handleRetry(pub: Publication): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要重试发布内容 #${pub.contentId}吗？`,
      '重试发布',
      { confirmButtonText: '重试', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  executing.value = pub.id
  try {
    await publishApi.execute(pub.contentId, 'xiaohongshu', undefined, pub.engine || createForm.engine)
    ElMessage.success('重试发布成功')
    await loadPublishList()
  } catch (error) {
    console.error('重试发布失败:', error)
  } finally {
    executing.value = 0
  }
}

/** 打开链接 */
function openLink(url?: string): void {
  if (url) {
    window.open(url, '_blank')
  }
}

/** 打开新建发布对话框 */
async function openCreateDialog(): Promise<void> {
  createForm.contentId = 0
  createForm.platform = 'xiaohongshu'
  createForm.scheduledAt = ''
  if (!createForm.engine) {
    const preferred = publishEngines.value.find((engine) => engine.isDefault && engine.available)
      || availablePublishEngines.value[0]
    createForm.engine = preferred?.name || ''
  }
  createDialogVisible.value = true

  // 加载已通过审核的内容列表
  try {
    const res = await contentsApi.getList({ page: 1, pageSize: 50, status: 'approved' })
    contentList.value = res.data
  } catch (error) {
    console.error('加载内容列表失败:', error)
    ElMessage.warning('加载内容列表失败，请稍后重试')
  }
}

/** 提交新建发布任务 */
async function handleCreate(): Promise<void> {
  if (!createForm.contentId) {
    ElMessage.warning('请选择要发布的内容')
    return
  }
  if (!createForm.engine) {
    ElMessage.warning('当前没有可用的发布引擎')
    return
  }

  creating.value = true
  try {
    await publishApi.execute(
      createForm.contentId,
      'xiaohongshu',
      createForm.scheduledAt || undefined,
      createForm.engine
    )
    ElMessage.success('发布任务已创建')
    createDialogVisible.value = false
    await loadPublishList()
  } catch (error) {
    console.error('创建发布任务失败:', error)
  } finally {
    creating.value = false
  }
}

/** Tab 切换 */
function handleTabChange(): void {
  pagination.page = 1
  loadPublishList()
}

/** 分页变化 */
function handlePageChange(page: number): void {
  pagination.page = page
  loadPublishList()
}

onMounted(() => {
  loadPublishList()
  loadPublishEngines()
})
</script>

<template>
  <div class="page-container">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <span class="page-title">发布队列</span>
      <el-button type="primary" @click="openCreateDialog">
        <el-icon><Plus /></el-icon>
        新建发布任务
      </el-button>
    </div>

    <!-- 新建发布对话框 -->
    <el-dialog v-model="createDialogVisible" title="新建发布任务" width="500px">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="内容" required>
          <el-select
            v-model="createForm.contentId"
            placeholder="请选择已审核的内容"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="item in contentList"
              :key="item.id"
              :label="`#${item.id} ${item.title || '(无标题)'}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="平台" required>
          <el-select v-model="createForm.platform" style="width: 100%" disabled>
            <el-option
              v-for="opt in platformOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="发布引擎" required>
          <el-select
            v-model="createForm.engine"
            :loading="loadingEngines"
            placeholder="请选择可用发布引擎"
            style="width: 100%"
            @change="handleEngineChange"
          >
            <el-option
              v-for="engine in publishEngines"
              :key="engine.name"
              :label="`${engine.label}${engine.available ? '' : '（不可用）'}`"
              :value="engine.name"
              :disabled="!engine.available"
            />
          </el-select>
          <div v-if="availablePublishEngines.length === 0" class="text-secondary">
            当前没有可用发布引擎，请先检查 Skill 路径和登录状态。
          </div>
        </el-form-item>
        <el-form-item label="定时发布">
          <el-date-picker
            v-model="createForm.scheduledAt"
            type="datetime"
            placeholder="不选则立即发布"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- Tab 切换 -->
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane
        v-for="tab in tabOptions"
        :key="tab.value"
        :label="tab.label"
        :name="tab.value"
      />
    </el-tabs>

    <!-- 发布列表 -->
    <el-card shadow="never">
      <el-table
        :data="filteredList"
        v-loading="loading"
        style="width: 100%"
        stripe
      >
        <el-table-column label="内容标题" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            内容 #{{ row.contentId }}
          </template>
        </el-table-column>
        <el-table-column label="平台" width="100">
          <template #default="{ row }">
            {{ platformLabel(row.platform) }}
          </template>
        </el-table-column>
        <el-table-column label="引擎" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.engine || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusConfig[row.status]?.type || 'info'" size="small">
              {{ statusConfig[row.status]?.label || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="计划发布时间" width="180">
          <template #default="{ row }">
            {{ row.scheduledAt || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="实际发布时间" width="180">
          <template #default="{ row }">
            {{ row.publishedAt || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="链接" width="90">
          <template #default="{ row }">
            <el-button
              v-if="row.postUrl"
              size="small"
              text
              type="primary"
              @click="openLink(row.postUrl)"
            >
              <el-icon><Link /></el-icon>
              查看
            </el-button>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="primary"
              :loading="executing === row.id"
              @click="handleExecute(row)"
            >
              <el-icon v-if="executing !== row.id"><Promotion /></el-icon>
              执行发布
            </el-button>
            <el-button
              v-if="row.status === 'failed'"
              size="small"
              type="warning"
              :loading="executing === row.id"
              @click="handleRetry(row)"
            >
              <el-icon v-if="executing !== row.id"><RefreshRight /></el-icon>
              重试
            </el-button>
            <el-tooltip
              v-if="row.status === 'failed' && row.errorMessage"
              :content="row.errorMessage"
              placement="top"
            >
              <el-button size="small" text type="info">
                <el-icon><WarningFilled /></el-icon>
              </el-button>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !filteredList.length" description="暂无发布记录" />
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
  </div>
</template>

<style scoped>
.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
</style>
