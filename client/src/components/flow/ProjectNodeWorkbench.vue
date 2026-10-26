<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { projectWorkflowApi, videoStudioApi, type ProjectNodeWorkbenchDTO, type ProjectPromptRecommendationDTO, type ProjectWorkflowDTO, type ProjectWorkflowNodeDTO, type ProjectWorkbenchInputDTO, type UnifiedVideoRecord } from '@/api'

const props = defineProps<{ workflow: ProjectWorkflowDTO; node: ProjectWorkflowNodeDTO }>()
const emit = defineEmits<{ updated: [workflow: ProjectWorkflowDTO]; close: [] }>()

const workbench = ref<ProjectNodeWorkbenchDTO | null>(null)
const recommendations = ref<ProjectPromptRecommendationDTO[]>([])
const selectedInputId = ref('')
const selectedCandidateId = ref('')
const prompt = ref(props.node.prompt || '')
const loading = ref(false)
const recommending = ref(false)
const videoUrl = ref(String(props.workflow.initialInput.videoUrl || props.workflow.initialInput.url || ''))
const videoStrategy = ref<'transcribe' | 'alchemist'>('transcribe')
const videoModel = ref('medium')
const videoLanguage = ref('auto')
const videoPlatform = ref(String(props.workflow.initialInput.platform || 'xiaohongshu'))
const completedVideoRecords = ref<UnifiedVideoRecord[]>([])

const output = computed(() => (props.node.output || {}) as Record<string, unknown>)
const candidates = computed(() => Array.isArray(output.value.candidates) ? output.value.candidates as Array<Record<string, unknown>> : [])
const selectedOutput = computed(() => output.value.selected as Record<string, unknown> | undefined)
const selectedInput = computed<ProjectWorkbenchInputDTO | undefined>(() => workbench.value?.inputs.find(input => input.id === selectedInputId.value))
const canExecute = computed(() => !loading.value && (!workbench.value?.capabilities.inputRequired || !!selectedInputId.value))

function extractVideoUrl(input: string): string {
  return input.trim().match(/https?:\/\/[^\s\u3000（）()【】《》“”‘’]+/i)?.[0] || input.trim()
}

function extractVideoSourceText(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/https?:\/\/[^\s\u3000（）()【】《》“”‘’]+/i)
  return match && trimmed.indexOf(match[0]) > 0 ? trimmed.slice(0, trimmed.indexOf(match[0])).trim() : ''
}

async function loadWorkbench(): Promise<void> {
  const res = await projectWorkflowApi.getWorkbench(props.workflow.id, props.node.nodeId)
  if (!res.data) throw new Error(res.error || '节点工作台加载失败')
  workbench.value = res.data
  const persisted = (props.node.input as Record<string, unknown> | undefined)?.selectedInput as Record<string, unknown> | undefined
  selectedInputId.value = String(persisted?.id || '')
  const persistedOutput = (props.node.output as Record<string, unknown> | undefined)?.selected as Record<string, unknown> | undefined
  selectedCandidateId.value = String(persistedOutput?.id || '')
}

async function loadRecommendations(): Promise<void> {
  recommending.value = true
  try {
    const res = await projectWorkflowApi.recommendPrompts(props.workflow.id, props.node.nodeId)
    if (!res.data) throw new Error(res.error || '提示词推荐失败')
    recommendations.value = res.data.recommendations
  } catch (error) { ElMessage.error((error as Error).message) } finally { recommending.value = false }
}

async function chooseInput(input: ProjectWorkbenchInputDTO): Promise<void> {
  selectedInputId.value = input.id
  try {
    const res = await projectWorkflowApi.selectInput(props.workflow.id, props.node.nodeId, { id: input.id, value: input.value })
    if (!res.data) throw new Error(res.error || '输入保存失败')
    emit('updated', res.data)
    ElMessage.success('已选择上游成果')
  } catch (error) { selectedInputId.value = ''; ElMessage.error((error as Error).message) }
}

