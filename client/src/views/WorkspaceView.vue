<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened, Plus, Setting, ArrowRight, Delete } from '@element-plus/icons-vue'
import FlowHome from '@/components/flow/FlowHome.vue'
import ProjectWorkflowCanvas from '@/components/flow/ProjectWorkflowCanvas.vue'
import { businessFlowApi, projectWorkflowApi, type BusinessFlowDTO, type BusinessFlowRunSummaryDTO, type ProjectWorkflowDTO } from '@/api'

const route = useRoute()
const router = useRouter()
const projects = ref<BusinessFlowDTO[]>([])
const selectedProjectId = ref<number | null>(null)
const runs = ref<BusinessFlowRunSummaryDTO[]>([])
const loading = ref(false)
const runLoading = ref(false)
const createVisible = ref(false)
const createLoading = ref(false)
const deletingProjectId = ref<number | null>(null)
const newProjectName = ref('')
const newProjectDescription = ref('')
const activeLayer = ref<'blueprint' | 'project'>(route.query.layer === 'project' ? 'project' : 'blueprint')
const projectWorkflows = ref<ProjectWorkflowDTO[]>([])
const selectedWorkflowId = ref<number | null>(null)
const workflowCreateVisible = ref(false)
const workflowCreateLoading = ref(false)
const workflowName = ref('')
const workflowDescription = ref('')
const workflowFlowId = ref<number | null>(null)
const workflowKeyword = ref('')

const selectedProject = computed(() => projects.value.find(project => project.id === selectedProjectId.value) || null)
const selectedWorkflow = computed(() => projectWorkflows.value.find(workflow => workflow.id === selectedWorkflowId.value) || null)

async function loadProjects(): Promise<void> {
  loading.value = true
  try {
    const res = await businessFlowApi.getList({ page: 1, pageSize: 100 })
    projects.value = res.data || []
    const routeProjectId = Number(route.query.project)
    const preferred = projects.value.find(project => project.id === routeProjectId) || projects.value[0]
    if (preferred) await selectProject(preferred, false)
  } catch (error) {
    ElMessage.error('加载项目失败: ' + (error as Error).message)
  } finally {
    loading.value = false
  }
}

async function loadProjectWorkflows(): Promise<void> {
  try {
    const res = await projectWorkflowApi.getList()
    projectWorkflows.value = res.data || []
    const routeId = Number(route.query.workflow)
    const preferred = projectWorkflows.value.find(item => item.id === routeId) || projectWorkflows.value[0]
    if (preferred) await selectWorkflow(preferred, false)
  } catch (error) { ElMessage.error('加载项目工作流失败: ' + (error as Error).message) }
}

async function selectWorkflow(workflow: ProjectWorkflowDTO, updateRoute = true): Promise<void> {
  const res = await projectWorkflowApi.getById(workflow.id)
  if (!res.data) throw new Error(res.error || '加载项目工作流失败')
  const index = projectWorkflows.value.findIndex(item => item.id === workflow.id)
  if (index >= 0) projectWorkflows.value[index] = res.data
  selectedWorkflowId.value = workflow.id
  if (updateRoute) await router.replace({ path: '/workspace', query: { layer: 'project', workflow: String(workflow.id) } })
}

function switchLayer(layer: 'blueprint' | 'project'): void {
  activeLayer.value = layer
  if (layer === 'project') router.replace({ path: '/workspace', query: selectedWorkflowId.value ? { layer, workflow: String(selectedWorkflowId.value) } : { layer } })
  else router.replace({ path: '/workspace', query: selectedProjectId.value ? { project: String(selectedProjectId.value) } : {} })
}

function openCreateWorkflow(): void {
  if (!projects.value.length) { ElMessage.warning('请先创建并完成一个业务编排'); return }
  workflowName.value = ''; workflowDescription.value = ''; workflowKeyword.value = ''
  workflowFlowId.value = selectedProjectId.value || projects.value[0].id
  workflowCreateVisible.value = true
}

