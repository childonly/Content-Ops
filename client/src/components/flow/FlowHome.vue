<script setup lang="ts">
/**
 * FlowHome — 流程图首页核心组件
 *
 * 职责：
 *   1. 集成 Vue Flow 渲染模块节点 DAG
 *   2. 注册 ModuleNode 自定义节点类型
 *   3. 管理节点点击 → 弹出 ModuleInfoCard
 *   4. 管理节点拖拽 → 持久化位置
 *   5. 提供工具栏（重置布局、统计信息、图例、筛选）
 *   6. 编排模式：拖拽编排、连线、右键删除、双击编辑
 *   7. 业务流线管理：保存、加载、执行、删除
 */

import { markRaw, nextTick, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  VueFlow,
  useVueFlow,
  type NodeMouseEvent,
  type NodeDragEvent,
  type Connection,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search as SearchIcon } from '@element-plus/icons-vue'

// Vue Flow 样式
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import ModuleNode from './ModuleNode.vue'
import ModuleInfoCard from './ModuleInfoCard.vue'
import { useModuleFlow } from '@/composables/useModuleFlow'
import {
  moduleConfigs,
  getAllSkills,
  categoryColors,
  edgeTypeConfig,
  type ModuleConfig,
  type ModuleSkill,
} from '@/config/moduleConfigs'
import {
  getNodeModuleId,
  getWorkflowRecommendations,
  type WorkflowRecommendation,
} from '@/config/workflowRecommendations'
import {
  businessFlowApi,
  type BusinessFlowDTO,
  type BusinessFlowRunDetailDTO,
} from '@/api'
import { adminLLMApi } from '@/api'

const props = defineProps<{ initialFlowId?: number }>()

// ============================================================================
// 路由
// ============================================================================

const router = useRouter()

/** 导航到指定路由 */
function navigateTo(route: string): void {
  router.push(route)
}

// ============================================================================
// 流程图数据
// ============================================================================

const {
  // 现有状态
  selectedModule,
  infoCardVisible,
  layoutInitialized,
  onNodeClick,
  onNodeDragStop,
  resetLayout,
  // 筛选状态
  showSkills,
  visibleCategories,
  searchKeyword,
  showLlmOnly,
  showInternalFlows,
  filteredNodes,
  filteredEdges,
  toggleSkills,
  toggleCategory,
  toggleLlmOnly,
  toggleInternalFlows,
  showAll,
  // 编排状态
  isOrchestrateMode,
  orchestrateNodes,
  orchestrateEdges,
  // 编排分析状态
  orchestrationName,
  orchestrationDoc,
  llmAnalysis,
  llmIssues,
  llmSuggestions,
  llmAnalysisProvider,
  llmAnalysisModel,
  llmAnalysisDuration,
  chatMessages,
  analyzingOrchestration,
  chattingWithLLM,
  planConfirmed,
  optimizingFlow,
  optimizationResult,
  // 编排方法
  enterOrchestrateMode,
  startNewOrchestration,
  exitOrchestrateMode,
  addNodeToCanvas,
  removeNodeFromCanvas,
  removeNodesFromCanvas,
  lastAddedNodeId,
  addEdgeToCanvas,
  saveBusinessFlow,
  loadBusinessFlow,
  // 编排分析方法
  generateRequirementDoc,
  saveAsCustomFlow,
  analyzeOrchestration,
  chatWithLLM,
  confirmPlan,
  resetPlan,
  executeOptimization,
} = useModuleFlow({ onNavigate: navigateTo })

// ============================================================================
// Vue Flow 实例
// ============================================================================

/** 流程图实例 ID，用于 useVueFlow 关联 */
const FLOW_ID = 'content-ops-flow'

const { fitView, screenToFlowCoordinate, getSelectedNodes, onPaneReady } = useVueFlow(FLOW_ID)

/** 画布右键菜单状态 */
const canvasContextMenu = ref<{ visible: boolean; x: number; y: number; nodeId: string | null }>({
  visible: false,
  x: 0,
  y: 0,
  nodeId: null,
})

/** 当前选中的编排节点 */
const selectedOrchestrateNodes = computed(() => {
  const selectedIds = new Set(getSelectedNodes.value.map(node => node.id))
  return orchestrateNodes.value.filter(node => selectedIds.has(node.id) || node.selected)
})

const contextNode = computed(() => orchestrateNodes.value.find(node => node.id === canvasContextMenu.value.nodeId) || null)
const contextRecommendations = computed(() => {
  if (!contextNode.value) return []
  return getWorkflowRecommendations(getNodeModuleId(contextNode.value))
})
const recommendedNextModules = computed(() => contextRecommendations.value.filter(item => item.recommended))
const optionalNextModules = computed(() => contextRecommendations.value.filter(item => !item.recommended).slice(0, 5))

function syncOrchestrateSelection(): void {
  if (!isOrchestrateMode.value) return
  const selectedIds = new Set(getSelectedNodes.value.map(node => node.id))
  orchestrateNodes.value = orchestrateNodes.value.map(node => ({
    ...node,
    selected: selectedIds.has(node.id),
  }))
}

function closeCanvasContextMenu(): void {
  canvasContextMenu.value.visible = false
}

// 面板就绪 → 自动适配视图
onPaneReady(() => {
  setTimeout(() => {
    fitView({ padding: 0.2, duration: 300 })
  }, 100)
})

// ============================================================================
// 自定义节点类型注册
// ============================================================================

/** 节点类型映射（markRaw 避免组件被响应式化） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: Record<string, any> = {
  module: markRaw(ModuleNode),
}

// ============================================================================
// 显示数据 computed（根据模式切换数据源）
// ============================================================================

/** 当前显示的节点（编排模式用 orchestrateNodes，普通模式用 filteredNodes） */
const displayNodes = computed(() =>
  isOrchestrateMode.value ? orchestrateNodes.value : filteredNodes.value
)

/** 当前显示的边（编排模式用 orchestrateEdges，普通模式用 filteredEdges） */
const displayEdges = computed(() =>
  isOrchestrateMode.value ? orchestrateEdges.value : filteredEdges.value
)

/** 统计文本 */
const statsText = computed(() => {
  if (isOrchestrateMode.value) {
    return `${orchestrateNodes.value.length} 个节点 · ${orchestrateEdges.value.length} 条连线`
  }
  return `${filteredNodes.value.length} 个模块 · ${filteredEdges.value.length} 条数据流`
})

// ============================================================================
// 编排模式侧边栏数据
// ============================================================================

/** 所有技能（去重） */
const allSkills = getAllSkills()

// ============================================================================
// 拖拽支持（HTML5 Drag API）
// ============================================================================

/** 拖拽开始：设置数据传输 */
function onDragStart(
  event: DragEvent,
  item: ModuleConfig | ModuleSkill,
  nodeType: 'module' | 'skill'
): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(
    'application/json',
    JSON.stringify({ nodeType, data: item })
  )
  event.dataTransfer.effectAllowed = 'move'
}

