<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { ProjectNodeStatus } from '@/api'

const props = defineProps<{ data: { label: string; moduleId: string; status: ProjectNodeStatus; summary?: string; inputSummary?: string; model?: string; current?: boolean } }>()
const statusText = computed(() => ({
  pending: '待执行', running: '执行中', waiting_review: '待确认', completed: '已完成', failed: '失败',
  skipped: '已跳过', blocked: '未接入',
}[props.data.status]))
</script>

<template>
  <div class="result-node" :class="[data.status, { current: data.current }]">
    <Handle type="target" :position="Position.Left" />
    <div class="node-top"><span>{{ data.label }}</span><em>{{ statusText }}</em></div>
    <small>{{ data.moduleId }}</small>
    <small v-if="data.inputSummary" class="input-summary">输入：{{ data.inputSummary }}</small>
    <p>{{ data.summary || '执行后在这里显示结果摘要' }}</p>
    <small v-if="data.model" class="model-summary">模型：{{ data.model }}</small>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.result-node { width: 220px; padding: 12px; border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-bg-card); color: var(--color-text-primary); box-shadow: var(--shadow-sm); }
.result-node.current { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.node-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 700; }
.node-top em { padding: 2px 6px; border-radius: 999px; background: var(--color-bg-subtle); color: var(--color-text-secondary); font-size: 10px; font-style: normal; }
.result-node.completed { border-color: var(--color-success); }.result-node.failed,.result-node.blocked { border-color: var(--color-danger); }.result-node.waiting_review { border-color: var(--color-warning); }
.result-node small { color: var(--color-text-secondary); }.result-node p { overflow: hidden; margin: 8px 0 0; color: var(--color-text-secondary); font-size: 11px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.result-node .input-summary,.result-node .model-summary{display:block;margin-top:4px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
