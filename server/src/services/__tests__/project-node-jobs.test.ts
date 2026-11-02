import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('../../config', () => ({ config: { dbPath: ':memory:' } }));
vi.mock('../../utils/logger', () => ({ createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../project-workflow.service', () => ({ executeProjectNode: execute, generateProjectVideoCandidates: execute, executeContinuously: execute }));
import { closeDb, getDb, initDb } from '../../db';
import { startNodeJob, getNodeJob, latestNodeJob } from '../project-node-jobs.service';
import { recoverNodeJobs } from '../../db/safety';
describe('durable node jobs', () => {
  let workflowId: number;
  beforeEach(() => {
    execute.mockReset(); initDb(); const db=getDb();
    const flowId = db.prepare("INSERT INTO business_flows(name,nodes,edges) VALUES('f','[]','[]')").run().lastInsertRowid;
    workflowId=Number(db.prepare("INSERT INTO project_workflows(flow_id,name,initial_input,nodes_snapshot,edges_snapshot) VALUES (?,'w','{}','[]','[]')").run(flowId).lastInsertRowid);
    db.prepare("INSERT INTO project_workflow_nodes(workflow_id,node_id,node_type,module_id,label,position,config) VALUES (?,'n','module','content','n','{}','{}')").run(workflowId);
  });
  afterEach(() => closeDb());
  it('returns a durable identifier immediately and reuses an in-flight job', async () => {
    let finish!: () => void; execute.mockImplementation(() => new Promise<void>(resolve => { finish=resolve; }));
    const job=startNodeJob(workflowId,'n','execute',{});
    expect(job.status).toBe('running');
    expect(latestNodeJob(workflowId,'n')?.id).toBe(job.id);
    expect(startNodeJob(workflowId,'n','execute',{}).id).toBe(job.id);
    expect(execute).toHaveBeenCalledTimes(1);
    finish(); await vi.waitFor(() => expect(getNodeJob(job.id)?.status).toBe('completed'));
  });
  it('retains a concrete failure for a reopened workbench', async () => {
    execute.mockRejectedValue(new Error('缺少引擎凭据'));
    const job=startNodeJob(workflowId,'n','execute',{});
    await vi.waitFor(() => expect(getNodeJob(job.id)).toMatchObject({ status:'failed', error:'缺少引擎凭据' }));
    expect(latestNodeJob(workflowId,'n')?.id).toBe(job.id);
  });
  it('recovers interrupted jobs without removing previous inputs or artifacts', () => {
    const db=getDb(); db.prepare("INSERT INTO project_node_jobs(id,workflow_id,node_id,kind,status,params) VALUES('old',?,'n','execute','running','{}')").run(workflowId);
    db.prepare("UPDATE project_workflow_nodes SET status='running',input_snapshot='persisted',output_snapshot='artifact' WHERE workflow_id=?").run(workflowId);
    recoverNodeJobs(db);
    expect(getNodeJob('old')?.status).toBe('interrupted');
    expect(db.prepare('SELECT status,input_snapshot,output_snapshot FROM project_workflow_nodes WHERE workflow_id=?').get(workflowId)).toEqual({ status:'failed', input_snapshot:'persisted', output_snapshot:'artifact' });
  });
});
