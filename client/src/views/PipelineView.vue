<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PipelineFlow from '@/components/PipelineFlow.vue'
import { pipelineApi } from '@/api'
import {
  PipelineStage,
  PipelineStatus,
  StageStatus,
  PIPELINE_STAGES,
  type PipelineRun,
  type PipelineStageRecord
} from '@/types'

// 加载状态
const loading = ref<boolean>(false)
const starting = ref<boolean>(false)
const advancing = ref<number>(0)

// 运行记录列表
const runList = ref<PipelineRun[]>([])
const selectedRuns = ref<PipelineRun[]>([])
const editVisible = ref(false)
const editingRun = ref<PipelineRun | null>(null)
const editKeyword = ref('')
const editTrendId = ref<number | undefined>()
const editing = ref(false)

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

// 当前选中的运行记录
const currentRun = ref<PipelineRun | null>(null)

// 详情抽屉
const detailVisible = ref<boolean>(false)

// 状态配置
const statusConfig: Record<string, { label: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  [PipelineStatus.RUNNING]: { label: '运行中', type: 'success' },
  [PipelineStatus.PAUSED]: { label: '已暂停', type: 'warning' },
  [PipelineStatus.COMPLETED]: { label: '已完成', type: 'info' },
  [PipelineStatus.FAILED]: { label: '失败', type: 'danger' }
}

const stageStatusConfig: Record<string, { label: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  [StageStatus.PENDING]: { label: '待执行', type: 'info' },
  [StageStatus.RUNNING]: { label: '进行中', type: 'success' },
  [StageStatus.COMPLETED]: { label: '已完成', type: 'success' },
  [StageStatus.FAILED]: { label: '失败', type: 'danger' },
  [StageStatus.SKIPPED]: { label: '已跳过', type: 'info' }
}

/** 阶段名称映射 */
const stageLabelMap = computed(() => {
  const map: Record<string, string> = {}
  PIPELINE_STAGES.forEach((s) => {
    map[s.stage] = s.label
  })
  return map
})

/** 当前运行中的闭环 */
const activeRun = computed(() => runList.value.find((r) => r.status === PipelineStatus.RUNNING) || null)

/** 获取阶段记录 */
function getStageRecord(run: PipelineRun, stage: PipelineStage): PipelineStageRecord | undefined {
  return run.stages.find((s) => s.stage === stage)
}

/** 加载运行记录列表 */
async function loadRuns(): Promise<void> {
  loading.value = true
  try {
    const res = await pipelineApi.getRuns({
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    runList.value = res.data
    pagination.total = res.total
  } catch (error) {
    console.error('加载运行记录失败:', error)
  } finally {
    loading.value = false
  }
}

/** 启动新闭环 */
async function handleStart(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将启动一个新的内容运营闭环，从趋势发现阶段开始自动执行，是否继续？',
      '启动新闭环',
      { confirmButtonText: '启动', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  starting.value = true
  try {
    const res = await pipelineApi.run({})
    ElMessage.success('闭环已启动')
    currentRun.value = res.data!
    await loadRuns()
    // 打开详情面板
    handleViewDetail(res.data!)
  } catch (error) {
    console.error('启动闭环失败:', error)
  } finally {
    starting.value = false
  }
}

/** 推进下一阶段 */
async function handleAdvance(run: PipelineRun): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要推进闭环 #${run.id} 到下一阶段吗？`,
      '推进阶段',
      { confirmButtonText: '推进', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  advancing.value = run.id
  try {
    const res = await pipelineApi.advance(run.id)
    ElMessage.success('已推进到下一阶段')
    currentRun.value = res.data!
    await loadRuns()
  } catch (error) {
    console.error('推进阶段失败:', error)
  } finally {
    advancing.value = 0
  }
}

/** 暂停闭环 */
async function handlePause(run: PipelineRun): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要暂停闭环 #${run.id} 吗？`,
      '暂停闭环',
      { confirmButtonText: '暂停', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  try {
    await pipelineApi.pause(run.id)
    ElMessage.success('闭环已暂停')
    await loadRuns()
  } catch (error) {
    console.error('暂停闭环失败:', error)
  }
}

/** 查看详情 */
async function handleViewDetail(run: PipelineRun): Promise<void> {
  detailVisible.value = true
  try {
    const res = await pipelineApi.getById(run.id)
    currentRun.value = res.data!
  } catch (error) {
    console.error('加载详情失败:', error)
    currentRun.value = run
  }
}

/** 是否可以推进 */
function canAdvance(run: PipelineRun): boolean {
  return run.status === PipelineStatus.RUNNING
}

/** 是否可以暂停 */
function canPause(run: PipelineRun): boolean {
  return run.status === PipelineStatus.RUNNING
}

/** 是否可以恢复 */
function canResume(run: PipelineRun): boolean {
  return run.status === PipelineStatus.PAUSED
}

/** 恢复闭环 */
async function handleResume(run: PipelineRun): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要恢复闭环 #${run.id} 吗？`,
      '恢复闭环',
      { confirmButtonText: '恢复', cancelButtonText: '取消', type: 'success' }
    )
  } catch {
    return
  }

  try {
    await pipelineApi.resume(run.id)
    ElMessage.success('闭环已恢复')
    await loadRuns()
  } catch (error) {
    console.error('恢复闭环失败:', error)
  }
}

