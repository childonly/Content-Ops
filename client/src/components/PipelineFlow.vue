<script setup lang="ts">
import { computed } from 'vue'
import {
  TrendCharts,
  PriceTag,
  EditPen,
  Promotion,
  DataLine,
  DataAnalysis,
  Check,
  Loading,
  Close
} from '@element-plus/icons-vue'
import { PipelineStage, StageStatus, PIPELINE_STAGES, type PipelineStageRecord } from '@/types'

interface Props {
  stages?: PipelineStageRecord[]
  currentStage?: PipelineStage
}

const props = withDefaults(defineProps<Props>(), {
  stages: () => [],
  currentStage: PipelineStage.TREND_DISCOVERY
})

/** 阶段图标映射 */
const stageIcons: Record<string, any> = {
  [PipelineStage.TREND_DISCOVERY]: TrendCharts,
  [PipelineStage.HASHTAG_RESEARCH]: PriceTag,
  [PipelineStage.CONTENT_GENERATION]: EditPen,
  [PipelineStage.PUBLISHING]: Promotion,
  [PipelineStage.PERFORMANCE_TRACKING]: DataLine,
  [PipelineStage.ITERATION]: DataAnalysis
}

/** 获取阶段记录 */
function getStageRecord(stage: PipelineStage): PipelineStageRecord | undefined {
  return props.stages.find((s) => s.stage === stage)
}

/** 获取阶段状态 */
function getStageStatus(stage: PipelineStage): StageStatus {
  const record = getStageRecord(stage)
  if (record) return record.status
  // 如果没有记录，根据 currentStage 推断
  const stageOrder = PIPELINE_STAGES.map((s) => s.stage)
  const currentIdx = stageOrder.indexOf(props.currentStage)
  const thisIdx = stageOrder.indexOf(stage)
  if (thisIdx < currentIdx) return StageStatus.COMPLETED
  if (thisIdx === currentIdx) return StageStatus.RUNNING
  return StageStatus.PENDING
}

/** 阶段状态样式类 */
function stageClass(stage: PipelineStage): string {
  const status = getStageStatus(stage)
  switch (status) {
    case StageStatus.COMPLETED:
      return 'stage--completed'
    case StageStatus.RUNNING:
      return 'stage--running'
    case StageStatus.FAILED:
      return 'stage--failed'
    case StageStatus.SKIPPED:
      return 'stage--skipped'
    default:
      return 'stage--pending'
  }
}

/** 箭头是否激活 */
function arrowActive(stage: PipelineStage): boolean {
  const status = getStageStatus(stage)
  return status === StageStatus.COMPLETED
}

/** 阶段状态图标 */
const statusIcons: Record<string, any> = {
  [StageStatus.COMPLETED]: Check,
  [StageStatus.RUNNING]: Loading,
  [StageStatus.FAILED]: Close,
  [StageStatus.SKIPPED]: Close,
  [StageStatus.PENDING]: null
}

/** 是否显示状态图标 */
function hasStatusIcon(stage: PipelineStage): boolean {
  const status = getStageStatus(stage)
  return status !== StageStatus.PENDING
}

/** 阶段状态文字 */
function statusText(stage: PipelineStage): string {
  const status = getStageStatus(stage)
  const map: Record<string, string> = {
    [StageStatus.COMPLETED]: '已完成',
    [StageStatus.RUNNING]: '进行中',
    [StageStatus.FAILED]: '失败',
    [StageStatus.SKIPPED]: '已跳过',
    [StageStatus.PENDING]: '待执行'
  }
  return map[status] || '待执行'
}

/** 阶段列表（用于渲染） */
const stageList = computed(() => PIPELINE_STAGES)
</script>

<template>
  <div class="pipeline-flow">
    <div class="pipeline-flow__container">
      <template v-for="(stage, index) in stageList" :key="stage.stage">
        <!-- 阶段节点 -->
        <div class="pipeline-flow__stage" :class="stageClass(stage.stage)">
          <div class="pipeline-flow__icon-wrapper">
            <el-icon class="pipeline-flow__icon" :size="24">
              <component :is="stageIcons[stage.stage]" />
            </el-icon>
            <el-icon v-if="hasStatusIcon(stage.stage)" class="pipeline-flow__status-icon" :size="14">
              <component :is="statusIcons[getStageStatus(stage.stage)]" />
            </el-icon>
          </div>
          <div class="pipeline-flow__label">{{ stage.label }}</div>
          <div class="pipeline-flow__status-text">{{ statusText(stage.stage) }}</div>
        </div>

        <!-- 箭头连接 -->
        <div
          v-if="index < stageList.length - 1"
          class="pipeline-flow__arrow"
          :class="{ 'arrow--active': arrowActive(stage.stage) }"
        >
          <el-icon :size="16"><ArrowRight /></el-icon>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pipeline-flow {
  width: 100%;
  overflow-x: auto;
  padding: 8px 0;
}

.pipeline-flow__container {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: max-content;
  padding: 0 8px;
}

.pipeline-flow__stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 110px;
  position: relative;
}

.pipeline-flow__icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg-muted);
  border: 3px solid var(--color-border-base);
  transition: all 0.3s;
  position: relative;
}

.pipeline-flow__icon {
  color: var(--color-text-secondary);
}

.pipeline-flow__status-icon {
  position: absolute;
  bottom: -2px;
  right: -2px;
  background: var(--color-bg-card);
  border-radius: 50%;
  padding: 2px;
}

.pipeline-flow__label {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.pipeline-flow__status-text {
  font-size: 11px;
  color: var(--color-text-placeholder);
  margin-top: 2px;
}

/* 已完成 */
.stage--completed .pipeline-flow__icon-wrapper {
  background-color: var(--color-success-soft);
  border-color: var(--color-success);
}

.stage--completed .pipeline-flow__icon {
  color: var(--color-success);
}

.stage--completed .pipeline-flow__label {
  color: var(--color-success);
}

.stage--completed .pipeline-flow__status-icon {
  color: var(--color-success);
}

/* 进行中 */
.stage--running .pipeline-flow__icon-wrapper {
  background-color: var(--color-primary-soft);
  border-color: var(--color-primary);
}

.stage--running .pipeline-flow__icon {
  color: var(--color-primary);
}

.stage--running .pipeline-flow__label {
  color: var(--color-primary);
}

.stage--running .pipeline-flow__status-icon {
  color: var(--color-primary);
}

/* 失败 */
.stage--failed .pipeline-flow__icon-wrapper {
  background-color: var(--color-danger-soft);
  border-color: var(--color-danger);
}

.stage--failed .pipeline-flow__icon {
  color: var(--color-danger);
}

.stage--failed .pipeline-flow__label {
  color: var(--color-danger);
}

.stage--failed .pipeline-flow__status-icon {
  color: var(--color-danger);
}

/* 已跳过 */
.stage--skipped .pipeline-flow__icon-wrapper {
  background-color: var(--color-info-soft);
  border-color: var(--color-info);
  opacity: 0.6;
}

/* 待执行 */
.stage--pending .pipeline-flow__icon-wrapper {
  background-color: var(--color-bg-muted);
  border-color: var(--color-border-base);
}

/* 箭头 */
.pipeline-flow__arrow {
  color: var(--color-border-base);
  margin: 0 4px;
  margin-bottom: 36px;
  transition: color 0.3s;
}

.arrow--active {
  color: var(--color-success);
}
</style>
