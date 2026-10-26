<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminTemplateApi, adminSkillApi, adminLLMApi, adminModuleApi, adminFavoriteApi, adminStatsApi, adminApiKeyApi, adminSystemSettingsApi, adminSystemInfoApi, xhsKeywordsApi, xhsSchedulesApi, xhsLoginApi, serviceStatusApi, businessFlowApi, chatApi, adminPromptApi } from '@/api'
import type { SystemPromptDTO } from '@/api'
import { Star, Plus, Edit, Delete, Tools, Refresh, Connection, Clock, VideoPlay, Switch, View, Document, Cpu, Grid, Key, Setting, Monitor, Operation, EditPen, ChatLineRound, Fold, Expand } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()

// ============================================================
// Tab 控制 — 根据路由 query 参数 group 决定初始标签页
// ============================================================

/** 业务内容管理标签页 */
const businessTabs = ['templates', 'skills', 'modules', 'pipeline', 'business-flows', 'prompts', 'conversations']
/** 用户与系统管理标签页 */
const systemTabs = ['llm', 'api-keys', 'system-settings', 'service-status', 'favorites']

/** 根据 route.query.group 设置初始 tab */
function getInitialTab(): string {
  const group = route.query.group as string
  if (group === 'system') return 'llm'
  return 'templates' // 默认显示业务内容管理
}

const activeTab = ref<string>(getInitialTab())

// 监听路由变化，切换标签页分组
watch(
  () => route.query.group,
  (newGroup) => {
    if (newGroup === 'system' && !systemTabs.includes(activeTab.value)) {
      activeTab.value = 'llm'
    } else if ((!newGroup || newGroup === 'business') && !businessTabs.includes(activeTab.value)) {
      activeTab.value = 'templates'
    }
  }
)

// 系统管理左侧垂直菜单折叠状态
const adminSidebarCollapsed = ref(false)
function handleMenuSelect(key: string) {
  activeTab.value = key
  // 更新 URL query 以保持状态
  const group = systemTabs.includes(key) ? 'system' : 'business'
  router.replace({ query: { group } })
}

// ============================================================
// 统计数据
// ============================================================
const stats = ref<any>({ templates: {}, skills: {}, modules: {}, favorites: 0, llmProviders: 0 })
async function loadStats() {
  try {
    const res = await adminStatsApi.get()
    if (res.data) stats.value = res.data
  } catch { /* ignore */ }
}

// ============================================================
// 模板管理
// ============================================================
const templates = ref<any[]>([])
const templateLoading = ref(false)

async function loadTemplates() {
  templateLoading.value = true
  try {
    const res = await adminTemplateApi.getList()
    templates.value = res.data || []
  } catch (e) { ElMessage.error('加载模板失败: ' + (e as Error).message) }
  finally { templateLoading.value = false }
}

