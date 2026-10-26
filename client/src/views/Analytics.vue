<script setup lang="ts">
import { ref, reactive, computed, onMounted, shallowRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent
} from 'echarts/components'
import StatCard from '@/components/StatCard.vue'
import { analyticsApi } from '@/api'
import type { AnalyticsRecord } from '@/types'
import dayjs from 'dayjs'

// 注册 ECharts 组件
use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent
])

// 加载状态
const loading = ref<boolean>(false)
const tracking = ref<number>(0)
const exporting = ref<boolean>(false)

// 分析记录列表
const analyticsList = ref<AnalyticsRecord[]>([])

// 日期范围（默认最近7天）
const dateRange = ref<[string, string]>([
  dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
  dayjs().format('YYYY-MM-DD')
])

// 是否使用日期筛选
const useDateFilter = ref<boolean>(false)

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

/** 格式化数字 */
function formatNumber(num: number): string {
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toLocaleString()
}

/** 汇总统计 */
const summary = computed(() => {
  const list = analyticsList.value
  const totalViews = list.reduce((sum, item) => sum + item.views, 0)
  const totalLikes = list.reduce((sum, item) => sum + item.likes, 0)
  const totalComments = list.reduce((sum, item) => sum + item.comments, 0)
  const avgEngagement =
    list.length > 0
      ? list.reduce((sum, item) => sum + item.engagementRate, 0) / list.length
      : 0
  return { totalViews, totalLikes, totalComments, avgEngagement }
})

/** ECharts 配置项（使用 shallowRef 避免深度响应） */
const chartOption = shallowRef({})

/** 生成趋势图配置（根据日期范围动态生成） */
function buildChartOption(records: AnalyticsRecord[]): Record<string, unknown> {
  if (records.length === 0) {
    return {
      title: { text: '暂无数据', left: 'center', textStyle: { fontSize: 16, color: '#999' } }
    }
  }

  const startDate = useDateFilter.value ? dayjs(dateRange.value[0]) : dayjs().subtract(6, 'day')
  const endDate = useDateFilter.value ? dayjs(dateRange.value[1]) : dayjs()
  const dayCount = endDate.diff(startDate, 'day') + 1

  const days: string[] = []
  const viewsData: number[] = []
  const likesData: number[] = []
  const commentsData: number[] = []

  for (let i = 0; i < dayCount; i++) {
    const date = startDate.add(i, 'day')
    const dateStr = date.format('YYYY-MM-DD')
    days.push(date.format('MM-DD'))

    const dayRecords = records.filter((r) => dayjs(r.trackedAt).format('YYYY-MM-DD') === dateStr)
    viewsData.push(dayRecords.reduce((sum, r) => sum + r.views, 0))
    likesData.push(dayRecords.reduce((sum, r) => sum + r.likes, 0))
    commentsData.push(dayRecords.reduce((sum, r) => sum + r.comments, 0))
  }

  return {
    title: {
      text: useDateFilter.value
        ? `${dateRange.value[0]} 至 ${dateRange.value[1]} 数据趋势`
        : '最近7天数据趋势',
      left: 'center',
      textStyle: { fontSize: 16, fontWeight: 600 }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' }
    },
    legend: {
      data: ['浏览量', '点赞数', '评论数'],
      bottom: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '12%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: days
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (val: number) => (val >= 10000 ? val / 10000 + '万' : val.toString())
      }
    },
    series: [
      {
        name: '浏览量',
        type: 'line',
        smooth: true,
        data: viewsData,
        itemStyle: { color: '#409eff' },
        areaStyle: { opacity: 0.1 }
      },
      {
        name: '点赞数',
        type: 'line',
        smooth: true,
        data: likesData,
        itemStyle: { color: '#67c23a' },
        areaStyle: { opacity: 0.1 }
      },
      {
        name: '评论数',
        type: 'line',
        smooth: true,
        data: commentsData,
        itemStyle: { color: '#e6a23c' },
        areaStyle: { opacity: 0.1 }
      }
    ]
  }
}

