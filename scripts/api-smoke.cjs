const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, 'logs', `api-smoke-${Date.now()}`);
fs.mkdirSync(scratch, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(scratch, 'fixture.db');
process.env.SKILL_BRIDGE_MODE = 'mock';
process.env.CONTENT_OPS_HOST = '127.0.0.1';
process.env.CONTENT_OPS_API_TOKEN = 'test-only-api-smoke-token';
process.chdir(scratch);
const { createApp } = require(path.join(root, 'server/dist/app.js'));
const { closeDb } = require(path.join(root, 'server/dist/db/index.js'));
let server;
let origin;
let assertions = 0;
async function request(url, method = 'GET', body, expected = 200, authorized = true) {
  const response = await fetch(origin + url, {
    method, headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${process.env.CONTENT_OPS_API_TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(result)}`); assertions++;
  return result;
}
async function execute(workflowId, nodeId) {
  const result = await request(`/api/project-workflows/${workflowId}/nodes/${nodeId}/jobs`, 'POST', { kind: 'execute', params: {} }, 202);
  const id = result.data.id;
  for (let attempt = 0; attempt < 60; attempt++) {
    const job = await request(`/api/project-workflows/jobs/${id}`);
    if (job.data.status !== 'running') { assert.equal(job.data.status, 'completed', job.data.error); return job.data; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Background node job timed out');
}
async function main() {
  try {
    const app = createApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    await request('/health', 'GET', undefined, 200, false);
    await request('/api/admin/modules', 'GET', undefined, 401, false);
    await request('/api/admin/modules');
    await request('/api/runtime/diagnostics');
    assert.equal((await request('/api/image-studio/auto-redbook/themes')).data.length, 8);
    const modules = ['content', 'publish', 'analytics'];
    const flow = await request('/api/business-flows', 'POST', {
      name: 'isolated smoke fixture', nodes: modules.map(id => ({ id, type: 'module', refName: id, label: id, position: { x: 0, y: 0 }, config: {} })),
      edges: [{ id: 'e1', source: 'content', target: 'publish' }, { id: 'e2', source: 'publish', target: 'analytics' }],
    });
    const created = await request('/api/project-workflows', 'POST', { flowId: flow.data.id, name: 'isolated project', initialInput: { keyword: '测试' } });
    const id = created.data.id;
    const contentJob = await execute(id, 'content');
    const restored = await request(`/api/project-workflows/${id}/nodes/content/jobs/latest`);
    assert.equal(restored.data.id, contentJob.id);
    let workflow = (await request(`/api/project-workflows/${id}`)).data;
    const contentNode = workflow.nodes.find(node => node.nodeId === 'content');
    assert.equal(contentNode.status, 'waiting_review');
    const candidate = contentNode.output.candidates[0];
    await request(`/api/project-workflows/${id}/nodes/content/select-result`, 'POST', { candidateId: candidate.id });
    const workbench = await request(`/api/project-workflows/${id}/nodes/publish/workbench`);
    assert.equal(workbench.data.inputs.length, 1);
    await request(`/api/project-workflows/${id}/nodes/publish/input`, 'PUT', { id: workbench.data.inputs[0].id });
    await execute(id, 'publish');
    workflow = (await request(`/api/project-workflows/${id}`)).data;
    assert.equal(workflow.status, 'ready_to_publish');
    const queue = await request('/api/publish/queue');
    assert.equal(queue.data.length, 1);
    assert.equal(queue.data[0].status, 'pending');
    const gate = await request(`/api/project-workflows/${id}/nodes/publish/confirm`, 'POST', {}, 400);
    assert.match(gate.error, /真实 URL/);
    await request(`/api/project-workflows/${id}`, 'DELETE');
    await request(`/api/project-workflows/${id}`, 'GET', undefined, 404);
    assert.equal((await request('/api/contents')).total, 1, 'Deleting a project must preserve generated content');
    console.log(`API smoke passed: ${assertions} HTTP assertions; auth, durable jobs, confirmed inputs, publication gate, content preservation. Isolated DB: ${scratch}`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    closeDb();
    require(path.join(root, 'server/dist/utils/logger.js')).logger.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
