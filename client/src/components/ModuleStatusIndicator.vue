<script setup lang="ts">
/**
 * ModuleStatusIndicator — 模块右上角 Skill/大模型状态指示器
 *
 * 功能：
 *   1. 紧凑显示当前模块集成的 Skill 数量和大模型配置
 *   2. 点击展开 Popover，显示详细 Skill 列表和 LLM 配置
 *   3. 支持 Skill 单选切换（启用/禁用）
 *   4. 支持 LLM 模型多选切换
 */
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getModuleConfig,
  skillTypeConfig,
  llmTypeConfig,
  type ModuleSkill,
  type LlmConfig,
} from '@/config/moduleConfigs'
import { adminLLMApi, adminModuleApi } from '@/api'

// ============================================================
// Props
// ============================================================

const props = defineProps<{
  /** 模块 ID（与 moduleConfigs 中的 id 对应） */
  moduleId: string
}>()

// ============================================================
// 状态
// ============================================================

/** Popover 可见性 */
const popoverVisible = ref(false)

/** 所有可用 LLM 配置列表（从后端加载） */
const allLlmConfigs = ref<any[]>([])

/** 用户自定义模型列表 */
const customModels = ref<any[]>([])

/** 当前选中的 Skill（单选模式） */
const selectedSkill = ref<string>('')

/** 当前选中的 LLM（多选模式） */
const selectedLlms = ref<string[]>([])

/** 运行配置保存状态 */
const savingConfig = ref(false)

/** 添加自定义模型的弹窗 */
const addModelVisible = ref(false)
const newModel = ref({
  name: '',
  provider: '',
  endpoint: '',
  apiKey: '',
})

// ============================================================
// 计算属性
// ============================================================

/** 模块配置 */
const moduleConfig = computed(() => getModuleConfig(props.moduleId))

/** 模块的 Skill 列表 */
const skills = computed<ModuleSkill[]>(() => moduleConfig.value?.skills ?? [])

/** 模块的 LLM 配置 */
const llmConfig = computed<LlmConfig | undefined>(() => moduleConfig.value?.llmConfig)

/** LLM 类型信息 */
const llmTypeInfo = computed(() => {
  if (!llmConfig.value) return null
  return llmTypeConfig[llmConfig.value.modelType] || null
})

/** Skill 数量 */
const skillCount = computed(() => skills.value.length)

/** 是否有 LLM 配置 */
const hasLlm = computed(() => llmConfig.value?.configured ?? false)

/** 获取 Skill 类型配置 */
function getSkillTypeConfig(type: string) {
  return skillTypeConfig[type as keyof typeof skillTypeConfig] || skillTypeConfig.file
}

/** 可切换的 LLM 列表（系统默认 + 用户自定义） */
const availableLlms = computed(() => {
  const system = allLlmConfigs.value.map(llm => ({
    label: llm.label || llm.provider,
    value: llm.provider,
    type: 'system',
    model: llm.model,
  }))
  const custom = customModels.value.map(m => ({
    label: m.name,
    value: `custom-${m.name}`,
    type: 'custom',
    model: m.name,
  }))
  return [...system, ...custom]
})

// ============================================================
// 方法
// ============================================================

/** 加载当前模块保存的 Skill/LLM 运行配置 */
async function loadModuleRuntimeConfig(): Promise<void> {
  try {
    const res = await adminModuleApi.getList()
    if (!res.success || !res.data) return
    const setting = res.data.find((item: any) => item.id === props.moduleId)
    if (!setting) return

    selectedSkill.value = setting.selected_skill || ''
    if (Array.isArray(setting.selected_llms)) {
      selectedLlms.value = setting.selected_llms
    } else {
      try {
        const parsed = JSON.parse(setting.selected_llms || '[]')
        selectedLlms.value = Array.isArray(parsed) ? parsed : []
      } catch {
        selectedLlms.value = []
      }
    }
  } catch (e) {
    ElMessage.error('加载模块运行配置失败: ' + (e as Error).message)
  }
}