/** 加载分析数据 */
async function loadAnalytics(): Promise<void> {
  loading.value = true
  try {
    let records: AnalyticsRecord[] = []

    if (useDateFilter.value && dateRange.value) {
      // 按日期范围查询
      const res = await analyticsApi.getByDateRange(dateRange.value[0], dateRange.value[1])
      analyticsList.value = res.data
      pagination.total = res.total
      records = res.data
    } else {
      // 默认分页查询
      const res = await analyticsApi.getList({
        page: pagination.page,
        pageSize: pagination.pageSize
      })
      analyticsList.value = res.data
      pagination.total = res.total
      records = res.data
    }

    // 构建图表配置
    chartOption.value = buildChartOption(records)
  } catch (error) {
    console.error('加载分析数据失败:', error)
  } finally {
    loading.value = false
  }
}

/** 追踪效果 */
async function handleTrack(record: AnalyticsRecord): Promise<void> {
  tracking.value = record.id
  try {
    await analyticsApi.track(record.publicationId)
    ElMessage.success('效果追踪完成，数据已更新')
    await loadAnalytics()
  } catch (error) {
    console.error('追踪效果失败:', error)
  } finally {
    tracking.value = 0
  }
}

/** 批量追踪 */
async function handleBatchTrack(): Promise<void> {
  if (analyticsList.value.length === 0) {
    ElMessage.warning('暂无可追踪的记录')
    return
  }
  loading.value = true
  try {
    for (const record of analyticsList.value.slice(0, 5)) {
      await analyticsApi.track(record.publicationId)
    }
    ElMessage.success('批量追踪完成')
    await loadAnalytics()
  } catch (error) {
    console.error('批量追踪失败:', error)
  } finally {
    loading.value = false
  }
}

/** 删除分析记录 */
async function handleDelete(record: AnalyticsRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要删除分析记录 #${record.id} 吗？`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await analyticsApi.delete(record.id)
    ElMessage.success('分析记录已删除')
    await loadAnalytics()
  } catch (error) {
    console.error('删除分析记录失败:', error)
  }
}

