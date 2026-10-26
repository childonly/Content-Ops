/**
 * 业务流线服务 (BusinessFlow - 类似"扣子"的自定义流程编排)
 *
 * 用户可拖拽 skill 和模块组成新的业务流线。
 * 提供流线的 CRUD 操作和执行能力。
 *
 * 数据持久化: business_flows 表
 *
 * 执行逻辑:
 *   1. 按 edges 的拓扑顺序遍历 nodes
 *   2. 每个 node 根据其 type 和 refName 调用对应的 API/service
 *   3. 对于 'skill' 类型，记录技能名称并模拟调用
 *   4. 对于 'module' 类型，记录模块 ID
 *   5. 对于 'input' 类型，使用 inputData
 *   6. 对于 'output' 类型，收集最终结果
 *   7. 更新 flow 的 last_run_at 和 run_count
 *   8. 返回 BusinessFlowExecutionResult
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import type {
  BusinessFlow,
  BusinessFlowStatus,
  CreateBusinessFlowInput,
  UpdateBusinessFlowInput,
  BusinessFlowExecutionResult,
  FlowStepResult,
  FlowNodeData,
  FlowEdgeData,
  FlowStepStatus,
  BusinessFlowRunSummary,
  BusinessFlowRunDetail,
} from '../types/business-flow.types';

const log = createServiceLogger('business-flow');

// ============================================================================
// 数据库行映射
// ============================================================================

interface BusinessFlowRow {
  id: number;
  name: string;
  description: string | null;
  nodes: string;
  edges: string;
  status: string;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

interface PersistedVueFlowNode {
  id?: string;
  type?: string;
  label?: string;
  position?: { x?: number; y?: number };
  data?: {
    label?: string;
    description?: string;
    nodeType?: string;
    config?: Record<string, unknown>;
    skill?: Record<string, unknown>;
  };
  config?: Record<string, unknown>;
  refName?: string;
  description?: string;
}

/** 兼容前端 Vue Flow 持久化结构和旧版扁平节点结构。 */
export function normalizeFlowNode(raw: PersistedVueFlowNode): FlowNodeData {
  const nested = raw.data || {};
  const nestedConfig = nested.config || nested.skill;
  const requestedType = nested.nodeType || raw.type;
  const type = requestedType === 'skill' || requestedType === 'input' || requestedType === 'output' || requestedType === 'condition'
    ? requestedType
    : 'module';
  const configId = typeof nestedConfig?.id === 'string' ? nestedConfig.id : undefined;
  const skillName = typeof nestedConfig?.name === 'string' ? nestedConfig.name : undefined;
  const label = raw.label || nested.label || configId || skillName || raw.id || '未命名节点';

  return {
    id: raw.id || `${type}-${label}`,
    type,
    label,
    description: raw.description || nested.description,
    refName: raw.refName || configId || skillName || raw.id,
    position: {
      x: Number(raw.position?.x || 0),
      y: Number(raw.position?.y || 0),
    },
    config: raw.config || nestedConfig || {},
  };
}

function mapRow(row: BusinessFlowRow): BusinessFlow {
  let nodes: FlowNodeData[] = [];
  let edges: FlowEdgeData[] = [];
  try {
    const parsed = row.nodes ? JSON.parse(row.nodes) as PersistedVueFlowNode[] : [];
    nodes = parsed.map(normalizeFlowNode);
  } catch { /* ignore */ }
  try { edges = row.edges ? JSON.parse(row.edges) : []; } catch { /* ignore */ }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    nodes,
    edges,
    status: row.status as BusinessFlowStatus,
    lastRunAt: row.last_run_at ?? undefined,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJson(value: unknown): string | null {
  if (value === undefined) return null;
  try { return JSON.stringify(value); } catch { return JSON.stringify({ value: String(value) }); }
}

interface BusinessFlowRunRow {
  id: number;
  flow_id: number;
  status: FlowStepStatus;
  input_data: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  step_count?: number;
}

interface BusinessFlowStepRunRow {
  node_id: string;
  node_label: string;
  status: FlowStepStatus;
  result: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  attempt: number | null;
  provider: string | null;
  model: string | null;
}

function mapRunSummary(row: BusinessFlowRunRow): BusinessFlowRunSummary {
  return {
    id: row.id,
    flowId: row.flow_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
    durationMs: row.duration_ms ?? undefined,
    error: row.error || undefined,
    stepCount: row.step_count || 0,
  };
}

function parseJsonValue(value: string | null): unknown {
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return value; }
}