/** 加载 LLM 配置列表 */
async function loadLlmConfigs(): Promise<void> {
  try {
    const res = await adminLLMApi.getList()
    if (res.success && res.data) {
      allLlmConfigs.value = res.data
      // 默认选中当前模块配置的 LLM
      if (selectedLlms.value.length === 0 && llmConfig.value?.modelName) {
        const matched = res.data.find(
          (llm: any) => llm.model === llmConfig.value?.modelName
        )
        if (matched) {
          selectedLlms.value = [matched.provider]
        }
      }
    }
  } catch (e) {
    ElMessage.error('加载 LLM 配置失败: ' + (e as Error).message)
  }
}

/** 切换 Skill 选择（单选模式） */
async function handleSkillChange(skillName: string): Promise<void> {
  if (savingConfig.value) return
  const previous = selectedSkill.value
  const next = previous === skillName ? '' : skillName
  selectedSkill.value = next
  savingConfig.value = true
  try {
    const res = await adminModuleApi.update(props.moduleId, { selected_skill: next })
    if (!res.success) throw new Error(res.error || '保存失败')
    selectedSkill.value = res.data?.selected_skill || ''
    const label = skills.value.find(s => s.name === skillName)?.label || skillName
    ElMessage.success(next ? `已切换到技能：${label}` : `已取消选择技能：${label}`)
  } catch (e) {
    selectedSkill.value = previous
    ElMessage.error('保存 Skill 选择失败: ' + (e as Error).message)
  } finally {
    savingConfig.value = false
  }
}

/** 切换 LLM 选择（多选模式） */
async function handleLlmChange(values: string[]): Promise<void> {
  if (savingConfig.value) return
  const previous = [...selectedLlms.value]
  const next = [...values]
  savingConfig.value = true
  try {
    const res = await adminModuleApi.update(props.moduleId, { selected_llms: next })
    if (!res.success) throw new Error(res.error || '保存失败')
    selectedLlms.value = Array.isArray(res.data?.selected_llms) ? res.data.selected_llms : next
    const labels = selectedLlms.value
      .map(v => availableLlms.value.find(l => l.value === v)?.label)
      .filter(Boolean)
    ElMessage.success(labels.length > 0 ? `已选择模型：${labels.join(', ')}` : '已清空模型选择')
  } catch (e) {
    selectedLlms.value = previous
    ElMessage.error('保存模型选择失败: ' + (e as Error).message)
  } finally {
    savingConfig.value = false
  }
}

async function loadRuntimeState(): Promise<void> {
  await loadModuleRuntimeConfig()
  await loadLlmConfigs()
}

/** 打开添加自定义模型弹窗 */
function openAddModel(): void {
  newModel.value = { name: '', provider: '', endpoint: '', apiKey: '' }
  addModelVisible.value = true
}

/** 保存自定义模型 */
async function saveCustomModel(): Promise<void> {
  if (!newModel.value.name.trim()) {
    ElMessage.warning('请输入模型名称')
    return
  }
  if (!newModel.value.provider.trim()) {
    ElMessage.warning('请输入提供商名称')
    return
  }

  try {
    // 调用后端 API 保存自定义模型
    await adminLLMApi.update(newModel.value.provider, {
      model: newModel.value.name,
      endpoint: newModel.value.endpoint || undefined,
      api_key: newModel.value.apiKey || undefined,
      label: newModel.value.name,
      enabled: 1,
    })
    ElMessage.success(`自定义模型「${newModel.value.name}」已添加`)
    addModelVisible.value = false
    await loadLlmConfigs()
  } catch (e) {
    ElMessage.error('添加失败: ' + (e as Error).message)
  }
}

// ============================================================
// 生命周期
// ============================================================

onMounted(() => {
  loadRuntimeState()
})

watch(() => props.moduleId, () => {
  loadRuntimeState()
})
</script>