/** 导出 CSV */
async function handleExportCSV(): Promise<void> {
  if (analyticsList.value.length === 0) {
    ElMessage.warning('暂无可导出的数据')
    return
  }

  exporting.value = true
  try {
    const records = analyticsList.value
    const headers = ['ID', '内容ID', '发布ID', '浏览量', '点赞', '评论', '分享', '收藏', '互动率(%)', '追踪时间']
    const rows = records.map(r => [
      r.id,
      r.contentId,
      r.publicationId,
      r.views,
      r.likes,
      r.comments,
      r.shares,
      r.collects,
      r.engagementRate.toFixed(2),
      r.trackedAt
    ])

    // 构建 CSV 内容（BOM 头确保中文正确显示）
    const csvContent = '\uFEFF' + [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n')

    // 创建下载链接
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const dateStr = useDateFilter.value
      ? `${dateRange.value[0]}_${dateRange.value[1]}`
      : dayjs().format('YYYY-MM-DD')
    link.download = `analytics_export_${dateStr}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    ElMessage.success(`已导出 ${records.length} 条分析记录`)
  } catch (error) {
    console.error('导出 CSV 失败:', error)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

/** 日期范围变化 */
function handleDateRangeChange(): void {
  if (useDateFilter.value && dateRange.value) {
    pagination.page = 1
    loadAnalytics()
  }
}

/** 切换日期筛选模式 */
function toggleDateFilter(): void {
  if (useDateFilter.value) {
    // 切换到日期筛选模式
    loadAnalytics()
  } else {
    // 切换回默认分页模式
    pagination.page = 1
    loadAnalytics()
  }
}

/** 分页变化 */
function handlePageChange(page: number): void {
  pagination.page = page
  if (!useDateFilter.value) {
    loadAnalytics()
  }
}

onMounted(() => {
  loadAnalytics()
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <span class="page-title">数据分析</span>
      <div class="header-actions">
        <el-button @click="handleExportCSV" :loading="exporting">
          <el-icon><Download /></el-icon>
          导出CSV
        </el-button>
        <el-button type="primary" @click="handleBatchTrack">
          <el-icon><DataLine /></el-icon>
          追踪效果
        </el-button>
      </div>
    </div>

    <!-- 日期筛选栏 -->
    <el-card class="mb-20" shadow="never">
      <div class="filter-bar">
        <el-switch
          v-model="useDateFilter"
          active-text="按日期范围筛选"
          inactive-text="默认分页"
          @change="toggleDateFilter"
        />
        <el-date-picker
          v-if="useDateFilter"
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          :disabled-date="(date: Date) => date > new Date()"
          @change="handleDateRangeChange"
          style="width: 320px"
        />
        <el-button v-if="useDateFilter" text type="primary" @click="loadAnalytics">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </el-card>

    <!-- 统计卡片 -->
    <div class="stat-card-row">
      <StatCard title="总浏览量" :value="summary.totalViews" icon="View" color="#409eff" />
      <StatCard title="总点赞" :value="summary.totalLikes" icon="Star" color="#67c23a" />
      <StatCard title="总评论" :value="summary.totalComments" icon="ChatDotRound" color="#e6a23c" />
      <StatCard title="平均互动率" :value="summary.avgEngagement.toFixed(2)" icon="TrendCharts" color="#f56c6c" suffix="%" />
    </div>

    <!-- 数据趋势图 -->
    <el-card class="mb-20" shadow="never">
      <v-chart
        v-if="chartOption"
        class="chart"
        :option="chartOption"
        autoresize
      />
      <el-empty v-else description="暂无图表数据" :image-size="80" />
    </el-card>

    <!-- 分析记录列表 -->
    <el-card shadow="never">
      <template #header>
        <span class="font-large font-bold">分析记录</span>
        <span class="record-count">（共 {{ pagination.total }} 条）</span>
      </template>
      <el-table :data="analyticsList" style="width: 100%" stripe>
        <el-table-column label="内容标题" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            内容 #{{ row.contentId }}
          </template>
        </el-table-column>
        <el-table-column label="浏览量" width="100" align="right">
          <template #default="{ row }">
            {{ formatNumber(row.views) }}
          </template>
        </el-table-column>
        <el-table-column label="点赞" width="90" align="right">
          <template #default="{ row }">
            {{ formatNumber(row.likes) }}
          </template>
        </el-table-column>
        <el-table-column label="评论" width="90" align="right">
          <template #default="{ row }">
            {{ formatNumber(row.comments) }}
          </template>
        </el-table-column>
        <el-table-column label="分享" width="90" align="right">
          <template #default="{ row }">
            {{ formatNumber(row.shares) }}
          </template>
        </el-table-column>
        <el-table-column label="互动率" width="100" align="right">
          <template #default="{ row }">
            <span :class="row.engagementRate >= 5 ? 'text-success' : 'text-warning'">
              {{ row.engagementRate.toFixed(2) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column label="追踪时间" width="170">
          <template #default="{ row }">
            {{ row.trackedAt }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              text
              type="primary"
              :loading="tracking === row.id"
              @click="handleTrack(row)"
            >
              <el-icon v-if="tracking !== row.id"><Refresh /></el-icon>
              追踪
            </el-button>
            <el-button
              size="small"
              text
              type="danger"
              @click="handleDelete(row)"
            >
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !analyticsList.length" description="暂无分析数据" />
    </el-card>

    <!-- 分页器 -->
    <div class="pagination-wrapper" v-if="!useDateFilter && pagination.total > 0">
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
.chart {
  height: 400px;
  width: 100%;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.record-count {
  color: var(--el-text-color-secondary);
  font-weight: normal;
  font-size: 14px;
  margin-left: 8px;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}
</style>