async function createWorkflow(): Promise<void> {
  if (!workflowName.value.trim() || !workflowFlowId.value) { ElMessage.warning('请选择业务编排并填写项目名称'); return }
  workflowCreateLoading.value = true
  try {
    const res = await projectWorkflowApi.create({ flowId: workflowFlowId.value, name: workflowName.value.trim(), description: workflowDescription.value.trim(), initialInput: { keyword: workflowKeyword.value.trim(), platform: 'xiaohongshu' } })
    if (!res.data) throw new Error(res.error || '创建失败')
    projectWorkflows.value.unshift(res.data); workflowCreateVisible.value = false; activeLayer.value = 'project'
    await selectWorkflow(res.data); ElMessage.success('项目工作流已创建，第一个节点已点亮')
  } catch (error) { ElMessage.error('创建项目工作流失败: ' + (error as Error).message) } finally { workflowCreateLoading.value = false }
}

async function deleteWorkflow(workflow: ProjectWorkflowDTO): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除项目工作流「${workflow.name}」吗？已生成的内容不会被删除。`, '删除项目工作流', { type: 'warning', confirmButtonText: '删除' })
    await projectWorkflowApi.delete(workflow.id)
    projectWorkflows.value = projectWorkflows.value.filter(item => item.id !== workflow.id)
    if (selectedWorkflowId.value === workflow.id) {
      selectedWorkflowId.value = null
      const next = projectWorkflows.value[0]
      if (next) await selectWorkflow(next); else await router.replace({ path: '/workspace', query: { layer: 'project' } })
    }
    ElMessage.success('项目工作流已删除')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error((error as Error).message) }
}

function updateWorkflow(workflow: ProjectWorkflowDTO): void {
  const index = projectWorkflows.value.findIndex(item => item.id === workflow.id)
  if (index >= 0) projectWorkflows.value[index] = workflow
}

async function selectProject(project: BusinessFlowDTO, updateRoute = true): Promise<void> {
  selectedProjectId.value = project.id
  if (updateRoute) {
    await router.replace({ path: '/workspace', query: { project: String(project.id) } })
  }
  await loadRuns(project.id)
}

async function loadRuns(flowId: number): Promise<void> {
  runLoading.value = true
  try {
    const res = await businessFlowApi.getRuns(flowId, 8)
    runs.value = res.data || []
  } catch {
    runs.value = []
  } finally {
    runLoading.value = false
  }
}

function openCreateProject(): void {
  newProjectName.value = ''
  newProjectDescription.value = ''
  createVisible.value = true
}

async function createProject(): Promise<void> {
  const name = newProjectName.value.trim()
  if (!name) {
    ElMessage.warning('请输入项目名称')
    return
  }
  createLoading.value = true
  try {
    const res = await businessFlowApi.create({
      name,
      description: newProjectDescription.value.trim(),
      nodes: [],
      edges: [],
    })
    if (!res.success || !res.data) throw new Error(res.error || '创建失败')
    projects.value.unshift(res.data)
    createVisible.value = false
    await selectProject(res.data)
    ElMessage.success('项目已创建')
  } catch (error) {
    ElMessage.error('创建项目失败: ' + (error as Error).message)
  } finally {
    createLoading.value = false
  }
}

async function deleteProject(project: BusinessFlowDTO): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除编排「${project.name}」吗？历史运行记录会一并删除，此操作不可撤销。`,
      '删除业务编排',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    deletingProjectId.value = project.id
    const res = await businessFlowApi.delete(project.id)
    if (!res.success) throw new Error(res.error || '删除失败')

    const wasSelected = selectedProjectId.value === project.id
    projects.value = projects.value.filter(item => item.id !== project.id)
    if (wasSelected) {
      selectedProjectId.value = null
      runs.value = []
      const nextProject = projects.value[0]
      if (nextProject) await selectProject(nextProject)
      else await router.replace({ path: '/workspace' })
    }
    ElMessage.success('业务编排已删除')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('删除项目失败: ' + (error as Error).message)
  } finally {
    deletingProjectId.value = null
  }
}