function mapStepRun(row: BusinessFlowStepRunRow): FlowStepResult {
  return {
    nodeId: row.node_id,
    nodeLabel: row.node_label,
    status: row.status,
    result: parseJsonValue(row.result),
    error: row.error || undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at || row.started_at,
    durationMs: row.duration_ms ?? undefined,
    attempt: row.attempt ?? undefined,
    provider: row.provider || undefined,
    model: row.model || undefined,
  };
}

export function getFlowRuns(flowId: number, limit: number = 20): BusinessFlowRunSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*, COUNT(s.id) AS step_count
    FROM business_flow_runs r
    LEFT JOIN business_flow_step_runs s ON s.run_id = r.id
    WHERE r.flow_id = ?
    GROUP BY r.id
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(flowId, Math.max(1, Math.min(limit, 100))) as BusinessFlowRunRow[];
  return rows.map(mapRunSummary);
}

export function getFlowRun(runId: number): BusinessFlowRunDetail | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM business_flow_runs WHERE id = ?').get(runId) as BusinessFlowRunRow | undefined;
  if (!row) return null;
  const steps = db.prepare(`
    SELECT node_id, node_label, status, result, error, started_at, completed_at, duration_ms, attempt, provider, model
    FROM business_flow_step_runs WHERE run_id = ? ORDER BY id ASC
  `).all(runId) as BusinessFlowStepRunRow[];
  return { ...mapRunSummary({ ...row, step_count: steps.length }), inputData: parseJsonValue(row.input_data) as Record<string, unknown> | undefined, steps: steps.map(mapStepRun) };
}

// ============================================================================
// 拓扑排序 - 根据 edges 对 nodes 进行排序
// ============================================================================

/**
 * 使用 Kahn 算法对节点进行拓扑排序。
 * 如果存在环，则返回按原始顺序排列的节点列表（尽力而为）。
 *
 * @param nodes 节点列表
 * @param edges 连线列表
 * @returns 拓扑排序后的节点列表
 */
function topologicalSort(nodes: FlowNodeData[], edges: FlowEdgeData[]): FlowNodeData[] {
  const nodeMap = new Map<string, FlowNodeData>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // 初始化
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // 构建邻接表和入度
  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  // Kahn 算法
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sortedIds: string[] = [];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    sortedIds.push(currentId);

    for (const neighborId of adjacency.get(currentId) || []) {
      const newDegree = (inDegree.get(neighborId) || 0) - 1;
      inDegree.set(neighborId, newDegree);
      if (newDegree === 0) {
        queue.push(neighborId);
      }
    }
  }

  // 如果存在环（sortedIds 数量 < nodes 数量），将剩余节点追加到末尾
  if (sortedIds.length < nodes.length) {
    for (const node of nodes) {
      if (!sortedIds.includes(node.id)) {
        sortedIds.push(node.id);
      }
    }
  }

  return sortedIds.map((id) => nodeMap.get(id)!).filter(Boolean);
}

// ============================================================================
// CRUD 操作
// ============================================================================

/**
 * 创建业务流线
 *
 * @param data 创建输入
 * @returns 创建后的业务流线
 */
export function createFlow(data: CreateBusinessFlowInput): BusinessFlow {
  const db = getDb();

  if (!data.name) {
    throw new Error('流线名称不能为空');
  }
  if (!Array.isArray(data.nodes)) {
    throw new Error('nodes 必须是数组');
  }
  if (!Array.isArray(data.edges)) {
    throw new Error('edges 必须是数组');
  }

  const info = db.prepare(`
    INSERT INTO business_flows (name, description, nodes, edges, status)
    VALUES (?, ?, ?, ?, 'draft')
  `).run(
    data.name,
    data.description ?? null,
    JSON.stringify(data.nodes),
    JSON.stringify(data.edges),
  );

  const id = Number(info.lastInsertRowid);
  log.info(`已创建业务流线: id=${id}, name="${data.name}"`);

  const result = getFlow(id);
  if (!result) throw new Error(`业务流线 ${id} 在创建后消失`);
  return result;
}

/**
 * 分页查询业务流线列表
 *
 * @param page 页码（从 1 开始）
 * @param pageSize 每页数量
 * @param status 可选状态过滤
 * @returns 分页结果
 */
export function getFlows(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
): { data: BusinessFlow[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM business_flows';
  const params: Array<string | number> = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const rows = db.prepare(query).all(...params) as BusinessFlowRow[];

  const countQuery = status
    ? 'SELECT COUNT(*) as total FROM business_flows WHERE status = ?'
    : 'SELECT COUNT(*) as total FROM business_flows';
  const countRow = db.prepare(countQuery).get(...(status ? [status] : [])) as { total: number };

  return {
    data: rows.map(mapRow),
    total: countRow.total,
  };
}

/**
 * 获取单个业务流线
 *
 * @param id 流线 ID
 * @returns 业务流线，不存在则返回 null
 */
export function getFlow(id: number): BusinessFlow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM business_flows WHERE id = ?').get(id) as BusinessFlowRow | undefined;
  return row ? mapRow(row) : null;
}