/** 拖拽悬停：允许放置 */
function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

/** 放置：将拖拽项添加到画布 */
function onDrop(event: DragEvent): void {
  event.preventDefault()
  if (!event.dataTransfer) return
  const raw = event.dataTransfer.getData('application/json')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as {
      nodeType: 'module' | 'skill'
      data: ModuleConfig | ModuleSkill
    }
    const position = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    const nodeId = addNodeToCanvas(parsed.data, parsed.nodeType, position)
    closeCanvasContextMenu()
    nextTick(() => {
      setTimeout(() => fitView({ nodes: [nodeId], padding: 0.45, duration: 350 }), 40)
    })
  } catch {
    // 解析失败忽略
  }
}

// ============================================================================
// VueFlow 事件处理
// ============================================================================

/** 节点点击 → 弹出模块信息卡片（仅普通模式） */
function handleNodeClick(event: NodeMouseEvent): void {
  if (isOrchestrateMode.value) {
    // Vue Flow 负责 Shift/Ctrl 选择，这里只同步到编排数据，确保工具条和保存结果一致。
    setTimeout(syncOrchestrateSelection, 0)
    return
  }
  onNodeClick(event.node)
}

/** 节点拖拽结束 → 保存位置 */
function handleNodeDragStop(event: NodeDragEvent): void {
  if (isOrchestrateMode.value) {
    // 编排模式：更新 orchestrateNodes 中的节点位置
    const node = orchestrateNodes.value.find(n => n.id === event.node.id)
    if (node) {
      node.position = { ...event.node.position }
    }
    setTimeout(syncOrchestrateSelection, 0)
  } else {
    onNodeDragStop(event.node)
  }
}

/** 连线事件（仅编排模式） */
function onConnect(connection: Connection): void {
  if (!isOrchestrateMode.value) return
  if (connection.source && connection.target) {
    addEdgeToCanvas(connection.source, connection.target)
  }
}

/** 右键节点 → 删除（仅编排模式） */
function onNodeContextMenu(event: NodeMouseEvent): void {
  if (!isOrchestrateMode.value) return
  event.event.preventDefault()
  const mouseEvent = event.event as MouseEvent
  const selected = selectedOrchestrateNodes.value
  const selectedIds = new Set(selected.map(node => node.id))
  if (!selectedIds.has(event.node.id)) {
    // 右键未选中的节点时，将其设为当前操作对象。
    orchestrateNodes.value = orchestrateNodes.value.map(node => ({
      ...node,
      selected: node.id === event.node.id,
    }))
  }
  canvasContextMenu.value = {
    visible: true,
    x: mouseEvent.clientX,
    y: mouseEvent.clientY,
    nodeId: event.node.id,
  }
}

/** 画布中键双击：智能定位选中节点、最近新增节点或全部节点 */
function handleCanvasDoubleClick(event: MouseEvent): void {
  if (!isOrchestrateMode.value || event.button !== 1) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.vue-flow__node')) return
  event.preventDefault()
  const selectedIds = selectedOrchestrateNodes.value.map(node => node.id)
  const targetIds = selectedIds.length > 0
    ? selectedIds
    : lastAddedNodeId.value
      ? [lastAddedNodeId.value]
      : undefined
  fitView({ nodes: targetIds, padding: targetIds ? 0.45 : 0.2, duration: 350 })
  ElMessage.info(targetIds ? `已定位 ${targetIds.length} 个节点` : '已适配全部节点')
}

function handleRemoveSelectedNodes(): void {
  const ids = selectedOrchestrateNodes.value.map(node => node.id)
  if (ids.length === 0) return
  ElMessageBox.confirm(`确定移除已选的 ${ids.length} 个节点及其关联连线？`, '批量移除节点', {
    type: 'warning',
    confirmButtonText: '批量移除',
    cancelButtonText: '取消',
  }).then(() => {
    removeNodesFromCanvas(ids)
    closeCanvasContextMenu()
    ElMessage.success(`已移除 ${ids.length} 个节点`)
  }).catch(() => undefined)
}

function handleRemoveContextNode(): void {
  const nodeId = canvasContextMenu.value.nodeId
  if (!nodeId) return
  const selectedCount = selectedOrchestrateNodes.value.length
  if (selectedCount > 1) {
    handleRemoveSelectedNodes()
    return
  }
  ElMessageBox.confirm('确定从画布移除该节点及其关联连线？', '移除节点', {
    type: 'warning',
    confirmButtonText: '移除',
    cancelButtonText: '取消',
  }).then(() => {
    removeNodeFromCanvas(nodeId)
    closeCanvasContextMenu()
    ElMessage.success('节点已移除')
  }).catch(() => undefined)
}

function handleLocateContextNode(): void {
  const nodeId = canvasContextMenu.value.nodeId
  if (!nodeId) return
  fitView({ nodes: [nodeId], padding: 0.45, duration: 350 })
  closeCanvasContextMenu()
}

function addRecommendedNextNode(item: WorkflowRecommendation): void {
  const source = contextNode.value
  if (!source) return

  const existingTarget = orchestrateNodes.value.find(node => getNodeModuleId(node) === item.module.id && node.id !== source.id)
  let targetId = existingTarget?.id
  if (!targetId) {
    targetId = addNodeToCanvas(item.module, 'module', {
      x: source.position.x + 300,
      y: source.position.y + (recommendedNextModules.value.findIndex(candidate => candidate.module.id === item.module.id) * 110),
    })
  }

  const edgeExists = orchestrateEdges.value.some(edge => edge.source === source.id && edge.target === targetId)
  if (!edgeExists) addEdgeToCanvas(source.id, targetId, item.recommended ? '推荐下一步' : '可选下一步')
  closeCanvasContextMenu()
  nextTick(() => setTimeout(() => fitView({ nodes: [source.id, targetId!], padding: 0.35, duration: 350 }), 40))
  ElMessage.success(existingTarget ? `已连接到「${item.module.label}」` : `已添加并连接「${item.module.label}」`)
}

function handleSelectionEnd(): void {
  setTimeout(syncOrchestrateSelection, 0)
}

/** 双击节点 → 编辑标签（仅编排模式） */
async function onNodeDoubleClick(event: NodeMouseEvent): Promise<void> {
  if (!isOrchestrateMode.value) return
  const node = orchestrateNodes.value.find(n => n.id === event.node.id)
  if (!node) return
  const currentLabel =
    (node.label as string | undefined) ||
    (node.data.label as string | undefined) ||
    ''
  try {
    const { value } = await ElMessageBox.prompt('请输入新的节点标签', '编辑标签', {
      inputValue: currentLabel,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValidator: (val: string) =>
        val.trim().length > 0 || '标签不能为空',
    })
    node.label = value
    node.data = { ...node.data, label: value }
  } catch {
    // 用户取消
  }
}

// ============================================================================
// 导航 & 布局
// ============================================================================

/** 信息卡片导航 */
function handleInfoCardNavigate(route: string): void {
  navigateTo(route)
}