function handleSelectionChange(rows: PipelineRun[]): void { selectedRuns.value = rows }

function openEdit(run: PipelineRun): void {
  editingRun.value = run; editKeyword.value = run.keyword || ''; editTrendId.value = run.trendId; editVisible.value = true
}

async function saveEdit(): Promise<void> {
  if (!editingRun.value) return
  editing.value = true
  try {
    await pipelineApi.update(editingRun.value.id, { keyword: editKeyword.value, trendId: editTrendId.value || null })
    editVisible.value = false; await loadRuns(); ElMessage.success('运行信息已更新')
  } catch (error) { ElMessage.error('编辑失败: ' + (error as Error).message) } finally { editing.value = false }
}

async function handleDelete(run: PipelineRun): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除闭环 #${run.id} 及其阶段记录吗？`, '删除运行记录', { type: 'warning', confirmButtonText: '删除' })
    await pipelineApi.delete(run.id); await loadRuns(); ElMessage.success('运行记录已删除')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error((error as Error).message) }
}

async function handleBatchDelete(): Promise<void> {
  if (!selectedRuns.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedRuns.value.length} 条运行及其阶段记录吗？`, '批量删除', { type: 'warning', confirmButtonText: '批量删除' })
    const res = await pipelineApi.batchDelete(selectedRuns.value.map(run => run.id))
    ElMessage.success(`已删除 ${res.data?.deleted || 0} 条运行记录`); selectedRuns.value = []; await loadRuns()
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error((error as Error).message) }
}

/** 分页变化 */
function handlePageChange(page: number): void {
  pagination.page = page
  loadRuns()
}

onMounted(() => {
  loadRuns()
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <span class="page-title">闭环管理</span>
      <el-button type="primary" :loading="starting" @click="handleStart">
        <el-icon v-if="!starting"><VideoPlay /></el-icon>
        {{ starting ? '启动中...' : '启动新闭环' }}
      </el-button>
    </div>

    <!-- 当前运行闭环 -->
    <el-card class="mb-20" shadow="never">
      <template #header>
        <div class="flex-between">
          <span class="font-large font-bold">当前运行闭环</span>
          <el-tag v-if="activeRun" :type="statusConfig[activeRun.status]?.type" size="small">
            {{ statusConfig[activeRun.status]?.label }}
          </el-tag>
        </div>
      </template>
      <div v-if="activeRun">
        <div class="mb-16 flex-between">
          <div>
            <span class="font-bold font-large">闭环 #{{ activeRun.id }}</span>
            <span class="ml-16 text-secondary">关联趋势：{{ activeRun.trendId ? '趋势 #' + activeRun.trendId : '未关联' }}</span>
          </div>
          <div>
            <el-button
              v-if="canAdvance(activeRun)"
              type="primary"
              size="small"
              :loading="advancing === activeRun.id"
              @click="handleAdvance(activeRun)"
            >
              <el-icon v-if="advancing !== activeRun.id"><CaretRight /></el-icon>
              推进下一阶段
            </el-button>
            <el-button
              v-if="canPause(activeRun)"
              size="small"
              type="warning"
              @click="handlePause(activeRun)"
            >
              <el-icon><VideoPause /></el-icon>
              暂停
            </el-button>
            <el-button
              v-if="canResume(activeRun)"
              size="small"
              type="success"
              @click="handleResume(activeRun)"
            >
              <el-icon><VideoPlay /></el-icon>
              恢复
            </el-button>
          </div>
        </div>
        <PipelineFlow :stages="activeRun.stages" :current-stage="activeRun.currentStage" />
      </div>
      <el-empty v-else description="暂无运行中的闭环" :image-size="80">
        <el-button type="primary" @click="handleStart">启动新闭环</el-button>
      </el-empty>
    </el-card>

    <!-- 运行记录列表 -->
    <el-card shadow="never">
      <template #header>
        <div class="flex-between"><span class="font-large font-bold">运行记录</span><el-button v-if="selectedRuns.length" type="danger" size="small" @click="handleBatchDelete"><el-icon><Delete /></el-icon>批量删除 {{ selectedRuns.length }}</el-button></div>
      </template>
      <el-table :data="runList" style="width: 100%" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="44" />
        <el-table-column label="闭环名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            闭环 #{{ row.id }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusConfig[row.status]?.type" size="small">
              {{ statusConfig[row.status]?.label || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前阶段" width="120">
          <template #default="{ row }">
            {{ stageLabelMap[row.currentStage] || row.currentStage }}
          </template>
        </el-table-column>
        <el-table-column label="关联趋势" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.trendId ? '趋势 #' + row.trendId : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="关键词/备注" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.keyword || '-' }}</template></el-table-column>
        <el-table-column label="开始时间" width="170">
          <template #default="{ row }">
            {{ row.startedAt }}
          </template>
        </el-table-column>
        <el-table-column label="完成时间" width="170">
          <template #default="{ row }">
            {{ row.completedAt || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="handleViewDetail(row)">
              <el-icon><View /></el-icon>
              查看详情
            </el-button>
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="handleDelete(row)">删除</el-button>
            <el-button
              v-if="canAdvance(row)"
              size="small"
              text
              type="success"
              :loading="advancing === row.id"
              @click="handleAdvance(row)"
            >
              推进
            </el-button>
            <el-button
              v-if="canResume(row)"
              size="small"
              text
              type="success"
              @click="handleResume(row)"
            >
              恢复
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !runList.length" description="暂无运行记录" />
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

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="detailVisible"
      title="闭环运行详情"
      size="600px"
      direction="rtl"
    >
      <div v-if="currentRun" class="detail-content">
        <!-- 基本信息 -->
        <el-descriptions :column="1" border class="mb-20">
          <el-descriptions-item label="闭环名称">闭环 #{{ currentRun.id }}</el-descriptions-item>
          <el-descriptions-item label="运行状态">
            <el-tag :type="statusConfig[currentRun.status]?.type" size="small">
              {{ statusConfig[currentRun.status]?.label }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前阶段">
            {{ stageLabelMap[currentRun.currentStage] }}
          </el-descriptions-item>
          <el-descriptions-item label="关联趋势">
            {{ currentRun.trendId ? '趋势 #' + currentRun.trendId : '未关联' }}
          </el-descriptions-item>
          <el-descriptions-item label="开始时间">{{ currentRun.startedAt }}</el-descriptions-item>
          <el-descriptions-item label="完成时间">
            {{ currentRun.completedAt || '-' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="currentRun.errorMessage" label="错误信息">
            <span class="text-danger">{{ currentRun.errorMessage }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 阶段详情 -->
        <div class="mb-16 font-bold font-large">阶段执行详情</div>
        <el-timeline>
          <el-timeline-item
            v-for="stage in PIPELINE_STAGES"
            :key="stage.stage"
            :type="getStageRecord(currentRun, stage.stage)?.status === StageStatus.COMPLETED ? 'success'
              : getStageRecord(currentRun, stage.stage)?.status === StageStatus.RUNNING ? 'primary'
              : getStageRecord(currentRun, stage.stage)?.status === StageStatus.FAILED ? 'danger'
              : 'info'"
            :timestamp="getStageRecord(currentRun, stage.stage)?.completedAt || getStageRecord(currentRun, stage.stage)?.startedAt || '待执行'"
            placement="top"
          >
            <div class="stage-detail">
              <div class="flex-between mb-8">
                <span class="font-bold">{{ stage.label }}</span>
                <el-tag
                  v-if="getStageRecord(currentRun, stage.stage)"
                  :type="stageStatusConfig[getStageRecord(currentRun, stage.stage)!.status]?.type"
                  size="small"
                >
                  {{ stageStatusConfig[getStageRecord(currentRun, stage.stage)!.status]?.label }}
                </el-tag>
                <el-tag v-else type="info" size="small">待执行</el-tag>
              </div>
              <div class="text-secondary text-sm">{{ stage.description }}</div>
              <div v-if="getStageRecord(currentRun, stage.stage)?.errorMessage" class="text-danger text-sm mt-8">
                错误：{{ getStageRecord(currentRun, stage.stage)!.errorMessage }}
              </div>
              <pre v-if="getStageRecord(currentRun, stage.stage)?.result" class="stage-result">{{ getStageRecord(currentRun, stage.stage)!.result }}</pre>
            </div>
          </el-timeline-item>
        </el-timeline>

        <!-- 操作按钮 -->
        <div class="detail-actions" v-if="canAdvance(currentRun) || canPause(currentRun) || canResume(currentRun)">
          <el-button
            v-if="canAdvance(currentRun)"
            type="primary"
            :loading="advancing === currentRun.id"
            @click="handleAdvance(currentRun)"
          >
            <el-icon><CaretRight /></el-icon>
            推进下一阶段
          </el-button>
          <el-button
            v-if="canPause(currentRun)"
            type="warning"
            @click="handlePause(currentRun)"
          >
            <el-icon><VideoPause /></el-icon>
            暂停闭环
          </el-button>
          <el-button
            v-if="canResume(currentRun)"
            type="success"
            @click="handleResume(currentRun)"
          >
            <el-icon><VideoPlay /></el-icon>
            恢复闭环
          </el-button>
        </div>
      </div>
    </el-drawer>
    <el-dialog v-model="editVisible" title="编辑运行信息" width="420px">
      <el-form label-width="82px"><el-form-item label="关键词/备注"><el-input v-model="editKeyword" maxlength="100" /></el-form-item><el-form-item label="关联趋势 ID"><el-input-number v-model="editTrendId" :min="1" controls-position="right" /></el-form-item></el-form>
      <template #footer><el-button @click="editVisible=false">取消</el-button><el-button type="primary" :loading="editing" @click="saveEdit">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.detail-content {
  padding: 0 4px;
}

.stage-detail {
  padding-bottom: 8px;
}
.stage-result { overflow:auto;margin:8px 0 0;padding:8px;border-radius:6px;background:var(--color-bg-subtle);color:var(--color-text-secondary);font-size:11px;white-space:pre-wrap; }

.text-sm {
  font-size: 13px;
}

.detail-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-lighter);
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
</style>
