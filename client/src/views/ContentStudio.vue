<script setup lang="ts">
/**
 * 内容工作室 - 增强版
 *
 * 三栏布局:
 *   左侧: 对话记录侧边栏（创建/选择/重命名/删除对话）
 *   中间: 对话面板（多轮对话 + 模式切换 + 确认/生成）
 *   右侧: 内容管理列表（时间格式化 + 列宽优化 + 增强编辑器）
 *
 * 核心功能:
 *   1. 多轮对话（LLM 配置）- 支持 discuss/keyword 两种模式
 *   2. 每轮确认 → 生成内容 → 跳转编辑器
 *   3. 编辑器支持图片生成、上传、拖拽排序
 *   4. 对话侧边栏可编辑名称
 */
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { chatApi, contentsApi, publishApi, templateApi, optimizeApi, adminFavoriteApi } from '@/api'
import type { Content, Conversation, ChatMessage, ChatMode, LlmStatus, UnifiedContent, UnifiedContentStats } from '@/types'
import type { ContentTemplateDTO, ContentOptimizeResult } from '@/api'

// 懒加载子模块组件
const VideoStudioPanel = defineAsyncComponent(() => import('./VideoStudioView.vue'))
const PipelineConsolePanel = defineAsyncComponent(() => import('./XhsPipelineView.vue'))
const PublishListPanel = defineAsyncComponent(() => import('./PublishQueue.vue'))
const ImageStudioPanel = defineAsyncComponent(() => import('./ImageStudioView.vue'))

const route = useRoute()

// ============================================================================
// 视图状态
// ============================================================================

/**
 * 当前激活的标签页: 'creation' | 'video' | 'image' | 'pipeline' | 'manage' | 'publish'
 *
 * 初始化时读取 URL query 参数 tab，支持从外部跳转时自动切换到对应子模块。
 * - 'creation'  → 对话创作（原 chat）
 * - 'video'     → 视频工作室
 * - 'image'     → 图片工作室
 * - 'pipeline'  → 流水线控制台
 * - 'manage'    → 内容管理（原 list）
 * - 'publish'   → 发布列表
 */
type TabName = 'creation' | 'video' | 'image' | 'pipeline' | 'manage' | 'publish'
const activeTab = ref<TabName>(
  (route.query.tab as TabName) || 'creation'
)

/** 兼容旧 query 参数：chat → creation, list → manage */
if ((route.query.tab as string) === 'chat') activeTab.value = 'creation'
if ((route.query.tab as string) === 'list') activeTab.value = 'manage'

/** 监听路由 query 变化，同步 tab 切换 */
watch(
  () => route.query.tab,
  (newTab) => {
    if (newTab && typeof newTab === 'string') {
      const validTabs: TabName[] = ['creation', 'video', 'image', 'pipeline', 'manage', 'publish']
      if (validTabs.includes(newTab as TabName)) {
        activeTab.value = newTab as TabName
      }
    }
  }
)

// ============================================================================
// 对话侧边栏
// ============================================================================

const conversations = ref<Conversation[]>([])
const currentConversation = ref<Conversation | null>(null)
const editingConvId = ref<number | null>(null)
const editingConvTitle = ref('')
const convLoading = ref(false)

/** 加载对话列表 */
async function loadConversations(): Promise<void> {
  convLoading.value = true
  try {
    const res = await chatApi.getConversations()
    if (res.success && res.data) {
      conversations.value = res.data
    }
  } catch (e) {
    console.error('加载对话列表失败:', e)
  } finally {
    convLoading.value = false
  }
}

/** 创建新对话 */
async function handleCreateConversation(mode: ChatMode = 'discuss'): Promise<void> {
  try {
    const res = await chatApi.createConversation({ mode })
    if (res.success && res.data) {
      conversations.value.unshift(res.data)
      await selectConversation(res.data)
      ElMessage.success('新对话已创建')
    }
  } catch (e) {
    ElMessage.error('创建对话失败: ' + (e as Error).message)
  }
}

/** 选择对话 */
async function selectConversation(conv: Conversation): Promise<void> {
  currentConversation.value = conv
  activeTab.value = 'creation'
  await loadMessages(conv.id)
  await nextTick()
  scrollToBottom()
}

/** 加载消息列表 */
const messages = ref<ChatMessage[]>([])
const messagesLoading = ref(false)

async function loadMessages(convId: number): Promise<void> {
  messagesLoading.value = true
  try {
    const res = await chatApi.getMessages(convId)
    if (res.success && res.data) {
      messages.value = res.data
    }
  } catch (e) {
    console.error('加载消息失败:', e)
  } finally {
    messagesLoading.value = false
  }
}

/** 开始编辑对话名称 */
function startEditConv(conv: Conversation): void {
  editingConvId.value = conv.id
  editingConvTitle.value = conv.title
}

/** 保存对话名称 */
async function saveConvTitle(): Promise<void> {
  if (!editingConvId.value) return
  const title = editingConvTitle.value.trim()
  if (!title) {
    ElMessage.warning('标题不能为空')
    return
  }
  try {
    const res = await chatApi.rename(editingConvId.value, title)
    if (res.success && res.data) {
      const idx = conversations.value.findIndex(c => c.id === editingConvId.value)
      if (idx >= 0) conversations.value[idx] = res.data
      if (currentConversation.value?.id === editingConvId.value) {
        currentConversation.value = res.data
      }
    }
  } catch (e) {
    ElMessage.error('重命名失败: ' + (e as Error).message)
  } finally {
    editingConvId.value = null
  }
}