/** 从模块弹窗触发编排该模块 */
async function handleOrchestrateModule(moduleId: string): Promise<void> {
  enterOrchestrateMode()
  isSystemFlowBased.value = true
  await nextTick()
  // 聚焦到对应模块节点
  const targetNode = orchestrateNodes.value.find(n => n.id === moduleId)
  if (targetNode) {
    setTimeout(() => {
      fitView({ nodes: [targetNode.id], padding: 0.45, duration: 300 })
    }, 100)
  }
}

/** 重置布局 */
async function handleResetLayout(): Promise<void> {
  resetLayout()
  await nextTick()
  setTimeout(() => {
    fitView({ padding: 0.2, duration: 300 })
  }, 50)
}

/** 自动适配视图 */
function handleFitView(): void {
  fitView({ padding: 0.2, duration: 300 })
}

// ============================================================================
// 模式切换
// ============================================================================

/** 当前编排是否基于系统流程图（true=复制自系统流程，false=新建空白编排） */
const isSystemFlowBased = ref<boolean>(false)

/** 工作台选择项目后，自动加载对应业务流线并进入编排画布 */
watch(
  () => props.initialFlowId,
  async (flowId) => {
    if (!flowId) return
    try {
      await loadBusinessFlow(flowId)
      isSystemFlowBased.value = false
      await nextTick()
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)
    } catch {
      ElMessage.error('加载项目流线失败')
    }
  },
  { immediate: true },
)

/** 进入编排模式 */
async function handleEnterOrchestrate(): Promise<void> {
  enterOrchestrateMode()
  isSystemFlowBased.value = true
  await nextTick()
  setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)
}

/** 新建空白编排 */
async function handleStartNewOrchestration(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将清空当前编排画布并开始全新编排，确定吗？',
      '新增编排',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  startNewOrchestration()
  isSystemFlowBased.value = false
  await nextTick()
  setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)
}

/** 退出编排模式 */
async function handleExitOrchestrate(): Promise<void> {
  exitOrchestrateMode()
  isSystemFlowBased.value = false
  await nextTick()
  setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)
}

// ============================================================================
// 业务流线管理
// ============================================================================

/** 流线列表 Drawer 可见性 */
const flowDrawerVisible = ref<boolean>(false)
/** 业务流线列表 */
const businessFlows = ref<BusinessFlowDTO[]>([])
/** 流线列表加载中 */
const flowListLoading = ref<boolean>(false)
/** 单次运行详情 Drawer */
const runDetailVisible = ref<boolean>(false)
const runDetailLoading = ref<boolean>(false)
const runDetail = ref<BusinessFlowRunDetailDTO | null>(null)

/** 加载业务流线列表 */
async function loadBusinessFlows(): Promise<void> {
  flowListLoading.value = true
  try {
    const res = await businessFlowApi.getList({ page: 1, pageSize: 100 })
    businessFlows.value = res.data || []
  } catch {
    ElMessage.error('加载业务流线列表失败')
  } finally {
    flowListLoading.value = false
  }
}

/** 打开流线列表 Drawer */
function openFlowDrawer(): void {
  flowDrawerVisible.value = true
  loadBusinessFlows()
}

async function openRunDetail(runId: number): Promise<void> {
  runDetailLoading.value = true
  runDetailVisible.value = true
  try {
    const res = await businessFlowApi.getRun(runId)
    if (!res.success || !res.data) throw new Error(res.error || '运行记录不存在')
    runDetail.value = res.data
  } catch (error) {
    runDetail.value = null
    ElMessage.error('加载运行详情失败: ' + (error as Error).message)
  } finally {
    runDetailLoading.value = false
  }
}

async function handleViewLatestRun(flow: BusinessFlowDTO): Promise<void> {
  try {
    const res = await businessFlowApi.getRuns(flow.id, 1)
    const latest = res.data?.[0]
    if (!latest) {
      ElMessage.info('该流线暂无运行记录')
      return
    }
    await openRunDetail(latest.id)
  } catch {
    ElMessage.error('加载运行记录失败')
  }
}

/** 加载已有流线到画布 */
async function handleLoadFlow(flow: BusinessFlowDTO): Promise<void> {
  try {
    await loadBusinessFlow(flow.id)
    isSystemFlowBased.value = false
    flowDrawerVisible.value = false
    ElMessage.success(`已加载流线: ${flow.name}`)
    await nextTick()
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)
  } catch {
    ElMessage.error('加载流线失败')
  }
}

/** 执行业务流线 */
async function handleExecuteFlow(flow: BusinessFlowDTO): Promise<void> {
  try {
    const res = await businessFlowApi.execute(flow.id)
    ElMessage.success(`流线「${flow.name}」执行完成，可查看逐节点结果`)
    if (res.data?.runId) await openRunDetail(res.data.runId)
    loadBusinessFlows()
  } catch {
    ElMessage.error('执行流线失败')
  }
}