async function toggleTemplate(tpl: any) {
  try {
    await adminTemplateApi.update(tpl.id, { enabled: tpl.enabled ? 0 : 1 })
    tpl.enabled = tpl.enabled ? 0 : 1
    ElMessage.success(tpl.enabled ? '已启用' : '已屏蔽')
    loadStats()
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

async function toggleTemplateFavorite(tpl: any) {
  try {
    if (tpl.is_favorited) {
      await adminFavoriteApi.remove('template', String(tpl.id))
      tpl.is_favorited = 0
    } else {
      await adminFavoriteApi.add('template', String(tpl.id), tpl.name)
      tpl.is_favorited = 1
    }
    loadStats()
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

// 编辑弹窗
const editVisible = ref(false)
const editForm = ref<any>({})
const isEditing = ref(false)
function openCreate() {
  isEditing.value = false
  editForm.value = { name: '', category: '干货测评型', description: '', title_formula: '', content_structure: '', tags: '', sample_title: '', sample_body: '' }
  editVisible.value = true
}
function openEdit(tpl: any) {
  isEditing.value = true
  editForm.value = { ...tpl }
  editVisible.value = true
}
async function saveTemplate() {
  try {
    if (isEditing.value) {
      await adminTemplateApi.update(editForm.value.id, editForm.value)
      ElMessage.success('已更新')
    } else {
      await adminTemplateApi.create(editForm.value)
      ElMessage.success('已创建')
    }
    editVisible.value = false
    await loadTemplates()
    await loadStats()
  } catch (e) { ElMessage.error('保存失败: ' + (e as Error).message) }
}
async function deleteTemplate(tpl: any) {
  if (tpl.is_builtin) { ElMessage.warning('内置模板不可删除，可禁用'); return }
  try {
    await adminTemplateApi.delete(tpl.id)
    ElMessage.success('已删除')
    await loadTemplates()
    await loadStats()
  } catch (e) { ElMessage.error('删除失败: ' + (e as Error).message) }
}

// ============================================================
// 技能管理
// ============================================================
const skills = ref<any[]>([])
const skillLoading = ref(false)

async function loadSkills() {
  skillLoading.value = true
  try {
    const res = await adminSkillApi.getList()
    skills.value = res.data || []
  } catch (e) { ElMessage.error('加载技能列表失败: ' + (e as Error).message) }
  finally { skillLoading.value = false }
}

async function toggleSkill(skl: any) {
  try {
    await adminSkillApi.update(skl.name, { enabled: skl.enabled ? 0 : 1 })
    skl.enabled = skl.enabled ? 0 : 1
    ElMessage.success(skl.enabled ? '已启用' : '已禁用')
    loadStats()
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

async function toggleSkillFavorite(skl: any) {
  try {
    if (skl.is_favorited) {
      await adminFavoriteApi.remove('skill', skl.name)
      skl.is_favorited = 0
    } else {
      await adminFavoriteApi.add('skill', skl.name, skl.label || skl.name)
      skl.is_favorited = 1
    }
    loadStats()
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

// ============================================================
// LLM 配置
// ============================================================
const llmConfigs = ref<any[]>([])
const llmLoading = ref(false)

async function loadLLM() {
  llmLoading.value = true
  try {
    const res = await adminLLMApi.getList()
    llmConfigs.value = res.data || []
  } catch (e) { ElMessage.error('加载 LLM 配置失败: ' + (e as Error).message) }
  finally { llmLoading.value = false }
}

async function toggleLLM(llm: any) {
  try {
    await adminLLMApi.update(llm.provider, { enabled: llm.enabled ? 0 : 1 })
    llm.enabled = llm.enabled ? 0 : 1
    ElMessage.success(llm.enabled ? '已启用' : '已禁用')
    loadStats()
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

// LLM 编辑弹窗
const llmEditVisible = ref(false)
const llmEditForm = ref<any>({})
function openLLMEdit(llm: any) {
  llmEditForm.value = { ...llm }
  llmEditVisible.value = true
}
async function saveLLM() {
  try {
    const { provider, model, endpoint, api_key, timeout_ms, label } = llmEditForm.value
    await adminLLMApi.update(provider, { model, endpoint, api_key, timeout_ms, label })
    ElMessage.success('已更新')
    llmEditVisible.value = false
    await loadLLM()
  } catch (e) { ElMessage.error('保存失败: ' + (e as Error).message) }
}

// ============================================================
// 用户自定义大模型快捷配置
// ============================================================

const quickModelName = ref('')
const quickModelProvider = ref('')
const quickModelEndpoint = ref('')
const quickModelApiKey = ref('')

/** 自定义模型添加弹窗 */
const customLLMDialogVisible = ref(false)
const customLLMForm = ref({
  name: '',
  provider: '',
  endpoint: '',
  apiKey: '',
})

/** 打开自定义模型添加弹窗 */
function openAddCustomLLM() {
  customLLMForm.value = { name: '', provider: '', endpoint: '', apiKey: '' }
  customLLMDialogVisible.value = true
}

/** 快捷添加自定义模型 */
async function quickAddCustomLLM() {
  if (!quickModelName.value.trim()) {
    ElMessage.warning('请输入模型名称')
    return
  }
  if (!quickModelProvider.value.trim()) {
    ElMessage.warning('请选择或输入提供商')
    return
  }

  try {
    await adminLLMApi.update(quickModelProvider.value, {
      model: quickModelName.value,
      endpoint: quickModelEndpoint.value || undefined,
      api_key: quickModelApiKey.value || undefined,
      label: quickModelName.value,
      enabled: 1,
    })
    ElMessage.success(`自定义模型「${quickModelName.value}」已添加`)
    quickModelName.value = ''
    quickModelProvider.value = ''
    quickModelEndpoint.value = ''
    quickModelApiKey.value = ''
    await loadLLM()
  } catch (e) {
    ElMessage.error('添加失败: ' + (e as Error).message)
  }
}

/** 保存弹窗中的自定义模型 */
async function saveCustomLLMDialog() {
  if (!customLLMForm.value.name.trim()) {
    ElMessage.warning('请输入模型名称')
    return
  }
  if (!customLLMForm.value.provider.trim()) {
    ElMessage.warning('请输入提供商')
    return
  }

  try {
    await adminLLMApi.update(customLLMForm.value.provider, {
      model: customLLMForm.value.name,
      endpoint: customLLMForm.value.endpoint || undefined,
      api_key: customLLMForm.value.apiKey || undefined,
      label: customLLMForm.value.name,
      enabled: 1,
    })
    ElMessage.success(`自定义模型「${customLLMForm.value.name}」已添加`)
    customLLMDialogVisible.value = false
    await loadLLM()
  } catch (e) {
    ElMessage.error('添加失败: ' + (e as Error).message)
  }
}

// ============================================================
// 模块管理
// ============================================================
const modules = ref<any[]>([])
const moduleLoading = ref(false)

async function loadModules() {
  moduleLoading.value = true
  try {
    const res = await adminModuleApi.getList()
    modules.value = res.data || []
  } catch (e) { ElMessage.error('加载模块列表失败: ' + (e as Error).message) }
  finally { moduleLoading.value = false }
}

async function toggleModule(mod: any) {
  try {
    await adminModuleApi.update(mod.id, { enabled: mod.enabled ? 0 : 1 })
    mod.enabled = mod.enabled ? 0 : 1
    ElMessage.success(mod.enabled ? '已启用' : '已禁用')
    loadStats()
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

// ============================================================
// 流水线配置（小红书关键词、定时任务、登录状态）
// ============================================================
const xhsKeywords = ref<any[]>([])
const xhsKeywordLoading = ref(false)
const xhsSchedules = ref<any[]>([])
const xhsScheduleLoading = ref(false)
const xhsLoginStatus = ref<any>(null)
const xhsLoginLoading = ref(false)

// 关键词编辑弹窗
const keywordEditVisible = ref(false)
const keywordEditForm = ref<any>({ keyword: '', name: '', description: '', category: '', enabled: true })
const keywordEditing = ref(false)

// 定时任务编辑弹窗
const scheduleEditVisible = ref(false)
const scheduleEditForm = ref<any>({ name: '', keyword: '', cron_expression: '0 9 * * *', enabled: true })
const scheduleEditing = ref(false)

async function loadXhsKeywords() {
  xhsKeywordLoading.value = true
  try {
    const res = await xhsKeywordsApi.getList()
    xhsKeywords.value = res.data || []
  } catch (e) { ElMessage.error('加载关键词失败: ' + (e as Error).message) }
  finally { xhsKeywordLoading.value = false }
}

async function loadXhsSchedules() {
  xhsScheduleLoading.value = true
  try {
    const res = await xhsSchedulesApi.getList()
    xhsSchedules.value = res.data || []
  } catch (e) { ElMessage.error('加载定时任务失败: ' + (e as Error).message) }
  finally { xhsScheduleLoading.value = false }
}

async function loadXhsLoginStatus() {
  xhsLoginLoading.value = true
  try {
    const res = await xhsLoginApi.getStatus()
    xhsLoginStatus.value = res.data || null
  } catch { xhsLoginStatus.value = null }
  finally { xhsLoginLoading.value = false }
}

async function toggleXhsKeyword(kw: any) {
  try {
    await xhsKeywordsApi.update(kw.id, { enabled: !kw.enabled })
    kw.enabled = kw.enabled ? 0 : 1
    ElMessage.success(kw.enabled ? '已启用' : '已禁用')
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

async function toggleXhsSchedule(sch: any) {
  try {
    await xhsSchedulesApi.update(sch.id, { enabled: !sch.enabled })
    sch.enabled = sch.enabled ? 0 : 1
    ElMessage.success(sch.enabled ? '已启用' : '已禁用')
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

function openKeywordCreate() {
  keywordEditing.value = false
  keywordEditForm.value = { keyword: '', name: '', description: '', category: '', enabled: true }
  keywordEditVisible.value = true
}
function openKeywordEdit(kw: any) {
  keywordEditing.value = true
  keywordEditForm.value = { ...kw }
  keywordEditVisible.value = true
}
async function saveKeyword() {
  try {
    if (keywordEditing.value) {
      await xhsKeywordsApi.update(keywordEditForm.value.id, keywordEditForm.value)
      ElMessage.success('已更新')
    } else {
      await xhsKeywordsApi.create(keywordEditForm.value)
      ElMessage.success('已创建')
    }
    keywordEditVisible.value = false
    await loadXhsKeywords()
  } catch (e) { ElMessage.error('保存失败: ' + (e as Error).message) }
}
async function deleteKeyword(kw: any) {
  try {
    await xhsKeywordsApi.delete(kw.id)
    ElMessage.success('已删除')
    await loadXhsKeywords()
  } catch (e) { ElMessage.error('删除失败: ' + (e as Error).message) }
}
async function triggerKeyword(kw: any) {
  try {
    await xhsKeywordsApi.trigger(kw.id)
    ElMessage.success(`已用关键词 '${kw.keyword}' 启动流水线`)
  } catch (e) { ElMessage.error('触发失败: ' + (e as Error).message) }
}

function openScheduleCreate() {
  scheduleEditing.value = false
  scheduleEditForm.value = { name: '', keyword: '', cron_expression: '0 9 * * *', enabled: true }
  scheduleEditVisible.value = true
}
function openScheduleEdit(sch: any) {
  scheduleEditing.value = true
  scheduleEditForm.value = { ...sch }
  scheduleEditVisible.value = true
}
async function saveSchedule() {
  try {
    if (scheduleEditing.value) {
      await xhsSchedulesApi.update(scheduleEditForm.value.id, scheduleEditForm.value)
      ElMessage.success('已更新')
    } else {
      await xhsSchedulesApi.create(scheduleEditForm.value)
      ElMessage.success('已创建')
    }
    scheduleEditVisible.value = false
    await loadXhsSchedules()
  } catch (e) { ElMessage.error('保存失败: ' + (e as Error).message) }
}
async function deleteSchedule(sch: any) {
  try {
    await xhsSchedulesApi.delete(sch.id)
    ElMessage.success('已删除')
    await loadXhsSchedules()
  } catch (e) { ElMessage.error('删除失败: ' + (e as Error).message) }
}
async function triggerSchedule(sch: any) {
  try {
    await xhsSchedulesApi.trigger(sch.id)
    ElMessage.success(`已用关键词 '${sch.keyword}' 启动流水线`)
  } catch (e) { ElMessage.error('触发失败: ' + (e as Error).message) }
}

async function refreshXhsLogin() {
  try {
    await xhsLoginApi.refresh()
    ElMessage.success('Cookie 刷新请求已发送')
    await loadXhsLoginStatus()
  } catch (e) { ElMessage.error('刷新失败: ' + (e as Error).message) }
}
async function startQrLogin() {
  try {
    await xhsLoginApi.startQrLogin()
    ElMessage.success('QR 登录已启动，请在弹出的浏览器中扫码')
    await loadXhsLoginStatus()
  } catch (e) { ElMessage.error('启动登录失败: ' + (e as Error).message) }
}

// ============================================================
// API 密钥管理
// ============================================================
const apiKeys = ref<any[]>([])
const apiKeyLoading = ref(false)
const apiKeyEditVisible = ref(false)
const apiKeyEditForm = ref<any>({})

async function loadApiKeys() {
  apiKeyLoading.value = true
  try {
    const res = await adminApiKeyApi.getList()
    apiKeys.value = res.data || []
  } catch (e) { ElMessage.error('加载 API 密钥失败: ' + (e as Error).message) }
  finally { apiKeyLoading.value = false }
}
async function toggleApiKey(key: any) {
  try {
    await adminApiKeyApi.update(key.key_name, { enabled: key.enabled ? 0 : 1 })
    key.enabled = key.enabled ? 0 : 1
    ElMessage.success(key.enabled ? '已启用' : '已禁用')
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}
function openApiKeyEdit(key: any) {
  // 编辑时清空密钥字段，用户可重新输入（留空则保持不变）
  apiKeyEditForm.value = { ...key, api_key: '' }
  apiKeyEditVisible.value = true
}
async function saveApiKey() {
  try {
    const { key_name, api_key, label, description } = apiKeyEditForm.value
    await adminApiKeyApi.update(key_name, { api_key, label, description })
    ElMessage.success('已更新')
    apiKeyEditVisible.value = false
    await loadApiKeys()
  } catch (e) { ElMessage.error('保存失败: ' + (e as Error).message) }
}

// ============================================================
// 系统设置管理
// ============================================================
const systemSettings = ref<any[]>([])
const systemSettingsLoading = ref(false)
const systemInfo = ref<Record<string, any>>({})

async function loadSystemSettings() {
  systemSettingsLoading.value = true
  try {
    const res = await adminSystemSettingsApi.getList()
    systemSettings.value = res.data || []
  } catch (e) { ElMessage.error('加载系统设置失败: ' + (e as Error).message) }
  finally { systemSettingsLoading.value = false }
}
async function loadSystemInfo() {
  try {
    const res = await adminSystemInfoApi.get()
    systemInfo.value = res.data || {}
  } catch { /* ignore */ }
}
async function saveSystemSetting(item: any) {
  try {
    await adminSystemSettingsApi.update(item.key, item.value)
    ElMessage.success(`${item.label} 已更新`)
  } catch (e) { ElMessage.error('保存失败: ' + (e as Error).message) }
}

// ============================================================
// 服务监控
// ============================================================
const serviceStatus = ref<any>(null)
const serviceStatusLoading = ref(false)
const serviceStarting = ref(false)
const serviceStopping = ref(false)

async function loadServiceStatus() {
  serviceStatusLoading.value = true
  try {
    const res = await serviceStatusApi.getStatus()
    serviceStatus.value = res.data || null
  } catch (e) { ElMessage.error('加载服务状态失败: ' + (e as Error).message) }
  finally { serviceStatusLoading.value = false }
}

async function startAllServices() {
  try {
    await ElMessageBox.confirm('确定要启动所有服务吗？此操作可能需要一些时间。', '启动全部服务', {
      confirmButtonText: '确定启动',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch { return }
  serviceStarting.value = true
  try {
    await serviceStatusApi.startAll()
    ElMessage.success('所有服务启动指令已发送')
    await loadServiceStatus()
    await loadStats()
  } catch (e) { ElMessage.error('启动服务失败: ' + (e as Error).message) }
  finally { serviceStarting.value = false }
}

async function stopAllServices() {
  try {
    await ElMessageBox.confirm('确定要停止所有服务吗？停止后相关功能将不可用。', '停止全部服务', {
      confirmButtonText: '确定停止',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch { return }
  serviceStopping.value = true
  try {
    await serviceStatusApi.stopAll()
    ElMessage.success('所有服务停止指令已发送')
    await loadServiceStatus()
  } catch (e) { ElMessage.error('停止服务失败: ' + (e as Error).message) }
  finally { serviceStopping.value = false }
}

// ============================================================
// 收藏管理
// ============================================================
const favorites = ref<any[]>([])
const favoritesLoading = ref(false)
const favoritesFilter = ref<string>('all')

const favoritesByType = computed(() => {
  if (favoritesFilter.value === 'all') return favorites.value
  return favorites.value.filter(f => f.target_type === favoritesFilter.value)
})

const favoriteTypeMap: Record<string, string> = {
  template: '模板',
  skill: '技能',
  module: '模块',
  video_record: '视频记录',
  chat_message: '对话消息',
  content: '内容',
  prompt: '提示词',
}

async function loadFavorites() {
  favoritesLoading.value = true
  try {
    const res = await adminFavoriteApi.getList()
    favorites.value = res.data || []
  } catch (e) { ElMessage.error('加载收藏列表失败: ' + (e as Error).message) }
  finally { favoritesLoading.value = false }
}

async function removeFavorite(item: any) {
  try {
    await adminFavoriteApi.remove(item.target_type, item.target_id)
    favorites.value = favorites.value.filter(f => f.id !== item.id)
    ElMessage.success('已取消收藏')
    loadStats()
  } catch (e) { ElMessage.error('取消收藏失败: ' + (e as Error).message) }
}

// ============================================================
// 提示词管理
// ============================================================
const prompts = ref<SystemPromptDTO[]>([])
const promptLoading = ref(false)
const promptEditVisible = ref(false)
const promptEditForm = ref({
  id: 0,
  name: '',
  label: '',
  category: 'general',
  content: '',
  description: '',
  variables: '' as string,
  enabled: 1,
})
const promptIsEdit = ref(false)

async function loadPrompts() {
  promptLoading.value = true
  try {
    const res = await adminPromptApi.getList()
    prompts.value = res.data || []
  } catch (e) { ElMessage.error('加载提示词失败: ' + (e as Error).message) }
  finally { promptLoading.value = false }
}

function openPromptCreate() {
  promptIsEdit.value = false
  promptEditForm.value = {
    id: 0, name: '', label: '', category: 'general',
    content: '', description: '', variables: '', enabled: 1,
  }
  promptEditVisible.value = true
}

function openPromptEdit(row: SystemPromptDTO) {
  promptIsEdit.value = true
  promptEditForm.value = {
    id: row.id,
    name: row.name,
    label: row.label,
    category: row.category,
    content: row.content,
    description: row.description,
    variables: row.variables,
    enabled: row.enabled,
  }
  promptEditVisible.value = true
}

async function savePrompt() {
  if (!promptEditForm.value.label.trim()) {
    ElMessage.warning('请输入提示词名称')
    return
  }
  if (!promptIsEdit.value && !promptEditForm.value.name.trim()) {
    ElMessage.warning('请输入提示词标识')
    return
  }
  try {
    const varList = promptEditForm.value.variables
      ? promptEditForm.value.variables.split(',').map(v => v.trim()).filter(Boolean)
      : []

    if (promptIsEdit.value) {
      await adminPromptApi.update(promptEditForm.value.id, {
        label: promptEditForm.value.label,
        category: promptEditForm.value.category,
        content: promptEditForm.value.content,
        description: promptEditForm.value.description,
        variables: varList,
        enabled: promptEditForm.value.enabled === 1,
      })
      ElMessage.success('提示词更新成功')
    } else {
      await adminPromptApi.create({
        name: promptEditForm.value.name,
        label: promptEditForm.value.label,
        category: promptEditForm.value.category,
        content: promptEditForm.value.content,
        description: promptEditForm.value.description,
        variables: varList,
      })
      ElMessage.success('提示词创建成功')
    }
    promptEditVisible.value = false
    await loadPrompts()
    loadStats()
  } catch (e) { ElMessage.error('保存提示词失败: ' + (e as Error).message) }
}

async function togglePromptEnabled(row: SystemPromptDTO) {
  try {
    await adminPromptApi.update(row.id, { enabled: !row.enabled })
    row.enabled = row.enabled ? 0 : 1
    ElMessage.success(row.enabled ? '已启用' : '已禁用')
  } catch (e) { ElMessage.error('操作失败: ' + (e as Error).message) }
}

async function deletePrompt(row: SystemPromptDTO) {
  try {
    await ElMessageBox.confirm(`确定删除提示词「${row.label}」？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
    await adminPromptApi.delete(row.id)
    ElMessage.success('提示词已删除')
    await loadPrompts()
    loadStats()
  } catch { /* cancelled */ }
}

// Whisper 模型选项（系统设置 select 类型用）
const whisperModelOptions = ['tiny', 'base', 'small', 'medium', 'large-v3']

// ============================================================
// 业务流线管理
// ============================================================
const businessFlows = ref<any[]>([])
const businessFlowLoading = ref(false)
const businessFlowTotal = ref(0)

async function loadBusinessFlows() {
  businessFlowLoading.value = true
  try {
    const res = await businessFlowApi.getList({ page: 1, pageSize: 50 })
    businessFlows.value = res.data || []
    businessFlowTotal.value = res.total || 0
  } catch (e) { ElMessage.error('加载业务流线失败: ' + (e as Error).message) }
  finally { businessFlowLoading.value = false }
}

async function deleteBusinessFlow(flow: any) {
  try {
    await ElMessageBox.confirm(`确定删除业务流线 "${flow.name}" 吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await businessFlowApi.delete(flow.id)
    ElMessage.success('已删除')
    await loadBusinessFlows()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败: ' + (e as Error).message)
  }
}

async function executeBusinessFlow(flow: any) {
  try {
    await ElMessageBox.confirm(`确定执行业务流线 "${flow.name}" 吗？`, '执行确认', {
      confirmButtonText: '执行',
      cancelButtonText: '取消',
      type: 'info'
    })
    ElMessage.info('开始执行业务流线...')
    await businessFlowApi.execute(flow.id)
    ElMessage.success('业务流线执行完成')
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('执行失败: ' + (e as Error).message)
  }
}

// ============================================================
// 对话记录管理
// ============================================================
const conversations = ref<any[]>([])
const conversationLoading = ref(false)
const conversationDetail = ref<any>(null)
const conversationDetailVisible = ref(false)
const conversationMessages = ref<any[]>([])

async function loadConversations() {
  conversationLoading.value = true
  try {
    const res = await chatApi.getConversations()
    conversations.value = res.data || []
  } catch (e) { ElMessage.error('加载对话记录失败: ' + (e as Error).message) }
  finally { conversationLoading.value = false }
}

async function viewConversation(conv: any) {
  conversationDetail.value = conv
  conversationDetailVisible.value = true
  try {
    const res = await chatApi.getMessages(conv.id)
    conversationMessages.value = res.data || []
  } catch (e) { ElMessage.error('加载消息失败: ' + (e as Error).message) }
}

async function renameConversation(conv: any) {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的对话标题', '重命名', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: conv.title,
    })
    if (value && value !== conv.title) {
      await chatApi.rename(conv.id, value)
      conv.title = value
      ElMessage.success('已重命名')
    }
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('重命名失败: ' + (e as Error).message)
  }
}

async function deleteConversation(conv: any) {
  try {
    await ElMessageBox.confirm(`确定删除对话 "${conv.title}" 吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await chatApi.delete(conv.id)
    ElMessage.success('已删除')
    await loadConversations()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败: ' + (e as Error).message)
  }
}

// ============================================================
// 生命周期
// ============================================================
onMounted(() => {
  loadStats()
  loadTemplates()
  loadSkills()
  loadLLM()
  loadModules()
  // 流水线配置、API密钥、系统设置
  loadXhsKeywords()
  loadXhsSchedules()
  loadXhsLoginStatus()
  loadApiKeys()
  loadSystemSettings()
  loadSystemInfo()
  loadServiceStatus()
  loadFavorites()
  loadPrompts()
  loadBusinessFlows()
  loadConversations()
})

// 分类选项（模板用）
const categoryOptions = [
  '干货测评型', '好物合集型', '对比测评型', '问题解答型', '故事分享型',
  '体验分享型', '教程攻略型', '日常Vlog型', '产品种草型', '行业洞察型',
  '清单盘点型', '评论互动型', '装修家居型', '母婴育儿型', '美食教程型',
  '穿搭分享型', '旅行攻略型',
]
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <span class="page-title">系统管理</span>
        <p class="page-desc">统一管理模板库、技能、LLM 和模块开关，管理应用于全项目</p>
      </div>
    </div>

    <!-- 概览卡片 -->
    <div class="stats-row">
      <div class="stat-card"><span class="stat-num">{{ stats.templates?.enabled || 0 }}/{{ stats.templates?.total || 0 }}</span><span class="stat-label">模板启用</span></div>
      <div class="stat-card"><span class="stat-num">{{ stats.skills?.enabled || 0 }}/{{ stats.skills?.total || 0 }}</span><span class="stat-label">技能启用</span></div>
      <div class="stat-card"><span class="stat-num">{{ stats.llmProviders || 0 }}</span><span class="stat-label">LLM 可用</span></div>
      <div class="stat-card"><span class="stat-num">{{ stats.modules?.enabled || 0 }}/{{ stats.modules?.total || 0 }}</span><span class="stat-label">模块启用</span></div>
      <div class="stat-card"><span class="stat-num">{{ stats.favorites || 0 }}</span><span class="stat-label">收藏数</span></div>
      <div class="stat-card"><span class="stat-num">{{ businessFlows.length }}</span><span class="stat-label">业务流线</span></div>
      <div class="stat-card"><span class="stat-num">{{ conversations.length }}</span><span class="stat-label">对话记录</span></div>
    </div>

    <!-- 主体：左侧垂直菜单 + 右侧内容 -->
    <div class="admin-body">
      <aside class="admin-sidebar" :class="{ collapsed: adminSidebarCollapsed }">
        <el-menu
          :default-active="activeTab"
          :collapse="adminSidebarCollapsed"
          :collapse-transition="false"
          @select="handleMenuSelect"
        >
          <!-- === 业务内容管理 === -->
          <el-menu-item-group :title="adminSidebarCollapsed ? '' : '业务内容管理'">
            <el-menu-item index="templates">
              <el-icon><Document /></el-icon>
              <template #title>模板管理</template>
            </el-menu-item>
            <el-menu-item index="skills">
              <el-icon><Tools /></el-icon>
              <template #title>技能管理</template>
            </el-menu-item>
            <el-menu-item index="modules">
              <el-icon><Grid /></el-icon>
              <template #title>模块管理</template>
            </el-menu-item>
            <el-menu-item index="pipeline">
              <el-icon><Connection /></el-icon>
              <template #title>流水线配置</template>
            </el-menu-item>
            <el-menu-item index="business-flows">
              <el-icon><Operation /></el-icon>
              <template #title>业务流线</template>
            </el-menu-item>
            <el-menu-item index="prompts">
              <el-icon><EditPen /></el-icon>
              <template #title>提示词管理</template>
            </el-menu-item>
            <el-menu-item index="conversations">
              <el-icon><ChatLineRound /></el-icon>
              <template #title>对话记录</template>
            </el-menu-item>
          </el-menu-item-group>

          <!-- === 用户与系统管理 === -->
          <el-menu-item-group :title="adminSidebarCollapsed ? '' : '用户与系统管理'">
            <el-menu-item index="llm">
              <el-icon><Cpu /></el-icon>
              <template #title>大模型管理</template>
            </el-menu-item>
            <el-menu-item index="api-keys">
              <el-icon><Key /></el-icon>
              <template #title>API 密钥</template>
            </el-menu-item>
            <el-menu-item index="system-settings">
              <el-icon><Setting /></el-icon>
              <template #title>系统设置</template>
            </el-menu-item>
            <el-menu-item index="service-status">
              <el-icon><Monitor /></el-icon>
              <template #title>服务监控</template>
            </el-menu-item>
            <el-menu-item index="favorites">
              <el-icon><Star /></el-icon>
              <template #title>收藏管理</template>
            </el-menu-item>
          </el-menu-item-group>
        </el-menu>
        <div class="sidebar-collapse-btn" :title="adminSidebarCollapsed ? '展开菜单' : '折叠菜单'" @click="adminSidebarCollapsed = !adminSidebarCollapsed">
          <el-icon>
            <Expand v-if="adminSidebarCollapsed" />
            <Fold v-else />
          </el-icon>
          <span v-if="!adminSidebarCollapsed" class="collapse-text">折叠</span>
        </div>
      </aside>
      <div class="admin-content">
        <el-card shadow="never">
        <!-- ====== 模板管理 ====== -->
        <div v-show="activeTab === 'templates'">
          <div class="tab-header">
            <span class="tab-desc">管理内容创作时可选用的模板库（屏蔽后不在内容工作室显示）</span>
            <el-button type="primary" size="small" :icon="Plus" @click="openCreate">新增模板</el-button>
          </div>
          <el-table :data="templates" v-loading="templateLoading" stripe style="width:100%">
            <el-table-column label="收藏" width="60" align="center">
              <template #default="{ row }">
                <el-icon :size="18" :color="row.is_favorited ? 'var(--color-warning)' : 'var(--color-text-placeholder)'" style="cursor:pointer" @click="toggleTemplateFavorite(row)">
                  <Star />
                </el-icon>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
            <el-table-column prop="category" label="分类" width="110" />
            <el-table-column prop="subcategory" label="子分类" width="90" />
            <el-table-column label="内置" width="70" align="center">
              <template #default="{ row }">
                <el-tag :type="row.is_builtin ? 'info' : ''" size="small">{{ row.is_builtin ? '是' : '否' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="usage_count" label="使用次数" width="90" align="center" />
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="toggleTemplate(row)" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button size="small" text @click="openEdit(row)"><el-icon><Edit /></el-icon></el-button>
                <el-button v-if="!row.is_builtin" size="small" text type="danger" @click="deleteTemplate(row)"><el-icon><Delete /></el-icon></el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- ====== 技能管理 ====== -->
        <div v-show="activeTab === 'skills'">
          <div class="tab-header"><span class="tab-desc">管理系统集成的 AI 技能（启用/禁用、收藏）</span></div>
          <el-table :data="skills" v-loading="skillLoading" stripe style="width:100%">
            <el-table-column label="收藏" width="60" align="center">
              <template #default="{ row }">
                <el-icon :size="18" :color="row.is_favorited ? 'var(--color-warning)' : 'var(--color-text-placeholder)'" style="cursor:pointer" @click="toggleSkillFavorite(row)"><Star /></el-icon>
              </template>
            </el-table-column>
            <el-table-column prop="label" label="技能名称" min-width="150" />
            <el-table-column prop="name" label="标识名" width="150" />
            <el-table-column prop="custom_description" label="描述" min-width="200" show-overflow-tooltip />
            <el-table-column prop="display_order" label="排序" width="70" align="center" />
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="toggleSkill(row)" size="small" />
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- ====== 大模型管理 ====== -->
        <div v-show="activeTab === 'llm'">
          <div class="tab-header">
            <span class="tab-desc">管理大语言模型提供商配置（模型/端点/API Key），支持添加用户自定义模型</span>
            <el-button type="primary" size="small" :icon="Plus" @click="openAddCustomLLM">添加自定义模型</el-button>
          </div>

          <!-- 系统默认模型 -->
          <div class="llm-section-label">
            <el-icon><Setting /></el-icon>
            <span>系统默认模型</span>
          </div>
          <el-table :data="llmConfigs" v-loading="llmLoading" stripe style="width:100%">
            <el-table-column prop="label" label="提供商" width="120" />
            <el-table-column prop="provider" label="标识" width="100" />
            <el-table-column prop="model" label="默认模型" width="160" />
            <el-table-column prop="endpoint" label="端点" min-width="200" show-overflow-tooltip />
            <el-table-column prop="api_key" label="API Key" width="120" />
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="toggleLLM(row)" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button size="small" text @click="openLLMEdit(row)"><el-icon><Edit /></el-icon></el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 用户自定义模型快捷配置 -->
          <div class="llm-section-label" style="margin-top: 20px;">
            <el-icon><Plus /></el-icon>
            <span>快捷添加自定义模型</span>
          </div>
          <div class="custom-llm-quick-add">
            <el-input
              v-model="quickModelName"
              placeholder="模型名称（如：gpt-4o, claude-3-opus）"
              style="width: 200px"
            />
            <el-select
              v-model="quickModelProvider"
              placeholder="选择提供商"
              filterable
              allow-create
              style="width: 160px"
            >
              <el-option label="OpenAI" value="openai" />
              <el-option label="Anthropic" value="anthropic" />
              <el-option label="智谱AI (GLM)" value="zhipu" />
              <el-option label="DeepSeek" value="deepseek" />
              <el-option label="Ollama (本地)" value="ollama" />
              <el-option label="月之暗面 (Moonshot)" value="moonshot" />
              <el-option label="自定义" value="custom" />
            </el-select>
            <el-input
              v-model="quickModelEndpoint"
              placeholder="API端点（可选，留空使用默认）"
              style="width: 280px"
            />
            <el-input
              v-model="quickModelApiKey"
              placeholder="API Key（可选）"
              type="password"
              show-password
              style="width: 200px"
            />
            <el-button type="primary" size="small" :icon="Plus" @click="quickAddCustomLLM">
              添加
            </el-button>
          </div>
        </div>

        <!-- ====== 模块管理 ====== -->
        <div v-show="activeTab === 'modules'">
          <div class="tab-header"><span class="tab-desc">管理项目各功能模块的启用/禁用（禁用后菜单不再显示）</span></div>
          <el-table :data="modules" v-loading="moduleLoading" stripe style="width:100%">
            <el-table-column prop="label" label="模块名称" min-width="140" />
            <el-table-column prop="id" label="标识" width="130" />
            <el-table-column label="分类" width="120">
              <template #default="{ row }">
                <el-tag size="small">{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
            <el-table-column prop="access_url" label="访问路径" width="140" />
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="toggleModule(row)" size="small" />
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- ====== 流水线配置 ====== -->
        <div v-show="activeTab === 'pipeline'">
          <!-- 登录状态 -->
          <div class="section-block">
            <div class="section-title">
              <el-icon><Connection /></el-icon>
              <span>小红书登录状态</span>
            </div>
            <div v-loading="xhsLoginLoading" class="login-status-row">
              <template v-if="xhsLoginStatus">
                <el-tag :type="xhsLoginStatus.is_logged_in ? 'success' : 'danger'" size="large">
                  {{ xhsLoginStatus.is_logged_in ? '已登录' : '未登录' }}
                </el-tag>
                <span class="login-info-item" v-if="xhsLoginStatus.is_logged_in">
                  Cookie 年龄: {{ xhsLoginStatus.cookie_age_days.toFixed(1) }} 天
                </span>
                <span class="login-info-item" v-if="xhsLoginStatus.is_logged_in">
                  上次登录: {{ xhsLoginStatus.last_login_time || '未知' }}
                </span>
                <span class="login-info-item">
                  浏览器: {{ xhsLoginStatus.browser || '未知' }}
                </span>
                <el-tag v-if="xhsLoginStatus.will_expire_soon" type="warning" size="small">即将过期</el-tag>
              </template>
              <span v-else class="login-info-item">无法获取登录状态</span>
              <div class="login-actions">
                <el-button size="small" :icon="Refresh" @click="loadXhsLoginStatus">刷新状态</el-button>
                <el-button size="small" type="primary" :icon="Refresh" @click="refreshXhsLogin" :disabled="!xhsLoginStatus?.is_logged_in">
                  刷新 Cookie
                </el-button>
                <el-button size="small" type="warning" @click="startQrLogin">QR 扫码登录</el-button>
              </div>
            </div>
          </div>

          <!-- 关键词管理 -->
          <div class="section-block">
            <div class="tab-header">
              <span class="section-title"><el-icon><Star /></el-icon><span>关键词管理</span></span>
              <el-button type="primary" size="small" :icon="Plus" @click="openKeywordCreate">新增关键词</el-button>
            </div>
            <el-table :data="xhsKeywords" v-loading="xhsKeywordLoading" stripe style="width:100%" size="small">
              <el-table-column prop="keyword" label="关键词" min-width="140" />
              <el-table-column prop="name" label="名称" width="120" show-overflow-tooltip />
              <el-table-column prop="category" label="分类" width="100" />
              <el-table-column prop="use_count" label="使用次数" width="90" align="center" />
              <el-table-column prop="last_used_at" label="上次使用" width="150" show-overflow-tooltip />
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-switch :model-value="!!row.enabled" @change="toggleXhsKeyword(row)" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="170" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" text type="success" @click="triggerKeyword(row)">触发</el-button>
                  <el-button size="small" text @click="openKeywordEdit(row)"><el-icon><Edit /></el-icon></el-button>
                  <el-button size="small" text type="danger" @click="deleteKeyword(row)"><el-icon><Delete /></el-icon></el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 定时任务管理 -->
          <div class="section-block">
            <div class="tab-header">
              <span class="section-title"><el-icon><Clock /></el-icon><span>定时任务管理</span></span>
              <el-button type="primary" size="small" :icon="Plus" @click="openScheduleCreate">新增定时任务</el-button>
            </div>
            <el-table :data="xhsSchedules" v-loading="xhsScheduleLoading" stripe style="width:100%" size="small">
              <el-table-column prop="name" label="任务名称" min-width="120" />
              <el-table-column prop="keyword" label="关键词" width="120" />
              <el-table-column prop="cron_expression" label="Cron 表达式" width="140" />
              <el-table-column prop="run_count" label="运行次数" width="90" align="center" />
              <el-table-column prop="last_run_at" label="上次运行" width="150" show-overflow-tooltip />
              <el-table-column prop="last_run_status" label="上次状态" width="90">
                <template #default="{ row }">
                  <el-tag v-if="row.last_run_status" :type="row.last_run_status === 'success' ? 'success' : 'danger'" size="small">
                    {{ row.last_run_status }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-switch :model-value="!!row.enabled" @change="toggleXhsSchedule(row)" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="140" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" text type="success" @click="triggerSchedule(row)">触发</el-button>
                  <el-button size="small" text @click="openScheduleEdit(row)"><el-icon><Edit /></el-icon></el-button>
                  <el-button size="small" text type="danger" @click="deleteSchedule(row)"><el-icon><Delete /></el-icon></el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <!-- ====== API 密钥管理 ====== -->
        <div v-show="activeTab === 'api-keys'">
          <div class="tab-header">
            <span class="tab-desc">集中管理外部服务 API 密钥（TikHub 等），密钥仅显示掩码，编辑后可更新</span>
          </div>
          <el-table :data="apiKeys" v-loading="apiKeyLoading" stripe style="width:100%">
            <el-table-column prop="label" label="服务名称" min-width="140" />
            <el-table-column prop="key_name" label="标识" width="120" />
            <el-table-column label="分类" width="130">
              <template #default="{ row }">
                <el-tag size="small">{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="密钥" min-width="180">
              <template #default="{ row }">
                <span v-if="row.has_key" class="key-masked">{{ row.api_key }}</span>
                <el-tag v-else type="info" size="small">未设置</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="toggleApiKey(row)" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button size="small" text @click="openApiKeyEdit(row)"><el-icon><Edit /></el-icon></el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- ====== 系统设置 ====== -->
        <div v-show="activeTab === 'system-settings'">
          <div class="tab-header">
            <span class="tab-desc">管理系统级偏好设置（Whisper 模型、图片生成、调度器等），修改后即时生效</span>
          </div>

          <!-- 按类别分组展示设置项 -->
          <div v-loading="systemSettingsLoading">
            <template v-for="cat in ['video', 'content', 'pipeline', 'general']" :key="cat">
              <div v-if="systemSettings.some(s => s.category === cat)" class="settings-group">
                <div class="settings-group-title">
                  {{ cat === 'video' ? '视频转录' : cat === 'content' ? '内容创作' : cat === 'pipeline' ? '流水线调度' : '通用' }}
                </div>
                <el-form label-width="180px" label-position="right" class="settings-form">
                  <el-form-item v-for="item in systemSettings.filter(s => s.category === cat)" :key="item.key" :label="item.label">
                    <div class="setting-row">
                      <!-- switch 类型 -->
                      <el-switch v-if="item.input_type === 'switch'" :model-value="item.value === 'true'" @change="(val: boolean) => { item.value = val ? 'true' : 'false'; saveSystemSetting(item) }" />
                      <!-- number 类型 -->
                      <el-input-number v-else-if="item.input_type === 'number'" v-model="item.value" :min="1" :max="999" size="default" @change="saveSystemSetting(item)" />
                      <!-- select 类型 -->
                      <el-select v-else-if="item.input_type === 'select'" v-model="item.value" size="default" @change="saveSystemSetting(item)">
                        <template v-if="item.key === 'whisper_default_model'">
                          <el-option v-for="m in whisperModelOptions" :key="m" :label="m" :value="m" />
                        </template>
                      </el-select>
                      <!-- text 类型（默认） -->
                      <el-input v-else v-model="item.value" size="default" style="max-width: 320px" @change="saveSystemSetting(item)" />
                      <span class="setting-desc">{{ item.description }}</span>
                    </div>
                  </el-form-item>
                </el-form>
              </div>
            </template>
          </div>

          <!-- 系统信息（只读） -->
          <div class="section-block" style="margin-top: 20px">
            <div class="section-title"><el-icon><Tools /></el-icon><span>运行时系统信息（只读）</span></div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="服务端口">{{ systemInfo.port || '-' }}</el-descriptions-item>
              <el-descriptions-item label="运行环境">{{ systemInfo.nodeEnv || '-' }}</el-descriptions-item>
              <el-descriptions-item label="数据库路径">{{ systemInfo.dbPath || '-' }}</el-descriptions-item>
              <el-descriptions-item label="前端地址">{{ systemInfo.clientUrl || '-' }}</el-descriptions-item>
              <el-descriptions-item label="Skill Bridge 模式">{{ systemInfo.skillBridgeMode || '-' }}</el-descriptions-item>
              <el-descriptions-item label="TikHub Base URL">{{ systemInfo.tikhubBaseUrl || '-' }}</el-descriptions-item>
              <el-descriptions-item label="Ollama URL">{{ systemInfo.ollamaBaseUrl || '-' }}</el-descriptions-item>
              <el-descriptions-item label="Ollama 模型">{{ systemInfo.ollamaModel || '-' }}</el-descriptions-item>
              <el-descriptions-item label="LLM Provider">{{ systemInfo.llmProvider || '-' }}</el-descriptions-item>
              <el-descriptions-item label="LLM 超时(ms)">{{ systemInfo.llmTimeout || '-' }}</el-descriptions-item>
              <el-descriptions-item label="图片 Provider">{{ systemInfo.imageProvider || '-' }}</el-descriptions-item>
              <el-descriptions-item label="图片模型">{{ systemInfo.imageModel || '-' }}</el-descriptions-item>
              <el-descriptions-item label="Python 脚本路径">{{ systemInfo.pythonScriptsPath || '-' }}</el-descriptions-item>
              <el-descriptions-item label="调度器时区">{{ systemInfo.schedulerTimezone || '-' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </div>

        <!-- ====== 服务监控 ====== -->
        <div v-show="activeTab === 'service-status'">
          <div class="tab-header">
            <span class="tab-desc">监控所有项目服务的运行状态，支持一键启动/停止</span>
            <div class="tab-header-actions">
              <el-button size="small" :icon="Refresh" :loading="serviceStatusLoading" @click="loadServiceStatus">刷新</el-button>
              <el-button size="small" type="success" :icon="VideoPlay" :loading="serviceStarting" @click="startAllServices">启动全部</el-button>
              <el-button size="small" type="danger" :icon="Switch" :loading="serviceStopping" @click="stopAllServices">停止全部</el-button>
            </div>
          </div>

          <div v-loading="serviceStatusLoading">
            <!-- 汇总信息 -->
            <div v-if="serviceStatus" class="service-summary">
              <el-tag :type="serviceStatus.portManagerOnline ? 'success' : 'danger'" size="large">
                端口管理器: {{ serviceStatus.portManagerOnline ? '在线' : '离线' }}
              </el-tag>
              <el-tag type="info" size="large">
                服务: {{ serviceStatus.summary.online }}/{{ serviceStatus.summary.total }} 在线
              </el-tag>
            </div>

            <!-- 服务列表 -->
            <el-table v-if="serviceStatus" :data="serviceStatus.services" stripe style="width: 100%">
              <el-table-column label="服务名称" prop="name" min-width="180" show-overflow-tooltip />
              <el-table-column label="端口" prop="port" width="100" align="center" />
              <el-table-column label="状态" width="100" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.online ? 'success' : 'info'" size="small">
                    {{ row.online ? '在线' : '离线' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="类型" prop="type" width="120" />
              <el-table-column label="技术栈" prop="tech" width="120" show-overflow-tooltip />
            </el-table>
            <el-empty v-if="!serviceStatusLoading && !serviceStatus" description="无法获取服务状态" :image-size="80" />
          </div>
        </div>

        <!-- ====== 收藏管理 ====== -->
        <div v-show="activeTab === 'favorites'">
          <div class="tab-header">
            <span class="tab-desc">管理全项目收藏的模板、技能和模块</span>
            <el-radio-group v-model="favoritesFilter" size="small">
              <el-radio-button label="all">全部</el-radio-button>
              <el-radio-button label="template">模板</el-radio-button>
              <el-radio-button label="skill">技能</el-radio-button>
              <el-radio-button label="module">模块</el-radio-button>
            </el-radio-group>
          </div>

          <el-table :data="favoritesByType" v-loading="favoritesLoading" stripe style="width: 100%">
            <el-table-column label="类型" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small">{{ favoriteTypeMap[row.target_type] || row.target_type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="名称" prop="target_name" min-width="200" show-overflow-tooltip />
            <el-table-column label="收藏时间" prop="created_at" width="180">
              <template #default="{ row }">
                {{ row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="danger" text :icon="Delete" @click="removeFavorite(row)">取消收藏</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!favoritesLoading && favoritesByType.length === 0" description="暂无收藏" :image-size="80" />
        </div>

        <!-- ====== 业务流线 ====== -->
        <div v-show="activeTab === 'business-flows'">
          <div class="tab-header">
            <span class="tab-desc">管理首页流程图编排中保存的自定义业务流线</span>
            <el-button size="small" :icon="Refresh" :loading="businessFlowLoading" @click="loadBusinessFlows">刷新</el-button>
          </div>

          <el-table :data="businessFlows" v-loading="businessFlowLoading" stripe style="width: 100%">
            <el-table-column label="名称" prop="name" min-width="180" show-overflow-tooltip />
            <el-table-column label="描述" prop="description" min-width="200" show-overflow-tooltip />
            <el-table-column label="状态" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
                  {{ row.status === 'active' ? '启用' : '草稿' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="节点数" width="80" align="center">
              <template #default="{ row }">
                {{ (row.nodes && row.nodes.length) || 0 }}
              </template>
            </el-table-column>
            <el-table-column label="创建时间" prop="created_at" width="180">
              <template #default="{ row }">
                {{ row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" text :icon="VideoPlay" @click="executeBusinessFlow(row)">执行</el-button>
                <el-button size="small" type="danger" text :icon="Delete" @click="deleteBusinessFlow(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!businessFlowLoading && businessFlows.length === 0" description="暂无业务流线，可在首页流程图编排模式中保存" :image-size="80" />
        </div>

        <!-- ====== 提示词管理 ====== -->
        <div v-show="activeTab === 'prompts'">
          <div class="tab-header">
            <span class="tab-desc">统一管理系统各模块使用的提示词</span>
            <el-button type="primary" size="small" :icon="Plus" @click="openPromptCreate">新增提示词</el-button>
          </div>
          <el-table :data="prompts" v-loading="promptLoading" stripe style="width: 100%">
            <el-table-column label="名称" prop="label" min-width="120" show-overflow-tooltip />
            <el-table-column label="标识" prop="name" width="140" show-overflow-tooltip />
            <el-table-column label="分类" prop="category" width="100">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="描述" prop="description" min-width="180" show-overflow-tooltip />
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-switch :model-value="row.enabled === 1" @change="togglePromptEnabled(row)" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="更新时间" width="160">
              <template #default="{ row }">{{ row.updated_at }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button text size="small" type="primary" @click="openPromptEdit(row)">编辑</el-button>
                <el-button text size="small" type="danger" @click="deletePrompt(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!promptLoading && prompts.length === 0" description="暂无提示词，点击「新增提示词」创建" :image-size="80" />
        </div>

        <!-- ====== 对话记录 ====== -->
        <div v-show="activeTab === 'conversations'">
          <div class="tab-header">
            <span class="tab-desc">管理内容工作台中的对话创作记录</span>
            <el-button size="small" :icon="Refresh" :loading="conversationLoading" @click="loadConversations">刷新</el-button>
          </div>

          <el-table :data="conversations" v-loading="conversationLoading" stripe style="width: 100%">
            <el-table-column label="标题" prop="title" min-width="200" show-overflow-tooltip />
            <el-table-column label="模式" width="120" align="center">
              <template #default="{ row }">
                <el-tag size="small">{{ row.mode || '对话' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="消息数" width="80" align="center">
              <template #default="{ row }">
                {{ row.message_count || 0 }}
              </template>
            </el-table-column>
            <el-table-column label="创建时间" prop="created_at" width="180">
              <template #default="{ row }">
                {{ row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="更新时间" prop="updated_at" width="180">
              <template #default="{ row }">
                {{ row.updated_at ? new Date(row.updated_at).toLocaleString('zh-CN') : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" text :icon="View" @click="viewConversation(row)">查看</el-button>
                <el-button size="small" type="primary" text :icon="Edit" @click="renameConversation(row)">重命名</el-button>
                <el-button size="small" type="danger" text :icon="Delete" @click="deleteConversation(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!conversationLoading && conversations.length === 0" description="暂无对话记录" :image-size="80" />
        </div>
        </el-card>
        </div>
    </div>

    <!-- 对话详情弹窗 -->
    <el-dialog v-model="conversationDetailVisible" :title="`对话详情: ${conversationDetail?.title || ''}`" width="700px" destroy-on-close>
      <div v-if="conversationMessages.length === 0" style="text-align: center; padding: 20px; color: var(--color-text-secondary);">
        暂无消息记录
      </div>
      <div v-else class="conversation-messages">
        <div v-for="msg in conversationMessages" :key="msg.id" :class="['message-item', msg.role]">
          <div class="message-role">{{ msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : msg.role }}</div>
          <div class="message-content">{{ msg.content }}</div>
          <div class="message-time">{{ msg.created_at ? new Date(msg.created_at).toLocaleString('zh-CN') : '' }}</div>
        </div>
      </div>
    </el-dialog>

    <!-- 模板编辑弹窗 -->
    <el-dialog v-model="editVisible" :title="isEditing ? '编辑模板' : '新增模板'" width="650px" destroy-on-close>
      <el-form :model="editForm" label-width="90px" label-position="top">
        <el-row :gutter="16">
          <el-col :span="14"><el-form-item label="模板名称"><el-input v-model="editForm.name" /></el-form-item></el-col>
          <el-col :span="10"><el-form-item label="分类"><el-select v-model="editForm.category"><el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" /></el-select></el-form-item></el-col>
        </el-row>
        <el-form-item label="子分类"><el-input v-model="editForm.subcategory" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editForm.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="标题公式"><el-input v-model="editForm.title_formula" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="内容结构"><el-input v-model="editForm.content_structure" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editForm.tags" placeholder="如：穿搭,分享,OOTD" /></el-form-item>
        <el-form-item label="示例标题"><el-input v-model="editForm.sample_title" /></el-form-item>
        <el-form-item label="示例正文"><el-input v-model="editForm.sample_body" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="saveTemplate">{{ isEditing ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- LLM 编辑弹窗 -->
    <el-dialog v-model="llmEditVisible" title="编辑 LLM 配置" width="550px" destroy-on-close>
      <el-form :model="llmEditForm" label-width="90px">
        <el-form-item label="提供商"><el-input :model-value="llmEditForm.label" disabled /></el-form-item>
        <el-form-item label="模型"><el-input v-model="llmEditForm.model" /></el-form-item>
        <el-form-item label="端点"><el-input v-model="llmEditForm.endpoint" /></el-form-item>
        <el-form-item label="API Key"><el-input v-model="llmEditForm.api_key" placeholder="留空保持不变" type="password" show-password /></el-form-item>
        <el-form-item label="超时(ms)"><el-input-number v-model="llmEditForm.timeout_ms" :min="10000" :max="600000" :step="10000" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="llmEditVisible = false">取消</el-button>
        <el-button type="primary" @click="saveLLM">保存</el-button>
      </template>
    </el-dialog>

    <!-- 自定义模型添加弹窗 -->
    <el-dialog v-model="customLLMDialogVisible" title="添加自定义大模型" width="500px" destroy-on-close>
      <el-form :model="customLLMForm" label-width="90px">
        <el-form-item label="模型名称" required>
          <el-input v-model="customLLMForm.name" placeholder="如：gpt-4o, claude-3-opus, GLM-4V-Flash" />
        </el-form-item>
        <el-form-item label="提供商" required>
          <el-select v-model="customLLMForm.provider" placeholder="选择或输入提供商" filterable allow-create style="width: 100%">
            <el-option label="OpenAI" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="智谱AI (GLM)" value="zhipu" />
            <el-option label="DeepSeek" value="deepseek" />
            <el-option label="Ollama (本地)" value="ollama" />
            <el-option label="月之暗面 (Moonshot)" value="moonshot" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item label="API端点">
          <el-input v-model="customLLMForm.endpoint" placeholder="如：https://api.openai.com/v1（留空使用默认）" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="customLLMForm.apiKey" type="password" show-password placeholder="输入 API Key（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="customLLMDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCustomLLMDialog">添加</el-button>
      </template>
    </el-dialog>

    <!-- 关键词编辑弹窗 -->
    <el-dialog v-model="keywordEditVisible" :title="keywordEditing ? '编辑关键词' : '新增关键词'" width="500px" destroy-on-close>
      <el-form :model="keywordEditForm" label-width="80px">
        <el-form-item label="关键词" required><el-input v-model="keywordEditForm.keyword" placeholder="如：护肤入门" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="keywordEditForm.name" placeholder="可选备注名" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="keywordEditForm.category" placeholder="如：美妆、科技" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="keywordEditForm.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="keywordEditForm.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="keywordEditVisible = false">取消</el-button>
        <el-button type="primary" @click="saveKeyword">{{ keywordEditing ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- 定时任务编辑弹窗 -->
    <el-dialog v-model="scheduleEditVisible" :title="scheduleEditing ? '编辑定时任务' : '新增定时任务'" width="500px" destroy-on-close>
      <el-form :model="scheduleEditForm" label-width="100px">
        <el-form-item label="任务名称" required><el-input v-model="scheduleEditForm.name" placeholder="如：每日护肤搜索" /></el-form-item>
        <el-form-item label="关键词" required><el-input v-model="scheduleEditForm.keyword" placeholder="如：护肤入门" /></el-form-item>
        <el-form-item label="Cron 表达式" required>
          <el-input v-model="scheduleEditForm.cron_expression" placeholder="如：0 9 * * *（每天9点）" />
          <div class="cron-hint">格式：分 时 日 月 周（5字段），如 0 9 * * * = 每天9:00</div>
        </el-form-item>
        <el-form-item label="启用"><el-switch v-model="scheduleEditForm.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scheduleEditVisible = false">取消</el-button>
        <el-button type="primary" @click="saveSchedule">{{ scheduleEditing ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- API 密钥编辑弹窗 -->
    <el-dialog v-model="apiKeyEditVisible" title="编辑 API 密钥" width="500px" destroy-on-close>
      <el-form :model="apiKeyEditForm" label-width="90px">
        <el-form-item label="服务名称"><el-input v-model="apiKeyEditForm.label" /></el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="apiKeyEditForm.api_key" placeholder="留空保持不变" type="password" show-password />
          <div class="cron-hint" v-if="apiKeyEditForm.has_key">当前已设置密钥，输入新值将覆盖</div>
        </el-form-item>
        <el-form-item label="描述"><el-input v-model="apiKeyEditForm.description" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="apiKeyEditVisible = false">取消</el-button>
        <el-button type="primary" @click="saveApiKey">保存</el-button>
      </template>
    </el-dialog>

    <!-- 提示词编辑弹窗 -->
    <el-dialog v-model="promptEditVisible" :title="promptIsEdit ? '编辑提示词' : '新增提示词'" width="700px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="标识名" v-if="!promptIsEdit">
          <el-input v-model="promptEditForm.name" placeholder="英文标识，如 content_discuss_prompt" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="promptEditForm.label" placeholder="显示名称，如「内容讨论提示词」" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="promptEditForm.category" placeholder="如 general / content / video / pipeline" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="promptEditForm.description" type="textarea" :rows="2" placeholder="一句话描述此提示词的用途" />
        </el-form-item>
        <el-form-item label="变量">
          <el-input v-model="promptEditForm.variables" placeholder="逗号分隔的变量名，如 title,body,tags" />
        </el-form-item>
        <el-form-item label="提示词内容">
          <el-input v-model="promptEditForm.content" type="textarea" :rows="10" placeholder="输入提示词内容，可用 {{变量名}} 引用变量" />
        </el-form-item>
        <el-form-item label="启用" v-if="promptIsEdit">
          <el-switch v-model="promptEditForm.enabled" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="promptEditVisible = false">取消</el-button>
        <el-button type="primary" @click="savePrompt">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container { max-width: 1200px; }
.page-header { margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 700; color: var(--color-text-primary); }
.page-desc { margin-top: 4px; font-size: 13px; color: var(--color-text-secondary); }

.stats-row { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.stat-card { flex: 1; min-width: 120px; background: var(--color-bg-page); border-radius: 8px; padding: 16px; text-align: center; }
.stat-num { display: block; font-size: 24px; font-weight: 700; color: var(--color-primary); }
.stat-label { display: block; font-size: 12px; color: var(--color-text-secondary); margin-top: 4px; }

.tab-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.tab-desc { font-size: 13px; color: var(--color-text-secondary); }

/* === 大模型管理 === */
.llm-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border-lighter);
}

.custom-llm-quick-add {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border-lighter);
  border-radius: var(--border-radius-base);
}

/* 流水线配置 Tab */
.section-block { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); }
.section-block:last-child { border-bottom: none; }
.section-title { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 12px; }

.login-status-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.login-info-item { font-size: 13px; color: var(--color-text-secondary); }
.login-actions { margin-left: auto; display: flex; gap: 8px; }

/* API 密钥 Tab */
.key-masked { font-family: 'Courier New', monospace; color: var(--color-text-secondary); letter-spacing: 1px; }

/* 系统设置 Tab */
.settings-group { margin-bottom: 20px; }
.settings-group-title { font-size: 14px; font-weight: 600; color: var(--color-primary); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px dashed var(--el-border-color, #dcdfe6); }
.settings-form .setting-row { display: flex; align-items: center; gap: 12px; }
.setting-desc { font-size: 12px; color: var(--color-text-secondary); }

/* 通用提示 */
.cron-hint { font-size: 12px; color: var(--color-text-secondary); margin-top: 4px; line-height: 1.4; }

/* 对话记录 Tab */
.conversation-messages { max-height: 500px; overflow-y: auto; padding: 0 8px; }
.message-item { padding: 12px 16px; margin-bottom: 12px; border-radius: 8px; background: var(--color-bg-subtle); }
.message-item.user { background: var(--color-primary-soft); border-left: 3px solid var(--color-primary); }
.message-item.assistant { background: var(--color-success-soft); border-left: 3px solid var(--color-success); }
.message-role { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 4px; }
.message-content { font-size: 14px; color: var(--color-text-primary); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.message-time { font-size: 11px; color: var(--color-text-placeholder, #c0c4cc); margin-top: 6px; text-align: right; }

/* === 系统管理：左侧垂直菜单 + 右侧内容 === */
.admin-body { display: flex; gap: 16px; align-items: flex-start; }
.admin-sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--color-bg-card, #fff);
  border: 1px solid var(--color-border-lighter, #ebeef5);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 16px;
  transition: width 0.28s ease;
}
.admin-sidebar.collapsed { width: 64px; }
.admin-sidebar :deep(.el-menu) { border-right: none; background-color: transparent; }
.admin-sidebar :deep(.el-menu-item) {
  border-radius: 6px;
  margin: 2px 0;
  height: 42px;
  line-height: 42px;
}
.admin-sidebar :deep(.el-menu-item.is-active) {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}
.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  border-top: 1px solid var(--color-border-lighter, #ebeef5);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-secondary, #909399);
  transition: color 0.2s ease;
}
.sidebar-collapse-btn:hover { color: var(--color-primary, #6366f1); }
.sidebar-collapse-btn .collapse-text { white-space: nowrap; }
.admin-content { flex: 1; min-width: 0; }
.admin-content :deep(.el-card) { border-radius: 8px; }
</style>