/** 删除对话 */
async function handleDeleteConv(conv: Conversation): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除对话「${conv.title}」？`, '删除对话', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
    const res = await chatApi.delete(conv.id)
    if (res.success) {
      conversations.value = conversations.value.filter(c => c.id !== conv.id)
      if (currentConversation.value?.id === conv.id) {
        currentConversation.value = null
        messages.value = []
      }
      ElMessage.success('对话已删除')
    }
  } catch { /* cancelled */ }
}

// ============================================================================
// 对话面板
// ============================================================================

const chatInput = ref('')
const chatMode = ref<ChatMode>('discuss')
const sending = ref(false)
const confirming = ref<number | null>(null)
const regenerating = ref<number | null>(null)
const generating = ref(false)
const llmStatus = ref<LlmStatus | null>(null)
const messageListRef = ref<HTMLElement | null>(null)
const favoritedMessages = ref<Set<number>>(new Set())

/** 发送消息 */
async function handleSendMessage(): Promise<void> {
  const content = chatInput.value.trim()
  if (!content) return
  if (!currentConversation.value) {
    ElMessage.warning('请先创建或选择一个对话')
    return
  }

  sending.value = true
  chatInput.value = ''

  try {
    const res = await chatApi.sendMessage(currentConversation.value.id, content, chatMode.value)
    if (res.success && res.data) {
      messages.value.push(res.data.userMessage, res.data.assistantMessage)
      // 发送后清除已使用的模板标记
      selectedTemplate.value = null
      await nextTick()
      scrollToBottom()

      // 刷新对话列表（标题可能已更新）
      await loadConversations()

      // 保持 currentConversation 与最新数据同步
      if (currentConversation.value) {
        const updated = conversations.value.find(c => c.id === currentConversation.value!.id)
        if (updated) {
          currentConversation.value = updated
        }
      }
    }
  } catch (e) {
    ElMessage.error('发送失败: ' + (e as Error).message)
    // 恢复输入内容
    chatInput.value = content
  } finally {
    sending.value = false
  }
}

/** 确认某轮对话 */
async function handleConfirm(msg: ChatMessage): Promise<void> {
  if (!currentConversation.value) return
  confirming.value = msg.id
  try {
    const res = await chatApi.confirm(currentConversation.value.id, msg.id)
    if (res.success && res.data) {
      // 更新消息确认状态
      messages.value = messages.value.map(m =>
        m.id === msg.id ? { ...m, confirmed: true } : m
      )
      currentConversation.value = res.data
      ElMessage.success('已确认此轮内容')
    }
  } catch (e) {
    ElMessage.error('确认失败: ' + (e as Error).message)
  } finally {
    confirming.value = null
  }
}

/** 复制消息内容到剪贴板 */
async function copyMessage(content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content)
    ElMessage.success('已复制到剪贴板')
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = content
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      ElMessage.success('已复制到剪贴板')
    } catch {
      ElMessage.error('复制失败，请手动复制')
    }
    document.body.removeChild(textarea)
  }
}

/** 收藏/取消收藏消息 */
async function toggleFavoriteMessage(msg: ChatMessage): Promise<void> {
  const isFavorited = favoritedMessages.value.has(msg.id)
  try {
    if (isFavorited) {
      await adminFavoriteApi.remove('chat_message', String(msg.id))
      favoritedMessages.value.delete(msg.id)
      favoritedMessages.value = new Set(favoritedMessages.value)
      ElMessage.success('已取消收藏')
    } else {
      await adminFavoriteApi.add(
        'chat_message',
        String(msg.id),
        msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '')
      )
      favoritedMessages.value.add(msg.id)
      favoritedMessages.value = new Set(favoritedMessages.value)
      ElMessage.success('已收藏')
    }
  } catch (e) {
    ElMessage.error('操作失败: ' + (e as Error).message)
  }
}

/** 重新生成助手消息 */
async function handleRegenerateMessage(msg: ChatMessage): Promise<void> {
  if (!currentConversation.value) return
  if (msg.role !== 'assistant') return

  regenerating.value = msg.id
  try {
    const res = await chatApi.regenerate(currentConversation.value.id, msg.id)
    if (res.success && res.data) {
      // 替换消息列表中的旧消息
      const idx = messages.value.findIndex(m => m.id === msg.id)
      if (idx >= 0) {
        messages.value[idx] = res.data.assistantMessage
      } else {
        // 如果找不到（已被后端删除），追加到末尾
        messages.value.push(res.data.assistantMessage)
      }
      await nextTick()
      scrollToBottom()
      ElMessage.success('已重新生成')
    }
  } catch (e) {
    ElMessage.error('重新生成失败: ' + (e as Error).message)
  } finally {
    regenerating.value = null
  }
}

/** 从对话生成内容 */
async function handleGenerateFromChat(): Promise<void> {
  if (!currentConversation.value) return
  generating.value = true
  try {
    const res = await chatApi.generateContent(currentConversation.value.id)
    if (res.success && res.data) {
      ElMessage.success(`内容已生成: ${res.data.title}`)
      // 刷新内容列表
      await loadContents()
      // 打开编辑器
      const newContent = contentList.value.find(c => c.id === res.data!.contentId)
      if (newContent) {
        await handleEdit(newContent)
      }
    }
  } catch (e) {
    ElMessage.error('生成内容失败: ' + (e as Error).message)
  } finally {
    generating.value = false
  }
}

/** 加载 LLM 状态 */
async function loadLlmStatus(): Promise<void> {
  try {
    const res = await chatApi.getLlmStatus()
    if (res.success && res.data) {
      llmStatus.value = res.data
    }
  } catch {
    // 静默处理
  }
}

/** 滚动到底部 */
function scrollToBottom(): void {
  if (messageListRef.value) {
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
  }
}

/** 格式化时间 */
function formatTime(dateStr: string): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 是否有确认的消息 */
const hasConfirmedMessage = computed(() => {
  return messages.value.some(m => m.confirmed && m.role === 'assistant')
})

// ============================================================================
// 模板相关
// ============================================================================

const templatePanelVisible = ref(false)
const templates = ref<ContentTemplateDTO[]>([])
const templateCategories = ref<string[]>([])
const selectedCategory = ref<string>('')
const templateSearchKeyword = ref<string>('')
const templateLoading = ref(false)
const selectedTemplate = ref<ContentTemplateDTO | null>(null)

// 内容优化
const optimizing = ref(false)
const optimizeResult = ref<ContentOptimizeResult | null>(null)

async function loadTemplates(): Promise<void> {
  templateLoading.value = true
  try {
    const res = await templateApi.getList({
      category: selectedCategory.value || undefined,
      keyword: templateSearchKeyword.value || undefined,
    })
    if (res.success && res.data) {
      templates.value = res.data.data
    }
  } catch (e) {
    console.error('加载模板失败:', e)
  } finally {
    templateLoading.value = false
  }
}

async function loadTemplateCategories(): Promise<void> {
  try {
    const res = await templateApi.getCategories()
    if (res.success && res.data) {
      templateCategories.value = res.data
    }
  } catch (e) {
    console.error('加载分类失败:', e)
  }
}

function selectTemplate(tmpl: ContentTemplateDTO): void {
  selectedTemplate.value = tmpl
  // 将模板内容前置到用户输入文本中，作为提示词的一部分
  if (tmpl.titleFormula || tmpl.contentStructure) {
    const parts: string[] = []
    if (tmpl.name) parts.push(`\u{1F4CB} 使用模板：${tmpl.name}`)
    if (tmpl.titleFormula) parts.push(`标题公式：${tmpl.titleFormula}`)
    if (tmpl.contentStructure) parts.push(`内容结构：${tmpl.contentStructure}`)
    if (tmpl.emojiStyle) parts.push(`推荐Emoji：${tmpl.emojiStyle}`)
    if (tmpl.sampleTitle) parts.push(`参考标题：${tmpl.sampleTitle}`)
    const templateContent = parts.join('\n')
    // 前置模板内容到已有输入之前，模板与用户输入合并为完整提示词
    const existing = chatInput.value.trim()
    chatInput.value = existing ? templateContent + '\n' + existing : templateContent
  }
  // 记录使用
  templateApi.recordUse(tmpl.id).catch(() => {})
  // 关闭模板弹窗
  templatePanelVisible.value = false
  ElMessage.success(`已应用模板：${tmpl.name}`)
}

async function handleOptimize(row: UnifiedContent | Content): Promise<void> {
  if (!row.title) {
    ElMessage.warning('请确保内容有标题')
    return
  }
  // 先打开编辑器对话框（会异步获取完整内容）
  await handleEdit(row)
  // 使用编辑器中已加载的正文进行优化
  if (!editForm.body) {
    ElMessage.warning('无法获取内容正文，优化中止')
    return
  }
  optimizing.value = true
  optimizeResult.value = null
  try {
    const res = await optimizeApi.optimize({
      title: editForm.title,
      body: editForm.body,
      templateId: (row as Content).templateId,
    })
    if (res.success && res.data) {
      optimizeResult.value = res.data
      ElMessage.success(`内容评分：${res.data.score}分`)
    }
  } catch (e) {
    ElMessage.error('优化失败: ' + (e as Error).message)
  } finally {
    optimizing.value = false
  }
}

function applyOptimized(): void {
  if (!optimizeResult.value) return
  const result = optimizeResult.value
  editForm.title = result.optimizedTitle || editForm.title
  editForm.body = result.optimizedBody || editForm.body
  ElMessage.success('已应用优化结果')
}

// ============================================================================
// 内容列表
// ============================================================================

const loading = ref(false)
const generating_content = ref(false)
const saving = ref(false)
const publishing = ref(false)
const contentList = ref<UnifiedContent[]>([])
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const statusFilter = ref<string>('')

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '审核中', value: 'reviewing' },
  { label: '已通过', value: 'approved' },
  { label: '已发布', value: 'published' },
  { label: '已拒绝', value: 'rejected' },
  { label: '待审核', value: 'pending' },
  { label: '发布失败', value: 'published_failed' }
]

const favoriteFilter = ref<boolean>(false)

// 来源筛选
const sourceFilter = ref<string>('')
const sourceOptions = [
  { label: '全部来源', value: '' },
  { label: '内容创作', value: 'content_studio' },
  { label: '流水线生成', value: 'pipeline' }
]

// 统一内容统计
const unifiedStats = ref<UnifiedContentStats | null>(null)

// 分组管理
const groups = ref<string[]>([])
const groupFilter = ref<string>('')

// 批量选择
const selectedItems = ref<UnifiedContent[]>([])

// 批量分组对话框
const batchGroupDialogVisible = ref(false)
const batchGroupName = ref('')

// 分组管理对话框
const groupManageDialogVisible = ref(false)
const newGroupName = ref('')
const renameGroupOldName = ref('')
const renameGroupNewName = ref('')

// 排序
const tableRef = ref()

const statusConfig: Record<string, { label: string; type: 'info' | 'warning' | 'success' | 'primary' | 'danger' }> = {
  draft: { label: '草稿', type: 'info' },
  reviewing: { label: '审核中', type: 'warning' },
  approved: { label: '已通过', type: 'primary' },
  published: { label: '已发布', type: 'success' },
  rejected: { label: '已拒绝', type: 'danger' },
  pending: { label: '待审核', type: 'warning' },
  published_failed: { label: '发布失败', type: 'danger' }
}

async function loadContents(): Promise<void> {
  loading.value = true
  try {
    const params: { page: number; pageSize: number; status?: string; favorited?: boolean; source?: string; groupName?: string } = {
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
    if (statusFilter.value) params.status = statusFilter.value
    if (favoriteFilter.value) params.favorited = true
    if (sourceFilter.value) params.source = sourceFilter.value
    if (groupFilter.value) params.groupName = groupFilter.value
    const res = await contentsApi.getUnifiedList(params)
    contentList.value = res.data
    pagination.total = res.total
    // 并行加载统计和分组
    loadUnifiedStats()
    loadGroups()
  } catch (e) {
    console.error('加载内容列表失败:', e)
  } finally {
    loading.value = false
  }
}

/** 加载统一内容统计 */
async function loadUnifiedStats(): Promise<void> {
  try {
    const res = await contentsApi.getUnifiedStats()
    if (res.success && res.data) {
      unifiedStats.value = res.data
    }
  } catch (e) {
    console.error('加载统计失败:', e)
  }
}

/** 加载分组列表 */
async function loadGroups(): Promise<void> {
  try {
    const res = await contentsApi.getGroups()
    if (res.success && res.data) {
      groups.value = res.data
    }
  } catch (e) {
    console.error('加载分组失败:', e)
  }
}

async function handleGenerate(): Promise<void> {
  try {
    await ElMessageBox.confirm('将基于最近追踪的趋势自动生成内容草稿，是否继续？', '生成内容', {
      confirmButtonText: '生成', cancelButtonText: '取消', type: 'warning'
    })
  } catch { return }

  generating_content.value = true
  try {
    await contentsApi.generate({})
    ElMessage.success('内容生成成功')
    await loadContents()
  } catch (e) {
    console.error('生成内容失败:', e)
  } finally {
    generating_content.value = false
  }
}

function handleFilterChange(): void {
  pagination.page = 1
  loadContents()
}

/** 切换收藏状态 */
async function handleToggleFavorite(row: UnifiedContent): Promise<void> {
  if (row.source === 'pipeline') {
    ElMessage.warning('流水线生成内容暂不支持收藏')
    return
  }
  try {
    const res = await contentsApi.toggleFavorite(row.id)
    if (res.success && res.data) {
      // 更新列表中对应记录的收藏状态
      const idx = contentList.value.findIndex(c => c.id === row.id)
      if (idx >= 0) {
        contentList.value[idx].isFavorited = !!res.data.isFavorited
      }
      ElMessage.success(res.data.isFavorited ? '已收藏' : '已取消收藏')
    }
  } catch (e) {
    ElMessage.error('操作失败: ' + (e as Error).message)
  }
}

function handlePageChange(page: number): void {
  pagination.page = page
  loadContents()
}

// ============================================================================
// 统一内容操作（合并 contents 和 drafts 两种来源）
// ============================================================================

/** 流水线草稿 API 辅助函数 */
async function pipelineDraftApi<T>(action: string, draftId: number, body?: unknown): Promise<T> {
  const url = `/api/xhs-pipeline/drafts/${draftId}/${action}`
  const res = await fetch(url, {
    method: action === 'approve' || action === 'reject' ? 'POST' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || `HTTP ${res.status}`)
  }
  return data as T
}

/** 判断行是否可发布（草稿/审核中/已通过 状态） */
function canPublish(row: UnifiedContent): boolean {
  return ['draft', 'reviewing', 'approved', 'pending'].includes(row.status)
}

/** 统一发布：直接发布，跳过审批步骤（Task 3(6)(c)） */
async function handlePublishUnified(row: UnifiedContent): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要将「${row.title}」发布到小红书吗？\n\n此操作将直接发布，请确保已登录小红书。`,
      '确认发布',
      { confirmButtonText: '确认发布', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }

  publishing.value = true
  try {
    if (row.source === 'pipeline') {
      // 流水线草稿：审核通过并发布
      await pipelineDraftApi('approve', row.id)
      ElMessage.success('草稿发布成功')
    } else {
      // 内容工作室：直接调用发布 API
      const result = await publishApi.execute(row.id, 'xiaohongshu')
      const pub = result.data
      if (pub?.status === 'published') {
        ElMessage.success('发布成功！笔记已发布到小红书')
      } else if (pub?.status === 'failed') {
        ElMessage.error(`发布失败：${(pub as any).errorMessage || result.error || '未知错误'}`)
      }
    }
    await loadContents()
  } catch (error: any) {
    const msg = error?.message || '发布请求失败'
    ElMessage.error(`发布失败：${msg}`)
  } finally {
    publishing.value = false
  }
}