/**
 * 更新业务流线
 *
 * @param id 流线 ID
 * @param data 更新输入
 * @returns 更新后的业务流线，不存在则返回 null
 */
export function updateFlow(id: number, data: UpdateBusinessFlowInput): BusinessFlow | null {
  const db = getDb();

  const existing = getFlow(id);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const name = data.name ?? existing.name;
  const description = data.description ?? existing.description ?? null;
  const nodes = data.nodes ? JSON.stringify(data.nodes) : JSON.stringify(existing.nodes);
  const edges = data.edges ? JSON.stringify(data.edges) : JSON.stringify(existing.edges);
  const status = data.status ?? existing.status;

  db.prepare(`
    UPDATE business_flows
    SET name = ?, description = ?, nodes = ?, edges = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(name, description, nodes, edges, status, now, id);

  log.info(`已更新业务流线: id=${id}`);

  return getFlow(id);
}

/**
 * 删除业务流线
 *
 * @param id 流线 ID
 * @returns 是否删除成功
 */
export function deleteFlow(id: number): boolean {
  const db = getDb();
  const projectTableExists = (db.pragma('table_info(project_workflows)') as Array<{ name: string }>).length > 0;
  if (projectTableExists) {
    const reference = db.prepare('SELECT COUNT(*) AS count FROM project_workflows WHERE flow_id = ?').get(id) as { count: number };
    if (reference.count > 0) throw new Error(`该编排已被 ${reference.count} 个项目工作流引用，请先删除对应项目工作流`);
  }
  const info = db.prepare('DELETE FROM business_flows WHERE id = ?').run(id);
  const deleted = info.changes > 0;
  if (deleted) {
    log.info(`已删除业务流线: id=${id}`);
  }
  return deleted;
}

// ============================================================================
// 执行流线
// ============================================================================

/**
 * 执行单个节点
 *
 * 根据节点类型执行不同逻辑:
 *   - skill:    记录技能名称并模拟调用（实际调用由前端编排或后续实现）
 *   - module:   记录模块 ID
 *   - input:    使用 inputData
 *   - output:   收集最终结果
 *   - condition: 评估条件表达式
 *
 * @param node 节点数据
 * @param inputData 输入数据
 * @param context 执行上下文（前序节点的输出结果）
 * @returns 节点执行结果
 */
function executeNode(
  node: FlowNodeData,
  inputData: Record<string, unknown>,
  context: Map<string, unknown>,
): unknown {
  const upstreamNodeIds = Array.from(context.keys());
  switch (node.type) {
    case 'input': {
      // input 节点: 返回 inputData 或节点 config 中指定的输入
      return { type: 'input', data: inputData };
    }

    case 'skill': {
      // skill 节点: 记录技能名称并模拟调用
      // 实际调用由前端编排或后续实现
      const skillName = node.refName || node.label || node.id;
      log.info(`[execute] 模拟调用技能: ${skillName}`, { nodeId: node.id, config: node.config });
      return {
        type: 'skill',
        skillName,
        status: 'simulated',
        message: `技能 "${skillName}" 调用已记录（模拟执行）`,
        config: node.config || {},
        upstreamNodeIds,
      };
    }

    case 'module': {
      // module 节点: 记录模块 ID
      const moduleId = node.refName || node.label || node.id;
      log.info(`[execute] 模拟调用模块: ${moduleId}`, { nodeId: node.id, config: node.config });
      return {
        type: 'module',
        moduleId,
        status: 'simulated',
        message: `模块 "${moduleId}" 调用已记录（模拟执行）`,
        config: node.config || {},
        upstreamNodeIds,
      };
    }

    case 'condition': {
      // condition 节点: 评估条件表达式（简单模拟）
      const condition = node.config?.condition || node.label || node.id;
      log.info(`[execute] 评估条件: ${condition}`, { nodeId: node.id });
      return {
        type: 'condition',
        condition,
        result: true,
        message: `条件 "${condition}" 评估为 true（模拟执行）`,
      };
    }

    case 'output': {
      // output 节点: 收集最终结果
      const collected = Array.from(context.entries()).map(([nodeId, result]) => ({ nodeId, result }));
      log.info(`[execute] 收集输出结果`, { nodeId: node.id, upstreamCount: collected.length });
      return {
        type: 'output',
        result: collected,
      };
    }

    default:
      throw new Error(`未知的节点类型: ${node.type}`);
  }
}

/**
 * 执行业务流线
 *
 * 执行逻辑:
 *   1. 按 edges 的拓扑顺序遍历 nodes
 *   2. 每个 node 根据其 type 和 refName 调用对应的逻辑
 *   3. 更新 flow 的 last_run_at 和 run_count
 *   4. 返回 BusinessFlowExecutionResult
 *
 * @param id 流线 ID
 * @param inputData 输入数据（可选）
 * @returns 执行结果
 */
export async function executeFlow(
  id: number,
  inputData?: Record<string, unknown>,
): Promise<BusinessFlowExecutionResult> {
  const flow = getFlow(id);
  if (!flow) {
    throw new Error(`业务流线 ${id} 不存在`);
  }

  const startedAt = new Date().toISOString();
  log.info(`开始执行业务流线: id=${id}, name="${flow.name}", nodes=${flow.nodes.length}`);

  const db = getDb();
  const runInsert = db.prepare(`
    INSERT INTO business_flow_runs (flow_id, status, input_data, started_at)
    VALUES (?, 'running', ?, ?)
  `).run(id, safeJson(inputData || {}), startedAt);
  const runId = Number(runInsert.lastInsertRowid);

  const steps: FlowStepResult[] = [];
  let overallStatus: FlowStepStatus = 'completed';

  // 拓扑排序
  const sortedNodes = topologicalSort(flow.nodes, flow.edges);

  // 执行上下文: 存储每个节点的输出，供下游节点使用
  const context = new Map<string, unknown>();
  const input = inputData || {};

  // 按拓扑顺序执行每个节点
  for (const node of sortedNodes) {
    const stepStartedAt = new Date().toISOString();
    const nodeLabel = node.label || String(node.config?.label || node.id);

    try {
      const result = executeNode(node, input, context);
      context.set(node.id, result);

      const stepCompletedAt = new Date().toISOString();
      const stepResult: FlowStepResult = {
        nodeId: node.id,
        nodeLabel,
        status: 'completed',
        result,
        startedAt: stepStartedAt,
        completedAt: stepCompletedAt,
        durationMs: Date.parse(stepCompletedAt) - Date.parse(stepStartedAt),
        attempt: 1,
      };
      steps.push(stepResult);
      db.prepare(`
        INSERT INTO business_flow_step_runs
          (run_id, flow_id, node_id, node_label, status, result, started_at, completed_at, duration_ms, attempt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId, id, stepResult.nodeId, stepResult.nodeLabel, stepResult.status,
        safeJson(stepResult.result), stepResult.startedAt, stepResult.completedAt,
        stepResult.durationMs, stepResult.attempt,
      );

      log.info(`节点执行完成: nodeId=${node.id}, label="${nodeLabel}"`);
    } catch (e) {
      const err = e as Error;
      const stepCompletedAt = new Date().toISOString();
      overallStatus = 'failed';

      const stepResult: FlowStepResult = {
        nodeId: node.id,
        nodeLabel,
        status: 'failed',
        error: err.message,
        startedAt: stepStartedAt,
        completedAt: stepCompletedAt,
        durationMs: Date.parse(stepCompletedAt) - Date.parse(stepStartedAt),
        attempt: 1,
      };
      steps.push(stepResult);
      db.prepare(`
        INSERT INTO business_flow_step_runs
          (run_id, flow_id, node_id, node_label, status, error, started_at, completed_at, duration_ms, attempt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId, id, stepResult.nodeId, stepResult.nodeLabel, stepResult.status,
        stepResult.error, stepResult.startedAt, stepResult.completedAt,
        stepResult.durationMs, stepResult.attempt,
      );

      log.error(`节点执行失败: nodeId=${node.id}, error=${err.message}`);
      break; // 某个节点失败则停止执行后续节点
    }
  }

  const completedAt = new Date().toISOString();

  const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
  db.prepare(`
    UPDATE business_flow_runs
    SET status = ?, completed_at = ?, duration_ms = ?, error = ?
    WHERE id = ?
  `).run(overallStatus, completedAt, durationMs, steps.find(step => step.status === 'failed')?.error || null, runId);

  // 更新 flow 的 last_run_at 和 run_count
  db.prepare(`
    UPDATE business_flows
    SET last_run_at = ?, run_count = run_count + 1, updated_at = ?
    WHERE id = ?
  `).run(completedAt, completedAt, id);

  log.info(`业务流线执行完成: id=${id}, status=${overallStatus}, steps=${steps.length}`);

  return {
    flowId: id,
    runId,
    status: overallStatus,
    steps,
    startedAt,
    completedAt,
    durationMs,
  };
}
