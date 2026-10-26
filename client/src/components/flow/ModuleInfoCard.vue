<script setup lang="ts">
/**
 * ModuleInfoCard — 模块信息卡片弹窗
 *
 * 点击流程图节点主体时弹出，展示：
 *   - 模块图标 + 名称 + 状态徽章
 *   - 模块功能描述（1-2 句话）
 *   - 内部功能列表（Feature Tags）
 *   - 【进入详情】按钮 → 跳转到对应路由
 */

import { computed, ref } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import {
  categoryColors,
  statusConfig,
  skillTypeConfig,
  llmTypeConfig,
  internalStepTypeConfig,
  type ModuleConfig,
  type ModuleSkill,
  type InternalStepType,
} from '@/config/moduleConfigs'
import { skillApi } from '@/api'
import { ElMessage } from 'element-plus'

// Vue Flow 样式（迷你流程图）
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

// ============================================================================
// Props
// ============================================================================

const props = defineProps<{
  /** 是否可见 */
  visible: boolean
  /** 选中的模块配置（可为 null） */
  module: ModuleConfig | null
}>()

// ============================================================================
// Emits
// ============================================================================

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'navigate', route: string): void
  (e: 'orchestrate', moduleId: string): void
}>()

// ============================================================================
// 计算属性
// ============================================================================

/** 双向绑定 visible（支持 v-model:visible） */
const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

/** 当前模块配置（安全访问） */
const currentModule = computed(() => props.module)

/** 分类颜色 */
const colors = computed(() => {
  if (!currentModule.value) return categoryColors['content-ops']
  return categoryColors[currentModule.value.category]
})

/** 状态配置 */
const status = computed(() => {
  if (!currentModule.value) return statusConfig.active
  return statusConfig[currentModule.value.status]
})

/** 该模块集成的 Skill 列表 */
const skills = computed<ModuleSkill[]>(() => {
  if (!currentModule.value?.skills) return []
  return currentModule.value.skills
})

/** 大模型配置 */
const llmConfig = computed(() => currentModule.value?.llmConfig)
const llmTypeInfo = computed(() => {
  if (!llmConfig.value) return null
  return llmTypeConfig[llmConfig.value.modelType] || null
})

/** 获取 Skill 类型配置 */
function getSkillTypeConfig(type: string) {
  return skillTypeConfig[type as keyof typeof skillTypeConfig] || skillTypeConfig.file
}

/** 获取内部流程步骤类型配置 */
function getStepTypeConfig(type: InternalStepType) {
  return internalStepTypeConfig[type] || internalStepTypeConfig.process
}

/** 模块内部流程 */
const internalFlow = computed(() => currentModule.value?.internalFlows)

/** Skill 名称 → ModuleSkill 的映射 */
const skillMap = computed<Map<string, ModuleSkill>>(() => {
  const map = new Map<string, ModuleSkill>()
  for (const skill of skills.value) {
    map.set(skill.name, skill)
  }
  return map
})

/** 解析步骤的 skillRef，返回对应的 Skill 列表 */
function getStepSkills(skillRef?: string): ModuleSkill[] {
  if (!skillRef) return []
  const names = skillRef.split(',').map(s => s.trim()).filter(Boolean)
  return names.map(n => skillMap.value.get(n)).filter(Boolean) as ModuleSkill[]
}

/** Skill-流程映射汇总（用于展示每个 skill 关联了哪些步骤） */
const skillFlowMapping = computed(() => {
  if (!internalFlow.value) return []
  const map = new Map<string, { skill: ModuleSkill; steps: string[] }>()
  for (const step of internalFlow.value.steps) {
    if (!step.skillRef) continue
    const names = step.skillRef.split(',').map(s => s.trim()).filter(Boolean)
    for (const n of names) {
      const skill = skillMap.value.get(n)
      if (!skill) continue
      if (!map.has(n)) {
        map.set(n, { skill, steps: [] })
      }
      map.get(n)!.steps.push(step.label)
    }
  }
  return Array.from(map.values())
})

/** Skill 文件夹打开中状态 */
const skillOpening = ref<string | null>(null)

/** 点击 Skill → 打开对应文件夹 */
async function handleSkillClick(skill: ModuleSkill): Promise<void> {
  if (!skill.path) {
    ElMessage.info(`技能「${skill.label}」为 ${getSkillTypeConfig(skill.type).label} 类型，无本地文件夹`)
    return
  }

  skillOpening.value = skill.name
  try {
    const res = await skillApi.openFolder(skill.name)
    if (res.success) {
      ElMessage.success(`已打开技能文件夹：${skill.label}`)
    } else {
      ElMessage.error(res.error || '打开文件夹失败')
    }
  } catch (e) {
    ElMessage.error('打开文件夹失败: ' + (e as Error).message)
  } finally {
    skillOpening.value = null
  }
}