/** 统一拒绝 */
async function handleRejectUnified(row: UnifiedContent): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定要拒绝内容「${row.title}」吗？`, '确认拒绝', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning'
    })
  } catch { return }

  try {
    if (row.source === 'pipeline') {
      await pipelineDraftApi('reject', row.id, { review_notes: '已拒绝' })
    } else {
      await contentsApi.updateStatus(row.id, 'rejected')
    }
    ElMessage.success('已拒绝')
    await loadContents()
  } catch (e) {
    ElMessage.error('操作失败: ' + (e as Error).message)
  }
}

/** 统一删除 */
async function handleDeleteUnified(row: UnifiedContent): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定要删除内容「${row.title}」吗？此操作不可恢复。`, '确认删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'error'
    })
  } catch { return }

  try {
    if (row.source === 'pipeline') {
      await pipelineDraftApi('delete', row.id)
    } else {
      await contentsApi.delete(row.id)
    }
    ElMessage.success('删除成功')
    await loadContents()
  } catch (e) {
    ElMessage.error('删除失败: ' + (e as Error).message)
  }
}

/** 更新单条内容的分组 */
async function handleGroupChange(row: UnifiedContent, groupName: string): Promise<void> {
  if (row.source === 'pipeline') {
    ElMessage.warning('流水线生成内容暂不支持分组')
    return
  }
  try {
    await contentsApi.updateGroup(row.id, groupName)
    ElMessage.success('分组已更新')
    await loadContents()
  } catch (e) {
    ElMessage.error('更新分组失败: ' + (e as Error).message)
  }
}

// ============================================================================
// 批量操作（Task 3(6)(b)）
// ============================================================================

/** 表格选择变化 */
function handleSelectionChange(selection: UnifiedContent[]): void {
  selectedItems.value = selection
}

/** 批量分组 */
async function handleBatchGroup(): Promise<void> {
  if (!selectedItems.value.length) return
  batchGroupDialogVisible.value = true
  batchGroupName.value = ''
}

/** 确认批量分组 */
async function confirmBatchGroup(): Promise<void> {
  if (!batchGroupName.value.trim()) {
    ElMessage.warning('请输入分组名称')
    return
  }
  const groupName = batchGroupName.value.trim()
  try {
    for (const item of selectedItems.value) {
      if (item.source === 'content_studio') {
        await contentsApi.updateGroup(item.id, groupName)
      }
    }
    ElMessage.success(`已将 ${selectedItems.value.length} 条内容分组到「${groupName}」`)
    batchGroupDialogVisible.value = false
    await loadContents()
  } catch (e) {
    ElMessage.error('批量分组失败: ' + (e as Error).message)
  }
}

/** 批量删除 */
async function handleBatchDelete(): Promise<void> {
  if (!selectedItems.value.length) return
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedItems.value.length} 条内容吗？此操作不可恢复。`,
      '批量删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'error' }
    )
  } catch { return }

  try {
    // 分来源处理
    const contentIds = selectedItems.value.filter(i => i.source === 'content_studio').map(i => i.id)
    const draftIds = selectedItems.value.filter(i => i.source === 'pipeline').map(i => i.id)

    if (contentIds.length) {
      await contentsApi.batchDelete(contentIds)
    }
    for (const draftId of draftIds) {
      await pipelineDraftApi('delete', draftId)
    }

    ElMessage.success(`已删除 ${selectedItems.value.length} 条内容`)
    selectedItems.value = []
    await loadContents()
  } catch (e) {
    ElMessage.error('批量删除失败: ' + (e as Error).message)
  }
}

// ============================================================================
// 分组管理（Task 3(6)(a)）
// ============================================================================

/** 创建新分组（通过将某条内容设为该分组来创建） */
async function handleCreateGroup(): Promise<void> {
  const name = newGroupName.value.trim()
  if (!name) {
    ElMessage.warning('请输入分组名称')
    return
  }
  if (groups.value.includes(name)) {
    ElMessage.warning('分组名称已存在')
    return
  }
  groups.value.push(name)
  newGroupName.value = ''
  ElMessage.success(`分组「${name}」已创建`)
}

/** 重命名分组 */
async function handleRenameGroup(): Promise<void> {
  const oldName = renameGroupOldName.value
  const newName = renameGroupNewName.value.trim()
  if (!oldName) {
    ElMessage.warning('请选择要重命名的分组')
    return
  }
  if (!newName) {
    ElMessage.warning('请输入新名称')
    return
  }
  if (oldName === newName) return

  try {
    // 遍历 contentList，将所有属于该分组的内容更新为新名称
    for (const item of contentList.value) {
      if (item.source === 'content_studio' && item.groupName === oldName) {
        await contentsApi.updateGroup(item.id, newName)
      }
    }
    // 更新本地 groups 列表
    const idx = groups.value.indexOf(oldName)
    if (idx >= 0) groups.value[idx] = newName
    renameGroupNewName.value = ''
    renameGroupOldName.value = ''
    ElMessage.success(`分组已从「${oldName}」重命名为「${newName}」`)
    await loadContents()
  } catch (e) {
    ElMessage.error('重命名分组失败: ' + (e as Error).message)
  }
}

/** 删除分组（将所有属于该分组的内容分组清空） */
async function handleDeleteGroup(groupName: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要删除分组「${groupName}」吗？该分组下的内容将变为未分组。`,
      '删除分组',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }

  try {
    for (const item of contentList.value) {
      if (item.source === 'content_studio' && item.groupName === groupName) {
        await contentsApi.updateGroup(item.id, '')
      }
    }
    const idx = groups.value.indexOf(groupName)
    if (idx >= 0) groups.value.splice(idx, 1)
    if (groupFilter.value === groupName) groupFilter.value = ''
    ElMessage.success(`分组「${groupName}」已删除`)
    await loadContents()
  } catch (e) {
    ElMessage.error('删除分组失败: ' + (e as Error).message)
  }
}

