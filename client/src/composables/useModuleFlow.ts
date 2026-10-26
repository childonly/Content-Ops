/**
 * useModuleFlow — 流程图数据管理 Composable
 *
 * 职责：
 *   1. 从 moduleConfigs 生成 Vue Flow 节点和连线
 *   2. 使用 dagre 自动布局排列节点
 *   3. 管理节点位置持久化（localStorage）
 *   4. 提供节点点击回调
 */

import { ref, computed, onMounted } from 'vue'
import dagre from 'dagre'
import {
  moduleConfigs,
  moduleEdges,
  type ModuleConfig,
  type ModuleCategory,
  type ModuleSkill,
} from '@/config/moduleConfigs'
import {
  businessFlowApi,
  orchestrationApi,
  type OrchestrationChatMessage,
  type BusinessFlowExecutionResultDTO,
} from '@/api'

// ============================================================================
// 类型定义（简化 Vue Flow 的深层泛型，避免 TS2589）
// ============================================================================

/** 简化的节点类型，避免 Vue Flow Node 泛型递归过深 */
interface FlowNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  selected?: boolean
  /** 节点标签（编排模式的默认节点类型使用） */
  label?: string
}

/**
 * VueFlow 节点事件参数的最小接口
 * 兼容 VueFlow 的 GraphNode 和内部 FlowNode，避免 label 类型冲突
 */
interface NodeInput {
  id: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
}

/** 简化的边类型 */
interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  animated?: boolean
  type?: string
  /** 使用 Record 类型以兼容 VueFlow 的 Styles 类型（需要索引签名） */
  style?: Record<string, string | number>
  labelStyle?: Record<string, string | number>
  labelBgStyle?: Record<string, string | number>
  /** 箭头终点标记（使用 any 兼容 VueFlow EdgeMarkerType） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markerEnd?: any
}

// ============================================================================
// 常量
// ============================================================================

const NODE_WIDTH = 280
const NODE_HEIGHT = 200
const LAYOUT_STORAGE_KEY = 'content-ops-flow-layout'

// ============================================================================
// dagre 自动布局
// ============================================================================

/** 使用 dagre 计算节点位置 */
function layoutWithDagre(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',     // 从左到右
    ranksep: 100,      // 层间距
    nodesep: 60,       // 节点间距
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}))

  // 添加节点
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  // 添加边
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  // 执行布局
  dagre.layout(g)

  // 应用位置
  return nodes.map((node): FlowNode => {
    const positioned = g.node(node.id)
    if (positioned) {
      return {
        ...node,
        position: {
          x: positioned.x - NODE_WIDTH / 2,
          y: positioned.y - NODE_HEIGHT / 2,
        },
      }
    }
    return node
  })
}

// ============================================================================
// 位置持久化
// ============================================================================

/** 从 localStorage 加载保存的布局 */
function loadSavedLayout(): Record<string, { x: number; y: number }> | null {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch {
    // 解析失败忽略
  }
  return null
}

/** 保存布局到 localStorage */
function saveLayout(nodes: FlowNode[]): void {
  const layout: Record<string, { x: number; y: number }> = {}
  for (const node of nodes) {
    layout[node.id] = { x: node.position.x, y: node.position.y }
  }
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // 存储失败忽略
  }
}

// ============================================================================
// Composable
// ============================================================================

export interface UseModuleFlowOptions {
  /** 节点内"进入详情"按钮的导航回调 */
  onNavigate?: (route: string) => void
}

