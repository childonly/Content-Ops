import { computed, onBeforeUnmount, ref } from 'vue'
import { projectWorkflowApi, type ProjectNodeJobDTO, type ProjectWorkflowDTO } from '@/api'

/** Poll durable server state. Unmounting only stops observation, never the job. */
export function useProjectNodeJob(workflowId: number, nodeId: string, updated: (workflow: ProjectWorkflowDTO) => Promise<void>) {
  const job = ref<ProjectNodeJobDTO | null>(null)
  const pollError = ref('')
  const now = ref(Date.now())
  const running = computed(() => job.value?.status === 'running')
  const elapsed = computed(() => job.value ? Math.max(0, Math.floor((now.value - Date.parse(job.value.createdAt.replace(' ', 'T') + (job.value.createdAt.endsWith('Z') ? '' : 'Z'))) / 1000)) : 0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let mounted = true
  async function poll(): Promise<void> {
    if (!mounted || !job.value) return
    try {
      const response = await projectWorkflowApi.getJob(job.value.id)
      if (!mounted) return
      if (!response.success || !response.data) throw new Error(response.error || '任务状态查询失败')
      job.value = response.data; now.value = Date.now(); pollError.value = ''
      if (!running.value) {
        const workflow = await projectWorkflowApi.getById(workflowId)
        if (mounted && workflow.data) await updated(workflow.data)
        return
      }
    } catch (error) { if (mounted) pollError.value = (error as Error).message }
    if (mounted) timer = setTimeout(() => { void poll() }, 1500)
  }
  async function restore(): Promise<void> {
    const response = await projectWorkflowApi.latestJob(workflowId, nodeId)
    if (!mounted) return
    job.value = response.data || null
    if (running.value) void poll()
  }
  async function start(kind: 'execute' | 'video', params: Record<string, unknown>): Promise<void> {
    const response = await projectWorkflowApi.startJob(workflowId, nodeId, kind, params)
    if (!response.success || !response.data) throw new Error(response.error || '任务启动失败')
    if (!mounted) return
    job.value = response.data
    if (timer) clearTimeout(timer)
    void poll()
  }
  onBeforeUnmount(() => { mounted = false; if (timer) clearTimeout(timer) })
  return { job, running, elapsed, pollError, start, restore }
}