// ============================================================================
// 排序操作（Task 3(6)(a)）
// ============================================================================

/** 上移一条内容（仅 content_studio 来源） */
async function handleMoveUp(row: UnifiedContent): Promise<void> {
  if (row.source !== 'content_studio') return
  const idx = contentList.value.findIndex(c => c.id === row.id)
  if (idx <= 0) return

  // 找到前一条同来源的内容
  let prevIdx = idx - 1
  while (prevIdx >= 0 && contentList.value[prevIdx].source !== 'content_studio') {
    prevIdx--
  }
  if (prevIdx < 0) return

  // 交换 sort_order
  const tmp = contentList.value[idx].sortOrder
  contentList.value[idx].sortOrder = contentList.value[prevIdx].sortOrder
  contentList.value[prevIdx].sortOrder = tmp

  // 重新排序本地列表
  contentList.value.sort((a, b) => a.sortOrder - b.sortOrder)
  await saveReorder()
}

/** 下移一条内容（仅 content_studio 来源） */
async function handleMoveDown(row: UnifiedContent): Promise<void> {
  if (row.source !== 'content_studio') return
  const idx = contentList.value.findIndex(c => c.id === row.id)
  if (idx < 0 || idx >= contentList.value.length - 1) return

  // 找到后一条同来源的内容
  let nextIdx = idx + 1
  while (nextIdx < contentList.value.length && contentList.value[nextIdx].source !== 'content_studio') {
    nextIdx++
  }
  if (nextIdx >= contentList.value.length) return

  // 交换 sort_order
  const tmp = contentList.value[idx].sortOrder
  contentList.value[idx].sortOrder = contentList.value[nextIdx].sortOrder
  contentList.value[nextIdx].sortOrder = tmp

  // 重新排序本地列表
  contentList.value.sort((a, b) => a.sortOrder - b.sortOrder)
  await saveReorder()
}

/** 保存排序到后端 */
async function saveReorder(): Promise<void> {
  try {
    const items = contentList.value
      .filter(c => c.source === 'content_studio')
      .map((c, idx) => ({ id: c.id, sort_order: idx }))
    await contentsApi.reorder(items)
    ElMessage.success('排序已更新')
  } catch (e) {
    console.error('保存排序失败:', e)
    ElMessage.error('保存排序失败')
  }
}

/** 获取来源标签文本 */
function getSourceLabel(source: string): string {
  return source === 'content_studio' ? '内容创作' : '流水线生成'
}

/** 获取来源标签类型 */
function getSourceTagType(source: string): 'primary' | 'warning' {
  return source === 'content_studio' ? 'primary' : 'warning'
}

// ============================================================================
// 编辑器（增强版 - 支持图片）
// ============================================================================

const editDialogVisible = ref(false)
const editForm = reactive({
  id: 0,
  title: '',
  body: '',
  tags: [] as string[],
  images: [] as string[]
})
const tagInput = ref('')
const imageGenerating = ref(false)
const imageUploading = ref(false)
const dragIndex = ref<number | null>(null)

/** 编辑内容 - 支持从 UnifiedContent 加载完整详情 */
async function handleEdit(row: UnifiedContent | Content): Promise<void> {
  editForm.id = row.id
  editForm.title = row.title
  editForm.tags = [...(row.tags || [])]
  editForm.images = [...(row.images || [])]
  tagInput.value = ''
  optimizeResult.value = null

  // 如果是 UnifiedContent（没有 body 字段），需要从后端获取完整内容
  if ('body' in row && row.body) {
    editForm.body = row.body
    editDialogVisible.value = true
  } else {
    // 从后端获取完整内容详情
    try {
      const source = (row as UnifiedContent).source
      if (source === 'pipeline') {
        // 流水线草稿：获取草稿详情
        const res = await fetch(`/api/xhs-pipeline/drafts/pending`)
        const data = await res.json()
        if (data.success && data.data) {
          const draft = data.data.find((d: any) => d.id === row.id)
          if (draft) {
            editForm.body = draft.content || ''
          }
        }
      } else {
        // 内容工作室：获取完整内容
        const res = await contentsApi.getById(row.id)
        if (res.success && res.data) {
          editForm.body = res.data.body || ''
          editForm.tags = [...(res.data.tags || [])]
          editForm.images = [...(res.data.images || [])]
        }
      }
    } catch (e) {
      console.error('获取内容详情失败:', e)
      editForm.body = ''
    }
    editDialogVisible.value = true
  }
}

function addTag(): void {
  const tag = tagInput.value.trim()
  if (tag && !editForm.tags.includes(tag)) {
    editForm.tags.push(tag)
    tagInput.value = ''
  }
}

function removeTag(tag: string): void {
  const idx = editForm.tags.indexOf(tag)
  if (idx > -1) editForm.tags.splice(idx, 1)
}

/** 生成配图 */
async function handleGenerateImages(): Promise<void> {
  if (!editForm.title.trim()) {
    ElMessage.warning('请先输入标题')
    return
  }
  imageGenerating.value = true
  try {
    // 先保存当前编辑状态（含已上传但未保存的图片），避免后端从DB读取旧数据导致覆盖丢失
    const currentImages = [...editForm.images]
    await contentsApi.update(editForm.id, {
      title: editForm.title,
      body: editForm.body,
      tags: editForm.tags,
      images: currentImages,
    })

    const res = await contentsApi.generateImages(editForm.id)
    if (res.success && res.data) {
      // 安全合并：以当前前端图片为基础，追加新生成的图片，避免DB旧数据覆盖
      const newImageSet = new Set(currentImages)
      for (const img of res.data.newImages || []) {
        newImageSet.add(img)
      }
      // 也保留后端返回的可能在DB中已有但前端没有的图片
      for (const img of res.data.images || []) {
        if (!newImageSet.has(img)) {
          // 后端有但前端没有的图片，可能是之前保存的，保留
          newImageSet.add(img)
        }
      }
      editForm.images = Array.from(newImageSet)
      ElMessage.success(res.message || `图片生成成功，新增 ${res.data.newImages?.length || 0} 张`)
    } else if (!res.success && res.error) {
      // 后端返回了具体的错误信息（如余额不足等）
      ElMessage.error(`图片生成失败: ${res.error}`)
    }
  } catch (e) {
    ElMessage.error('生成图片失败: ' + (e as Error).message)
  } finally {
    imageGenerating.value = false
  }
}

/** 上传图片 */
async function handleUploadImage(file: File): Promise<boolean> {
  // 验证文件类型
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请上传图片文件')
    return false
  }
  // 验证文件大小 (5MB)
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('图片大小不能超过 5MB')
    return false
  }

  imageUploading.value = true
  try {
    // 转为 base64
    const base64 = await fileToBase64(file)
    const res = await contentsApi.uploadImage(base64, file.name)
    if (res.success && res.data) {
      editForm.images.push(res.data.path)
      ElMessage.success('图片上传成功')
    }
  } catch (e) {
    ElMessage.error('上传失败: ' + (e as Error).message)
  } finally {
    imageUploading.value = false
  }
  return false // 阻止 el-upload 默认行为
}

/** 文件转 base64 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 删除图片 */
async function handleDeleteImage(index: number): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除这张图片？', '删除图片', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
    const res = await contentsApi.deleteImage(editForm.id, index)
    if (res.success) {
      editForm.images.splice(index, 1)
      ElMessage.success('图片已删除')
    }
  } catch { /* cancelled */ }
}

/** 拖拽排序 */
function onDragStart(index: number): void {
  dragIndex.value = index
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
}

function onDrop(targetIndex: number): void {
  if (dragIndex.value === null || dragIndex.value === targetIndex) return
  const dragged = editForm.images[dragIndex.value]
  editForm.images.splice(dragIndex.value, 1)
  editForm.images.splice(targetIndex, 0, dragged)
  dragIndex.value = null
}

/** 保存编辑 */
async function handleSave(): Promise<void> {
  if (!editForm.title.trim()) {
    ElMessage.warning('请输入标题')
    return
  }
  if (!editForm.body.trim()) {
    ElMessage.warning('请输入正文内容')
    return
  }

  saving.value = true
  try {
    await contentsApi.update(editForm.id, {
      title: editForm.title,
      body: editForm.body,
      tags: editForm.tags,
      images: editForm.images
    })
    ElMessage.success('保存成功')
    editDialogVisible.value = false
    await loadContents()
  } catch (e) {
    console.error('保存内容失败:', e)
  } finally {
    saving.value = false
  }
}

