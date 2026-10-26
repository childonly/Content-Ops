import { getDb } from '../db';
import { getFlow } from './business-flow.service';
import { discoverTrends } from './trend.service';
import { researchHashtags } from './hashtag.service';
import { generateContent } from './content.service';
import { getUnifiedRecord, processVideoUnified, type UnifiedVideoRecord } from './video-studio.service';
import { callLLM } from './llm-service';
import { createServiceLogger } from '../utils/logger';
import { extractVideoSourceText, extractVideoUrl } from '../utils/video-url';
import type { FlowEdgeData, FlowNodeData } from '../types/business-flow.types';
import type { ProjectNodeStatus, ProjectNodeWorkbench, ProjectPromptRecommendation, ProjectWorkflow, ProjectWorkflowNode, ProjectWorkflowStatus, ProjectWorkbenchInput, SourceType } from '../types/project-workflow.types';

const log = createServiceLogger('project-workflow');

interface WorkflowRow {
  id: number; flow_id: number; flow_name?: string; name: string; description: string | null;
  status: ProjectWorkflowStatus; mode: 'step' | 'continuous'; initial_input: string;
  nodes_snapshot: string; edges_snapshot: string; current_node_id: string | null;
  final_content_id: number | null; created_at: string; updated_at: string; completed_at: string | null;
}

interface NodeRow {
  id: number; workflow_id: number; node_id: string; node_type: string; module_id: string; label: string;
  position: string; status: ProjectNodeStatus; prompt: string | null; config: string;
  input_snapshot: string | null; output_snapshot: string | null; output_type: string | null;
  artifact_refs: string | null; source_refs: string | null; provider: string | null; model: string | null;
  error: string | null; attempt: number; started_at: string | null; completed_at: string | null; duration_ms: number | null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function stringify(value: unknown): string { return JSON.stringify(value ?? null); }

function textSummary(value: unknown, max = 180): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (!value || typeof value !== 'object') return String(value ?? '');
  const record = value as Record<string, unknown>;
  const candidate = record.title || record.name || record.text || record.body || record.summary || record.message;
  if (typeof candidate === 'string') return candidate.slice(0, max);
  if (Array.isArray(record.items)) return `${record.items.length} 条结果`;
  return JSON.stringify(value).slice(0, max);
}

function moduleCapabilities(workflow: ProjectWorkflow, node: ProjectWorkflowNode) {
  const supportsVideoGeneration = node.moduleId === 'video-studio';
  const supported = ['radar', 'trends', 'hashtags', 'content', 'video-studio', 'draft-review', 'publish'];
  return {
    moduleId: node.moduleId,
    label: node.label,
    inputRequired: predecessors(workflow, node.nodeId).length > 0,
    supportsPromptRecommendations: node.moduleId !== 'draft-review' && node.moduleId !== 'publish',
    supportsVideoGeneration,
    blockedReason: supported.includes(node.moduleId) ? undefined : `模块「${node.label}」尚未接入项目节点适配器。`,
  };
}