/** 删除业务流线 */
async function handleDeleteFlow(flow: BusinessFlowDTO): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除流线「${flow.name}」？此操作不可恢复。`,
      '删除流线',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      }
    )
    await businessFlowApi.delete(flow.id)
    ElMessage.success('已删除')
    loadBusinessFlows()
  } catch {
    // 用户取消或删除失败
  }
}

// ============================================================================
// 保存流线对话框
// ============================================================================

/** 保存对话框可见性 */
const saveDialogVisible = ref<boolean>(false)
/** 新流线名称 */
const newFlowName = ref<string>('')
/** 新流线描述 */
const newFlowDescription = ref<string>('')
/** 保存中 */
const savingFlow = ref<boolean>(false)

/** 保存业务流线 */
async function handleSaveFlow(): Promise<void> {
  if (!newFlowName.value.trim()) {
    ElMessage.warning('请输入流线名称')
    return
  }
  savingFlow.value = true
  try {
    await saveBusinessFlow(newFlowName.value, newFlowDescription.value)
    ElMessage.success('业务流线已保存')
    saveDialogVisible.value = false
  } catch {
    ElMessage.error('保存流线失败')
  } finally {
    savingFlow.value = false
  }
}

// ============================================================================
// 编排分析与对话
// ============================================================================

/** 自定义编排保存对话框 */
const customFlowDialogVisible = ref<boolean>(false)
/** 自定义编排名称 */
const customFlowName = ref<string>('')
/** 自定义编排描述 */
const customFlowDesc = ref<string>('')
/** LLM 分析面板可见性 */
const analysisPanelVisible = ref<boolean>(false)
/** 对话输入框内容 */
const chatInputMessage = ref<string>('')
/** 可用 LLM 配置 */
const availableLlmConfigs = ref<Array<{ provider: string; label?: string; model?: string; enabled?: number }>>([])
const selectedLlmProvider = ref<string>('auto')
const selectedLlmModel = ref<string>('')

async function loadLlmConfigs(): Promise<void> {
  try {
    const res = await adminLLMApi.getList()
    availableLlmConfigs.value = (res.data || []).filter(item => item.enabled !== 0)
  } catch {
    availableLlmConfigs.value = []
  }
}

function handleLlmProviderChange(provider: string): void {
  selectedLlmModel.value = availableLlmConfigs.value.find(item => item.provider === provider)?.model || ''
}

/** 打开自定义编排保存对话框 */
function openCustomFlowDialog(): void {
  if (orchestrateNodes.value.length === 0) {
    ElMessage.warning('画布上没有节点，请先添加节点')
    return
  }
  customFlowName.value = orchestrationName.value || ''
  customFlowDesc.value = ''
  customFlowDialogVisible.value = true
}

/** 保存自定义编排 */
async function handleSaveCustomFlow(): Promise<void> {
  if (!customFlowName.value.trim()) {
    ElMessage.warning('请输入编排名称')
    return
  }
  savingFlow.value = true
  try {
    await saveAsCustomFlow(customFlowName.value, customFlowDesc.value)
    ElMessage.success(`自定义编排「${customFlowName.value}」已保存，需求文档已生成`)
    customFlowDialogVisible.value = false
  } catch (e) {
    ElMessage.error('保存自定义编排失败: ' + (e as Error).message)
  } finally {
    savingFlow.value = false
  }
}

/** 打开 LLM 分析面板 */
function openAnalysisPanel(): void {
  if (orchestrateNodes.value.length === 0) {
    ElMessage.warning('画布上没有节点，请先添加节点')
    return
  }
  loadLlmConfigs()
  // 确保需求文档已生成
  if (!orchestrationDoc.value) {
    generateRequirementDoc()
  }
  analysisPanelVisible.value = true
}

/** 执行 LLM 分析 */
async function handleAnalyze(): Promise<void> {
  try {
    await analyzeOrchestration({
      provider: selectedLlmProvider.value === 'auto' ? undefined : selectedLlmProvider.value,
      model: selectedLlmModel.value || undefined,
    })
    ElMessage.success('LLM 分析完成')
  } catch (e) {
    ElMessage.error('LLM 分析失败: ' + (e as Error).message)
  }
}

/** 发送对话消息 */
async function handleSendMessage(): Promise<void> {
  const msg = chatInputMessage.value.trim()
  if (!msg) return
  chatInputMessage.value = ''
  try {
    await chatWithLLM(msg, {
      provider: selectedLlmProvider.value === 'auto' ? undefined : selectedLlmProvider.value,
      model: selectedLlmModel.value || undefined,
    })
  } catch (e) {
    ElMessage.error('对话失败: ' + (e as Error).message)
  }
}

/** 确认编排方案 */
function handleConfirmPlan(): void {
  confirmPlan()
  ElMessage.success('编排方案已确认')
}

/** 执行流程优化 */
async function handleExecuteOptimization(): Promise<void> {
  try {
    const result = await executeOptimization()
    ElMessage.success(optimizationResult.value || '流程优化已执行')
    if (result?.runId) await openRunDetail(result.runId)
  } catch (e) {
    ElMessage.error('执行优化失败: ' + (e as Error).message)
  }
}

/** 重置编排方案 */
function handleResetPlan(): void {
  resetPlan()
  ElMessage.info('已重置编排方案确认状态')
}

// ============================================================================
// 图例数据
// ============================================================================

const legendItems = [
  { label: '内容运营中心', color: categoryColors['content-ops'].border },
  { label: '小红书流水线', color: categoryColors['xhs-pipeline'].border },
  { label: '社媒情报中心', color: categoryColors['radar'].border },
]

const edgeLegendItems = [
  { label: '前后流程（实线→）', color: edgeTypeConfig.sequential.color, dashed: false },
  { label: '数据引用（虚线→）', color: edgeTypeConfig.data.color, dashed: true },
  { label: '活跃数据流（动画）', color: '#4c8dff', dashed: true, animated: true },
]

// ============================================================================
// 工具函数
// ============================================================================

/** 格式化日期 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '从未'
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function formatRunValue(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) || '' } catch { return String(value) }
}
</script>

<template>
  <div class="flow-home" :class="{ 'orchestrate-mode': isOrchestrateMode }">
    <!-- 工具栏 -->
    <div class="flow-toolbar">
      <div class="toolbar-left">
        <h3 class="toolbar-title">
          <el-icon class="title-icon"><Share /></el-icon>
          {{ isOrchestrateMode ? (isSystemFlowBased ? '当前系统流程图 - 编排模式' : '业务编排画布') : '系统流程图' }}
          <el-tag
            v-if="isOrchestrateMode && isSystemFlowBased"
            size="small"
            type="warning"
            effect="dark"
            class="system-flow-badge"
          >
            当前系统流程
          </el-tag>
        </h3>
        <span class="toolbar-stats">{{ statsText }}</span>
      </div>
      <div class="toolbar-right">
        <!-- 适配视图按钮（两种模式都有） -->
        <el-button size="small" @click="handleFitView">
          <el-icon><FullScreen /></el-icon>
          <span class="btn-text">适配视图</span>
        </el-button>

        <!-- 普通模式：搜索 + 筛选按钮 + 重置布局 + 编排模式 -->
        <template v-if="!isOrchestrateMode">
          <el-input
            v-model="searchKeyword"
            size="small"
            placeholder="搜索模块/技能..."
            style="width: 180px"
            clearable
            :prefix-icon="SearchIcon"
          />
          <el-button-group class="filter-group">
            <el-button size="small" @click="showAll">全部</el-button>
            <el-button
              size="small"
              :type="showSkills ? 'primary' : 'info'"
              @click="toggleSkills"
            >
              技能
            </el-button>
            <el-button
              size="small"
              :type="showLlmOnly ? 'primary' : 'info'"
              @click="toggleLlmOnly"
            >
              大模型
            </el-button>
            <el-button
              size="small"
              :type="showInternalFlows ? 'primary' : 'info'"
              @click="toggleInternalFlows"
            >
              内部流程
            </el-button>
            <el-button
              size="small"
              :type="visibleCategories.has('content-ops') ? 'primary' : 'info'"
              @click="toggleCategory('content-ops')"
            >
              内容运营
            </el-button>
            <el-button
              size="small"
              :type="visibleCategories.has('xhs-pipeline') ? 'primary' : 'info'"
              @click="toggleCategory('xhs-pipeline')"
            >
              小红书流水线
            </el-button>
            <el-button
              size="small"
              :type="visibleCategories.has('radar') ? 'primary' : 'info'"
              @click="toggleCategory('radar')"
            >
              情报中心
            </el-button>
          </el-button-group>
          <el-button
            size="small"
            type="primary"
            plain
            @click="handleResetLayout"
          >
            <el-icon><Refresh /></el-icon>
            <span class="btn-text">重置布局</span>
          </el-button>
          <el-button size="small" type="warning" @click="handleEnterOrchestrate">
            <el-icon><EditPen /></el-icon>
            <span class="btn-text">编排模式</span>
          </el-button>
        </template>

        <!-- 编排模式：新增编排 + 保存编排 + LLM分析 + 确认方案 + 优化流程 + 我的流线 + 退出编排 -->
        <template v-else>
          <el-button
            size="small"
            type="info"
            @click="handleStartNewOrchestration"
          >
            <el-icon><Plus /></el-icon>
            <span class="btn-text">新增编排</span>
          </el-button>
          <el-button
            size="small"
            type="success"
            @click="openCustomFlowDialog"
          >
            <el-icon><FolderOpened /></el-icon>
            <span class="btn-text">保存编排</span>
          </el-button>
          <el-button
            size="small"
            type="primary"
            @click="openAnalysisPanel"
          >
            <el-icon><ChatLineSquare /></el-icon>
            <span class="btn-text">LLM分析</span>
          </el-button>
          <el-button
            size="small"
            :type="planConfirmed ? 'success' : 'warning'"
            :disabled="!llmAnalysis"
            @click="handleConfirmPlan"
          >
            <el-icon><Select /></el-icon>
            <span class="btn-text">确认方案</span>
          </el-button>
          <el-button
            size="small"
            type="danger"
            :disabled="!planConfirmed"
            :loading="optimizingFlow"
            @click="handleExecuteOptimization"
          >
            <el-icon><MagicStick /></el-icon>
            <span class="btn-text">优化流程</span>
          </el-button>
          <el-button size="small" @click="openFlowDrawer">
            <el-icon><List /></el-icon>
            <span class="btn-text">我的流线</span>
          </el-button>
          <el-button
            v-if="selectedOrchestrateNodes.length > 0"
            size="small"
            type="danger"
            plain
            @click="handleRemoveSelectedNodes"
          >
            <el-icon><Delete /></el-icon>
            <span class="btn-text">移除已选 {{ selectedOrchestrateNodes.length }}</span>
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="handleExitOrchestrate"
          >
            <el-icon><Close /></el-icon>
            <span class="btn-text">退出编排</span>
          </el-button>
        </template>
      </div>
    </div>

    <!-- 主体区域 -->
    <div class="flow-body">
      <!-- 编排模式侧边栏 -->
      <div v-if="isOrchestrateMode" class="orchestrate-sidebar">
        <!-- 模块列表 -->
        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <el-icon><Grid /></el-icon>
            <span>模块</span>
          </div>
          <div class="sidebar-list">
            <div
              v-for="mod in moduleConfigs"
              :key="mod.id"
              class="sidebar-item"
              draggable="true"
              @dragstart="onDragStart($event, mod, 'module')"
            >
              <div class="item-name">{{ mod.label }}</div>
              <div class="item-desc">{{ mod.description }}</div>
            </div>
          </div>
        </div>

        <!-- 技能列表 -->
        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <el-icon><Cpu /></el-icon>
            <span>技能</span>
          </div>
          <div class="sidebar-list">
            <div
              v-for="skill in allSkills"
              :key="skill.name"
              class="sidebar-item"
              draggable="true"
              @dragstart="onDragStart($event, skill, 'skill')"
            >
              <div class="item-name">{{ skill.name }}</div>
              <div class="item-desc">{{ skill.description }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Vue Flow 画布 -->
      <div
        class="flow-canvas"
        v-loading="!layoutInitialized"
        @drop="onDrop"
        @dragover="onDragOver"
        @dblclick="handleCanvasDoubleClick"
        @click="closeCanvasContextMenu"
      >
        <VueFlow
          :key="isOrchestrateMode ? 'orchestrate' : 'normal'"
          :id="FLOW_ID"
          :nodes="displayNodes"
          :edges="displayEdges"
          :node-types="nodeTypes"
          :fit-view-on-init="true"
          :default-zoom="0.85"
          :min-zoom="0.3"
          :max-zoom="2"
          :snap-to-grid="true"
          :snap-grid="[16, 16]"
          :connection-radius="30"
          selection-key-code="Shift"
          multi-selection-key-code="Control"
          delete-key-code="Backspace"
          :select-nodes-on-drag="true"
          @node-click="handleNodeClick"
          @node-drag-stop="handleNodeDragStop"
          @connect="onConnect"
          @node-context-menu="onNodeContextMenu"
          @node-double-click="onNodeDoubleClick"
          @selection-end="handleSelectionEnd"
        >
          <Background :gap="20" :size="1" pattern-color="var(--color-border-base)" />

          <Controls position="bottom-left" :show-interactive="false" />
        </VueFlow>
        <div
          v-if="isOrchestrateMode && canvasContextMenu.visible"
          class="canvas-context-menu"
          :style="{ left: `${canvasContextMenu.x}px`, top: `${canvasContextMenu.y}px` }"
          @click.stop
        >
          <div class="context-menu-title">
            {{ selectedOrchestrateNodes.length > 1 ? `已选 ${selectedOrchestrateNodes.length} 个节点` : '节点操作' }}
          </div>
          <template v-if="selectedOrchestrateNodes.length <= 1 && recommendedNextModules.length">
            <div class="context-menu-section">推荐下一步</div>
            <button
              v-for="item in recommendedNextModules"
              :key="`recommended-${item.module.id}`"
              type="button"
              @click="addRecommendedNextNode(item)"
            >
              <strong>{{ item.module.label }}</strong>
              <small>{{ item.module.description }}</small>
            </button>
          </template>
          <details v-if="selectedOrchestrateNodes.length <= 1 && optionalNextModules.length" class="context-menu-more">
            <summary>更多可选模块</summary>
            <button
              v-for="item in optionalNextModules"
              :key="`optional-${item.module.id}`"
              type="button"
              @click="addRecommendedNextNode(item)"
            >{{ item.module.label }}</button>
          </details>
          <div class="context-menu-section">节点管理</div>
          <button type="button" @click="handleLocateContextNode">定位节点</button>
          <button type="button" @click="handleRemoveContextNode">
            {{ selectedOrchestrateNodes.length > 1 ? '移除已选节点' : '移除当前节点' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 图例（仅普通模式） -->
    <div v-if="!isOrchestrateMode" class="flow-legend">
      <div class="legend-group">
        <div
          v-for="item in legendItems"
          :key="item.label"
          class="legend-item"
        >
          <span
            class="legend-dot"
            :style="{ backgroundColor: item.color }"
          ></span>
          <span class="legend-text">{{ item.label }}</span>
        </div>
      </div>
      <div class="legend-divider"></div>
      <div class="legend-group">
        <div
          v-for="item in edgeLegendItems"
          :key="item.label"
          class="legend-item"
        >
          <span
            class="legend-line"
            :class="{ 'legend-line-dashed': item.dashed, 'legend-line-animated': item.animated }"
            :style="{ borderColor: item.color }"
          ></span>
          <span class="legend-text">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <!-- 提示信息 -->
    <div class="flow-hint">
      <el-icon><InfoFilled /></el-icon>
      <span v-if="!isOrchestrateMode">
        点击节点查看详情 · 拖拽节点调整布局 · 滚轮缩放
      </span>
      <span v-else>
        拖拽模块/技能到画布 · Shift 框选或 Ctrl 多选 · 中键双击智能定位 · 右键查看节点操作 · 双击编辑标签
      </span>
    </div>

    <!-- 模块信息卡片弹窗 -->
    <ModuleInfoCard
      v-model:visible="infoCardVisible"
      :module="selectedModule"
      @navigate="handleInfoCardNavigate"
      @orchestrate="handleOrchestrateModule"
    />

    <!-- 业务流线列表 Drawer -->
    <el-drawer
      v-model="flowDrawerVisible"
      title="我的业务流线"
      size="480px"
      direction="rtl"
    >
      <div v-loading="flowListLoading" class="flow-drawer-content">
        <div v-if="businessFlows.length === 0 && !flowListLoading" class="empty-tip">
          <el-icon :size="32"><FolderOpened /></el-icon>
          <p>暂无已保存的业务流线</p>
        </div>
        <el-card
          v-for="flow in businessFlows"
          :key="flow.id"
          class="flow-card"
          shadow="hover"
        >
          <div class="flow-card-header">
            <span class="flow-name">{{ flow.name }}</span>
            <el-tag size="small" :type="flow.status === 'running' ? 'success' : 'info'">
              {{ flow.status || 'idle' }}
            </el-tag>
          </div>
          <div class="flow-desc">{{ flow.description || '无描述' }}</div>
          <div class="flow-meta">
            <span class="meta-item">
              <el-icon :size="12"><VideoPlay /></el-icon>
              运行 {{ flow.runCount }} 次
            </span>
            <span class="meta-item">
              <el-icon :size="12"><Clock /></el-icon>
              {{ formatDate(flow.lastRunAt) }}
            </span>
          </div>
          <div class="flow-actions">
            <el-button
              size="small"
              type="primary"
              @click="handleLoadFlow(flow)"
            >
              加载
            </el-button>
            <el-button
              size="small"
              type="success"
              @click="handleExecuteFlow(flow)"
            >
              执行
            </el-button>
            <el-button
              v-if="flow.runCount > 0"
              size="small"
              @click="handleViewLatestRun(flow)"
            >
              查看结果
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="handleDeleteFlow(flow)"
            >
              删除
            </el-button>
          </div>
        </el-card>
      </div>
    </el-drawer>

    <!-- 运行详情 Drawer：展示整体状态及每个节点的输入/输出/耗时 -->
    <el-drawer
      v-model="runDetailVisible"
      title="运行详情"
      size="560px"
      direction="rtl"
    >
      <div v-loading="runDetailLoading" class="run-detail-panel">
        <template v-if="runDetail">
          <div class="run-summary-card">
            <div class="run-summary-header">
              <span>运行 #{{ runDetail.id }}</span>
              <el-tag :type="runDetail.status === 'completed' ? 'success' : runDetail.status === 'failed' ? 'danger' : 'warning'">
                {{ runDetail.status === 'completed' ? '已完成' : runDetail.status === 'failed' ? '失败' : runDetail.status }}
              </el-tag>
            </div>
            <div class="run-summary-meta">
              <span>开始：{{ formatDate(runDetail.startedAt) }}</span>
              <span>耗时：{{ runDetail.durationMs ?? 0 }} ms</span>
              <span>步骤：{{ runDetail.steps.length }}</span>
            </div>
            <div v-if="runDetail.error" class="run-error">{{ runDetail.error }}</div>
          </div>

          <el-timeline class="run-timeline">
            <el-timeline-item
              v-for="(step, index) in runDetail.steps"
              :key="`${step.nodeId}-${index}`"
              :type="step.status === 'completed' ? 'success' : step.status === 'failed' ? 'danger' : 'primary'"
              :timestamp="`${step.durationMs ?? 0} ms`"
            >
              <div class="run-step-card">
                <div class="run-step-header">
                  <span class="run-step-index">{{ index + 1 }}</span>
                  <span class="run-step-label">{{ step.nodeLabel }}</span>
                  <el-tag size="small" :type="step.status === 'completed' ? 'success' : step.status === 'failed' ? 'danger' : 'info'">
                    {{ step.status === 'completed' ? '成功' : step.status === 'failed' ? '失败' : step.status }}
                  </el-tag>
                </div>
                <div v-if="step.provider || step.model" class="run-step-llm">
                  LLM：{{ step.provider || '未知供应商' }} · {{ step.model || '未知模型' }}
                </div>
                <pre v-if="step.result !== undefined" class="run-step-result">{{ formatRunValue(step.result) }}</pre>
                <div v-if="step.error" class="run-error">{{ step.error }}</div>
              </div>
            </el-timeline-item>
          </el-timeline>
        </template>
        <div v-else-if="!runDetailLoading" class="empty-tip">暂无运行详情</div>
      </div>
    </el-drawer>

    <!-- 保存业务流线对话框 -->
    <el-dialog
      v-model="saveDialogVisible"
      title="保存业务流线"
      width="420px"
    >
      <el-form label-width="60px">
        <el-form-item label="名称">
          <el-input
            v-model="newFlowName"
            placeholder="请输入流线名称"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="newFlowDescription"
            type="textarea"
            :rows="3"
            placeholder="可选，简要描述该流线的用途"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="saveDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="savingFlow"
          @click="handleSaveFlow"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 自定义编排保存对话框 -->
    <el-dialog
      v-model="customFlowDialogVisible"
      title="保存为自定义编排"
      width="480px"
    >
      <el-form label-width="80px">
        <el-form-item label="编排名称">
          <el-input
            v-model="customFlowName"
            placeholder="请输入编排名称"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="customFlowDesc"
            type="textarea"
            :rows="3"
            placeholder="可选，描述编排变更内容"
            maxlength="300"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <div class="custom-flow-hint">
        <el-icon><InfoFilled /></el-icon>
        <span>保存后将自动生成需求文档，可用于后续 LLM 分析</span>
      </div>
      <template #footer>
        <el-button @click="customFlowDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="savingFlow"
          @click="handleSaveCustomFlow"
        >
          保存并生成需求文档
        </el-button>
      </template>
    </el-dialog>

    <!-- LLM 分析与对话面板 -->
    <el-drawer
      v-model="analysisPanelVisible"
      title="编排分析 - LLM 智能助手"
      size="520px"
      direction="rtl"
      :close-on-click-modal="false"
    >
      <div class="analysis-panel">
        <!-- 编排信息 -->
        <div class="analysis-section">
          <div class="analysis-section-title">
            <span class="section-title-dot" style="background: var(--color-primary)"></span>
            <span>编排信息</span>
          </div>
          <div class="orchestration-info">
            <div class="info-row">
              <span class="info-label">编排名称：</span>
              <span class="info-value">{{ orchestrationName || '未命名' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">节点数量：</span>
              <span class="info-value">{{ orchestrateNodes.length }} 个</span>
            </div>
            <div class="info-row">
              <span class="info-label">连线数量：</span>
              <span class="info-value">{{ orchestrateEdges.length }} 条</span>
            </div>
          </div>
        </div>

        <!-- 需求文档 -->
        <div v-if="orchestrationDoc" class="analysis-section">
          <div class="analysis-section-title">
            <span class="section-title-dot" style="background: var(--color-success)"></span>
            <span>需求文档</span>
          </div>
          <div class="requirement-doc">
            <pre>{{ orchestrationDoc }}</pre>
          </div>
        </div>

        <!-- LLM 分析结果 -->
        <div class="analysis-section">
          <div class="analysis-section-title">
            <span class="section-title-dot" style="background: var(--color-primary)"></span>
            <span>LLM 分析</span>
            <el-select
              v-model="selectedLlmProvider"
              size="small"
              style="width: 155px; margin-left: auto"
              :disabled="analyzingOrchestration || chattingWithLLM"
              @change="handleLlmProviderChange"
            >
              <el-option label="自动选择" value="auto" />
              <el-option
                v-for="llm in availableLlmConfigs"
                :key="llm.provider"
                :label="`${llm.label || llm.provider} · ${llm.model || '默认模型'}`"
                :value="llm.provider"
              />
            </el-select>
            <el-select
              v-if="selectedLlmProvider !== 'auto'"
              v-model="selectedLlmModel"
              size="small"
              style="width: 150px"
              filterable
              allow-create
              default-first-option
              placeholder="选择模型"
              :disabled="analyzingOrchestration || chattingWithLLM"
            >
              <el-option
                v-if="selectedLlmModel"
                :label="selectedLlmModel"
                :value="selectedLlmModel"
              />
            </el-select>
            <el-button
              size="small"
              type="primary"
              :loading="analyzingOrchestration"
              @click="handleAnalyze"
            >
              {{ analyzingOrchestration ? '分析中...' : (llmAnalysis ? '重新分析' : '开始分析') }}
            </el-button>
          </div>
          <div v-if="!llmAnalysis && !analyzingOrchestration" class="analysis-empty">
            <span>点击"开始分析"按钮，调用 LLM 对当前编排方案进行智能分析</span>
          </div>
          <div v-if="llmAnalysis" class="llm-analysis-result">
            <div class="llm-runtime-meta">
              <el-tag size="small" type="info">
                实际模型：{{ llmAnalysisProvider || 'none' }}{{ llmAnalysisModel ? ` · ${llmAnalysisModel}` : '' }}
              </el-tag>
              <span v-if="llmAnalysisDuration !== null">耗时 {{ llmAnalysisDuration }} ms</span>
            </div>
            <div class="analysis-text">{{ llmAnalysis }}</div>
            <div v-if="llmIssues.length > 0" class="analysis-issues">
              <div class="issues-title">存在问题</div>
              <div v-for="(issue, i) in llmIssues" :key="i" class="issue-item">
                <span class="issue-dot"></span>
                <span>{{ issue }}</span>
              </div>
            </div>
            <div v-if="llmSuggestions.length > 0" class="analysis-suggestions">
              <div class="suggestions-title">优化建议</div>
              <div v-for="(sug, i) in llmSuggestions" :key="i" class="suggestion-item">
                <span class="suggestion-dot"></span>
                <span>{{ sug }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 对话区域 -->
        <div class="analysis-section analysis-chat-section">
          <div class="analysis-section-title">
            <span class="section-title-dot" style="background: var(--color-info)"></span>
            <span>对话讨论</span>
            <el-tag v-if="planConfirmed" size="small" type="success" style="margin-left: auto">已确认</el-tag>
          </div>
          <div class="chat-messages">
            <div v-if="chatMessages.length === 0" class="chat-empty">
              <span>与 LLM 讨论编排方案的合理性，提出您的疑问或需求</span>
            </div>
            <div
              v-for="(msg, idx) in chatMessages"
              :key="idx"
              class="chat-message"
              :class="msg.role"
            >
              <div class="chat-message-role">
                {{ msg.role === 'user' ? '我' : 'LLM' }}
              </div>
              <div class="chat-message-content">{{ msg.content }}</div>
            </div>
          </div>
          <div class="chat-input-area">
            <el-input
              v-model="chatInputMessage"
              type="textarea"
              :rows="2"
              placeholder="输入消息与 LLM 讨论..."
              :disabled="chattingWithLLM"
              @keyup.ctrl.enter="handleSendMessage"
            />
            <el-button
              type="primary"
              :loading="chattingWithLLM"
              :disabled="!chatInputMessage.trim()"
              @click="handleSendMessage"
            >
              发送
            </el-button>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="analysis-section analysis-actions">
          <el-button
            v-if="llmAnalysis && !planConfirmed"
            type="warning"
            @click="handleConfirmPlan"
          >
            确认方案
          </el-button>
          <el-button
            v-if="planConfirmed"
            type="danger"
            :loading="optimizingFlow"
            @click="handleExecuteOptimization"
          >
            优化流程
          </el-button>
          <el-button
            v-if="planConfirmed"
            @click="handleResetPlan"
          >
            重置确认
          </el-button>
          <div v-if="optimizationResult" class="optimization-result">
            {{ optimizationResult }}
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.flow-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 600px;
  background: var(--color-bg-page);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
}

/* 工具栏 */
.flow-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-light);
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toolbar-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-icon {
  color: var(--color-primary);
}

.toolbar-stats {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.system-flow-badge {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-text {
  margin-left: 4px;
}

.filter-group {
  margin: 0 4px;
}

/* 主体区域 */
.flow-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 400px;
}

/* 编排模式侧边栏 */
.orchestrate-sidebar {
  width: 240px;
  flex-shrink: 0;
  background: var(--color-bg-card);
  border-right: 1px solid var(--color-border-light);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
}

.sidebar-section + .sidebar-section {
  border-top: 1px solid var(--color-border-light);
}

.sidebar-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border-light);
  position: sticky;
  top: 0;
  z-index: 1;
}

.sidebar-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}

.sidebar-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: grab;
  transition: background 0.15s ease;
  border: 1px solid transparent;
}

.sidebar-item:hover {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
}

.sidebar-item:active {
  cursor: grabbing;
}

.item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.item-desc {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 画布 */
.flow-canvas {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.canvas-context-menu {
  position: fixed;
  z-index: 30;
  width: 260px;
  max-height: min(520px, calc(100vh - 24px));
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  background: var(--color-bg-card);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.16));
}

.canvas-context-menu button {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.canvas-context-menu button:hover {
  background: var(--color-primary-soft);
}

.canvas-context-menu button strong, .canvas-context-menu button small { display: block; }
.canvas-context-menu button small { overflow: hidden; margin-top: 2px; color: var(--color-text-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.context-menu-section { padding: 8px 10px 3px; color: var(--color-text-secondary); font-size: 10px; font-weight: 700; letter-spacing: .06em; }
.context-menu-more { border-top: 1px solid var(--color-border-light); border-bottom: 1px solid var(--color-border-light); }
.context-menu-more summary { padding: 7px 10px; color: var(--color-text-secondary); cursor: pointer; font-size: 11px; }

.context-menu-title {
  padding: 5px 10px 7px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-secondary);
  font-size: 11px;
}

.run-detail-panel {
  min-height: 100%;
}

.run-summary-card {
  padding: 14px;
  margin-bottom: 18px;
  border: 1px solid var(--color-border-light);
  border-radius: 10px;
  background: var(--color-bg-subtle);
}

.run-summary-header,
.run-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-summary-header {
  justify-content: space-between;
  color: var(--color-text-primary);
  font-weight: 600;
}

.run-summary-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.run-timeline {
  padding: 0 8px;
}

.run-step-card {
  padding: 10px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  background: var(--color-bg-card);
}

.run-step-index {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  text-align: center;
  line-height: 20px;
  font-size: 11px;
}

.run-step-label {
  flex: 1;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.run-step-llm {
  margin-top: 8px;
  color: var(--color-primary);
  font-size: 11px;
}

.run-step-result {
  max-height: 220px;
  margin: 8px 0 0;
  padding: 8px;
  overflow: auto;
  border-radius: 6px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 11px;
}

.run-error {
  margin-top: 8px;
  color: var(--color-danger);
  font-size: 12px;
}

.llm-runtime-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--color-text-secondary);
  font-size: 11px;
}

/* 图例 */
.flow-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border-light);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.legend-group {
  display: flex;
  align-items: center;
  gap: 16px;
}

.legend-divider {
  width: 1px;
  height: 16px;
  background: var(--color-border-base);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-line {
  width: 24px;
  height: 0;
  border-top: 2px solid;
  flex-shrink: 0;
  position: relative;
}

.legend-line-dashed {
  border-top-style: dashed;
}

.legend-line-animated {
  animation: legend-dash 0.5s linear infinite;
}

@keyframes legend-dash {
  to {
    border-top-color: transparent;
  }
}

.legend-text {
  font-size: 12px;
  color: var(--color-text-regular);
}

/* 提示信息 */
.flow-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  background: var(--color-bg-card);
  border-top: 1px solid var(--color-border-light);
  font-size: 12px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.flow-hint .el-icon {
  color: var(--color-primary);
}

/* 流线 Drawer 内容 */
.flow-drawer-content {
  padding: 0 4px;
}

.empty-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--color-text-secondary);
}

.empty-tip p {
  margin: 0;
  font-size: 14px;
}

.flow-card {
  margin-bottom: 12px;
}

.flow-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.flow-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.flow-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
  line-height: 1.5;
}

.flow-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.flow-actions {
  display: flex;
  gap: 8px;
}

/* 自定义编排保存提示 */
.custom-flow-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 12px;
  background: var(--color-primary-soft);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-primary);
}

.custom-flow-hint .el-icon {
  color: var(--color-primary);
}

/* 编排分析面板 */
.analysis-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 4px;
}

.analysis-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.analysis-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.section-title-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.orchestration-info {
  background: var(--color-bg-subtle);
  border-radius: 8px;
  padding: 12px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
}

.info-label {
  color: var(--color-text-secondary);
  min-width: 80px;
}

.info-value {
  color: var(--color-text-primary);
  font-weight: 500;
}

.requirement-doc {
  background: var(--color-bg-subtle);
  border-radius: 8px;
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.requirement-doc pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-regular);
  font-family: 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.analysis-empty {
  padding: 20px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 13px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
}

.llm-analysis-result {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.analysis-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-regular);
  background: var(--color-bg-subtle);
  border-radius: 8px;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.analysis-issues,
.analysis-suggestions {
  background: var(--color-bg-subtle);
  border-radius: 8px;
  padding: 12px;
}

.issues-title,
.suggestions-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.issues-title {
  color: var(--color-danger);
}

.suggestions-title {
  color: var(--color-success);
}

.issue-item,
.suggestion-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-regular);
  padding: 4px 0;
}

.issue-dot,
.suggestion-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}

.issue-dot {
  background: var(--color-danger);
}

.suggestion-dot {
  background: var(--color-success);
}

/* 对话区域 */
.analysis-chat-section {
  display: flex;
  flex-direction: column;
}

.chat-messages {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  min-height: 120px;
}

.chat-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 90%;
}

.chat-message.user {
  align-self: flex-end;
}

.chat-message.assistant {
  align-self: flex-start;
}

.chat-message-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.chat-message.user .chat-message-role {
  text-align: right;
  color: var(--color-primary);
}

.chat-message.assistant .chat-message-role {
  color: var(--color-primary);
}

.chat-message-content {
  font-size: 13px;
  line-height: 1.5;
  padding: 8px 12px;
  border-radius: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-message.user .chat-message-content {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.chat-message.assistant .chat-message-content {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-light);
}

.chat-input-area {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.chat-input-area .el-input {
  flex: 1;
}

.analysis-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-light);
}

.optimization-result {
  width: 100%;
  padding: 10px;
  background: var(--color-success-soft);
  border-radius: 8px;
  font-size: 13px;
  color: var(--color-success);
  margin-top: 8px;
}
</style>

<style>
/* Vue Flow 全局样式覆盖 */

/* 节点选中样式 */
.vue-flow__node.selected .module-node {
  box-shadow: 0 0 0 2px var(--color-primary), var(--box-shadow-raised);
}

/* 边样式 */
.vue-flow__edge-path {
  stroke-width: 2;
}

.vue-flow__edge.animated .vue-flow__edge-path {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}

@keyframes dashdraw {
  to {
    stroke-dashoffset: -10;
  }
}

/* 边标签 */
.vue-flow__edge-textwrapper {
  font-size: 11px;
}

.vue-flow__edge-text {
  fill: var(--color-text-secondary);
}

/* Controls 控件 */
.vue-flow__controls {
  box-shadow: var(--box-shadow-raised-sm);
  border-radius: 8px;
  overflow: hidden;
}

.vue-flow__controls-button {
  border: none;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-bg-card);
}

.vue-flow__controls-button:hover {
  background: var(--color-bg-card-hover);
}

/* Background 网格 */
.vue-flow__background {
  background: var(--color-bg-page);
}

/* 编排模式默认节点样式 */
.orchestrate-mode .vue-flow__node-default {
  font-size: 12px;
  border: 2px solid var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  border-radius: 8px;
  padding: 8px 16px;
  font-weight: 600;
  box-shadow: var(--box-shadow-raised-sm);
}

.orchestrate-mode .vue-flow__node-default.selected {
  box-shadow: 0 0 0 2px var(--color-primary), var(--box-shadow-raised);
}

/* 编排模式 Handle 样式 */
.orchestrate-mode .vue-flow__handle {
  width: 10px;
  height: 10px;
  background: var(--color-primary);
  border: 2px solid var(--color-bg-card);
  border-radius: 50%;
}
</style>