// ============================================================================
// 从视频工作室跳转后的自动轮询逻辑
// ============================================================================

/**
 * 当从视频工作室提交内容后，后端异步处理 LLM 回复。
 * 前端跳转到 /content?tab=chat&convId=xxx 后，需要轮询消息列表，
 * 直到检测到 assistant 消息出现，表示 LLM 回复已完成。
 */
const isPollingMessages = ref(false)
let pollingTimer: ReturnType<typeof setInterval> | null = null
const POLLING_INTERVAL = 2000 // 2秒轮询一次
const POLLING_MAX_ATTEMPTS = 60 // 最多轮询60次（2分钟超时）
let pollingAttempts = 0

/** 开始轮询消息列表，等待 LLM 回复 */
async function startMessagePolling(convId: number): Promise<void> {
  isPollingMessages.value = true
  pollingAttempts = 0

  // 先加载对话列表，确保对话存在
  await loadConversations()

  // 找到目标对话并选中
  const targetConv = conversations.value.find(c => c.id === convId)
  if (targetConv) {
    currentConversation.value = targetConv
    activeTab.value = 'creation'
    await loadMessages(convId)
    await nextTick()
    scrollToBottom()
  }

  // 检查是否已有 assistant 消息
  const hasAssistantMsg = messages.value.some(m => m.role === 'assistant')
  if (hasAssistantMsg) {
    // LLM 已回复，无需轮询
    isPollingMessages.value = false
    return
  }

  // 开始轮询
  pollingTimer = setInterval(async () => {
    pollingAttempts++
    if (pollingAttempts > POLLING_MAX_ATTEMPTS) {
      // 超时停止
      stopMessagePolling()
      ElMessage.warning('AI 回复超时，请稍后刷新查看')
      return
    }

    try {
      const res = await chatApi.getMessages(convId)
      if (res.success && res.data) {
        const prevMsgCount = messages.value.length
        messages.value = res.data

        // 检测到 assistant 消息出现，说明 LLM 回复已完成
        const nowHasAssistant = messages.value.some(m => m.role === 'assistant')
        if (nowHasAssistant && messages.value.length > prevMsgCount) {
          await nextTick()
          scrollToBottom()
          stopMessagePolling()
          ElMessage.success('AI 已完成内容分析')
        }
      }
    } catch (e) {
      console.error('轮询消息失败:', e)
    }
  }, POLLING_INTERVAL)
}

