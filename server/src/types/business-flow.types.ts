/**
 * 业务流线 (BusinessFlow) 类型定义
 *
 * 类似"扣子"的自定义流程编排功能，用户可拖拽 skill 和模块组成新的业务流线。
 * 定义了流线节点、连线、流线实体以及执行结果的数据契约。
 */

// ============================================================================
// 流线节点 (Flow Node) 相关
// ============================================================================

/**
 * 流线节点类型
 * - skill:    技能节点，引用已注册的 skill
 * - module:   模块节点，引用已注册的模块
 * - input:    输入节点，接收外部输入数据
 * - output:   输出节点，收集最终结果
 * - condition: 条件节点，根据条件表达式决定分支
 */
export type FlowNodeType = 'skill' | 'module' | 'input' | 'output' | 'condition';

/**
 * 流线节点数据
 */
export interface FlowNodeData {
  /** 节点唯一 ID */
  id: string;
  /** 节点类型 */
  type: FlowNodeType;
  /** 节点显示标签 */
  label: string;
  /** 节点描述 */
  description?: string;
  /** 技能/模块名称（skill 类型时为技能名称，module 类型时为模块 ID） */
  refName?: string;
  /** 节点在画布上的位置坐标 */
  position: { x: number; y: number };
  /** 节点配置（任意配置项，如参数、选项等） */
  config?: Record<string, unknown>;
}

// ============================================================================
// 流线连线 (Flow Edge) 相关
// ============================================================================

/**
 * 流线连线数据
 */
export interface FlowEdgeData {
  /** 连线唯一 ID */
  id: string;
  /** 源节点 ID */
  source: string;
  /** 目标节点 ID */
  target: string;
  /** 连线显示标签 */
  label?: string;
  /** 条件表达式（可选，用于 condition 节点的分支判断） */
  condition?: string;
}

// ============================================================================
// 业务流线 (BusinessFlow) 实体
// ============================================================================

/**
 * 业务流线状态
 */
export type BusinessFlowStatus = 'draft' | 'active' | 'archived';

/**
 * 业务流线实体
 */
export interface BusinessFlow {
  /** 流线 ID */
  id: number;
  /** 流线名称 */
  name: string;
  /** 流线描述 */
  description?: string;
  /** 流线节点列表 */
  nodes: FlowNodeData[];
  /** 流线连线列表 */
  edges: FlowEdgeData[];
  /** 流线状态 */
  status: BusinessFlowStatus;
  /** 最后执行时间 */
  lastRunAt?: string;
  /** 执行次数 */
  runCount: number;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

// ============================================================================
// 输入类型
// ============================================================================

/**
 * 创建业务流线的输入
 */
export interface CreateBusinessFlowInput {
  name: string;
  description?: string;
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
}

/**
 * 更新业务流线的输入（部分更新）
 */
export interface UpdateBusinessFlowInput {
  name?: string;
  description?: string;
  nodes?: FlowNodeData[];
  edges?: FlowEdgeData[];
  status?: BusinessFlowStatus;
}

/**
 * 执行业务流线的输入
 */
export interface ExecuteBusinessFlowInput {
  flowId: number;
  /** 输入数据（可选，传给 input 节点） */
  inputData?: Record<string, unknown>;
}

// ============================================================================
// 执行结果
// ============================================================================

/**
 * 流线执行步骤状态
 */
export type FlowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * 流线执行步骤结果
 */
export interface FlowStepResult {
  /** 节点 ID */
  nodeId: string;
  /** 节点标签 */
  nodeLabel: string;
  /** 步骤状态 */
  status: FlowStepStatus;
  /** 步骤执行结果 */
  result?: unknown;
  /** 步骤执行错误信息 */
  error?: string;
  /** 步骤开始时间 */
  startedAt: string;
  /** 步骤完成时间 */
  completedAt: string;
  /** 步骤耗时（毫秒） */
  durationMs?: number;
  /** 第几次尝试 */
  attempt?: number;
  /** 实际使用的 LLM 提供商 */
  provider?: string;
  /** 实际使用的 LLM 模型 */
  model?: string;
}

/**
 * 业务流线执行结果
 */
export interface BusinessFlowExecutionResult {
  /** 运行记录 ID */
  runId?: number;
  /** 流线 ID */
  flowId: number;
  /** 整体执行状态 */
  status: FlowStepStatus;
  /** 各步骤执行结果 */
  steps: FlowStepResult[];
  /** 执行开始时间 */
  startedAt: string;
  /** 执行完成时间 */
  completedAt: string;
  /** 总耗时（毫秒） */
  durationMs?: number;
}

/** 历史运行记录摘要 */
export interface BusinessFlowRunSummary {
  id: number;
  flowId: number;
  status: FlowStepStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  stepCount: number;
}

/** 历史运行记录详情 */
export interface BusinessFlowRunDetail extends BusinessFlowRunSummary {
  inputData?: Record<string, unknown>;
  steps: FlowStepResult[];
}