export function useModuleFlow(options?: UseModuleFlowOptions) {
  // Vue Flow 节点
  const nodes = ref<FlowNode[]>([])
  // Vue Flow 边
  const edges = ref<FlowEdge[]>([])
  // 当前选中的模块（用于信息卡片弹窗）
  const selectedModule = ref<ModuleConfig | null>(null)
  // 信息卡片弹窗可见性
  const infoCardVisible = ref<boolean>(false)
  // 布局是否已初始化
  const layoutInitialized = ref<boolean>(false)

  // ============================================================================
  // 筛选状态
  // ============================================================================

  /** 是否显示 skill 徽章 */
  const showSkills = ref<boolean>(true)
  /** 是否显示模块节点 */
  const showModules = ref<boolean>(true)
  /** 可见的分类集合 */
  const visibleCategories = ref<Set<ModuleCategory>>(
    new Set<ModuleCategory>(['content-ops', 'xhs-pipeline', 'radar'])
  )
  /** 搜索关键词 */
  const searchKeyword = ref<string>('')
  /** 是否仅显示配置了大模型的模块 */
  const showLlmOnly = ref<boolean>(false)
  /** 是否显示模块内部流程 */
  const showInternalFlows = ref<boolean>(false)

  // ============================================================================
  // 编排模式状态
  // ============================================================================

  /** 是否为编排模式 */
  const isOrchestrateMode = ref<boolean>(false)
  /** 编排画布的节点 */
  const orchestrateNodes = ref<FlowNode[]>([])
  /** 编排画布的边 */
  const orchestrateEdges = ref<FlowEdge[]>([])
  /** 最近添加的节点，用于画布智能定位 */
  const lastAddedNodeId = ref<string | null>(null)

  // ============================================================================
  // 编排分析状态（LLM 分析与对话）
  // ============================================================================

  /** 编排名称（保存自定义编排时命名） */
  const orchestrationName = ref<string>('')
  /** 需求文档内容（描述编排变更内容） */
  const orchestrationDoc = ref<string>('')
  /** LLM 分析结果文本 */
  const llmAnalysis = ref<string>('')
  /** LLM 分析的问题列表 */
  const llmIssues = ref<string[]>([])
  /** LLM 分析的优化建议列表 */
  const llmSuggestions = ref<string[]>([])
  /** 最近一次分析实际使用的 LLM */
  const llmAnalysisProvider = ref<string>('')
  const llmAnalysisModel = ref<string>('')
  const llmAnalysisDuration = ref<number | null>(null)
  /** 编排对话消息列表 */
  const chatMessages = ref<OrchestrationChatMessage[]>([])
  /** 编排分析加载中 */
  const analyzingOrchestration = ref<boolean>(false)
  /** 对话发送中 */
  const chattingWithLLM = ref<boolean>(false)
  /** 编排方案是否已确认 */
  const planConfirmed = ref<boolean>(false)
  /** 流程优化执行中 */
  const optimizingFlow = ref<boolean>(false)
  /** 流程优化执行结果 */
  const optimizationResult = ref<string>('')
  /** 最近一次业务流线执行详情 */
  const lastExecutionResult = ref<BusinessFlowExecutionResultDTO | null>(null)

  /**
   * 初始化节点和边
   *
   * 1. 从 moduleConfigs 生成节点
   * 2. 检查 localStorage 是否有保存的布局
   * 3. 有保存布局则用保存的，否则用 dagre 自动布局
   */
  function initFlow(): void {
    // 生成节点
    const rawNodes: FlowNode[] = moduleConfigs.map(config => ({
      id: config.id,
      type: 'module',  // 自定义节点类型名
      position: { x: 0, y: 0 },  // 初始位置，后续由 dagre 或 savedLayout 覆盖
      data: {
        config,
        // 将导航回调注入到节点数据中，供 ModuleNode 直接调用
        navigate: options?.onNavigate,
        // 将内部流程显示状态注入到节点数据中
        showInternalFlows: showInternalFlows.value,
      },
      // 节点初始不选中
      selected: false,
    }))

    // 生成边（带箭头和类型样式）
    const rawEdges: FlowEdge[] = moduleEdges.map(edge => {
      const isSequential = edge.edgeType !== 'data'
      const strokeColor = isSequential ? '#4361ee' : '#94a3b8'
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: edge.animated || false,
        type: 'smoothstep',
        style: { stroke: strokeColor, strokeWidth: 2 },
        labelStyle: { fontSize: '11px', fill: '#6c757d' },
        labelBgStyle: { fill: '#f8f9fc' },
        markerEnd: {
          type: 'arrowclosed',
          width: 14,
          height: 14,
          color: strokeColor,
        },
      }
    })

    // 尝试加载保存的布局
    const savedLayout = loadSavedLayout()

    if (savedLayout) {
      // 使用保存的布局
      nodes.value = rawNodes.map((node): FlowNode => ({
        ...node,
        position: savedLayout[node.id] || node.position,
      }))
    } else {
      // 使用 dagre 自动布局
      nodes.value = layoutWithDagre(rawNodes, rawEdges)
    }

    edges.value = rawEdges
    layoutInitialized.value = true
  }

  /**
   * 节点点击事件处理器
   *
   * 点击节点主体 → 弹出模块信息卡片
   */
  function onNodeClick(node: NodeInput): void {
    const config = moduleConfigs.find(m => m.id === node.id)
    if (config) {
      selectedModule.value = config
      infoCardVisible.value = true
    }
  }

  /**
   * 关闭信息卡片
   */
  function closeInfoCard(): void {
    infoCardVisible.value = false
    selectedModule.value = null
  }

  /**
   * 保存当前节点位置到 localStorage
   *
   * 在节点拖拽结束后调用
   */
  function onNodesChange(updatedNodes: FlowNode[]): void {
    nodes.value = updatedNodes
    saveLayout(updatedNodes)
  }

  /**
   * 节点拖拽结束事件
   *
   * Vue Flow 的 @node-drag-stop 回调，更新节点位置并保存到 localStorage
   *
   * @param node 拖拽结束的节点（包含最新位置）
   */
  function onNodeDragStop(node?: NodeInput): void {
    if (node && node.position) {
      const targetNode = nodes.value.find(n => n.id === node.id)
      if (targetNode) {
        targetNode.position = { x: node.position.x, y: node.position.y }
      }
    }
    saveLayout(nodes.value)
  }

  /**
   * 重置布局为 dagre 自动排列
   *
   * 清除 localStorage 保存的布局，重新计算
   */
  function resetLayout(): void {
    localStorage.removeItem(LAYOUT_STORAGE_KEY)
    const rawNodes: FlowNode[] = moduleConfigs.map(config => ({
      id: config.id,
      type: 'module',
      position: { x: 0, y: 0 },
      data: {
        config,
        navigate: options?.onNavigate,
        showInternalFlows: showInternalFlows.value,
      },
    }))
    const rawEdges: FlowEdge[] = moduleEdges.map(edge => {
      const isSequential = edge.edgeType !== 'data'
      const strokeColor = isSequential ? '#4361ee' : '#94a3b8'
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: edge.animated || false,
        type: 'smoothstep',
        style: { stroke: strokeColor, strokeWidth: 2 },
        markerEnd: {
          type: 'arrowclosed',
          width: 14,
          height: 14,
          color: strokeColor,
        },
      }
    })
    nodes.value = layoutWithDagre(rawNodes, rawEdges)
    edges.value = rawEdges
  }

  /**
   * 更新单个节点的数据（用于内嵌功能执行后更新状态）
   */
  function updateNodeData(nodeId: string, dataPatch: Record<string, unknown>): void {
    const node = nodes.value.find(n => n.id === nodeId)
    if (node) {
      node.data = { ...node.data, ...dataPatch }
    }
  }

  // ==========================================================================
  // 筛选方法
  // ==========================================================================

  /** 切换 skill 显示 */
  function toggleSkills(): void {
    showSkills.value = !showSkills.value
  }

  /** 切换模块显示 */
  function toggleModules(): void {
    showModules.value = !showModules.value
  }

  /** 切换分类显示 */
  function toggleCategory(cat: ModuleCategory): void {
    const newSet = new Set<ModuleCategory>(visibleCategories.value)
    if (newSet.has(cat)) {
      newSet.delete(cat)
    } else {
      newSet.add(cat)
    }
    visibleCategories.value = newSet
  }

  /** 切换仅显示大模型模块 */
  function toggleLlmOnly(): void {
    showLlmOnly.value = !showLlmOnly.value
  }

  /** 切换显示模块内部流程 */
  function toggleInternalFlows(): void {
    showInternalFlows.value = !showInternalFlows.value
    // 同步更新所有节点的 showInternalFlows 状态
    for (const node of nodes.value) {
      node.data = { ...node.data, showInternalFlows: showInternalFlows.value }
    }
  }

  /** 更新搜索关键词 */
  function setSearchKeyword(keyword: string): void {
    searchKeyword.value = keyword
  }

  /** 全部显示 */
  function showAll(): void {
    showSkills.value = true
    showModules.value = true
    showLlmOnly.value = false
    showInternalFlows.value = false
    searchKeyword.value = ''
    visibleCategories.value = new Set<ModuleCategory>(['content-ops', 'xhs-pipeline', 'radar'])
    // 同步更新所有节点
    for (const node of nodes.value) {
      node.data = { ...node.data, showInternalFlows: false }
    }
  }

  // ==========================================================================
  // 筛选 computed
  // ==========================================================================

  /** 根据筛选条件过滤后的节点 */
  const filteredNodes = computed<FlowNode[]>(() => {
    if (!showModules.value) return []
    const keyword = searchKeyword.value.trim().toLowerCase()

    return nodes.value
      .filter(node => {
        const config = node.data.config as ModuleConfig | undefined
        if (!config) return true

        // 分类筛选
        if (!visibleCategories.value.has(config.category)) {
          return false
        }

        // 大模型筛选
        if (showLlmOnly.value) {
          if (!config.llmConfig?.configured) return false
        }

        // 关键词搜索：匹配模块名、描述、功能、技能名称
        if (keyword) {
          const matchLabel = config.label.toLowerCase().includes(keyword)
          const matchDesc = config.description.toLowerCase().includes(keyword)
          const matchFeatures = config.features.some(f => f.toLowerCase().includes(keyword))
          const matchId = config.id.toLowerCase().includes(keyword)
          const matchSkills = (config.skills || []).some(s =>
            s.name.toLowerCase().includes(keyword) ||
            s.label.toLowerCase().includes(keyword) ||
            s.description.toLowerCase().includes(keyword)
          )
          const matchLlm = config.llmConfig?.modelName?.toLowerCase().includes(keyword)
          if (!matchLabel && !matchDesc && !matchFeatures && !matchId && !matchSkills && !matchLlm) {
            return false
          }
        }

        return true
      })
      .map(node => {
        // 如果关闭 skill 显示，则从 config 中剥离 skills（不影响原始数据）
        if (!showSkills.value) {
          const config = node.data.config as ModuleConfig | undefined
          if (config && config.skills && config.skills.length > 0) {
            return {
              ...node,
              data: {
                ...node.data,
                config: { ...config, skills: [] },
                showInternalFlows: showInternalFlows.value,
              },
            }
          }
        }
        // 确保 showInternalFlows 状态始终同步
        if (node.data.showInternalFlows !== showInternalFlows.value) {
          return {
            ...node,
            data: { ...node.data, showInternalFlows: showInternalFlows.value },
          }
        }
        return node
      })
  })

  /** 根据筛选后节点过滤的边 */
  const filteredEdges = computed<FlowEdge[]>(() => {
    const visibleNodeIds = new Set(filteredNodes.value.map(n => n.id))
    return edges.value.filter(
      edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    )
  })

  // ==========================================================================
  // 编排模式方法
  // ==========================================================================

  /** 进入编排模式，默认加载当前系统流程图 */
  function enterOrchestrateMode(): void {
    isOrchestrateMode.value = true
    // 复制当前系统流程到编排画布，作为调整基础
    orchestrateNodes.value = nodes.value.map(n => ({ ...n, selected: false }))
    orchestrateEdges.value = edges.value.map(e => ({ ...e }))
    lastAddedNodeId.value = null
  }

  /** 新建空白编排 */
  function startNewOrchestration(): void {
    isOrchestrateMode.value = true
    orchestrateNodes.value = []
    orchestrateEdges.value = []
    lastAddedNodeId.value = null
    orchestrationName.value = ''
    clearOrchestrationAnalysis()
  }

  /** 退出编排模式 */
  function exitOrchestrateMode(): void {
    isOrchestrateMode.value = false
    clearOrchestrationAnalysis()
  }

  /** 从侧边栏拖拽节点到画布 */
  function addNodeToCanvas(
    config: ModuleConfig | ModuleSkill,
    nodeType: 'module' | 'skill',
    position?: { x: number; y: number },
  ): string {
    // 生成基础 ID
    const baseId = nodeType === 'module'
      ? (config as ModuleConfig).id
      : (config as ModuleSkill).name
    // 确保 ID 唯一
    let id = baseId
    let counter = 1
    while (orchestrateNodes.value.some(n => n.id === id)) {
      id = `${baseId}-${counter++}`
    }

    // 计算标签和描述
    const label = nodeType === 'module'
      ? (config as ModuleConfig).label
      : (config as ModuleSkill).label
    const description = config.description

    // 位置优先使用画布转换后的鼠标落点；没有落点时保留可预测的默认位置
    const offset = orchestrateNodes.value.length
    const node: FlowNode = {
      id,
      type: 'default',
      position: position || { x: 120 + offset * 60, y: 120 + offset * 40 },
      label,
      data: {
        label,
        description,
        nodeType,
        config: nodeType === 'module' ? config : undefined,
        skill: nodeType === 'skill' ? config : undefined,
      },
    }
    orchestrateNodes.value = [...orchestrateNodes.value, node]
    lastAddedNodeId.value = id
    return id
  }

  /** 从画布移除节点（同时移除关联的边） */
  function removeNodeFromCanvas(nodeId: string): void {
    orchestrateNodes.value = orchestrateNodes.value.filter(n => n.id !== nodeId)
    orchestrateEdges.value = orchestrateEdges.value.filter(
      e => e.source !== nodeId && e.target !== nodeId
    )
    if (lastAddedNodeId.value === nodeId) {
      lastAddedNodeId.value = orchestrateNodes.value[orchestrateNodes.value.length - 1]?.id || null
    }
  }

  /** 批量移除编排节点，并同步移除关联边 */
  function removeNodesFromCanvas(nodeIds: string[]): void {
    const ids = new Set(nodeIds)
    if (ids.size === 0) return
    orchestrateNodes.value = orchestrateNodes.value.filter(n => !ids.has(n.id))
    orchestrateEdges.value = orchestrateEdges.value.filter(
      e => !ids.has(e.source) && !ids.has(e.target)
    )
    if (lastAddedNodeId.value && ids.has(lastAddedNodeId.value)) {
      lastAddedNodeId.value = orchestrateNodes.value[orchestrateNodes.value.length - 1]?.id || null
    }
  }

  /** 添加连线 */
  function addEdgeToCanvas(source: string, target: string, label?: string): void {
    const edgeId = `e-${source}-${target}-${Date.now()}`
    const edge: FlowEdge = {
      id: edgeId,
      source,
      target,
      label,
      animated: true,
      type: 'smoothstep',
      style: { stroke: '#4361ee', strokeWidth: 2 },
      labelStyle: { fontSize: '11px', fill: '#6c757d' },
      labelBgStyle: { fill: '#f8f9fc' },
    }
    orchestrateEdges.value = [...orchestrateEdges.value, edge]
  }

  /** 保存业务流线到后端 */
  async function saveBusinessFlow(name: string, description: string): Promise<void> {
    await businessFlowApi.create({
      name,
      description,
      nodes: orchestrateNodes.value as unknown as Record<string, unknown>[],
      edges: orchestrateEdges.value as unknown as Record<string, unknown>[],
    })
  }

  /** 加载已有业务流线到画布 */
  async function loadBusinessFlow(flowId: number): Promise<void> {
    const res = await businessFlowApi.getById(flowId)
    if (res.success && res.data) {
      orchestrateNodes.value = (res.data.nodes || []) as unknown as FlowNode[]
      orchestrateEdges.value = (res.data.edges || []) as unknown as FlowEdge[]
      isOrchestrateMode.value = true
    }
  }

  // ==========================================================================
  // 编排分析与方法（LLM 分析、对话、确认、执行）
  // ==========================================================================

  /** 生成需求文档（描述编排变更内容） */
  function generateRequirementDoc(): string {
    const nodeLabels = orchestrateNodes.value
      .map(n => (n.label as string) || (n.data.label as string) || n.id)
      .join(' → ')
    const edgeCount = orchestrateEdges.value.length
    const doc = [
      `# 编排方案：${orchestrationName.value || '未命名编排'}`,
      '',
      `## 编排概述`,
      `- 节点数量：${orchestrateNodes.value.length}`,
      `- 连线数量：${edgeCount}`,
      `- 流程链路：${nodeLabels}`,
      '',
      `## 变更说明`,
      `本编排方案对现有项目流程进行了调整，包含 ${orchestrateNodes.value.length} 个节点和 ${edgeCount} 条数据流向。`,
      '',
      `## 预期目标`,
      `- 优化数据流转效率`,
      `- 减少冗余步骤`,
      `- 提升内容运营自动化程度`,
    ].join('\n')
    orchestrationDoc.value = doc
    return doc
  }

  /** 保存自定义编排（命名保存并生成需求文档） */
  async function saveAsCustomFlow(name: string, description?: string): Promise<void> {
    orchestrationName.value = name
    // 生成需求文档
    generateRequirementDoc()
    // 同时保存为业务流线
    await businessFlowApi.create({
      name,
      description: description || orchestrationDoc.value.substring(0, 200),
      nodes: orchestrateNodes.value as unknown as Record<string, unknown>[],
      edges: orchestrateEdges.value as unknown as Record<string, unknown>[],
    })
  }

  /** 调用 LLM 分析当前编排方案 */
  async function analyzeOrchestration(selection?: { provider?: string; model?: string }): Promise<void> {
    if (orchestrateNodes.value.length === 0) {
      throw new Error('画布上没有节点，请先添加节点')
    }
    analyzingOrchestration.value = true
    try {
      // 确保需求文档已生成
      if (!orchestrationDoc.value) {
        generateRequirementDoc()
      }
      const res = await orchestrationApi.analyze({
        name: orchestrationName.value || '未命名编排',
        description: orchestrationDoc.value,
        nodes: orchestrateNodes.value as unknown as Record<string, unknown>[],
        edges: orchestrateEdges.value as unknown as Record<string, unknown>[],
        requirementDoc: orchestrationDoc.value,
        llmProvider: selection?.provider,
        llmModel: selection?.model,
      })
      if (res.success && res.data) {
        llmAnalysis.value = res.data.analysis || ''
        llmIssues.value = res.data.issues || []
        llmSuggestions.value = res.data.suggestions || []
        llmAnalysisProvider.value = res.data.provider || ''
        llmAnalysisModel.value = res.data.model || ''
        llmAnalysisDuration.value = res.data.durationMs ?? null
      } else {
        throw new Error(res.error || '分析失败')
      }
    } finally {
      analyzingOrchestration.value = false
    }
  }

  /** 与 LLM 对话讨论编排方案 */
  async function chatWithLLM(message: string, selection?: { provider?: string; model?: string }): Promise<void> {
    if (!message.trim()) return
    chattingWithLLM.value = true
    // 添加用户消息
    chatMessages.value = [...chatMessages.value, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    }]
    try {
      const res = await orchestrationApi.chat({
        name: orchestrationName.value || '未命名编排',
        description: orchestrationDoc.value,
        nodes: orchestrateNodes.value as unknown as Record<string, unknown>[],
        edges: orchestrateEdges.value as unknown as Record<string, unknown>[],
        history: chatMessages.value,
        message,
        llmProvider: selection?.provider,
        llmModel: selection?.model,
      })
      if (res.success && res.data) {
        chatMessages.value = [...chatMessages.value, {
          role: 'assistant',
          content: res.data.reply,
          timestamp: new Date().toISOString(),
        }]
      } else {
        throw new Error(res.error || '对话失败')
      }
    } finally {
      chattingWithLLM.value = false
    }
  }

  /** 确认编排方案 */
  function confirmPlan(): void {
    planConfirmed.value = true
    chatMessages.value = [...chatMessages.value, {
      role: 'assistant',
      content: '方案已确认。您可以点击"优化流程"按钮开始执行流程调整。',
      timestamp: new Date().toISOString(),
    }]
  }

  /** 重置编排方案确认状态 */
  function resetPlan(): void {
    planConfirmed.value = false
    optimizationResult.value = ''
  }

  /** 执行流程优化（实际调整项目流程） */
  async function executeOptimization(): Promise<BusinessFlowExecutionResultDTO | null> {
    if (!planConfirmed.value) {
      throw new Error('请先确认方案后再执行优化')
    }
    optimizingFlow.value = true
    try {
      // 保存最终编排方案为业务流线并执行
      const saveRes = await businessFlowApi.create({
        name: `${orchestrationName.value || '优化编排'} - 已执行`,
        description: orchestrationDoc.value.substring(0, 200),
        nodes: orchestrateNodes.value as unknown as Record<string, unknown>[],
        edges: orchestrateEdges.value as unknown as Record<string, unknown>[],
      })
      if (saveRes.success && saveRes.data) {
        // 执行业务流线
        const executeRes = await businessFlowApi.execute(saveRes.data.id)
        lastExecutionResult.value = executeRes.data || null
        optimizationResult.value = `流程优化已执行完成。已创建并执行业务流线 #${saveRes.data.id}，运行记录 #${executeRes.data?.runId || '未生成'}。`
        return executeRes.data || null
      } else {
        throw new Error('保存编排方案失败')
      }
    } finally {
      optimizingFlow.value = false
    }
  }

  /** 清空编排分析状态（退出编排模式时调用） */
  function clearOrchestrationAnalysis(): void {
    orchestrationName.value = ''
    orchestrationDoc.value = ''
    llmAnalysis.value = ''
    llmIssues.value = []
    llmSuggestions.value = []
    llmAnalysisProvider.value = ''
    llmAnalysisModel.value = ''
    llmAnalysisDuration.value = null
    chatMessages.value = []
    planConfirmed.value = false
    optimizationResult.value = ''
    lastExecutionResult.value = null
  }

  // 计算属性：节点数量
  const nodeCount = computed(() => nodes.value.length)
  const edgeCount = computed(() => edges.value.length)

  // 自动初始化
  onMounted(() => {
    initFlow()
  })

  return {
    // 状态
    nodes,
    edges,
    selectedModule,
    infoCardVisible,
    layoutInitialized,
    nodeCount,
    edgeCount,
    // 筛选状态
    showSkills,
    showModules,
    visibleCategories,
    searchKeyword,
    showLlmOnly,
    showInternalFlows,
    filteredNodes,
    filteredEdges,
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
    lastExecutionResult,
    // 方法
    initFlow,
    onNodeClick,
    closeInfoCard,
    onNodesChange,
    onNodeDragStop,
    resetLayout,
    updateNodeData,
    // 筛选方法
    toggleSkills,
    toggleModules,
    toggleCategory,
    toggleLlmOnly,
    toggleInternalFlows,
    setSearchKeyword,
    showAll,
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
    clearOrchestrationAnalysis,
  }
}
