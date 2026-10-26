<script setup lang="ts">
import { computed, markRaw, ref, watch } from 'vue'
import { VueFlow, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { ElMessage } from 'element-plus'
import ProjectResultNode from './ProjectResultNode.vue'
import ProjectNodeWorkbench from './ProjectNodeWorkbench.vue'
import { projectWorkflowApi, type ProjectWorkflowDTO, type ProjectWorkflowNodeDTO } from '@/api'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const props = defineProps<{ workflow: ProjectWorkflowDTO }>()
const emit = defineEmits<{ updated: [workflow: ProjectWorkflowDTO] }>()
const selectedNodeId = ref(props.workflow.currentNodeId || props.workflow.nodes?.[0]?.nodeId || '')
const prompt = ref('')
const executing = ref(false)
const workbenchNodeId = ref('')
// Vue Flow 节点组件会由运行时注入完整 NodeProps；本组件只声明实际使用的 data。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: Record<string, any> = { result: markRaw(ProjectResultNode) }

watch(() => props.workflow.id, () => { selectedNodeId.value = props.workflow.currentNodeId || props.workflow.nodes?.[0]?.nodeId || '' })
const selectedNode = computed(() => props.workflow.nodes?.find(node => node.nodeId === selectedNodeId.value) || null)
watch(selectedNode, node => { prompt.value = node?.prompt || '' }, { immediate: true })

function summarize(node: ProjectWorkflowNodeDTO): string {
  if (node.error) return node.error
  const output = node.output as Record<string, unknown> | undefined
  if (!output) return ''
  if (output.selected && typeof output.selected === 'object') return String((output.selected as Record<string, unknown>).summary || (output.selected as Record<string, unknown>).title || '已选择成果')
  if (Array.isArray(output.candidates)) return `${output.candidates.length} 个候选成果，等待选择`
  if (typeof output.message === 'string') return output.message
  if (Array.isArray(output.items)) return `${output.items.length} 条结果`
  if (typeof output.title === 'string') return output.title
  return node.outputType || '已生成结果'
}

const flowNodes = computed(() => (props.workflow.nodes || []).map((node, index) => ({
  id: node.nodeId,
  type: 'result',
  position: { x: Number(node.position?.x ?? index * 280), y: Number(node.position?.y ?? 100) },
  data: { label: node.label, moduleId: node.moduleId, status: node.status, summary: summarize(node), inputSummary: String(((node.input as Record<string, unknown> | undefined)?.selectedInput as Record<string, unknown> | undefined)?.title || ''), model: node.model, current: props.workflow.currentNodeId === node.nodeId },
})))
const flowEdges = computed(() => props.workflow.edgesSnapshot.map((edge: any, index: number) => ({ ...edge, id: edge.id || `project-edge-${index}`, animated: true, type: 'smoothstep' })))

function selectNode(event: NodeMouseEvent): void { selectedNodeId.value = event.node.id; workbenchNodeId.value = event.node.id }
function openWorkbench(): void { if (selectedNode.value) workbenchNodeId.value = selectedNode.value.nodeId }
function updateWorkflow(workflow: ProjectWorkflowDTO): void { emit('updated', workflow) }
async function executeNode(): Promise<void> {
  if (!selectedNode.value) return
  executing.value = true
  try {
    const res = await projectWorkflowApi.executeNode(props.workflow.id, selectedNode.value.nodeId, { prompt: prompt.value.trim() || undefined })
    if (!res.data) throw new Error(res.error || '执行失败')
    emit('updated', res.data); ElMessage.success('节点执行完成')
  } catch (error) { ElMessage.error('节点执行失败: ' + (error as Error).message) } finally { executing.value = false }
}
async function confirmNode(): Promise<void> {
  if (!selectedNode.value) return
  executing.value = true
  try {
    const res = await projectWorkflowApi.confirmNode(props.workflow.id, selectedNode.value.nodeId)
    if (!res.data) throw new Error(res.error || '确认失败')
    emit('updated', res.data); ElMessage.success('已确认，下一节点已点亮')
  } catch (error) { ElMessage.error((error as Error).message) } finally { executing.value = false }
}
async function executeContinuously(): Promise<void> {
  executing.value = true
  try {
    const res = await projectWorkflowApi.executeContinuously(props.workflow.id)
    if (!res.data) throw new Error(res.error || '执行失败')
    emit('updated', res.data); ElMessage.success('连续执行已暂停在人工节点或完成')
  } catch (error) { ElMessage.error('连续执行失败: ' + (error as Error).message) } finally { executing.value = false }
}
function format(value: unknown): string { try { return JSON.stringify(value, null, 2) || '' } catch { return String(value) } }
</script>

<template>
  <div class="project-workflow-canvas">
    <div class="project-toolbar">
      <div><strong>{{ workflow.name }}</strong><span>{{ workflow.flowName }} · {{ workflow.nodes?.filter(n => n.status === 'completed').length || 0 }}/{{ workflow.nodes?.length || 0 }} 步</span></div>
      <el-button size="small" type="primary" :loading="executing" @click="executeContinuously">连续执行</el-button>
    </div>
    <div class="project-main">
      <VueFlow :nodes="flowNodes" :edges="flowEdges" :node-types="nodeTypes" fit-view-on-init @node-click="selectNode">
        <Background :gap="20" :size="1" pattern-color="var(--color-border-base)" /><Controls position="bottom-left" />
      </VueFlow>
      <aside v-if="selectedNode" class="node-inspector">
        <div class="inspector-heading"><div><small>NODE RESULT</small><h3>{{ selectedNode.label }}</h3></div><el-tag size="small">{{ selectedNode.status }}</el-tag></div>
        <label>提示词 / 本次微调</label>
        <el-input v-model="prompt" type="textarea" :rows="4" placeholder="留空使用项目初始关键词；修改后可重新执行" />
        <div class="node-actions">
          <el-button type="primary" plain @click="openWorkbench">打开节点工作台</el-button>
          <el-button v-if="selectedNode.status === 'waiting_review'" type="success" :loading="executing" @click="confirmNode">确认并进入下一步</el-button>
          <el-button v-else type="primary" :loading="executing" :disabled="selectedNode.status === 'running'" @click="executeNode">{{ selectedNode.attempt ? '修改并重试' : '执行此节点' }}</el-button>
        </div>
        <label>直接结果</label><pre>{{ format(selectedNode.output) || '尚未执行' }}</pre>
        <label>来源与真实性</label><pre>{{ format(selectedNode.sourceRefs) || '暂无来源' }}</pre>
        <div v-if="selectedNode.provider || selectedNode.model" class="model-line">{{ selectedNode.provider }} / {{ selectedNode.model }}</div>
      </aside>
    </div>
    <ProjectNodeWorkbench v-if="workbenchNodeId && props.workflow.nodes?.find(node => node.nodeId === workbenchNodeId)" :workflow="workflow" :node="props.workflow.nodes?.find(node => node.nodeId === workbenchNodeId)!" @updated="updateWorkflow" @close="workbenchNodeId = ''" />
  </div>
</template>

<style scoped>
.project-workflow-canvas { display:flex; flex-direction:column; height:100%; min-height:0; }.project-toolbar{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--color-border-light);background:var(--color-bg-card)}.project-toolbar div{display:flex;flex-direction:column;gap:2px}.project-toolbar span{color:var(--color-text-secondary);font-size:11px}.project-main{display:grid;grid-template-columns:minmax(0,1fr) 310px;flex:1;min-height:0}.node-inspector{overflow:auto;padding:14px;border-left:1px solid var(--color-border-light);background:var(--color-bg-card)}.inspector-heading{display:flex;justify-content:space-between;gap:8px}.inspector-heading small,label{color:var(--color-text-secondary);font-size:10px;font-weight:700;letter-spacing:.06em}.inspector-heading h3{margin:3px 0 16px}.node-inspector label{display:block;margin:14px 0 6px}.node-actions{margin-top:10px}.node-inspector pre{max-height:230px;overflow:auto;padding:10px;border-radius:7px;background:var(--color-bg-subtle);color:var(--color-text-secondary);font-size:10px;white-space:pre-wrap;word-break:break-word}.model-line{font-size:11px;color:var(--color-text-secondary)}
</style>
