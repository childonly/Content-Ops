import { Router, type Request, type Response } from 'express';
import {
  confirmProjectNode, createProjectWorkflow, deleteProjectWorkflow, executeContinuously,
  executeProjectNode, generateProjectVideoCandidates, getProjectNodeWorkbench, getProjectWorkflow, listProjectWorkflows,
  recommendProjectNodePrompts, reuseProjectVideoRecord, selectProjectNodeInput, selectProjectNodeResult,
} from '../services/project-workflow.service';

export const router = Router();

router.get('/', (_req, res) => res.json({ success: true, data: listProjectWorkflows() }));

router.post('/', (req: Request, res: Response) => {
  try {
    const { flowId, name, description, initialInput } = req.body || {};
    if (!Number(flowId) || !String(name || '').trim()) return res.status(400).json({ success: false, error: 'flowId 和 name 必填' });
    res.json({ success: true, data: createProjectWorkflow({ flowId: Number(flowId), name: String(name), description, initialInput }) });
  } catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.get('/:id', (req, res) => {
  const data = getProjectWorkflow(Number(req.params.id));
  if (!data) return res.status(404).json({ success: false, error: '项目工作流不存在' });
  res.json({ success: true, data });
});

router.delete('/:id', (req, res) => {
  const deleted = deleteProjectWorkflow(Number(req.params.id));
  res.status(deleted ? 200 : 404).json(deleted ? { success: true, data: { deleted: true } } : { success: false, error: '项目工作流不存在' });
});

router.post('/:id/nodes/:nodeId/execute', async (req, res) => {
  try { res.json({ success: true, data: await executeProjectNode(Number(req.params.id), req.params.nodeId, req.body || {}) }); }
  catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.get('/:id/nodes/:nodeId/workbench', (req, res) => {
  try { res.json({ success: true, data: getProjectNodeWorkbench(Number(req.params.id), req.params.nodeId) }); }
  catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.put('/:id/nodes/:nodeId/input', (req, res) => {
  try {
    const { id, value } = req.body || {};
    if (!String(id || '').trim()) return res.status(400).json({ success: false, error: 'input id 必填' });
    res.json({ success: true, data: selectProjectNodeInput(Number(req.params.id), req.params.nodeId, { id: String(id), value }) });
  } catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.post('/:id/nodes/:nodeId/prompt-recommendations', async (req, res) => {
  try { res.json({ success: true, data: await recommendProjectNodePrompts(Number(req.params.id), req.params.nodeId) }); }
  catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.post('/:id/nodes/:nodeId/video/generate', async (req, res) => {
  try { res.json({ success: true, data: await generateProjectVideoCandidates(Number(req.params.id), req.params.nodeId, req.body || {}) }); }
  catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.post('/:id/nodes/:nodeId/video/reuse', (req, res) => {
  try {
    const uid = String(req.body?.uid || '').trim();
    if (!uid) return res.status(400).json({ success: false, error: 'uid 必填' });
    res.json({ success: true, data: reuseProjectVideoRecord(Number(req.params.id), req.params.nodeId, uid) });
  } catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.post('/:id/nodes/:nodeId/select-result', (req, res) => {
  try {
    const candidateId = String(req.body?.candidateId || '');
    if (!candidateId) return res.status(400).json({ success: false, error: 'candidateId 必填' });
    res.json({ success: true, data: selectProjectNodeResult(Number(req.params.id), req.params.nodeId, candidateId) });
  } catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.post('/:id/nodes/:nodeId/confirm', (req, res) => {
  try { res.json({ success: true, data: confirmProjectNode(Number(req.params.id), req.params.nodeId) }); }
  catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

router.post('/:id/execute-continuously', async (req, res) => {
  try { res.json({ success: true, data: await executeContinuously(Number(req.params.id)) }); }
  catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); }
});

export default router;
