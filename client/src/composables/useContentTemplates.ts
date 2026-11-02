import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { templateApi, type ContentTemplateDTO } from '@/api'

export function useContentTemplates(chatInput: Ref<string>) {
const templatePanelVisible = ref(false)
const templates = ref<ContentTemplateDTO[]>([])
const templateCategories = ref<string[]>([])
const selectedCategory = ref<string>('')
const templateSearchKeyword = ref<string>('')
const templateLoading = ref(false)
const selectedTemplate = ref<ContentTemplateDTO | null>(null)

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


return { templatePanelVisible, templates, templateCategories, selectedCategory, templateSearchKeyword, templateLoading, selectedTemplate, loadTemplates, loadTemplateCategories, selectTemplate }
}