/** 停止消息轮询 */
function stopMessagePolling(): void {
  isPollingMessages.value = false
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

/**
 * 处理来自视频工作室的跳转请求。
 * URL: /content?tab=chat&convId=xxx
 */
async function handleVideoStudioRedirect(): Promise<void> {
  const convIdStr = route.query.convId as string
  if (convIdStr) {
    const convId = parseInt(convIdStr, 10)
    if (!Number.isNaN(convId)) {
      await startMessagePolling(convId)
    }
  }
}

// 监听 route query 变化（支持在同一组件内多次跳转）
watch(
  () => route.query.convId,
  (newConvId) => {
    if (newConvId) {
      handleVideoStudioRedirect()
    }
  }
)

// 模板面板打开时自动加载模板数据
watch(templatePanelVisible, (visible) => {
  if (visible) {
    loadTemplates()
    loadTemplateCategories()
  }
})

// ============================================================================
// 初始化
// ============================================================================

onMounted(async () => {
  await loadConversations()
  loadContents()
  loadLlmStatus()

  // 检查是否从视频工作室跳转而来
  if (route.query.convId) {
    await handleVideoStudioRedirect()
  }
})

onUnmounted(() => {
  stopMessagePolling()
})
</script>

<template>
  <div class="content-studio">
    <!-- 左侧：对话侧边栏（仅内容创作tab显示） -->
    <aside class="studio-sidebar" v-if="activeTab === 'creation'">
      <div class="sidebar-header">
        <span class="sidebar-title">对话记录</span>
        <el-dropdown trigger="click" @command="(cmd: string) => handleCreateConversation(cmd as ChatMode)">
          <el-button type="primary" size="small" :icon="undefined">
            <el-icon><Plus /></el-icon>
            新建
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="discuss">讨论模式</el-dropdown-item>
              <el-dropdown-item command="keyword">关键词提取</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <!-- LLM 状态 -->
      <div v-if="llmStatus" class="llm-status-bar">
        <el-tooltip :content="llmStatus.availableProviders.join('、') || '未配置'" placement="bottom">
          <el-tag size="small" :type="llmStatus.availableProviders.length > 0 ? 'success' : 'danger'" effect="plain">
            <el-icon><Cpu /></el-icon>
            {{ llmStatus.availableProviders.length > 0 ? llmStatus.availableProviders[0] : '未配置LLM' }}
          </el-tag>
        </el-tooltip>
      </div>

      <!-- 对话列表 -->
      <div class="conversation-list" v-loading="convLoading">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="conversation-item"
          :class="{ active: currentConversation?.id === conv.id }"
          @click="selectConversation(conv)"
        >
          <div class="conv-item-left">
            <el-icon class="conv-icon" :class="conv.mode === 'keyword' ? 'keyword-mode' : 'discuss-mode'">
              <ChatDotRound v-if="conv.mode === 'discuss'" />
              <Search v-else />
            </el-icon>
            <div class="conv-item-content">
              <template v-if="editingConvId === conv.id">
                <el-input
                  v-model="editingConvTitle"
                  size="small"
                  @click.stop
                  @keyup.enter="saveConvTitle"
                  @blur="saveConvTitle"
                />
              </template>
              <template v-else>
                <span class="conv-title" @dblclick.stop="startEditConv(conv)">{{ conv.title }}</span>
                <span class="conv-meta">
                  {{ conv.messageCount }} 条 · {{ formatTime(conv.updatedAt) }}
                </span>
              </template>
            </div>
          </div>
          <div class="conv-item-actions" v-if="editingConvId !== conv.id">
            <el-icon class="conv-action" @click.stop="startEditConv(conv)"><Edit /></el-icon>
            <el-icon class="conv-action danger" @click.stop="handleDeleteConv(conv)"><Delete /></el-icon>
          </div>
          <el-tag v-if="conv.status === 'confirmed'" size="small" type="success" class="conv-status-tag">
            已确认
          </el-tag>
        </div>
        <el-empty v-if="!convLoading && !conversations.length" description="暂无对话" :image-size="60" />
      </div>
    </aside>

    <!-- 右侧：主内容区 -->
    <main class="studio-main">
      <div class="studio-content-wrapper">
        <!-- ===== 内容创作 ===== -->
        <div v-if="activeTab === 'creation'" class="studio-tab-pane">
          <div v-if="!currentConversation" class="chat-empty">
            <el-empty description="选择左侧对话或创建新对话开始">
              <el-button type="primary" @click="handleCreateConversation('discuss')">
                <el-icon><Plus /></el-icon>
                创建新对话
              </el-button>
            </el-empty>
          </div>
          <div v-else class="chat-panel">
            <!-- 消息列表 -->
            <div ref="messageListRef" class="message-list" v-loading="messagesLoading">
              <div v-for="msg in messages" :key="msg.id" class="message-item" :class="msg.role">
                <div class="message-avatar">
                  <el-icon v-if="msg.role === 'user'"><User /></el-icon>
                  <el-icon v-else><ChatDotRound /></el-icon>
                </div>
                <div class="message-body">
                  <div class="message-header">
                    <span class="message-role">{{ msg.role === 'user' ? '我' : 'AI 助手' }}</span>
                    <span class="message-time">{{ formatTime(msg.createdAt) }}</span>
                    <el-tag v-if="msg.llmProvider" size="small" type="info" effect="plain" class="ml-4">
                      {{ msg.llmProvider }}
                    </el-tag>
                    <el-tag v-if="msg.confirmed" size="small" type="success" class="ml-4">
                      <el-icon><Check /></el-icon> 已确认
                    </el-tag>
                  </div>
                  <div class="message-content">{{ msg.content }}</div>
                  <!-- 关键词提取结果 -->
                  <div v-if="msg.extractedKeywords && msg.extractedKeywords.length" class="extracted-keywords">
                    <span class="kw-label">提取的关键词：</span>
                    <el-tag
                      v-for="kw in msg.extractedKeywords"
                      :key="kw"
                      size="small"
                      class="kw-tag"
                      @click="$router.push('/hashtags?keyword=' + encodeURIComponent(kw))"
                    >
                      #{{ kw }}
                    </el-tag>
                  </div>
                  <!-- 消息操作按钮 -->
                  <div class="message-actions">
                    <el-button text size="small" @click="copyMessage(msg.content)">
                      <el-icon><CopyDocument /></el-icon> 复制
                    </el-button>
                    <el-button
                      text
                      size="small"
                      :class="{ 'is-favorited': favoritedMessages.has(msg.id) }"
                      @click="toggleFavoriteMessage(msg)"
                    >
                      <el-icon><StarFilled v-if="favoritedMessages.has(msg.id)" /><Star v-else /></el-icon>
                      {{ favoritedMessages.has(msg.id) ? '已收藏' : '收藏' }}
                    </el-button>
                    <el-button
                      v-if="msg.role === 'assistant'"
                      text
                      size="small"
                      :loading="regenerating === msg.id"
                      @click="handleRegenerateMessage(msg)"
                    >
                      <el-icon><Refresh /></el-icon> 重新生成
                    </el-button>
                    <el-button
                      v-if="msg.role === 'assistant' && !msg.confirmed"
                      size="small"
                      type="primary"
                      plain
                      :loading="confirming === msg.id"
                      @click="handleConfirm(msg)"
                    >
                      <el-icon><Check /></el-icon>
                      确认此轮
                    </el-button>
                  </div>
                </div>
              </div>
              <el-empty v-if="!messagesLoading && !messages.length" description="开始对话吧" :image-size="60" />
              <!-- 轮询等待 AI 回复提示 -->
              <div v-if="isPollingMessages" class="polling-hint">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>AI 正在分析视频内容，请稍候...</span>
              </div>
            </div>

            <!-- 底部操作栏 -->
            <div class="chat-actions-bar" v-if="hasConfirmedMessage">
              <el-button
                type="success"
                :loading="generating"
                @click="handleGenerateFromChat"
              >
                <el-icon><MagicStick /></el-icon>
                基于确认内容生成笔记
              </el-button>
            </div>

            <!-- 输入区域 -->
            <div class="chat-input-area">
              <div class="mode-switch">
                <el-radio-group v-model="chatMode" size="small">
                  <el-radio-button value="discuss">
                    <el-icon><ChatDotRound /></el-icon> 讨论模式
                  </el-radio-button>
                  <el-radio-button value="keyword">
                    <el-icon><Search /></el-icon> 关键词提取
                  </el-radio-button>
                </el-radio-group>
                <span class="mode-desc">{{ chatMode === 'keyword' ? '输入内容描述，AI 将提取核心关键词、长尾词和推荐标签' : '与 AI 顾问自由讨论内容方向，获取标题、结构和标签建议' }}</span>
              </div>
              <!-- 模板库（紧凑弹出版，位于输入框附近） -->
              <div class="input-toolbar">
                <el-popover
                  v-model:visible="templatePanelVisible"
                  placement="top-start"
                  :width="480"
                  trigger="click"
                >
                  <template #reference>
                    <el-button text size="small">
                      <el-icon><Collection /></el-icon>
                      模板库
                      <el-tag v-if="selectedTemplate" size="small" type="success" style="margin-left: 8px">{{ selectedTemplate.name }}</el-tag>
                    </el-button>
                  </template>
                  <div class="template-library-compact">
                    <div class="template-toolbar">
                      <el-select v-model="selectedCategory" placeholder="分类" size="small" clearable style="width: 100px" @change="loadTemplates">
                        <el-option v-for="cat in templateCategories" :key="cat" :label="cat" :value="cat" />
                      </el-select>
                      <el-input v-model="templateSearchKeyword" placeholder="搜索模板" size="small" clearable style="width: 130px" @keyup.enter="loadTemplates" @clear="loadTemplates">
                        <template #prefix><el-icon><Search /></el-icon></template>
                      </el-input>
                    </div>
                    <div class="template-grid-compact" v-loading="templateLoading">
                      <div
                        v-for="tmpl in templates"
                        :key="tmpl.id"
                        class="template-card-compact"
                        :class="{ selected: selectedTemplate?.id === tmpl.id }"
                        @click="selectTemplate(tmpl)"
                      >
                        <div class="template-card-header">
                          <span class="template-card-name">{{ tmpl.name }}</span>
                          <el-tag size="small" :type="tmpl.isBuiltin ? 'info' : ''">{{ tmpl.isBuiltin ? '内置' : '自定义' }}</el-tag>
                        </div>
                        <div class="template-card-desc">{{ tmpl.description || '暂无描述' }}</div>
                      </div>
                      <el-empty v-if="!templateLoading && !templates.length" description="暂无模板" :image-size="30" />
                    </div>
                  </div>
                </el-popover>
                <el-button text size="small" @click="$router.push('/admin?tab=templates')">
                  <el-icon><Edit /></el-icon>
                  编辑模板库
                </el-button>
              </div>
              <div class="input-row">
                <el-input
                  v-model="chatInput"
                  type="textarea"
                  :rows="2"
                  :placeholder="chatMode === 'keyword' ? '输入内容描述，提取关键词和标签...' : '输入你的想法或需求...'"
                  @keydown.enter.exact.prevent="handleSendMessage"
                  :disabled="sending"
                />
                <el-button
                  type="primary"
                  :loading="sending"
                  :disabled="!chatInput.trim()"
                  @click="handleSendMessage"
                  class="send-btn"
                >
                  <el-icon v-if="!sending"><Promotion /></el-icon>
                  {{ sending ? '思考中...' : '发送' }}
                </el-button>
              </div>
              <div class="input-hint">Enter 发送 · Shift + Enter 换行</div>
            </div>
          </div>
        </div>

        <!-- ===== 视频工作室 ===== -->
        <div v-else-if="activeTab === 'video'" class="studio-tab-pane">
          <VideoStudioPanel />
        </div>

        <!-- ===== 图片工作室 ===== -->
        <div v-else-if="activeTab === 'image'" class="studio-tab-pane">
          <ImageStudioPanel />
        </div>

        <!-- ===== 流水线控制台 ===== -->
        <div v-else-if="activeTab === 'pipeline'" class="studio-tab-pane">
          <PipelineConsolePanel />
        </div>

        <!-- ===== 内容管理（统一列表 - 合并草稿审核） ===== -->
        <div v-else-if="activeTab === 'manage'" class="studio-tab-pane">
          <!-- 统计概览 -->
          <div class="unified-stats" v-if="unifiedStats">
            <el-card shadow="never" class="stat-card">
              <div class="stat-value">{{ unifiedStats.total }}</div>
              <div class="stat-label">总计</div>
            </el-card>
            <el-card shadow="never" class="stat-card">
              <div class="stat-value stat-primary">{{ unifiedStats.contentStudio }}</div>
              <div class="stat-label">内容创作</div>
            </el-card>
            <el-card shadow="never" class="stat-card">
              <div class="stat-value stat-warning">{{ unifiedStats.pipeline }}</div>
              <div class="stat-label">流水线生成</div>
            </el-card>
            <el-card shadow="never" class="stat-card">
              <div class="stat-value stat-success">{{ unifiedStats.byStatus['published'] || 0 }}</div>
              <div class="stat-label">已发布</div>
            </el-card>
            <el-card shadow="never" class="stat-card">
              <div class="stat-value stat-info">{{ unifiedStats.byStatus['draft'] || 0 }}</div>
              <div class="stat-label">草稿</div>
            </el-card>
          </div>

          <!-- 筛选与操作栏 -->
          <div class="list-header">
            <div class="list-header-left">
              <el-select
                v-model="sourceFilter"
                placeholder="来源"
                style="width: 130px"
                @change="handleFilterChange"
              >
                <el-option v-for="opt in sourceOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <el-select
                v-model="statusFilter"
                placeholder="状态"
                style="width: 130px; margin-left: 8px"
                @change="handleFilterChange"
              >
                <el-option v-for="opt in statusOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <el-select
                v-model="groupFilter"
                placeholder="分组"
                clearable
                style="width: 130px; margin-left: 8px"
                @change="handleFilterChange"
              >
                <el-option label="全部分组" value="" />
                <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
              </el-select>
              <el-switch
                v-model="favoriteFilter"
                active-text="仅看收藏"
                @change="handleFilterChange"
                style="margin-left: 12px"
              />
              <el-button text type="primary" style="margin-left: 8px" @click="groupManageDialogVisible = true">
                <el-icon><FolderOpened /></el-icon> 管理分组
              </el-button>
            </div>
            <el-button type="primary" :loading="generating_content" @click="handleGenerate">
              <el-icon v-if="!generating_content"><MagicStick /></el-icon>
              {{ generating_content ? '生成中...' : '生成内容' }}
            </el-button>
          </div>

          <!-- 批量操作工具栏 -->
          <div class="batch-toolbar" v-if="selectedItems.length > 0">
            <span class="batch-info">已选择 {{ selectedItems.length }} 项</span>
            <el-button size="small" type="primary" @click="handleBatchGroup">
              <el-icon><FolderAdd /></el-icon> 批量分组
            </el-button>
            <el-button size="small" type="danger" @click="handleBatchDelete">
              <el-icon><Delete /></el-icon> 批量删除
            </el-button>
          </div>

          <el-card shadow="never">
            <el-table
              ref="tableRef"
              :data="contentList"
              v-loading="loading"
              style="width: 100%"
              stripe
              row-key="id"
              @selection-change="handleSelectionChange"
            >
              <el-table-column type="selection" width="42" />
              <el-table-column label="序号" type="index" width="60" align="center" />
              <el-table-column label="ID" width="70" align="center">
                <template #default="{ row }">
                  <span class="text-secondary">{{ row.id }}</span>
                </template>
              </el-table-column>
              <el-table-column label="标签" min-width="130">
                <template #default="{ row }">
                  <div class="content-tags" v-if="row.tags && row.tags.length">
                    <el-tag
                      v-for="tag in row.tags.slice(0, 2)"
                      :key="tag"
                      size="small"
                      type="info"
                      effect="plain"
                    >#{{ tag }}</el-tag>
                    <span v-if="row.tags.length > 2" class="text-secondary">+{{ row.tags.length - 2 }}</span>
                  </div>
                  <span v-else class="text-secondary">-</span>
                </template>
              </el-table-column>
              <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
              <el-table-column label="图片" width="70" align="center">
                <template #default="{ row }">
                  <el-badge v-if="row.images && row.images.length" :value="row.images.length" type="primary">
                    <el-icon size="16" color="var(--color-text-secondary)"><Picture /></el-icon>
                  </el-badge>
                  <span v-else class="text-secondary">-</span>
                </template>
              </el-table-column>
              <el-table-column label="收藏" width="60" align="center">
                <template #default="{ row }">
                  <el-icon
                    class="favorite-icon"
                    :class="{ active: row.isFavorited }"
                    @click="handleToggleFavorite(row)"
                  >
                    <StarFilled v-if="row.isFavorited" />
                    <Star v-else />
                  </el-icon>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="statusConfig[row.status]?.type || 'info'" size="small">
                    {{ statusConfig[row.status]?.label || row.status }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="生成时间" width="150">
                <template #default="{ row }">
                  {{ formatTime(row.generatedAt) }}
                </template>
              </el-table-column>
              <el-table-column label="来源" width="100" align="center">
                <template #default="{ row }">
                  <el-tag :type="getSourceTagType(row.source)" size="small" effect="light">
                    {{ getSourceLabel(row.source) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="分组" width="120">
                <template #default="{ row }">
                  <el-select
                    v-if="row.source === 'content_studio'"
                    :model-value="row.groupName"
                    size="small"
                    placeholder="未分组"
                    style="width: 100px"
                    @change="(val: string) => handleGroupChange(row, val)"
                  >
                    <el-option label="未分组" value="" />
                    <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
                  </el-select>
                  <span v-else class="text-secondary">-</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="310" fixed="right">
                <template #default="{ row }">
                  <!-- 排序按钮（仅内容创作来源） -->
                  <el-button
                    v-if="row.source === 'content_studio'"
                    size="small" text
                    @click="handleMoveUp(row)"
                  >
                    <el-icon><Top /></el-icon>
                  </el-button>
                  <el-button
                    v-if="row.source === 'content_studio'"
                    size="small" text
                    @click="handleMoveDown(row)"
                  >
                    <el-icon><Bottom /></el-icon>
                  </el-button>
                  <el-button size="small" text type="primary" @click="handleEdit(row)">
                    <el-icon><Edit /></el-icon> 编辑
                  </el-button>
                  <el-button size="small" text type="warning" :loading="optimizing" @click="handleOptimize(row)">
                    <el-icon><MagicStick /></el-icon> AI优化
                  </el-button>
                  <!-- Task 3(6)(c): 合并为单一发布按钮，直接发布跳过审批 -->
                  <el-button
                    v-if="canPublish(row)"
                    size="small" text type="success"
                    :loading="publishing"
                    @click="handlePublishUnified(row)"
                  >发布</el-button>
                  <el-button
                    v-if="canPublish(row)"
                    size="small" text type="danger"
                    @click="handleRejectUnified(row)"
                  >拒绝</el-button>
                  <el-button
                    size="small" text type="danger"
                    @click="handleDeleteUnified(row)"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!loading && !contentList.length" description="暂无内容数据" />
          </el-card>

          <div class="pagination-wrapper" v-if="pagination.total > 0">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="pagination.total"
              :page-size="pagination.pageSize"
              :current-page="pagination.page"
              @current-change="handlePageChange"
            />
          </div>
        </div>

        <!-- ===== 发布列表 ===== -->
        <div v-else-if="activeTab === 'publish'" class="studio-tab-pane">
          <PublishListPanel />
        </div>
      </div>
    </main>

    <!-- 增强编辑器对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      title="编辑内容"
      width="850px"
      :close-on-click-modal="false"
      class="content-editor-dialog"
    >
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="editForm.title" placeholder="请输入标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="标签">
          <div class="tag-editor">
            <el-tag
              v-for="tag in editForm.tags"
              :key="tag"
              closable
              size="default"
              class="mr-8 mb-8"
              @close="removeTag(tag)"
            >#{{ tag }}</el-tag>
            <el-input
              v-if="editForm.tags.length < 10"
              v-model="tagInput"
              size="small"
              style="width: 160px"
              placeholder="输入标签后回车"
              @keyup.enter="addTag"
            />
          </div>
        </el-form-item>
        <el-form-item label="正文">
          <el-input
            v-model="editForm.body"
            type="textarea"
            :rows="10"
            placeholder="请输入正文内容"
            maxlength="5000"
            show-word-limit
          />
        </el-form-item>
        <!-- 图片管理 -->
        <el-form-item label="配图">
          <div class="image-section">
            <div class="image-actions">
              <el-button type="primary" plain size="small" :loading="imageGenerating" @click="handleGenerateImages">
                <el-icon><MagicStick /></el-icon>
                AI 生成配图
              </el-button>
              <el-upload
                :show-file-list="false"
                :before-upload="handleUploadImage"
                accept="image/*"
              >
                <el-button type="success" plain size="small" :loading="imageUploading">
                  <el-icon><Upload /></el-icon>
                  上传图片
                </el-button>
              </el-upload>
            </div>
            <div class="image-grid" v-if="editForm.images.length > 0">
              <div
                v-for="(img, idx) in editForm.images"
                :key="idx"
                class="image-item"
                draggable="true"
                @dragstart="onDragStart(idx)"
                @dragover="onDragOver"
                @drop="onDrop(idx)"
              >
                <img :src="img" :alt="`图片 ${idx + 1}`" class="preview-img" />
                <div class="image-overlay">
                  <el-icon class="img-action danger" @click="handleDeleteImage(idx)"><Delete /></el-icon>
                  <span class="img-order">{{ idx + 1 }}</span>
                </div>
              </div>
            </div>
            <div class="image-empty" v-else>
              <span class="text-secondary">暂无配图，可点击上方按钮生成或上传</span>
            </div>
            <div class="image-hint">提示：可拖拽图片调整顺序</div>
          </div>
        </el-form-item>
      </el-form>
      <!-- AI优化结果展示 -->
      <div v-if="optimizeResult" class="optimize-result">
        <el-divider />
        <div class="optimize-header">
          <span class="optimize-title">AI内容优化报告</span>
          <el-tag :type="optimizeResult.score >= 80 ? 'success' : optimizeResult.score >= 60 ? 'warning' : 'danger'" size="large">
            综合评分 {{ optimizeResult.score }}
          </el-tag>
        </div>
        <div class="optimize-scores">
          <div class="score-item">
            <span class="score-label">标题</span>
            <el-progress :percentage="optimizeResult.titleScore" :stroke-width="8" :color="optimizeResult.titleScore >= 80 ? 'var(--color-success)' : 'var(--color-warning)'" />
          </div>
          <div class="score-item">
            <span class="score-label">正文</span>
            <el-progress :percentage="optimizeResult.bodyScore" :stroke-width="8" :color="optimizeResult.bodyScore >= 80 ? 'var(--color-success)' : 'var(--color-warning)'" />
          </div>
          <div class="score-item">
            <span class="score-label">结构</span>
            <el-progress :percentage="optimizeResult.structureScore" :stroke-width="8" :color="optimizeResult.structureScore >= 80 ? 'var(--color-success)' : 'var(--color-warning)'" />
          </div>
        </div>
        <div v-if="optimizeResult.suggestions.length" class="optimize-suggestions">
          <div class="suggestions-title">改进建议：</div>
          <div v-for="(s, i) in optimizeResult.suggestions" :key="i" class="suggestion-item">
            <el-icon><Check /></el-icon> {{ s }}
          </div>
        </div>
        <div class="optimize-actions">
          <el-button type="primary" size="small" :disabled="!optimizeResult.optimizedTitle" @click="applyOptimized">
            <el-icon><Upload /></el-icon> 应用优化结果
          </el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量分组对话框 -->
    <el-dialog v-model="batchGroupDialogVisible" title="批量分组" width="400px">
      <el-form label-width="80px">
        <el-form-item label="分组名称">
          <el-select
            v-model="batchGroupName"
            placeholder="选择或输入分组名称"
            filterable
            allow-create
            style="width: 100%"
          >
            <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchGroupDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmBatchGroup">确认分组</el-button>
      </template>
    </el-dialog>

    <!-- 分组管理对话框 -->
    <el-dialog v-model="groupManageDialogVisible" title="分组管理" width="500px">
      <!-- 创建新分组 -->
      <div class="group-section">
        <h4>创建新分组</h4>
        <div style="display: flex; gap: 8px; margin-top: 8px">
          <el-input v-model="newGroupName" placeholder="输入分组名称" @keyup.enter="handleCreateGroup" />
          <el-button type="primary" @click="handleCreateGroup">创建</el-button>
        </div>
      </div>

      <!-- 已有分组列表 -->
      <div class="group-section" style="margin-top: 20px">
        <h4>已有分组 ({{ groups.length }})</h4>
        <el-table :data="groups.map(g => ({ name: g }))" style="width: 100%; margin-top: 8px" max-height="300">
          <el-table-column prop="name" label="分组名称" />
          <el-table-column label="操作" width="200" align="center">
            <template #default="{ row }">
              <el-button
                size="small"
                text
                type="primary"
                @click="renameGroupOldName = row.name; renameGroupNewName = row.name"
              >重命名</el-button>
              <el-button
                size="small"
                text
                type="danger"
                @click="handleDeleteGroup(row.name)"
              >删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 重命名区域 -->
      <div class="group-section" v-if="renameGroupOldName" style="margin-top: 20px">
        <h4>重命名分组: {{ renameGroupOldName }}</h4>
        <div style="display: flex; gap: 8px; margin-top: 8px">
          <el-input v-model="renameGroupNewName" placeholder="输入新名称" />
          <el-button type="primary" @click="handleRenameGroup">确认重命名</el-button>
          <el-button @click="renameGroupOldName = ''; renameGroupNewName = ''">取消</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.content-studio {
  display: flex;
  height: calc(100vh - 60px);
  overflow: hidden;
}

/* ==================== 侧边栏 ==================== */
.studio-sidebar {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-light);
  background: var(--color-bg-sidebar);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-bg-card);
}

.sidebar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.llm-status-bar {
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border-lighter);
  background: var(--color-bg-card);
}

.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.conversation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 4px;
  position: relative;
}