function mapNode(row: NodeRow): ProjectWorkflowNode {
  return {
    id: row.id, workflowId: row.workflow_id, nodeId: row.node_id, nodeType: row.node_type,
    moduleId: row.module_id, label: row.label, position: parseJson(row.position, {}), status: row.status,
    prompt: row.prompt || undefined, config: parseJson(row.config, {}), input: parseJson(row.input_snapshot, undefined),
    output: parseJson(row.output_snapshot, undefined), outputType: row.output_type || undefined,
    artifactRefs: parseJson(row.artifact_refs, []), sourceRefs: parseJson(row.source_refs, []),
    provider: row.provider || undefined, model: row.model || undefined, error: row.error || undefined,
    attempt: row.attempt, startedAt: row.started_at || undefined, completedAt: row.completed_at || undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

function mapWorkflow(row: WorkflowRow, includeNodes = false): ProjectWorkflow {
  const workflow: ProjectWorkflow = {
    id: row.id, flowId: row.flow_id, flowName: row.flow_name, name: row.name,
    description: row.description || undefined, status: row.status, mode: row.mode,
    initialInput: parseJson(row.initial_input, {}), nodesSnapshot: parseJson(row.nodes_snapshot, []),
    edgesSnapshot: parseJson(row.edges_snapshot, []), currentNodeId: row.current_node_id || undefined,
    finalContentId: row.final_content_id ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  };
  if (includeNodes) {
    const rows = getDb().prepare('SELECT * FROM project_workflow_nodes WHERE workflow_id = ? ORDER BY id').all(row.id) as NodeRow[];
    workflow.nodes = rows.map(mapNode);
  }
  return workflow;
}

function workflowSelect(): string {
  return `SELECT w.*, f.name AS flow_name FROM project_workflows w JOIN business_flows f ON f.id = w.flow_id`;
}

function sortedNodes(nodes: FlowNodeData[], edges: FlowEdgeData[]): FlowNodeData[] {
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  }
  const queue = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  const result: FlowNodeData[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const node = nodes.find(item => item.id === id);
    if (node) result.push(node);
    for (const target of outgoing.get(id) || []) {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return result.length === nodes.length ? result : nodes;
}

export function listProjectWorkflows(): ProjectWorkflow[] {
  const rows = getDb().prepare(`${workflowSelect()} ORDER BY w.updated_at DESC`).all() as WorkflowRow[];
  return rows.map(row => mapWorkflow(row));
}

export function getProjectWorkflow(id: number): ProjectWorkflow | null {
  const row = getDb().prepare(`${workflowSelect()} WHERE w.id = ?`).get(id) as WorkflowRow | undefined;
  return row ? mapWorkflow(row, true) : null;
}

export function createProjectWorkflow(input: { flowId: number; name: string; description?: string; initialInput?: Record<string, unknown> }): ProjectWorkflow {
  const flow = getFlow(input.flowId);
  if (!flow) throw new Error('业务编排不存在');
  if (!flow.nodes.length) throw new Error('业务编排没有节点，请先完成业务编排');
  const nodes = sortedNodes(flow.nodes, flow.edges);
  const db = getDb();
  const create = db.transaction(() => {
    const info = db.prepare(`INSERT INTO project_workflows
      (flow_id, name, description, initial_input, nodes_snapshot, edges_snapshot, current_node_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(flow.id, input.name.trim(), input.description || null, stringify(input.initialInput || {}), stringify(nodes), stringify(flow.edges), nodes[0]?.id || null);
    const workflowId = Number(info.lastInsertRowid);
    const insertNode = db.prepare(`INSERT INTO project_workflow_nodes
      (workflow_id, node_id, node_type, module_id, label, position, config)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const node of nodes) {
      insertNode.run(workflowId, node.id, node.type, node.refName || node.id, node.label, stringify(node.position), stringify(node.config || {}));
    }
    return workflowId;
  });
  const result = getProjectWorkflow(create());
  if (!result) throw new Error('项目工作流创建失败');
  return result;
}

export function deleteProjectWorkflow(id: number): boolean {
  return getDb().prepare('DELETE FROM project_workflows WHERE id = ?').run(id).changes > 0;
}

export function getProjectWorkflowReferenceCount(flowId: number): number {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM project_workflows WHERE flow_id = ?').get(flowId) as { count: number };
  return row.count;
}

function predecessors(workflow: ProjectWorkflow, nodeId: string): string[] {
  return (workflow.edgesSnapshot as FlowEdgeData[]).filter(edge => edge.target === nodeId).map(edge => edge.source);
}

function candidateList(node: ProjectWorkflowNode): Array<Record<string, unknown>> {
  const output = node.output as Record<string, unknown> | undefined;
  if (Array.isArray(output?.candidates)) return output.candidates.filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Record<string, unknown>;
    const payload = value.value as Record<string, unknown> | undefined;
    return payload?.status !== 'failed';
  });
  if (output && node.status === 'completed') return [{ id: `${node.nodeId}:output`, type: node.outputType || 'result', title: node.label, summary: textSummary(output), value: output }];
  return [];
}

function buildWorkbenchInputs(workflow: ProjectWorkflow, node: ProjectWorkflowNode): ProjectWorkbenchInput[] {
  const ids = predecessors(workflow, node.nodeId);
  const inputs: ProjectWorkbenchInput[] = [];
  for (const upstream of workflow.nodes || []) {
    if (!ids.includes(upstream.nodeId) || upstream.status !== 'completed') continue;
    const candidates = candidateList(upstream);
    candidates.forEach((candidate, index) => {
      inputs.push({
        id: String(candidate.id || `${upstream.nodeId}:${index}`),
        nodeId: upstream.nodeId,
        nodeLabel: upstream.label,
        type: String(candidate.type || upstream.outputType || 'result'),
        title: String(candidate.title || `${upstream.label} 成果 ${index + 1}`),
        summary: String(candidate.summary || textSummary(candidate.value ?? candidate)),
        value: candidate.value ?? candidate,
        sourceRefs: upstream.sourceRefs || [],
      });
    });
  }
  return inputs;
}

function fallbackRecommendations(node: ProjectWorkflowNode, input?: ProjectWorkbenchInput): ProjectPromptRecommendation[] {
  const context = input?.summary || '已选择的上游成果';
  const byModule: Record<string, Array<[string, string, string]>> = {
    'video-studio': [
      ['提炼主题', `从以下视频成果中提炼 3 个可用于内容创作的主题：\n${context}`, '适合快速提取选题方向'],
      ['结构化摘要', `将以下视频成果整理为结构化摘要，包含结论、证据和行动建议：\n${context}`, '适合交给后续内容节点'],
      ['平台改写', `将以下视频成果改写为适合目标平台发布的内容，保留事实并突出可读性：\n${context}`, '适合生成下一步草稿'],
    ],
    hashtags: [
      ['精准标签', `根据以下内容提取 10 个高相关标签，并说明每个标签的使用理由：\n${context}`, '让标签研究结果可直接复用'],
      ['分层标签', `为以下内容生成核心、场景、长尾三层标签：\n${context}`, '便于组合发布标签'],
      ['风险过滤', `筛选以下内容中不适合公开发布或可能引发误解的标签，并给出替代项：\n${context}`, '降低标签使用风险'],
    ],
    content: [
      ['小红书笔记', `基于以下上游成果生成一篇结构清晰、真实具体的小红书笔记，包含标题、正文和标签：\n${context}`, '适合直接进入内容生成'],
      ['短视频口播', `将以下上游成果改写为 60 秒短视频口播稿，开头 3 秒抓住注意力：\n${context}`, '适合视频内容二次创作'],
      ['多版本标题', `基于以下上游成果生成 8 个不同角度的标题，并标注每个标题的切入点：\n${context}`, '适合人工挑选标题'],
    ],
  };
  const rows = byModule[node.moduleId] || [
    ['提炼要点', `请提炼以下成果的核心要点，并给出下一步可执行建议：\n${context}`, '通用成果整理'],
    ['校验事实', `请检查以下成果中的事实、来源和不确定信息，列出需要人工确认的部分：\n${context}`, '适合进入审核节点'],
    ['优化表达', `请在不改变事实的前提下，优化以下成果的结构和表达：\n${context}`, '适合人工微调前预处理'],
  ];
  return rows.map(([title, prompt, reason], index) => ({ id: `fallback-${node.moduleId}-${index}`, title, prompt, reason, fallback: true }));
}

function parseRecommendations(text: string, node: ProjectWorkflowNode, input?: ProjectWorkbenchInput): ProjectPromptRecommendation[] {
  try {
    const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || text) as unknown;
    if (Array.isArray(parsed)) {
      const result = parsed.map((item, index) => {
        const row = item as Record<string, unknown>;
        return { id: `llm-${node.moduleId}-${index}`, title: String(row.title || `推荐模板 ${index + 1}`), prompt: String(row.prompt || ''), reason: String(row.reason || '根据当前节点与上游成果生成'), };
      }).filter(item => item.prompt.trim());
      if (result.length) return result.slice(0, 5);
    }
  } catch { /* fallback below */ }
  return fallbackRecommendations(node, input);
}

