export type ProjectWorkflowStatus = 'draft' | 'running' | 'waiting_review' | 'ready_to_publish' | 'completed' | 'failed';
export type ProjectNodeStatus = 'pending' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'skipped' | 'blocked';
export type SourceType = 'observed' | 'estimated' | 'simulated';

export interface ProjectWorkflowNode {
  id: number;
  workflowId: number;
  nodeId: string;
  nodeType: string;
  moduleId: string;
  label: string;
  position: Record<string, unknown>;
  status: ProjectNodeStatus;
  prompt?: string;
  config: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  outputType?: string;
  artifactRefs: unknown[];
  sourceRefs: unknown[];
  provider?: string;
  model?: string;
  error?: string;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ProjectWorkbenchInput {
  id: string;
  nodeId: string;
  nodeLabel: string;
  type: string;
  title: string;
  summary: string;
  value: unknown;
  sourceRefs: unknown[];
}

export interface ProjectPromptRecommendation {
  id: string;
  title: string;
  prompt: string;
  reason: string;
  fallback?: boolean;
}

export interface ProjectNodeWorkbench {
  workflowId: number;
  node: ProjectWorkflowNode;
  inputs: ProjectWorkbenchInput[];
  capabilities: {
    moduleId: string;
    label: string;
    inputRequired: boolean;
    supportsPromptRecommendations: boolean;
    supportsVideoGeneration: boolean;
    blockedReason?: string;
  };
  recommendations?: ProjectPromptRecommendation[];
  recommendationMeta?: { provider?: string; model?: string; fallback?: boolean };
}

export interface ProjectWorkflow {
  id: number;
  flowId: number;
  flowName?: string;
  name: string;
  description?: string;
  status: ProjectWorkflowStatus;
  mode: 'step' | 'continuous';
  initialInput: Record<string, unknown>;
  nodesSnapshot: unknown[];
  edgesSnapshot: unknown[];
  currentNodeId?: string;
  finalContentId?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  nodes?: ProjectWorkflowNode[];
}