.conversation-item:hover {
  background: var(--color-bg-card-hover);
}

.conversation-item.active {
  background: var(--color-primary-soft);
}

.conv-item-left {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.conv-icon {
  font-size: 16px;
  margin-top: 2px;
  flex-shrink: 0;
}

.conv-icon.discuss-mode {
  color: var(--color-primary);
}

.conv-icon.keyword-mode {
  color: var(--color-warning);
}

.conv-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conv-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}

.conv-meta {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.conv-item-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.conversation-item:hover .conv-item-actions {
  opacity: 1;
}

.conv-action {
  font-size: 14px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 2px;
}

.conv-action:hover {
  color: var(--color-primary);
}

.conv-action.danger:hover {
  color: var(--color-danger);
}

.conv-status-tag {
  position: absolute;
  top: 4px;
  right: 4px;
}

/* ==================== 主内容区 ==================== */
.studio-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 非内容创作tab时，允许内容滚动 */
.studio-content-wrapper {
  overflow-y: auto;
  height: 100%;
}

.divider-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
}

.studio-content-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.studio-tab-pane {
  height: 100%;
  overflow-y: auto;
  padding: 0 24px 16px;
}

/* ==================== 对话面板 ==================== */
.chat-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 0 16px;
}

.polling-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--color-primary);
  font-size: 14px;
  background: var(--color-primary-soft);
  border-radius: 8px;
  margin-top: 12px;
}