// ============================================================================
// 模块内部流程迷你图（Vue Flow）
// ============================================================================

/** 迷你流程图实例 ID（独立于主流程图，避免冲突） */
const MINI_FLOW_ID = 'module-info-mini-flow'

/** 迷你流程图是否处于编辑模式 */
const isEditMode = ref<boolean>(false)

/** 迷你流程图节点（基于 internalFlow.steps 横向布局，间距 200px） */
const miniFlowNodes = computed(() => {
  if (!internalFlow.value) return []
  return internalFlow.value.steps.map((step, idx) => {
    const config = getStepTypeConfig(step.type)
    const stepSkills = getStepSkills(step.skillRef)
    // 如果步骤关联了 Skill，在标签后追加技能名称
    const skillSuffix = stepSkills.length > 0
      ? `\n[${stepSkills.map(s => s.label).join(', ')}]`
      : ''
    return {
      id: step.id,
      position: { x: idx * 200, y: 0 },
      data: { label: step.label },
      label: `${step.label}${skillSuffix}`,
      style: {
        backgroundColor: config.bg,
        borderColor: config.color,
        color: config.color,
        borderWidth: '2px',
        borderStyle: 'solid',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: '600',
        padding: '6px 12px',
        whiteSpace: 'pre-wrap' as const,
      },
    }
  })
})

/** 迷你流程图边（基于 internalFlow.edges） */
const miniFlowEdges = computed(() => {
  if (!internalFlow.value) return []
  return internalFlow.value.edges.map((e, idx) => ({
    id: `mini-e-${e.source}-${e.target}-${idx}`,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2 },
  }))
})

/** 进入编排调整模式 */
function handleEditFlow(): void {
  isEditMode.value = true
  ElMessage.info('已进入编排调整模式')
}

/** LLM 流程分析（占位） */
function handleAnalyzeFlow(): void {
  ElMessage.info('LLM 流程分析功能开发中')
}

/** 保存流程修改 */
function handleSaveFlow(): void {
  isEditMode.value = false
  ElMessage.success('流程修改已保存')
}

// ============================================================================
// 事件处理
// ============================================================================

/** 点击进入详情按钮 */
function handleNavigate(): void {
  if (currentModule.value) {
    emit('navigate', currentModule.value.route)
    dialogVisible.value = false
  }
}