export function getProjectNodeWorkbench(workflowId: number, nodeId: string): ProjectNodeWorkbench {
  const workflow = getProjectWorkflow(workflowId);
  const node = workflow?.nodes?.find(item => item.nodeId === nodeId);
  if (!workflow || !node) throw new Error('项目节点不存在');
  return { workflowId, node, inputs: buildWorkbenchInputs(workflow, node), capabilities: moduleCapabilities(workflow, node) };
}

export function selectProjectNodeInput(workflowId: number, nodeId: string, input: { id: string; value?: unknown }): ProjectWorkflow {
  const workbench = getProjectNodeWorkbench(workflowId, nodeId);
  const selected = workbench.inputs.find(item => item.id === input.id);
  if (!selected) throw new Error('所选成果不存在或尚未完成');
  const db = getDb();
  const previous = workbench.node.input || {};
  db.prepare(`UPDATE project_workflow_nodes SET input_snapshot=?, error=NULL, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`)
    .run(stringify({ ...((previous && typeof previous === 'object') ? previous : {}), selectedInput: selected, selectedAt: new Date().toISOString() }), workflowId, nodeId);
  return getProjectWorkflow(workflowId)!;
}

export async function recommendProjectNodePrompts(workflowId: number, nodeId: string): Promise<{ recommendations: ProjectPromptRecommendation[]; provider?: string; model?: string; fallback: boolean }> {
  const workflow = getProjectWorkflow(workflowId);
  const node = workflow?.nodes?.find(item => item.nodeId === nodeId);
  if (!workflow || !node) throw new Error('项目节点不存在');
  const input = buildWorkbenchInputs(workflow, node).find(item => {
    const selected = (node.input as Record<string, unknown> | undefined)?.selectedInput as Record<string, unknown> | undefined;
    return !selected || item.id === selected.id;
  });
  const prompt = `你是内容项目工作流助手。请为“${node.label}”节点生成 3 到 5 个可执行提示词模板。\n项目：${workflow.name}\n节点链：${(workflow.nodes || []).map(item => item.label).join(' → ')}\n当前输入：${input?.summary || '暂无，提供适合首步执行的模板'}\n只返回 JSON 数组，每项包含 title、prompt、reason 三个字符串字段。不要输出 Markdown。`;
  const result = await callLLM(prompt);
  const fallback = !result.text.trim();
  const recommendations = parseRecommendations(result.text, node, input).map(item => ({ ...item, fallback: fallback || item.fallback }));
  return { recommendations, provider: result.provider, model: result.model, fallback };
}

