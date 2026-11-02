import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const hooks=vi.hoisted(() => ({ close: undefined as (()=>void)|undefined }))
const api=vi.hoisted(() => ({ startJob:vi.fn(), getJob:vi.fn(), latestJob:vi.fn(), getById:vi.fn() }))
vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onBeforeUnmount:(fn:()=>void)=>{hooks.close=fn} }))
vi.mock('@/api', () => ({projectWorkflowApi:api}))
import { useProjectNodeJob } from './useProjectNodeJob'
const active={id:'job',workflowId:1,nodeId:'n',kind:'execute',status:'running',createdAt:'2026-11-01 12:00:00',updatedAt:'2026-11-01 12:00:00'}
beforeEach(() => {vi.clearAllMocks(); vi.useFakeTimers(); api.getJob.mockResolvedValue({success:true,data:active})})
afterEach(() => {hooks.close?.();vi.useRealTimers()})
it('restores and polls an already running durable job after reopening', async () => {
  api.latestJob.mockResolvedValue({success:true,data:active});const state=useProjectNodeJob(1,'n',vi.fn());await state.restore();
  expect(state.running.value).toBe(true);expect(api.getJob).toHaveBeenCalledWith('job');
})
it('stops polling on close without cancelling the server job', async () => {
  api.latestJob.mockResolvedValue({success:true,data:active});const state=useProjectNodeJob(1,'n',vi.fn());await state.restore();
  hooks.close?.();const count=api.getJob.mock.calls.length;await vi.advanceTimersByTimeAsync(5000);expect(api.getJob).toHaveBeenCalledTimes(count)
})
it('refreshes artifacts when a background job completes', async () => {
  api.startJob.mockResolvedValue({success:true,data:active});api.getJob.mockResolvedValue({success:true,data:{...active,status:'completed'}})
  const workflow={id:1,nodes:[]};api.getById.mockResolvedValue({success:true,data:workflow});const updated=vi.fn();const state=useProjectNodeJob(1,'n',updated);
  await state.start('execute',{});await vi.advanceTimersByTimeAsync(0);expect(updated).toHaveBeenCalledWith(workflow);expect(state.running.value).toBe(false)
})
