<script setup lang="ts">
import { computed } from 'vue'
import type { Trend, Platform, TrendStatus } from '@/types'

interface Props {
  trend: Trend
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'track', trend: Trend): void
  (e: 'generate', trend: Trend): void
  (e: 'detail', trend: Trend): void
}>()

/** 平台名称映射 */
const platformLabels: Record<Platform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitter: 'Twitter'
}

/** 状态映射 */
const statusConfig: Record<TrendStatus, { label: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  new: { label: '已发现', type: 'info' },
  tracked: { label: '追踪中', type: 'success' },
  archived: { label: '已归档', type: 'warning' }
}

/** 平台标签 */
const platformLabel = computed(() => platformLabels[props.trend.platform] || props.trend.platform)

/** 状态信息 */
const statusInfo = computed(() => statusConfig[props.trend.status] || statusConfig.new)

/** 格式化热度 */
const heatText = computed(() => {
  const heat = props.trend.heat
  if (heat >= 10000) return (heat / 10000).toFixed(1) + '万'
  return heat.toString()
})

/** 增长率是否为正 */
const isPositiveGrowth = computed(() => props.trend.growthRate >= 0)

/** 处理追踪 */
function handleTrack(): void {
  emit('track', props.trend)
}

/** 处理生成内容 */
function handleGenerate(): void {
  emit('generate', props.trend)
}
function handleDetail(): void { emit('detail', props.trend) }
</script>

<template>
  <el-card class="trend-card" shadow="hover">
    <!-- 卡片头部 -->
    <div class="trend-card__header">
      <div class="trend-card__title-row">
        <span class="trend-card__platform">{{ platformLabel }}</span>
        <el-tag :type="statusInfo.type" size="small" effect="light">{{ statusInfo.label }}</el-tag>
      </div>
      <h3 class="trend-card__title">{{ trend.title }}</h3>
    </div>

    <!-- 描述 -->
    <p class="trend-card__desc">{{ trend.description }}</p>

    <!-- 数据指标 -->
    <div class="trend-card__metrics">
      <div class="trend-card__metric">
        <span class="trend-card__metric-label">热度</span>
        <span class="trend-card__metric-value">{{ heatText }}</span>
      </div>
      <div class="trend-card__metric">
        <span class="trend-card__metric-label">增长率</span>
        <span class="trend-card__metric-value" :class="{ 'text-success': isPositiveGrowth, 'text-danger': !isPositiveGrowth }">
          {{ isPositiveGrowth ? '+' : '' }}{{ trend.growthRate }}%
        </span>
      </div>
      <div class="trend-card__metric">
        <span class="trend-card__metric-label">分类</span>
        <span class="trend-card__metric-value">{{ trend.category }}</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="trend-card__actions">
      <el-button size="small" text type="primary" @click="handleDetail">查看详情与来源</el-button>
      <el-button size="small" @click="handleTrack">
        <el-icon><TrendCharts /></el-icon>
        追踪
      </el-button>
      <el-button size="small" type="primary" @click="handleGenerate">
        <el-icon><EditPen /></el-icon>
        生成内容
      </el-button>
    </div>
  </el-card>
</template>

<style scoped>
.trend-card {
  border-radius: 8px;
  transition: transform 0.2s;
}

.trend-card:hover {
  transform: translateY(-2px);
}

.trend-card__header {
  margin-bottom: 12px;
}

.trend-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.trend-card__platform {
  font-size: 12px;
  color: var(--color-primary);
  font-weight: 600;
  background-color: var(--color-primary);
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
}

.trend-card__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.trend-card__desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.trend-card__metrics {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid var(--color-border-lighter);
  border-bottom: 1px solid var(--color-border-lighter);
  margin-bottom: 12px;
}

.trend-card__metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.trend-card__metric-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.trend-card__metric-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.trend-card__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