<template>
  <el-popover
    v-model:visible="popoverVisible"
    placement="bottom-end"
    :width="380"
    trigger="click"
    popper-class="module-status-popover"
  >
    <template #reference>
      <div class="status-indicator-trigger" @click.stop>
        <!-- Skill 数量徽章 -->
        <el-badge :value="skillCount" type="primary" :hidden="skillCount === 0">
          <div class="indicator-icon skill-icon" title="集成技能">
            <el-icon :size="16"><Cpu /></el-icon>
          </div>
        </el-badge>

        <!-- LLM 配置徽章 -->
        <div
          v-if="hasLlm && llmTypeInfo"
          class="indicator-icon llm-icon"
          :style="{
            color: llmTypeInfo.color,
            borderColor: llmTypeInfo.color,
            backgroundColor: llmTypeInfo.bg,
          }"
          :title="llmConfig?.modelName"
        >
          <el-icon :size="16">
            <component :is="llmTypeInfo.icon" />
          </el-icon>
          <span class="llm-short-text">{{ llmConfig?.modelName?.split(' ')[0] || 'LLM' }}</span>
        </div>
        <div v-else class="indicator-icon llm-icon no-llm" title="未配置大模型">
          <el-icon :size="16"><CircleClose /></el-icon>
        </div>
      </div>
    </template>

    <!-- Popover 内容 -->
    <div class="status-popover-content" v-if="moduleConfig">
      <!-- 标题 -->
      <div class="popover-header">
        <span class="popover-title">{{ moduleConfig.label }} — 集成状态</span>
      </div>

      <!-- Skill 列表（单选切换） -->
      <div class="popover-section">
        <div class="section-header">
          <span class="section-title">
            <el-icon :size="13"><Cpu /></el-icon>
            集成技能（{{ skillCount }}）
          </span>
          <el-tag size="small" type="info" effect="plain">单选切换</el-tag>
        </div>
        <div class="skill-switch-list">
          <div
            v-for="skill in skills"
            :key="skill.name"
            class="skill-switch-item"
            :class="{ active: selectedSkill === skill.name, saving: savingConfig }"
            @click="handleSkillChange(skill.name)"
          >
            <div class="skill-item-left">
              <el-icon :size="14" :color="getSkillTypeConfig(skill.type).color">
                <component :is="getSkillTypeConfig(skill.type).icon" />
              </el-icon>
              <div class="skill-item-info">
                <span class="skill-item-name">{{ skill.label }}</span>
                <span class="skill-item-impl">{{ skill.implementation }}</span>
              </div>
            </div>
            <el-icon
              v-if="selectedSkill === skill.name"
              :size="14"
              color="#4361ee"
              class="skill-check-icon"
            >
              <Check />
            </el-icon>
          </div>
          <div v-if="skills.length === 0" class="empty-text">
            暂无集成技能
          </div>
        </div>
      </div>

      <!-- LLM 配置（多选切换） -->
      <div class="popover-section">
        <div class="section-header">
          <span class="section-title">
            <el-icon :size="13"><Connection /></el-icon>
            大模型配置
          </span>
          <el-tag size="small" type="info" effect="plain">多选切换</el-tag>
        </div>

        <!-- 当前模块默认模型 -->
        <div v-if="llmConfig?.configured" class="current-llm-box">
          <span class="current-llm-label">当前默认：</span>
          <span class="current-llm-name">{{ llmConfig.modelName }}</span>
        </div>

        <!-- 可选模型列表 -->
        <el-checkbox-group
          v-model="selectedLlms"
          :disabled="savingConfig"
          @change="handleLlmChange"
          class="llm-checkbox-group"
        >
          <el-checkbox
            v-for="llm in availableLlms"
            :key="llm.value"
            :value="llm.value"
            class="llm-checkbox-item"
          >
            <div class="llm-checkbox-content">
              <span class="llm-checkbox-label">{{ llm.label }}</span>
              <el-tag
                size="small"
                :type="llm.type === 'system' ? 'success' : 'warning'"
                effect="plain"
              >
                {{ llm.type === 'system' ? '系统' : '自定义' }}
              </el-tag>
            </div>
          </el-checkbox>
        </el-checkbox-group>

        <!-- 添加自定义模型 -->
        <el-button
          text
          type="primary"
          size="small"
          class="add-custom-model-btn"
          @click="openAddModel"
        >
          <el-icon><Plus /></el-icon>
          添加自定义模型
        </el-button>
      </div>
    </div>

    <!-- 添加自定义模型弹窗 -->
    <el-dialog
      v-model="addModelVisible"
      title="添加自定义大模型"
      width="440px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form :model="newModel" label-width="80px">
        <el-form-item label="模型名称" required>
          <el-input
            v-model="newModel.name"
            placeholder="如：gpt-4o, claude-3-opus, GLM-4V-Flash"
          />
        </el-form-item>
        <el-form-item label="提供商" required>
          <el-select
            v-model="newModel.provider"
            placeholder="选择或输入提供商"
            filterable
            allow-create
            style="width: 100%"
          >
            <el-option label="OpenAI" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="智谱AI" value="zhipu" />
            <el-option label="DeepSeek" value="deepseek" />
            <el-option label="Ollama (本地)" value="ollama" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item label="API端点">
          <el-input
            v-model="newModel.endpoint"
            placeholder="如：https://api.openai.com/v1（留空使用默认）"
          />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="newModel.apiKey"
            type="password"
            show-password
            placeholder="输入 API Key（可选）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addModelVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCustomModel">添加</el-button>
      </template>
    </el-dialog>
  </el-popover>