function videoCandidates(record: UnifiedVideoRecord): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  if (record.fullText || record.transcript) candidates.push({ id: `${record.uid}:transcript`, type: 'video-transcript', title: '完整转录稿', summary: textSummary(record.fullText || record.transcript), value: record.fullText || record.transcript, recordUid: record.uid });
  if (record.summary) candidates.push({ id: `${record.uid}:summary`, type: 'video-summary', title: 'AI 总结稿', summary: textSummary(record.summary), value: record.summary, recordUid: record.uid });
  if (record.rewrittenBody || record.rewrittenTitle) candidates.push({ id: `${record.uid}:rewrite`, type: 'video-rewrite', title: record.rewrittenTitle || '平台改写稿', summary: textSummary(record.rewrittenBody || record.rewrittenTitle), value: { title: record.rewrittenTitle, body: record.rewrittenBody, tags: record.rewrittenTags }, recordUid: record.uid });
  if (record.keyPoints?.length) candidates.push({ id: `${record.uid}:key-points`, type: 'video-key-points', title: '关键观点', summary: record.keyPoints.slice(0, 3).join('；'), value: record.keyPoints, recordUid: record.uid });
  if (!candidates.length) candidates.push({ id: `${record.uid}:record`, type: 'video-record', title: '视频处理结果', summary: record.errorMessage || record.url, value: record, recordUid: record.uid });
  return candidates;
}

