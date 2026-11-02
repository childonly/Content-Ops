import { randomUUID } from 'crypto';
import { getDb } from '../db';
import { executeProjectNode, generateProjectVideoCandidates } from './project-workflow.service';

export interface ProjectNodeJob {
  id: string; workflowId: number; nodeId: string; kind: 'execute' | 'video';
  status: 'running' | 'completed' | 'failed' | 'interrupted'; message?: string; error?: string; createdAt: string; updatedAt: string;
}
interface JobRow { id: string; workflow_id: number; node_id: string; kind: ProjectNodeJob['kind']; status: ProjectNodeJob['status']; message: string | null; error: string | null; created_at: string; updated_at: string; }
function mapJob(row: JobRow | undefined): ProjectNodeJob | null {
  return row ? { id: row.id, workflowId: row.workflow_id, nodeId: row.node_id, kind: row.kind, status: row.status, message: row.message || undefined, error: row.error || undefined, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}
export function getNodeJob(id: string): ProjectNodeJob | null {
  return mapJob(getDb().prepare('SELECT * FROM project_node_jobs WHERE id=?').get(id) as JobRow | undefined);
}
export function latestNodeJob(workflowId: number, nodeId: string): ProjectNodeJob | null {
  return mapJob(getDb().prepare('SELECT * FROM project_node_jobs WHERE workflow_id=? AND node_id=? ORDER BY rowid DESC LIMIT 1').get(workflowId, nodeId) as JobRow | undefined);
}
export function startNodeJob(workflowId: number, nodeId: string, kind: ProjectNodeJob['kind'], params: Record<string, unknown>): ProjectNodeJob {
  const db = getDb();
  const active = mapJob(db.prepare("SELECT * FROM project_node_jobs WHERE workflow_id=? AND node_id=? AND status='running'").get(workflowId, nodeId) as JobRow | undefined);
  if (active) return active;
  const node = db.prepare('SELECT status FROM project_workflow_nodes WHERE workflow_id=? AND node_id=?').get(workflowId, nodeId) as { status: string } | undefined;
  if (!node) throw new Error('项目节点不存在');
  if (node.status === 'running') throw new Error('节点执行中，请等待或检查中断恢复状态');
  if (node.status === 'completed') throw new Error('节点已有确认成果，不重复执行');
  if (kind !== 'execute' && kind !== 'video') throw new Error('不支持的任务类型');
  const id = randomUUID();
  db.prepare("INSERT INTO project_node_jobs(id,workflow_id,node_id,kind,status,params,message) VALUES (?,?,?,?,'running',?,?)")
    .run(id, workflowId, nodeId, kind, JSON.stringify(params), kind === 'video' ? '视频处理正在执行；关闭工作台后任务继续运行' : '节点正在执行；关闭工作台后任务继续运行');
  const run = async (): Promise<void> => {
    try {
      if (kind === 'video') {
        if (typeof params.url !== 'string') throw new Error('视频 URL 必填');
        await generateProjectVideoCandidates(workflowId, nodeId, params as Parameters<typeof generateProjectVideoCandidates>[2]);
      } else {
        await executeProjectNode(workflowId, nodeId, params as Parameters<typeof executeProjectNode>[2]);
      }
      db.prepare("UPDATE project_node_jobs SET status='completed',message='执行结束，请查看并确认成果',updated_at=datetime('now') WHERE id=?").run(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare("UPDATE project_node_jobs SET status='failed',error=?,updated_at=datetime('now') WHERE id=?").run(message, id);
    }
  };
  void run();
  return getNodeJob(id)!;
}