.message-item {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-bg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 16px;
  color: var(--color-text-secondary);
}

.message-item.user .message-avatar {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}

.message-item.assistant .message-avatar {
  background: var(--color-success);
  color: var(--color-text-inverse);
}

.message-body {
  flex: 1;
  min-width: 0;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.message-role {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.message-time {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.ml-4 {
  margin-left: 4px;
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-regular);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-bg-subtle);
  padding: 12px 16px;
  border-radius: 8px;
}

.message-item.user .message-content {
  background: var(--color-primary-soft);
}

.extracted-keywords {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.kw-label {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.kw-tag {
  cursor: pointer;
}

.kw-tag:hover {
  opacity: 0.8;
}

.message-actions {
  margin-top: 8px;
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message-item:hover .message-actions {
  opacity: 1;
}

.message-actions .is-favorited {
  color: var(--color-warning);
}

.message-actions .is-favorited .el-icon {
  color: var(--color-warning);
}

.chat-actions-bar {
  padding: 12px 0;
  border-top: 1px solid var(--color-border-light);
  display: flex;
  justify-content: center;
}

.chat-input-area {
  border-top: 1px solid var(--color-border-light);
  padding: 12px 0;
}

.mode-switch {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mode-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.send-btn {
  flex-shrink: 0;
  height: 56px;
}

.input-hint {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-top: 4px;
  text-align: right;
}

/* ==================== 内容列表 ==================== */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-top: 16px;
}

.list-header-left {
  display: flex;
  align-items: center;
}

.favorite-icon {
  font-size: 18px;
  cursor: pointer;
  color: var(--color-text-placeholder);
  transition: color 0.2s, transform 0.2s;
}

.favorite-icon:hover {
  color: var(--color-warning);
  transform: scale(1.2);
}

.favorite-icon.active {
  color: var(--color-warning);
}

.content-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.text-secondary {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

/* ==================== 编辑器 ==================== */
.tag-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.mr-8 {
  margin-right: 8px;
}

.mb-8 {
  margin-bottom: 8px;
}

.image-section {
  width: 100%;
}

.image-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.image-item {
  position: relative;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 1;
  cursor: move;
  transition: border-color 0.15s;
}

.image-item:hover {
  border-color: var(--color-primary);
}

.preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.image-item:hover .image-overlay {
  opacity: 1;
}

.img-action {
  font-size: 20px;
  color: var(--color-text-inverse);
  cursor: pointer;
  padding: 4px;
}

.img-action.danger:hover {
  color: var(--color-danger);
}

.img-order {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: var(--color-text-inverse);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}

.image-empty {
  padding: 24px;
  text-align: center;
  border: 1px dashed var(--color-border-base);
  border-radius: 8px;
}

.image-hint {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-top: 8px;
}

/* 模板面板 */
.template-panel {
  padding: 0 0 16px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.template-library {
  margin-top: 12px;
}

.template-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  max-height: 300px;
  overflow-y: auto;
  padding: 4px 0;
}

.template-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--el-bg-color);
}

.template-card:hover {
  border-color: var(--el-color-primary);
  box-shadow: var(--box-shadow-raised-sm);
  transform: translateY(-1px);
}

.template-card.selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.template-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.template-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.template-card-category {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}

.template-card-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.template-card-desc {
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 6px;
}

.template-card-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}

.template-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* 输入区工具栏 */
.input-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* 紧凑版模板库弹出层 */
.template-library-compact {
  padding: 4px;
}

.template-library-compact .template-toolbar {
  margin-bottom: 8px;
}

.template-grid-compact {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
  padding: 2px 0;
}

.template-card-compact {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--el-bg-color);
}

.template-card-compact:hover {
  border-color: var(--el-color-primary);
  box-shadow: var(--box-shadow-raised-sm);
}

.template-card-compact.selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.template-card-compact .template-card-name {
  font-size: 12px;
}

.template-card-compact .template-card-desc {
  font-size: 11px;
  -webkit-line-clamp: 1;
  margin-bottom: 0;
}

/* 优化结果 */
.optimize-result {
  margin-top: 8px;
}

.optimize-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.optimize-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.optimize-scores {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.score-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.score-label {
  width: 40px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.score-item .el-progress {
  flex: 1;
}

.optimize-suggestions {
  background: var(--el-color-warning-light-9);
  padding: 12px 14px;
  border-radius: 8px;
  margin-bottom: 12px;
}

.suggestions-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.suggestion-item {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.7;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.suggestion-item .el-icon {
  color: var(--el-color-success);
  margin-top: 3px;
  flex-shrink: 0;
}

.optimize-actions {
  display: flex;
  justify-content: flex-end;
}

/* ==================== 统一内容统计 ==================== */
.unified-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  flex: 1;
  text-align: center;
  padding: 8px 0;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.4;
}

.stat-primary { color: var(--el-color-primary); }
.stat-warning { color: var(--el-color-warning); }
.stat-success { color: var(--el-color-success); }
.stat-info { color: var(--el-color-info); }

.stat-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

/* ==================== 批量操作工具栏 ==================== */
.batch-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  margin-bottom: 12px;
  background: var(--el-color-primary-light-9);
  border-radius: 4px;
  border: 1px solid var(--el-color-primary-light-7);
}

.batch-info {
  font-size: 13px;
  color: var(--el-color-primary);
  font-weight: 500;
  margin-right: 8px;
}

/* ==================== 分组管理对话框 ==================== */
.group-section h4 {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-regular);
}
</style>