function openAdvancedDashboard(): void {
  router.push('/dashboard')
}

function openProjectSettings(): void {
  router.push({ path: '/admin', query: { group: 'business', tab: 'business-flows' } })
}

function formatDate(value?: string | null): string {
  if (!value) return '从未运行'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(async () => { await loadProjects(); await loadProjectWorkflows() })
</script>

<template>
  <div class="workspace-view">
    <header class="workspace-header">
      <div>
        <div class="workspace-kicker">CONTENT OPS WORKSPACE</div>
        <h1>工作台</h1>
        <p>选择一个项目，继续内容生产和流程编排。</p>
      </div>
      <div class="workspace-header-actions">
        <el-radio-group :model-value="activeLayer" size="small" @change="switchLayer($event as 'blueprint' | 'project')">
          <el-radio-button value="blueprint">① 业务编排</el-radio-button>
          <el-radio-button value="project">② 项目工作流</el-radio-button>
        </el-radio-group>
        <el-button @click="openAdvancedDashboard">
          <el-icon><ArrowRight /></el-icon>
          高级总览
        </el-button>
        <el-button type="primary" @click="activeLayer === 'blueprint' ? openCreateProject() : openCreateWorkflow()">
          <el-icon><Plus /></el-icon>
          {{ activeLayer === 'blueprint' ? '新建编排' : '新建项目' }}
        </el-button>
      </div>
    </header>

    <div class="workspace-grid">
      <aside v-if="activeLayer === 'blueprint'" class="workspace-projects" v-loading="loading">
        <div class="panel-heading">
          <div>
            <span class="panel-eyebrow">PROJECTS</span>
            <h2>最近项目</h2>
          </div>
          <el-button text type="primary" @click="openCreateProject"><el-icon><Plus /></el-icon></el-button>
        </div>
        <button class="new-project-card" type="button" @click="openCreateProject">
          <el-icon><Plus /></el-icon>
          <span>新建一个内容项目</span>
        </button>
        <div v-if="projects.length === 0 && !loading" class="empty-projects">
          <el-icon :size="28"><FolderOpened /></el-icon>
          <p>还没有项目</p>
          <span>从新建项目开始</span>
        </div>
        <div
          v-for="project in projects"
          :key="project.id"
          class="project-card"
          :class="{ active: project.id === selectedProjectId }"
          role="button"
          tabindex="0"
          @click="selectProject(project)"
          @keydown.enter.prevent="selectProject(project)"
          @keydown.space.prevent="selectProject(project)"
        >
          <div class="project-card-top">
            <span class="project-card-name">{{ project.name }}</span>
            <div class="project-card-actions">
              <el-tag size="small" :type="project.status === 'active' ? 'success' : 'info'">{{ project.status || '草稿' }}</el-tag>
              <el-button
                class="project-delete"
                text
                type="danger"
                size="small"
                :loading="deletingProjectId === project.id"
                aria-label="删除项目"
                @click.stop="deleteProject(project)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
          <p>{{ project.description || '暂无项目描述' }}</p>
          <div class="project-card-meta">
            <span>{{ project.nodes?.length || 0 }} 节点</span>
            <span>运行 {{ project.runCount || 0 }} 次</span>
          </div>
        </div>
      </aside>
      <aside v-else class="workspace-projects">
        <div class="panel-heading"><div><span class="panel-eyebrow">PROJECT RUNS</span><h2>项目工作流</h2></div><el-button text type="primary" @click="openCreateWorkflow"><el-icon><Plus /></el-icon></el-button></div>
        <button class="new-project-card" type="button" @click="openCreateWorkflow"><el-icon><Plus /></el-icon><span>从业务编排创建项目</span></button>
        <div v-if="!projectWorkflows.length" class="empty-projects"><el-icon :size="28"><FolderOpened /></el-icon><p>还没有执行项目</p><span>选择业务编排创建第一项</span></div>
        <div v-for="workflow in projectWorkflows" :key="workflow.id" class="project-card" :class="{ active: workflow.id === selectedWorkflowId }" role="button" tabindex="0" @click="selectWorkflow(workflow)" @keydown.enter.prevent="selectWorkflow(workflow)">
          <div class="project-card-top"><span class="project-card-name">{{ workflow.name }}</span><div class="project-card-actions"><el-tag size="small">{{ workflow.status }}</el-tag><el-button text type="danger" size="small" @click.stop="deleteWorkflow(workflow)"><el-icon><Delete /></el-icon></el-button></div></div>
          <p>基于：{{ workflow.flowName || `编排 #${workflow.flowId}` }}</p>
          <div class="project-card-meta"><span>{{ workflow.nodes?.length || workflow.nodesSnapshot.length }} 步</span><span>{{ formatDate(workflow.updatedAt) }}</span></div>
        </div>
      </aside>

      <main class="workspace-canvas">
        <div v-if="activeLayer === 'blueprint' && !selectedProject" class="workspace-empty-state">
          <el-icon :size="44"><FolderOpened /></el-icon>
          <h2>选择项目后进入画布</h2>
          <p>左侧选择最近项目，或创建一个新的内容项目。</p>
          <el-button type="primary" @click="openCreateProject">新建项目</el-button>
        </div>
        <FlowHome
          v-else-if="activeLayer === 'blueprint' && selectedProject"
          :key="selectedProject.id"
          class="workspace-flow"
          :initial-flow-id="selectedProject.id"
        />
        <div v-else-if="!selectedWorkflow" class="workspace-empty-state"><el-icon :size="44"><FolderOpened /></el-icon><h2>创建项目后查看逐节点成果</h2><p>项目会冻结所选业务编排，并逐步保存每个节点的真实结果。</p><el-button type="primary" @click="openCreateWorkflow">新建项目工作流</el-button></div>
        <ProjectWorkflowCanvas v-else :workflow="selectedWorkflow" @updated="updateWorkflow" />
      </main>

      <aside class="workspace-inspector">
        <template v-if="activeLayer === 'blueprint' && selectedProject">
          <div class="panel-heading">
            <div>
              <span class="panel-eyebrow">PROJECT INSPECTOR</span>
              <h2>项目概览</h2>
            </div>
            <el-button text @click="openProjectSettings"><el-icon><Setting /></el-icon></el-button>
          </div>
          <div class="inspector-title">{{ selectedProject.name }}</div>
          <p class="inspector-description">{{ selectedProject.description || '为这个项目添加一句描述，方便团队协作。' }}</p>
          <div class="inspector-stats">
            <div><strong>{{ selectedProject.nodes?.length || 0 }}</strong><span>节点</span></div>
            <div><strong>{{ selectedProject.edges?.length || 0 }}</strong><span>连线</span></div>
            <div><strong>{{ selectedProject.runCount || 0 }}</strong><span>运行</span></div>
          </div>
          <div class="inspector-next">
            <span class="panel-eyebrow">NEXT STEP</span>
            <p>从画布左侧添加模块或技能，完成第一个流程节点。</p>
          </div>
        </template>
        <template v-else-if="selectedWorkflow">
          <div class="panel-heading"><div><span class="panel-eyebrow">PROJECT STATUS</span><h2>执行概览</h2></div></div>
          <div class="inspector-title">{{ selectedWorkflow.name }}</div><p class="inspector-description">基于 {{ selectedWorkflow.flowName }}</p>
          <div class="inspector-stats"><div><strong>{{ selectedWorkflow.nodes?.filter(n => n.status === 'completed').length || 0 }}</strong><span>已完成</span></div><div><strong>{{ selectedWorkflow.nodes?.filter(n => n.status === 'waiting_review').length || 0 }}</strong><span>待确认</span></div><div><strong>{{ selectedWorkflow.nodes?.filter(n => n.status === 'failed' || n.status === 'blocked').length || 0 }}</strong><span>异常</span></div></div>
          <div class="inspector-next"><span class="panel-eyebrow">CURRENT</span><p>{{ selectedWorkflow.currentNodeId || '已完成' }}</p></div>
          <el-alert v-if="selectedWorkflow.status === 'ready_to_publish'" title="成果已进入待发布区，需要确认后才会外发" type="warning" :closable="false" />
        </template>
      </aside>

      <section class="workspace-runs">
        <template v-if="activeLayer === 'blueprint'">
        <div class="panel-heading compact">
          <div>
            <span class="panel-eyebrow">RUN TIMELINE</span>
            <h2>最近运行</h2>
          </div>
          <el-button v-if="selectedProject" text @click="loadRuns(selectedProject.id)">刷新</el-button>
        </div>
        <div v-if="runLoading" class="runs-loading">加载运行记录...</div>
        <div v-else-if="runs.length === 0" class="runs-empty">项目还没有运行记录。</div>
        <div v-else class="run-list">
          <div v-for="run in runs" :key="run.id" class="run-item">
            <span class="run-status-dot" :class="run.status"></span>
            <div class="run-item-main">
              <span>运行 #{{ run.id }}</span>
              <small>{{ formatDate(run.startedAt) }} · {{ run.stepCount }} 步</small>
            </div>
            <el-tag size="small" :type="run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'">
              {{ run.status === 'completed' ? '完成' : run.status === 'failed' ? '失败' : run.status }}
            </el-tag>
          </div>
        </div>
        </template>
        <template v-else>
          <div class="panel-heading compact"><div><span class="panel-eyebrow">STEP TIMELINE</span><h2>节点成果时间线</h2></div></div>
          <div v-if="!selectedWorkflow?.nodes?.length" class="runs-empty">选择项目后显示逐节点结果。</div>
          <div v-else class="run-list"><div v-for="node in selectedWorkflow.nodes" :key="node.nodeId" class="run-item"><span class="run-status-dot" :class="node.status"></span><div class="run-item-main"><span>{{ node.label }}</span><small>{{ node.outputType || '尚无结果' }} · 尝试 {{ node.attempt }} 次</small></div><el-tag size="small">{{ node.status }}</el-tag></div></div>
        </template>
      </section>
    </div>

    <el-dialog v-model="createVisible" title="新建内容项目" width="440px">
      <el-form label-width="72px">
        <el-form-item label="项目名称">
          <el-input v-model="newProjectName" maxlength="60" show-word-limit placeholder="例如：夏季家居内容计划" />
        </el-form-item>
        <el-form-item label="项目描述">
          <el-input v-model="newProjectDescription" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="说明项目目标或内容方向" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="createProject">创建并进入画布</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="workflowCreateVisible" title="从业务编排创建项目" width="480px">
      <el-form label-width="88px">
        <el-form-item label="业务编排"><el-select v-model="workflowFlowId" style="width:100%"><el-option v-for="flow in projects" :key="flow.id" :label="`${flow.name}（${flow.nodes?.length || 0} 节点）`" :value="flow.id" /></el-select></el-form-item>
        <el-form-item label="项目名称"><el-input v-model="workflowName" placeholder="例如：8 月家居选题项目" /></el-form-item>
        <el-form-item label="初始关键词"><el-input v-model="workflowKeyword" placeholder="例如：小户型收纳" /></el-form-item>
        <el-form-item label="项目说明"><el-input v-model="workflowDescription" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="workflowCreateVisible=false">取消</el-button><el-button type="primary" :loading="workflowCreateLoading" @click="createWorkflow">创建并点亮第一步</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace-view { display: flex; flex-direction: column; height: 100%; min-height: calc(100vh - 112px); color: var(--color-text-primary); }
.workspace-header { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 20px 24px 16px; }
.workspace-kicker, .panel-eyebrow { color: var(--color-primary); font-size: 10px; font-weight: 700; letter-spacing: .12em; }
.workspace-header h1 { margin: 4px 0 2px; font-size: 24px; }
.workspace-header p { margin: 0; color: var(--color-text-secondary); font-size: 13px; }
.workspace-header-actions { display: flex; gap: 8px; }
.workspace-grid { flex: 1; display: grid; grid-template-columns: 250px minmax(460px, 1fr) 260px; grid-template-rows: minmax(420px, 1fr) 150px; gap: 12px; min-height: 0; padding: 0 16px 16px; }
.workspace-projects, .workspace-inspector, .workspace-runs { min-height: 0; overflow: auto; padding: 14px; border: 1px solid var(--color-border-light); border-radius: 12px; background: var(--color-bg-card); }
.workspace-canvas { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--color-border-light); border-radius: 12px; background: var(--color-bg-page); }
.workspace-flow { height: 100%; min-height: 0; border: 0; border-radius: 0; }
.panel-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
.panel-heading.compact { align-items: center; margin-bottom: 8px; }
.panel-heading h2 { margin: 3px 0 0; font-size: 15px; }
.new-project-card, .project-card { width: 100%; border: 1px solid var(--color-border-light); border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.new-project-card { display: flex; align-items: center; gap: 8px; padding: 10px; margin-bottom: 10px; color: var(--color-primary); font-size: 12px; }
.project-card { padding: 10px; margin-bottom: 8px; transition: border-color .15s, background .15s; }
.project-card:hover, .project-card.active { border-color: var(--color-primary); background: var(--color-primary-soft); }
.project-card-top { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
.project-card-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
.project-delete { opacity: .65; }
.project-card:hover .project-delete, .project-delete:focus { opacity: 1; }
.project-card-name { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.project-card p, .inspector-description { margin: 8px 0; color: var(--color-text-secondary); font-size: 11px; line-height: 1.5; }
.project-card-meta { display: flex; gap: 10px; color: var(--color-text-secondary); font-size: 10px; }
.empty-projects, .workspace-empty-state, .runs-empty, .runs-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--color-text-secondary); text-align: center; }
.empty-projects { padding: 32px 8px; }
.empty-projects p { margin: 8px 0 2px; color: var(--color-text-primary); font-size: 13px; }
.empty-projects span { font-size: 11px; }
.workspace-empty-state { height: 100%; gap: 8px; }
.workspace-empty-state h2 { margin: 4px 0 0; font-size: 18px; }
.workspace-empty-state p { margin: 0 0 10px; font-size: 12px; }
.inspector-title { margin: 18px 0 6px; font-size: 17px; font-weight: 700; }
.inspector-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 18px 0; }
.inspector-stats div { padding: 9px 4px; border-radius: 7px; background: var(--color-bg-subtle); text-align: center; }
.inspector-stats strong, .inspector-stats span { display: block; }
.inspector-stats strong { font-size: 18px; }
.inspector-stats span { margin-top: 2px; color: var(--color-text-secondary); font-size: 10px; }
.inspector-next { margin-top: 20px; padding: 12px; border-left: 2px solid var(--color-primary); background: var(--color-bg-subtle); }
.inspector-next p { margin: 6px 0 0; color: var(--color-text-secondary); font-size: 11px; line-height: 1.5; }
.workspace-runs { grid-column: 2 / 4; }
.run-list { display: flex; flex-wrap: wrap; gap: 8px; }
.run-item { display: flex; align-items: center; gap: 8px; min-width: 220px; flex: 1; padding: 8px 10px; border: 1px solid var(--color-border-light); border-radius: 8px; }
.run-status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-warning); }
.run-status-dot.completed { background: var(--color-success); }
.run-status-dot.failed { background: var(--color-danger); }
.run-item-main { display: flex; flex: 1; flex-direction: column; gap: 2px; font-size: 12px; }
.run-item-main small { color: var(--color-text-secondary); font-size: 10px; }
@media (max-width: 1180px) { .workspace-grid { grid-template-columns: 220px minmax(420px, 1fr); } .workspace-inspector { display: none; } .workspace-runs { grid-column: 2; } }
@media (max-width: 820px) { .workspace-header { align-items: flex-start; flex-direction: column; } .workspace-grid { display: flex; flex-direction: column; overflow: auto; } .workspace-projects { max-height: 260px; } .workspace-canvas { min-height: 560px; } .workspace-runs { min-height: 150px; } }
</style>