async function executeGeneric(): Promise<void> {
  if (!canExecute.value) return
  loading.value = true
  try {
    const res = await projectWorkflowApi.executeNode(props.workflow.id, props.node.nodeId, { prompt: prompt.value.trim() || undefined, selectedInput: selectedInput.value })
    if (!res.data) throw new Error(res.error || '节点执行失败')
    emit('updated', res.data)
    await loadWorkbench()
    ElMessage.success('节点执行完成，请选择或确认成果')
  } catch (error) { ElMessage.error('节点执行失败：' + (error as Error).message) } finally { loading.value = false }
}

async function executeVideo(): Promise<void> {
  if (!videoUrl.value.trim()) { ElMessage.warning('请先输入视频链接'); return }
  const normalizedUrl = extractVideoUrl(videoUrl.value)
  if (!/^https?:\/\//i.test(normalizedUrl)) { ElMessage.warning('未识别到有效的视频 URL，请检查输入'); return }
  loading.value = true
  try {
    const res = await projectWorkflowApi.generateVideo(props.workflow.id, props.node.nodeId, { url: normalizedUrl, sourceText: extractVideoSourceText(videoUrl.value) || undefined, strategy: videoStrategy.value, model: videoModel.value, language: videoLanguage.value, platform: videoPlatform.value })
    if (!res.data) throw new Error(res.error || '视频处理失败')
    emit('updated', res.data)
    await loadWorkbench()
    ElMessage.success('视频处理完成，请选择一条成果')
  } catch (error) { ElMessage.error('视频处理失败：' + (error as Error).message) } finally { loading.value = false }
}

async function loadCompletedVideoRecords(): Promise<void> {
  try {
    const res = await videoStudioApi.getRecords({ page: 1, pageSize: 12 })
    completedVideoRecords.value = (res.data || []).filter(record => record.status === 'completed')
  } catch { completedVideoRecords.value = [] }
}

async function reuseVideo(record: UnifiedVideoRecord): Promise<void> {
  loading.value = true
  try {
    const res = await projectWorkflowApi.reuseVideo(props.workflow.id, props.node.nodeId, record.uid)
    if (!res.data) throw new Error(res.error || '复用视频成果失败')
    emit('updated', res.data)
    await loadWorkbench()
    ElMessage.success('已载入视频工作室成果，请选择一条作为节点结果')
  } catch (error) { ElMessage.error((error as Error).message) } finally { loading.value = false }
}

async function selectCandidate(candidate: Record<string, unknown>): Promise<void> {
  const id = String(candidate.id || '')
  if (!id) return
  selectedCandidateId.value = id
  loading.value = true
  try {
    const res = await projectWorkflowApi.selectResult(props.workflow.id, props.node.nodeId, id)
    if (!res.data) throw new Error(res.error || '成果确认失败')
    emit('updated', res.data)
    ElMessage.success('成果已确认，下一节点已准备')
    emit('close')
  } catch (error) { ElMessage.error((error as Error).message) } finally { loading.value = false }
}

async function confirmExisting(): Promise<void> {
  loading.value = true
  try {
    const res = await projectWorkflowApi.confirmNode(props.workflow.id, props.node.nodeId)
    if (!res.data) throw new Error(res.error || '确认失败')
    emit('updated', res.data); emit('close'); ElMessage.success('已确认，下一节点已准备')
  } catch (error) { ElMessage.error((error as Error).message) } finally { loading.value = false }
}

function useRecommendation(item: ProjectPromptRecommendationDTO): void { prompt.value = item.prompt; ElMessage.success('已填入提示词，可继续人工微调') }
function summary(value: unknown): string { return String(value || '暂无摘要') }

onMounted(async () => { try { await loadWorkbench(); if (props.node.moduleId === 'video-studio') await loadCompletedVideoRecords(); else await loadRecommendations() } catch (error) { ElMessage.error((error as Error).message) } })
</script>

<template>
  <el-dialog :model-value="true" width="780px" top="5vh" destroy-on-close class="project-node-workbench" @close="emit('close')">
    <template #header>
      <div class="workbench-title"><div><small>PROJECT NODE WORKBENCH</small><h2>{{ node.label }}</h2></div><el-tag :type="node.status === 'completed' ? 'success' : node.status === 'failed' ? 'danger' : 'info'">{{ node.status }}</el-tag></div>
    </template>
    <div v-if="workbench" class="workbench-body">
      <el-alert v-if="workbench.capabilities.blockedReason" :title="workbench.capabilities.blockedReason" type="warning" show-icon :closable="false" />
      <section v-if="workbench.capabilities.inputRequired" class="workbench-section">
        <div class="section-heading"><strong>1. 选择上游成果</strong><span>选择后才可进入本节点</span></div>
        <div v-if="workbench.inputs.length" class="input-grid">
          <button v-for="input in workbench.inputs" :key="input.id" class="artifact-card" :class="{ selected: selectedInputId === input.id }" @click="chooseInput(input)">
            <span class="artifact-type">{{ input.type }}</span><strong>{{ input.title }}</strong><p>{{ input.summary }}</p><small>{{ input.nodeLabel }}</small>
          </button>
        </div>
        <el-empty v-else description="前置节点尚未确认成果" :image-size="54" />
      </section>

      <section v-if="node.moduleId === 'video-studio'" class="workbench-section">
        <div class="section-heading"><strong>2. 视频工作室</strong><span>复用真实视频处理能力</span></div>
        <el-input v-model="videoUrl" placeholder="粘贴视频链接或平台分享文本" clearable />
        <div class="video-options"><el-select v-model="videoStrategy"><el-option label="视频转录" value="transcribe" /><el-option label="视频炼金术" value="alchemist" /></el-select><el-select v-if="videoStrategy === 'transcribe'" v-model="videoModel"><el-option label="medium（推荐）" value="medium" /><el-option label="small（较快）" value="small" /><el-option label="large-v3（最高精度）" value="large-v3" /></el-select><el-select v-if="videoStrategy === 'transcribe'" v-model="videoLanguage"><el-option label="自动检测" value="auto" /><el-option label="中文" value="zh" /><el-option label="英文" value="en" /></el-select><el-select v-if="videoStrategy === 'alchemist'" v-model="videoPlatform"><el-option label="小红书" value="xiaohongshu" /><el-option label="抖音" value="douyin" /><el-option label="微信公众号" value="wechat" /></el-select><el-button type="primary" :loading="loading" @click="executeVideo">生成候选成果</el-button></div>
        <div v-if="completedVideoRecords.length" class="history-block"><div class="section-heading"><strong>复用已有成功成果</strong><span>无需重复转录</span></div><div class="history-list"><button v-for="record in completedVideoRecords" :key="record.uid" class="history-item" :disabled="loading" @click="reuseVideo(record)"><div><strong>{{ record.sourceText || record.rewrittenTitle || record.url }}</strong><small>{{ record.strategy }} · {{ record.model || record.platform || '默认配置' }}</small></div><span>载入</span></button></div></div>
      </section>

      <section v-if="node.moduleId !== 'video-studio' && workbench.capabilities.supportsPromptRecommendations" class="workbench-section">
        <div class="section-heading"><strong>{{ workbench.capabilities.inputRequired ? '2' : '1' }}. LLM 提示词推荐</strong><el-button text type="primary" :loading="recommending" @click="loadRecommendations">重新推荐</el-button></div>
        <div class="prompt-grid"><button v-for="item in recommendations" :key="item.id" class="prompt-card" @click="useRecommendation(item)"><strong>{{ item.title }}</strong><p>{{ item.reason }}</p><code>{{ item.prompt }}</code><small v-if="item.fallback">本地备用模板</small></button></div>
        <el-input v-model="prompt" type="textarea" :rows="5" placeholder="点击模板后，在这里继续人工微调" />
        <el-button class="execute-button" type="primary" :loading="loading" :disabled="!canExecute || !!workbench.capabilities.blockedReason" @click="executeGeneric">执行本节点</el-button>
      </section>

      <section v-if="candidates.length" class="workbench-section">
        <div class="section-heading"><strong>{{ node.moduleId === 'video-studio' ? '3' : '3' }}. 选择成果并进入下一步</strong><span>点击一条成果确认</span></div>
        <div class="candidate-grid"><button v-for="candidate in candidates" :key="String(candidate.id)" class="candidate-card" :class="{ selected: selectedCandidateId === String(candidate.id) }" :disabled="loading" @click="selectCandidate(candidate)"><span>{{ candidate.type }}</span><strong>{{ candidate.title }}</strong><p>{{ summary(candidate.summary) }}</p><small>选择并确认 →</small></button></div>
      </section>
      <section v-else-if="node.status === 'waiting_review'" class="workbench-section"><el-alert title="当前节点等待人工确认" description="请检查右侧结果后点击确认，系统会点亮下一节点。" type="info" show-icon :closable="false" /><el-button class="execute-button" type="success" :loading="loading" @click="confirmExisting">确认并进入下一步</el-button></section>
      <section v-if="selectedOutput" class="selected-preview"><span>当前选定成果</span><strong>{{ selectedOutput.title }}</strong><p>{{ summary(selectedOutput.summary || selectedOutput.value) }}</p></section>
    </div>
    <el-skeleton v-else :rows="8" animated />
  </el-dialog>
</template>

<style scoped>
.workbench-title{display:flex;align-items:center;justify-content:space-between;gap:16px}.workbench-title small,.section-heading span{color:var(--color-text-secondary);font-size:11px;letter-spacing:.05em}.workbench-title h2{margin:4px 0 0;font-size:20px}.workbench-body{display:flex;flex-direction:column;gap:14px}.workbench-section{padding:14px;border:1px solid var(--color-border-light);border-radius:12px;background:var(--color-bg-subtle)}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.input-grid,.candidate-grid,.prompt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.artifact-card,.prompt-card,.candidate-card{display:flex;flex-direction:column;align-items:flex-start;gap:5px;text-align:left;padding:12px;border:1px solid var(--color-border-light);border-radius:10px;background:var(--color-bg-card);color:var(--color-text-primary);cursor:pointer}.artifact-card:hover,.prompt-card:hover,.candidate-card:hover,.artifact-card.selected,.candidate-card.selected{border-color:var(--color-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-primary) 15%,transparent)}.artifact-card p,.prompt-card p,.candidate-card p,.selected-preview p{margin:0;color:var(--color-text-secondary);font-size:12px;line-height:1.5}.artifact-card small,.candidate-card small,.prompt-card small{color:var(--color-text-secondary);font-size:10px}.artifact-type,.candidate-card span{color:var(--color-primary);font-size:10px;text-transform:uppercase}.prompt-card code{display:block;max-height:64px;overflow:hidden;color:var(--color-text-secondary);font-size:11px;line-height:1.4;white-space:pre-wrap}.video-options{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.video-options .el-select{width:150px}.execute-button{margin-top:10px}.selected-preview{padding:12px;border-left:3px solid var(--color-success);background:var(--color-bg-subtle)}.selected-preview span{display:block;color:var(--color-text-secondary);font-size:11px}.selected-preview strong{display:block;margin:4px 0}@media(max-width:720px){.input-grid,.candidate-grid,.prompt-grid{grid-template-columns:1fr}.video-options .el-select{width:100%}}
.history-block{margin-top:14px;padding-top:12px;border-top:1px solid var(--color-border-light)}.history-list{display:flex;flex-direction:column;gap:7px;max-height:180px;overflow:auto}.history-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px;border:1px solid var(--color-border-light);border-radius:8px;background:var(--color-bg-card);color:var(--color-text-primary);cursor:pointer;text-align:left}.history-item:hover{border-color:var(--color-primary)}.history-item div{min-width:0}.history-item strong,.history-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-item small{margin-top:3px;color:var(--color-text-secondary);font-size:10px}.history-item span{color:var(--color-primary);font-size:12px}
</style>