</template>

<style scoped>
/* === 触发器 === */
.status-indicator-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--border-radius-base);
  transition: background-color 0.2s ease;
}

.status-indicator-trigger:hover {
  background-color: var(--color-bg-card-hover);
}

.indicator-icon {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--border-radius-pill);
  border: 1px solid var(--color-border-light);
  background-color: var(--color-bg-card);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-regular);
  transition: all 0.2s ease;
}

.skill-icon {
  color: var(--color-primary);
  border-color: var(--color-primary);
  background-color: var(--color-primary-soft);
}

.llm-icon {
  display: flex;
  align-items: center;
  gap: 4px;
}

.llm-short-text {
  font-size: 11px;
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-llm {
  color: var(--color-text-secondary);
  border-color: var(--color-border-light);
  background-color: var(--color-bg-subtle);
}

/* === Popover 内容 === */
.status-popover-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.popover-header {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-lighter);
}

.popover-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.popover-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* === Skill 切换列表 === */
.skill-switch-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skill-switch-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--border-radius-base);
  border: 1px solid var(--color-border-lighter);
  cursor: pointer;
  transition: all 0.2s ease;
}

.skill-switch-item:hover {
  border-color: var(--color-primary);
  background-color: rgba(99, 102, 241, 0.04);
}

.skill-switch-item.active {
  border-color: var(--color-primary);
  background-color: rgba(99, 102, 241, 0.08);
  box-shadow: 0 0 0 1px var(--color-primary);
}

.skill-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.skill-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.skill-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.skill-item-impl {
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-check-icon {
  flex-shrink: 0;
}

.empty-text {
  font-size: 12px;
  color: var(--color-text-placeholder);
  text-align: center;
  padding: 12px;
}

/* === LLM 配置 === */
.current-llm-box {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--border-radius-base);
  background-color: var(--color-bg-card);
  font-size: 12px;
}

.current-llm-label {
  color: var(--color-text-secondary);
}

.current-llm-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.llm-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.llm-checkbox-item {
  margin-right: 0;
  height: auto;
  padding: 4px 0;
}

.llm-checkbox-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.llm-checkbox-label {
  font-size: 13px;
}

.add-custom-model-btn {
  align-self: flex-start;
  margin-top: 4px;
}
</style>