/** 编排此模块的内部流程 */
function handleOrchestrateModule(): void {
  if (currentModule.value) {
    emit('orchestrate', currentModule.value.id)
    dialogVisible.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    width="720px"
    :show-close="true"
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    align-center
    class="module-info-dialog"
  >
    <template #header>
      <div v-if="currentModule" class="dialog-header">
        <div
          class="header-icon-box"
          :style="{ backgroundColor: colors.bg, borderColor: colors.border }"
        >
          <el-icon :size="24" :color="colors.border">
            <component :is="currentModule.icon" />
          </el-icon>
        </div>
        <div class="header-text">
          <div class="header-title-row">
            <span class="header-title">{{ currentModule.label }}</span>
            <span
              class="header-status-badge"
              :style="{ color: status.color, backgroundColor: status.bg }"
            >
              {{ status.label }}
            </span>
          </div>
          <span class="header-route">{{ currentModule.route }}</span>
        </div>
      </div>
    </template>

    <div v-if="currentModule" class="dialog-body">
      <!-- 功能描述 -->
      <div class="info-section">
        <div class="section-label">功能描述</div>
        <p class="section-text">{{ currentModule.description }}</p>
      </div>

      <!-- 核心功能 -->
      <div class="info-section">
        <div class="section-label">核心功能</div>
        <div class="feature-tags">
          <el-tag
            v-for="feature in currentModule.features"
            :key="feature"
            size="small"
            effect="light"
            :style="{
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.bg,
            }"
          >
            {{ feature }}
          </el-tag>
        </div>
      </div>

      <!-- 模块内部流程（提升至主要位置） -->
      <div v-if="internalFlow && internalFlow.steps.length > 0" class="info-section internal-flow-section">
        <div class="section-label">
          <el-icon :size="12"><Operation /></el-icon>
          <span>模块流程图（{{ internalFlow.steps.length }}步）</span>
          <el-button text size="small" type="primary" style="margin-left: auto" @click="handleOrchestrateModule">
            <el-icon><EditPen /></el-icon>
            编排流程
          </el-button>
        </div>
        <div class="mini-flow-container">
          <VueFlow
            :key="`mini-flow-${currentModule?.id}`"
            :id="MINI_FLOW_ID"
            :nodes="miniFlowNodes"
            :edges="miniFlowEdges"
            :fit-view-on-init="true"
            :nodes-draggable="isEditMode"
            :nodes-connectable="isEditMode"
            :elements-selectable="isEditMode"
            :min-zoom="0.3"
            :max-zoom="1.5"
            class="mini-flow"
          >
            <Background :gap="16" :size="1" pattern-color="var(--color-border-base)" />
            <Controls position="bottom-left" :show-interactive="false" />
          </VueFlow>
          <div class="mini-flow-actions">
            <el-button size="small" :type="isEditMode ? 'warning' : 'primary'" @click="handleEditFlow">
              <el-icon><EditPen /></el-icon>
              <span>编排调整</span>
            </el-button>
            <el-button size="small" @click="handleAnalyzeFlow">
              <el-icon><ChatLineSquare /></el-icon>
              <span>分析</span>
            </el-button>
            <el-button size="small" type="success" :disabled="!isEditMode" @click="handleSaveFlow">
              <el-icon><Select /></el-icon>
              <span>保存</span>
            </el-button>
          </div>
        </div>
      </div>

      <!-- Skill-流程映射关系 -->
      <div v-if="skillFlowMapping.length > 0" class="info-section skill-flow-mapping-section">
        <div class="section-label">
          <el-icon :size="12"><Connection /></el-icon>
          <span>Skill-流程映射（{{ skillFlowMapping.length }} 个技能关联）</span>
        </div>
        <div class="skill-flow-mapping-list">
          <div
            v-for="item in skillFlowMapping"
            :key="item.skill.name"
            class="skill-flow-mapping-item"
          >
            <div class="mapping-skill-info">
              <el-icon :size="12" :color="getSkillTypeConfig(item.skill.type).color">
                <component :is="getSkillTypeConfig(item.skill.type).icon" />
              </el-icon>
              <span class="mapping-skill-name">{{ item.skill.label }}</span>
              <el-tag size="small" effect="plain" :style="{
                color: getSkillTypeConfig(item.skill.type).color,
                borderColor: getSkillTypeConfig(item.skill.type).color,
              }">
                {{ getSkillTypeConfig(item.skill.type).label }}
              </el-tag>
            </div>
            <div class="mapping-steps">
              <span class="mapping-steps-label">关联步骤：</span>
              <span
                v-for="stepLabel in item.steps"
                :key="stepLabel"
                class="mapping-step-tag"
              >
                {{ stepLabel }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 以下为辅助信息区域 -->

      <!-- 大模型配置 -->
      <div class="info-section">
        <div class="section-label">
          <el-icon :size="12"><Cpu /></el-icon>
          <span>大模型配置</span>
        </div>
        <div v-if="llmConfig?.configured && llmTypeInfo" class="llm-config-box">
          <div class="llm-config-header">
            <el-tag
              size="small"
              effect="light"
              :style="{
                color: llmTypeInfo.color,
                borderColor: llmTypeInfo.color,
                backgroundColor: llmTypeInfo.bg,
              }"
            >
              <el-icon :size="11" style="vertical-align: middle">
                <component :is="llmTypeInfo.icon" />
              </el-icon>
              {{ llmTypeInfo.label }}
            </el-tag>
            <span class="llm-model-name">{{ llmConfig.modelName }}</span>
          </div>
          <p v-if="llmConfig.usage" class="llm-usage">{{ llmConfig.usage }}</p>
        </div>
        <div v-else class="llm-config-empty">
          <el-icon :size="14" color="var(--color-text-secondary)"><CircleClose /></el-icon>
          <span>未配置大模型（仅使用 API/文件技能）</span>
        </div>
      </div>

      <!-- 集成技能列表 -->
      <div v-if="skills.length > 0" class="info-section">
        <div class="section-label">
          <el-icon :size="12"><Cpu /></el-icon>
          <span>集成技能（点击打开文件夹编辑）</span>
        </div>
        <div class="skill-list">
          <div
            v-for="skill in skills"
            :key="skill.name"
            class="skill-card"
            :class="{
              'skill-clickable': skill.path,
              'skill-loading': skillOpening === skill.name,
            }"
            @click="handleSkillClick(skill)"
          >
            <div class="skill-card-header">
              <div class="skill-card-left">
                <el-icon :size="14" :color="getSkillTypeConfig(skill.type).color">
                  <component :is="getSkillTypeConfig(skill.type).icon" />
                </el-icon>
                <div class="skill-card-names">
                  <span class="skill-card-name">{{ skill.label }}</span>
                  <span class="skill-card-en-name">{{ skill.name }}</span>
                </div>
              </div>
              <el-tag
                size="small"
                effect="light"
                :style="{
                  color: getSkillTypeConfig(skill.type).color,
                  borderColor: getSkillTypeConfig(skill.type).color,
                  backgroundColor: getSkillTypeConfig(skill.type).bg,
                }"
              >
                {{ getSkillTypeConfig(skill.type).label }}
              </el-tag>
            </div>
            <p class="skill-card-desc">{{ skill.description }}</p>
            <div class="skill-card-meta">
              <span class="skill-card-impl">
                <el-icon :size="11"><Operation /></el-icon>
                {{ skill.implementation }}
              </span>
              <span v-if="skill.path" class="skill-card-path" :title="skill.path">
                <el-icon :size="11"><FolderOpened /></el-icon>
                {{ skill.path.length > 45 ? '...' + skill.path.slice(-42) : skill.path }}
              </span>
              <span v-else class="skill-card-path skill-card-path-none">
                无本地文件
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 模块分类 -->
      <div class="info-section">
        <div class="section-label">所属分类</div>
        <div class="category-info">
          <el-tag
            size="small"
            effect="dark"
            :style="{
              backgroundColor: colors.border,
              borderColor: colors.border,
            }"
          >
            {{ currentModule.category === 'content-ops' ? '内容运营中心' : currentModule.category === 'xhs-pipeline' ? '小红书流水线' : '社媒情报中心' }}
          </el-tag>
          <span class="category-route-text">路由：{{ currentModule.route }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleNavigate">
          <el-icon class="mr-4"><ArrowRight /></el-icon>
          进入详情
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 对话框头部 */
.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon-box {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.header-status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.header-route {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-family: 'Courier New', monospace;
}

/* 对话框主体 */
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
}

.info-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 4px;
}