function adapterCandidates(node: ProjectWorkflowNode, result: { output: unknown; outputType: string }): Array<Record<string, unknown>> {
  const output = result.output as Record<string, unknown>;
  if (node.moduleId === 'content') {
    const content = output as Record<string, unknown>;
    return [{ id: `${node.nodeId}:content`, type: 'content', title: String(content.title || '生成内容'), summary: textSummary(content.body || content.content || content.title), value: output }];
  }
  const items = Array.isArray(output.items) ? output.items : [];
  return items.slice(0, 20).map((item, index) => {
    const value = item as Record<string, unknown>;
    return { id: `${node.nodeId}:${String(value.id || index)}`, type: result.outputType, title: String(value.title || value.tag || value.name || `候选成果 ${index + 1}`), summary: textSummary(value), value };
  });
}

export async function generateProjectVideoCandidates(workflowId: number, nodeId: string, input: { url: string; strategy?: 'transcribe' | 'alchemist'; model?: string; language?: string; platform?: string; sourceText?: string }): Promise<ProjectWorkflow> {
  const workflow = getProjectWorkflow(workflowId);
  const node = workflow?.nodes?.find(item => item.nodeId === nodeId);
  if (!workflow || !node) throw new Error('项目节点不存在');
  if (node.moduleId !== 'video-studio') throw new Error('当前节点不是视频工作室');
  if (!input.url?.trim()) throw new Error('视频链接不能为空');
  const normalizedUrl = extractVideoUrl(input.url);
  if (!/^https?:\/\//i.test(normalizedUrl)) throw new Error('未识别到有效的视频 URL，请粘贴平台分享链接或完整 URL');
  const sourceText = input.sourceText?.trim() || extractVideoSourceText(input.url);
  const startedAt = new Date().toISOString();
  const db = getDb();
  db.prepare(`UPDATE project_workflow_nodes SET status='running', input_snapshot=?, error=NULL, attempt=attempt+1, started_at=?, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`)
    .run(stringify({ initial: workflow.initialInput, videoRequest: { ...input, url: normalizedUrl, sourceText }, upstreamNodeIds: predecessors(workflow, nodeId) }), startedAt, workflowId, nodeId);
  db.prepare("UPDATE project_workflows SET status='running', current_node_id=?, updated_at=datetime('now') WHERE id=?").run(nodeId, workflowId);
  try {
    const record = await processVideoUnified(normalizedUrl, { strategy: input.strategy || 'transcribe', transcribeOptions: { model: input.model || 'medium', language: input.language && input.language !== 'auto' ? input.language : undefined, sourceText }, alchemistPlatform: input.platform as any || 'xiaohongshu' });
    if (record.status === 'failed') throw new Error(record.errorMessage || '视频处理失败，请查看视频工作室记录详情');
    const candidates = videoCandidates(record);
    const completedAt = new Date().toISOString();
    db.prepare(`UPDATE project_workflow_nodes SET status='waiting_review', output_snapshot=?, output_type='video-candidates', artifact_refs=?, source_refs=?, provider='video-studio', model=?, completed_at=?, duration_ms=?, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`)
      .run(stringify({ candidates, selected: null }), stringify(candidates.map(candidate => ({ type: candidate.type, id: candidate.recordUid, candidateId: candidate.id }))), stringify([{ url: record.url, platform: record.platform, sourceType: 'observed', capturedAt: record.updatedAt || record.createdAt }]), record.model || record.strategy, completedAt, Date.parse(completedAt) - Date.parse(startedAt), workflowId, nodeId);
    db.prepare("UPDATE project_workflows SET status='waiting_review', current_node_id=?, updated_at=datetime('now') WHERE id=?").run(nodeId, workflowId);
    return getProjectWorkflow(workflowId)!;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`UPDATE project_workflow_nodes SET status='failed', error=?, completed_at=?, duration_ms=?, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`).run(message, completedAt, Date.parse(completedAt) - Date.parse(startedAt), workflowId, nodeId);
    db.prepare("UPDATE project_workflows SET status='failed', updated_at=datetime('now') WHERE id=?").run(workflowId);
    throw error;
  }
}

export function reuseProjectVideoRecord(workflowId: number, nodeId: string, uid: string): ProjectWorkflow {
  const workflow = getProjectWorkflow(workflowId);
  const node = workflow?.nodes?.find(item => item.nodeId === nodeId);
  if (!workflow || !node) throw new Error('项目节点不存在');
  if (node.moduleId !== 'video-studio') throw new Error('当前节点不是视频工作室');
  const record = getUnifiedRecord(uid);
  if (!record) throw new Error('视频工作室记录不存在');
  if (record.status !== 'completed') throw new Error(record.errorMessage || '只能复用已完成的视频记录');
  const candidates = videoCandidates(record);
  const db = getDb();
  const input = node.input && typeof node.input === 'object' ? node.input as Record<string, unknown> : {};
  db.prepare(`UPDATE project_workflow_nodes SET status='waiting_review', input_snapshot=?, output_snapshot=?, output_type='video-candidates', artifact_refs=?, source_refs=?, provider='video-studio', model=?, error=NULL, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`)
    .run(
      stringify({ ...input, reusedRecordUid: record.uid, videoRequest: { url: record.url, sourceText: record.sourceText, strategy: record.strategy } }),
      stringify({ candidates, selected: null }),
      stringify(candidates.map(candidate => ({ type: candidate.type, id: record.uid, candidateId: candidate.id }))),
      stringify([{ url: record.url, platform: record.platform, sourceType: 'observed', capturedAt: record.updatedAt || record.createdAt }]),
      record.model || record.strategy,
      workflowId,
      nodeId,
    );
  db.prepare("UPDATE project_workflows SET status='waiting_review', current_node_id=?, updated_at=datetime('now') WHERE id=?").run(nodeId, workflowId);
  return getProjectWorkflow(workflowId)!;
}

export function selectProjectNodeResult(workflowId: number, nodeId: string, candidateId: string): ProjectWorkflow {
  const workflow = getProjectWorkflow(workflowId);
  const node = workflow?.nodes?.find(item => item.nodeId === nodeId);
  if (!workflow || !node) throw new Error('项目节点不存在');
  const output = node.output as Record<string, unknown> | undefined;
  const candidates = Array.isArray(output?.candidates) ? output.candidates as Array<Record<string, unknown>> : [];
  const selected = candidates.find(item => String(item.id) === candidateId);
  if (!selected) throw new Error('成果不存在，请重新生成候选成果');
  const db = getDb();
  db.prepare(`UPDATE project_workflow_nodes SET status='completed', output_snapshot=?, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`).run(stringify({ candidates, selected }), workflowId, nodeId);
  const after = getProjectWorkflow(workflowId)!;
  const next = nextPendingNode(after);
  const status: ProjectWorkflowStatus = next ? 'running' : 'completed';
  db.prepare("UPDATE project_workflows SET status=?, current_node_id=?, updated_at=datetime('now'), completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END WHERE id=?").run(status, next?.nodeId || nodeId, status, workflowId);
  return getProjectWorkflow(workflowId)!;
}

function nextPendingNode(workflow: ProjectWorkflow): ProjectWorkflowNode | undefined {
  return workflow.nodes?.find(node => node.status === 'pending' && predecessors(workflow, node.nodeId)
    .every(id => workflow.nodes?.find(item => item.nodeId === id)?.status === 'completed'));
}

function deriveKeyword(workflow: ProjectWorkflow, upstream: ProjectWorkflowNode[], prompt?: string, selectedInput?: ProjectWorkbenchInput): string {
  if (prompt?.trim()) return prompt.trim();
  if (selectedInput?.summary?.trim()) return selectedInput.summary.trim();
  const keyword = workflow.initialInput.keyword;
  if (typeof keyword === 'string' && keyword.trim()) return keyword.trim();
  for (const node of upstream) {
    const output = node.output as { items?: Array<{ title?: string; tag?: string }> } | undefined;
    const value = output?.items?.[0]?.title || output?.items?.[0]?.tag;
    if (value) return value;
  }
  return workflow.name;
}