.section-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-regular);
  margin: 0;
}

.feature-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 集成技能列表 */
.skill-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skill-card {
  padding: 12px;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  transition: all 0.15s ease;
}

.skill-card.skill-clickable {
  cursor: pointer;
}

.skill-card.skill-clickable:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  box-shadow: var(--box-shadow-raised-sm);
  transform: translateY(-1px);
}

.skill-card.skill-loading {
  opacity: 0.5;
  pointer-events: none;
}

.skill-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.skill-card-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.skill-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.skill-card-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-regular);
  margin: 0 0 8px 0;
}

.skill-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.skill-card-impl,
.skill-card-path {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: 'Courier New', monospace;
}

.skill-card-path-none {
  font-style: italic;
  opacity: 0.7;
}

.category-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.category-route-text {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-family: 'Courier New', monospace;
}

/* 内部流程展示 */
.internal-flow-section {
  background: var(--color-bg-subtle);
  border-radius: 8px;
  padding: 12px;
  margin: 8px -12px;
}

.internal-flow-section .section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

/* 迷你流程图容器 */
.mini-flow-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mini-flow {
  height: 280px;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  background: var(--color-bg-page);
}

.mini-flow-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* Skill-流程映射 */
.skill-flow-mapping-section {
  background: var(--color-primary-soft);
  border-radius: 8px;
  padding: 12px;
  margin: 8px -12px;
}

.skill-flow-mapping-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-flow-mapping-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--color-bg-card);
  border-radius: 6px;
  border: 1px solid var(--color-border-light);
}

.mapping-skill-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mapping-skill-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.mapping-steps {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.mapping-steps-label {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.mapping-step-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 500;
}

/* 对话框底部 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.mr-4 {
  margin-right: 4px;
}
</style>

<style>
/* 全局样式：对话框圆角 */
.module-info-dialog .el-dialog {
  border-radius: 12px;
  overflow: hidden;
}

.module-info-dialog .el-dialog__header {
  padding: 16px 20px;
  margin-right: 0;
  border-bottom: 1px solid var(--color-border-lighter);
}

.module-info-dialog .el-dialog__body {
  padding: 20px;
}

.module-info-dialog .el-dialog__footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-lighter);
}

/* 迷你流程图 Vue Flow 全局样式 */
.module-info-dialog .vue-flow__node-default {
  font-size: 12px;
  border-radius: 8px;
  box-shadow: var(--box-shadow-raised-sm);
}

.module-info-dialog .vue-flow__controls {
  box-shadow: var(--box-shadow-raised-sm);
  border-radius: 6px;
  overflow: hidden;
}

.module-info-dialog .vue-flow__controls-button {
  border: none;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-bg-card);
}

.module-info-dialog .vue-flow__controls-button:hover {
  background: var(--color-bg-card-hover);
}

.module-info-dialog .vue-flow__edge-path {
  stroke-width: 2;
}

.module-info-dialog .vue-flow__edge-textwrapper {
  font-size: 10px;
}

.module-info-dialog .vue-flow__edge-text {
  fill: var(--color-text-secondary);
}

.module-info-dialog .vue-flow__background {
  background: var(--color-bg-page);
}
</style>