async function runAdapter(workflow: ProjectWorkflow, node: ProjectWorkflowNode, prompt?: string, selectedInput?: ProjectWorkbenchInput): Promise<{
  status: ProjectNodeStatus; output: unknown; outputType: string; artifacts?: unknown[]; sources?: unknown[]; finalContentId?: number;
}> {
  const upstreamIds = predecessors(workflow, node.nodeId);
  const upstream = (workflow.nodes || []).filter(item => upstreamIds.includes(item.nodeId));
  const keyword = deriveKeyword(workflow, upstream, prompt, selectedInput);
  const platform = typeof workflow.initialInput.platform === 'string' ? workflow.initialInput.platform : 'xiaohongshu';

  switch (node.moduleId) {
    case 'radar':
    case 'trends': {
      const items = await discoverTrends({ platform, limit: 10 });
      return {
        status: 'completed', outputType: 'trend-list', output: { items, sourceType: 'observed' satisfies SourceType },
        artifacts: items.map(item => ({ type: 'trend', id: item.id })),
        sources: items.map(item => ({ platform: item.platform, capturedAt: item.discoveredAt, sourceType: 'observed' })),
      };
    }
    case 'hashtags': {
      const items = await researchHashtags({ keyword, platform, limit: 10 });
      return {
        status: 'completed', outputType: 'hashtag-list', output: { items, sourceType: 'estimated' satisfies SourceType },
        artifacts: items.map(item => ({ type: 'hashtag', id: item.id })),
        sources: [{ platform, capturedAt: new Date().toISOString(), sourceType: 'estimated', note: '平台未返回完整指标时可能包含估算值' }],
      };
    }
    case 'content': {
      const content = await generateContent({ keywords: [keyword], style: String(node.config.style || '小红书'), tone: String(node.config.tone || '自然') });
      return {
        status: 'completed', outputType: 'content', output: content,
        artifacts: [{ type: 'content', id: content.id }], sources: [{ sourceType: 'observed', service: 'xhs-content' }], finalContentId: content.id,
      };
    }
    case 'draft-review':
      return { status: 'waiting_review', outputType: 'review-gate', output: { message: '请检查上游成果，确认后进入下一步。' } };
    case 'publish':
      return { status: 'waiting_review', outputType: 'publish-ready', output: { message: '成果已进入待发布区，确认后才会调用外部发布引擎。' } };
    default:
      return { status: 'blocked', outputType: 'blocked', output: { message: `模块「${node.label}」尚未接入项目节点适配器。` } };
  }
}

export async function executeProjectNode(workflowId: number, nodeId: string, patch?: { prompt?: string; config?: Record<string, unknown>; selectedInput?: ProjectWorkbenchInput }): Promise<ProjectWorkflow> {
  const workflow = getProjectWorkflow(workflowId);
  if (!workflow) throw new Error('项目工作流不存在');
  const node = workflow.nodes?.find(item => item.nodeId === nodeId);
  if (!node) throw new Error('项目节点不存在');
  const unready = predecessors(workflow, nodeId).filter(id => workflow.nodes?.find(item => item.nodeId === id)?.status !== 'completed');
  if (unready.length) throw new Error(`前置节点尚未完成: ${unready.join(', ')}`);

  const db = getDb();
  const startedAt = new Date().toISOString();
  const config = { ...node.config, ...(patch?.config || {}) };
  db.prepare(`UPDATE project_workflow_nodes SET status='running', prompt=?, config=?, input_snapshot=?, error=NULL,
    attempt=attempt+1, started_at=?, completed_at=NULL, duration_ms=NULL, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`)
    .run(patch?.prompt ?? node.prompt ?? null, stringify(config), stringify({ initial: workflow.initialInput, upstreamNodeIds: predecessors(workflow, nodeId), selectedInput: patch?.selectedInput || (node.input as Record<string, unknown> | undefined)?.selectedInput }), startedAt, workflowId, nodeId);
  db.prepare("UPDATE project_workflows SET status='running', current_node_id=?, updated_at=datetime('now') WHERE id=?").run(nodeId, workflowId);

  try {
    const refreshed = getProjectWorkflow(workflowId)!;
    const current = refreshed.nodes!.find(item => item.nodeId === nodeId)!;
    const selectedInput = patch?.selectedInput || ((current.input as Record<string, unknown> | undefined)?.selectedInput as ProjectWorkbenchInput | undefined);
    const result = await runAdapter(refreshed, current, patch?.prompt ?? current.prompt, selectedInput);
    const requiresSelection = result.status === 'completed' && ['radar', 'trends', 'hashtags', 'content'].includes(current.moduleId);
    const candidates = requiresSelection ? adapterCandidates(current, result) : [];
    const normalizedResult = requiresSelection && candidates.length
      ? { ...result, status: 'waiting_review' as ProjectNodeStatus, output: { candidates, selected: null }, outputType: `${result.outputType}-candidates`, artifacts: candidates.map(candidate => ({ type: candidate.type, id: candidate.id })) }
      : result;
    const completedAt = new Date().toISOString();
    const duration = Date.parse(completedAt) - Date.parse(startedAt);
    db.prepare(`UPDATE project_workflow_nodes SET status=?, output_snapshot=?, output_type=?, artifact_refs=?, source_refs=?,
      completed_at=?, duration_ms=?, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`)
      .run(normalizedResult.status, stringify(normalizedResult.output), normalizedResult.outputType, stringify(normalizedResult.artifacts || []), stringify(normalizedResult.sources || []), completedAt, duration, workflowId, nodeId);
    if (result.finalContentId) db.prepare('UPDATE project_workflows SET final_content_id=? WHERE id=?').run(result.finalContentId, workflowId);

    const after = getProjectWorkflow(workflowId)!;
    const next = nextPendingNode(after);
    const status: ProjectWorkflowStatus = normalizedResult.status === 'failed' || normalizedResult.status === 'blocked' ? 'failed'
      : normalizedResult.status === 'waiting_review' ? (normalizedResult.outputType === 'publish-ready' ? 'ready_to_publish' : 'waiting_review')
        : next ? 'running' : 'completed';
    db.prepare(`UPDATE project_workflows SET status=?, current_node_id=?, updated_at=datetime('now'),
      completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END WHERE id=?`)
      .run(status, next?.nodeId || nodeId, status, completedAt, workflowId);
    return getProjectWorkflow(workflowId)!;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`UPDATE project_workflow_nodes SET status='failed', error=?, completed_at=?, duration_ms=?, updated_at=datetime('now') WHERE workflow_id=? AND node_id=?`)
      .run(message, completedAt, Date.parse(completedAt) - Date.parse(startedAt), workflowId, nodeId);
    db.prepare("UPDATE project_workflows SET status='failed', updated_at=datetime('now') WHERE id=?").run(workflowId);
    log.error('项目节点执行失败', { workflowId, nodeId, error: message });
    throw error;
  }
}

export function confirmProjectNode(workflowId: number, nodeId: string): ProjectWorkflow {
  const workflow = getProjectWorkflow(workflowId);
  const node = workflow?.nodes?.find(item => item.nodeId === nodeId);
  if (!workflow || !node) throw new Error('项目节点不存在');
  if (node.status !== 'waiting_review') throw new Error('当前节点不需要人工确认');
  const output = node.output as Record<string, unknown> | undefined;
  if (Array.isArray(output?.candidates) && !output?.selected) throw new Error('请先选择一条成果后再确认');
  const db = getDb();
  db.prepare("UPDATE project_workflow_nodes SET status='completed', updated_at=datetime('now') WHERE workflow_id=? AND node_id=?").run(workflowId, nodeId);
  const after = getProjectWorkflow(workflowId)!;
  const next = nextPendingNode(after);
  const status = next ? 'running' : 'completed';
  db.prepare("UPDATE project_workflows SET status=?, current_node_id=?, updated_at=datetime('now'), completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END WHERE id=?")
    .run(status, next?.nodeId || nodeId, status, workflowId);
  return getProjectWorkflow(workflowId)!;
}

export async function executeContinuously(workflowId: number): Promise<ProjectWorkflow> {
  let workflow = getProjectWorkflow(workflowId);
  if (!workflow) throw new Error('项目工作流不存在');
  for (let guard = 0; guard < 100; guard += 1) {
    const next = nextPendingNode(workflow);
    if (!next) return workflow;
    workflow = await executeProjectNode(workflowId, next.nodeId);
    const executed = workflow.nodes?.find(item => item.nodeId === next.nodeId);
    if (!executed || executed.status !== 'completed') return workflow;
  }
  throw new Error('连续执行超过安全节点上限');
}
