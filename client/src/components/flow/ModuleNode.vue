<script setup lang="ts">
/**
 * ModuleNode — 流程图自定义节点组件
 *
 * 结构：
 *   顶部：模块图标 + 名称 + 状态徽章
 *   中部：内嵌功能组件（根据 embeddedFeature 类型动态渲染）
 *   底部：【进入详情】按钮
 *
 * 交互：
 *   - 点击节点主体 → 由 Vue Flow 的 @node-click 事件处理（弹出信息卡片）
 *   - 点击【进入详情】→ 调用 data.navigate(route) → 路由跳转
 *   - 使用内嵌功能 → 直接调用 API 执行，无需跳转页面
 */

import { computed, ref, onMounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import {
  categoryColors,
  statusConfig,
  skillTypeConfig,
  llmTypeConfig,
  internalStepTypeConfig,
  type ModuleConfig,
  type ModuleSkill,
  type EmbeddedFeatureType,
  type InternalFlow,
  type InternalStepType,
} from '@/config/moduleConfigs'
import { trendsApi, hashtagsApi, contentsApi, publishApi, dashboardApi, pipelineApi, skillApi } from '@/api'
import type { Platform } from '@/types'
import { ElMessage } from 'element-plus'

// ============================================================================
// Props
// ============================================================================

const props = defineProps<{
  /** 节点数据（Vue Flow 注入） */
  data: {
    config: ModuleConfig
    /** 导航回调（由 FlowHome 通过节点数据注入） */
    navigate?: (route: string) => void
    /** 是否显示内部流程（由 FlowHome 通过节点数据注入） */
    showInternalFlows?: boolean
    [key: string]: unknown
  }
}>()

// ============================================================================
// 计算属性
// ============================================================================

const config = computed(() => props.data.config)
const colors = computed(() => categoryColors[config.value.category])
const status = computed(() => statusConfig[config.value.status])
const featureType = computed<EmbeddedFeatureType>(() => config.value.embeddedFeature)

/** 该模块集成的 Skill 列表 */
const skills = computed<ModuleSkill[]>(() => config.value.skills || [])

/** 大模型配置 */
const llmConfig = computed(() => config.value.llmConfig)
const llmTypeInfo = computed(() => {
  if (!llmConfig.value) return llmTypeConfig.none
  return llmTypeConfig[llmConfig.value.modelType] || llmTypeConfig.none
})

/** 模块首字母（用于纯 CSS 图标替代 SVG） */
const moduleInitial = computed<string>(() => {
  return config.value.label.charAt(0) || 'M'
})

/** 模块内部流程 */
const internalFlow = computed<InternalFlow | undefined>(() => config.value.internalFlows)

/** 是否显示内部流程区域 */
const showInternalFlow = computed<boolean>(() => {
  return !!(props.data.showInternalFlows && internalFlow.value && internalFlow.value.steps.length > 0)
})

/** 获取步骤类型配置 */
function getStepTypeConfig(type: InternalStepType) {
  return internalStepTypeConfig[type] || internalStepTypeConfig.process
}

/** 获取 Skill 类型配置 */
function getSkillTypeConfig(type: string) {
  return skillTypeConfig[type as keyof typeof skillTypeConfig] || skillTypeConfig.file
}

/** Skill 名称 → ModuleSkill 的映射，用于流程步骤 skillRef 查找 */
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

// ============================================================================
// 内嵌功能状态
// ============================================================================

// 通用加载状态
const loading = ref<boolean>(false)

// 趋势发现：平台选择
const trendPlatform = ref<string>('douyin')

// 标签搜索：关键词
const hashtagKeyword = ref<string>('')

// 内容生成：关键词
const contentKeyword = ref<string>('')

// 情报监测：关键词
const radarKeyword = ref<string>('')

// 统计数据
const publishPendingCount = ref<number>(0)
const draftPendingCount = ref<number>(0)
const totalViews = ref<number>(0)
const totalLikes = ref<number>(0)
const activePipelineCount = ref<number>(0)
const xhsLoginStatus = ref<string>('未检测')

// ============================================================================
// 内嵌功能执行
// ============================================================================

/** 趋势发现 */
async function executeTrendDiscover(): Promise<void> {
  loading.value = true
  try {
    const res = await trendsApi.discover({ platform: trendPlatform.value as Platform, limit: 10 })
    if (res.success && res.data) {
      ElMessage.success(`发现 ${res.data.length} 条趋势`)
    } else {
      ElMessage.warning(res.error || '未发现趋势')
    }
  } catch (e) {
    ElMessage.error('趋势发现失败: ' + (e as Error).message)
  } finally {
    loading.value = false
  }
}

/** 标签搜索 */
async function executeHashtagSearch(): Promise<void> {
  if (!hashtagKeyword.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  loading.value = true
  try {
    const res = await hashtagsApi.research({ keyword: hashtagKeyword.value, platform: 'douyin' })
    if (res.success && res.data) {
      ElMessage.success(`找到 ${res.data.length} 个相关标签`)
    } else {
      ElMessage.warning(res.error || '未找到标签')
    }
  } catch (e) {
    ElMessage.error('标签搜索失败: ' + (e as Error).message)
  } finally {
    loading.value = false
  }
}

/** 内容生成 */
async function executeContentGenerate(): Promise<void> {
  if (!contentKeyword.value.trim()) {
    ElMessage.warning('请输入关键词')
    return
  }
  loading.value = true
  try {
    const res = await contentsApi.generate({ keywords: [contentKeyword.value] })
    if (res.success && res.data) {
      ElMessage.success(`内容已生成: ${res.data.title}`)
    } else {
      ElMessage.warning(res.error || '生成失败')
    }
  } catch (e) {
    ElMessage.error('内容生成失败: ' + (e as Error).message)
  } finally {
    loading.value = false
  }
}

/** 情报监测 */
async function executeRadarMonitor(): Promise<void> {
  if (!radarKeyword.value.trim()) {
    ElMessage.warning('请输入监测关键词')
    return
  }
  loading.value = true
  try {
    // 调用雷达 API 发起监听请求
    const response = await fetch('/api/radar/listening', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: radarKeyword.value,
        platforms: ['douyin'],
        limit: 10,
      }),
    })
    const res = await response.json()
    if (res.success) {
      ElMessage.success(`已开始监听关键词「${radarKeyword.value}」`)
    } else {
      ElMessage.warning(res.error || '监听启动失败，正在跳转到情报中心...')
    }
  } catch {
    ElMessage.info('正在跳转到情报中心进行详细监测...')
  } finally {
    loading.value = false
    // 跳转到情报中心页面查看详细结果
    if (props.data.navigate) {
      props.data.navigate(`/radar?keyword=${encodeURIComponent(radarKeyword.value)}`)
    }
  }
}

/** 启动闭环 */
async function executePipelineStart(): Promise<void> {
  loading.value = true
  try {
    const res = await pipelineApi.run({})
    if (res.success && res.data) {
      ElMessage.success(`闭环 #${res.data.id} 已启动`)
      activePipelineCount.value++
    } else {
      ElMessage.warning(res.error || '启动失败')
    }
  } catch (e) {
    ElMessage.error('启动闭环失败: ' + (e as Error).message)
  } finally {
    loading.value = false
  }
}

/** 启动小红书流水线 */
async function executeXhsStart(): Promise<void> {
  loading.value = true
  try {
    // 调用小红书流水线启动 API
    const response = await fetch('/api/xhs-pipeline/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'auto' }),
    })
    const res = await response.json()
    if (res.success) {
      ElMessage.success('小红书流水线已启动，正在跳转到详情页...')
    } else {
      ElMessage.warning(res.error || '启动失败，正在跳转到流水线控制台...')
    }
  } catch {
    ElMessage.info('正在跳转到流水线控制台...')
  } finally {
    loading.value = false
    // 跳转到流水线控制台查看运行状态
    if (props.data.navigate) {
      props.data.navigate('/xhs-pipeline?action=start')
    }
  }
}

/** 加载统计数据 */
async function loadStats(): Promise<void> {
  try {
    // 加载发布队列待发布数
    if (featureType.value === 'publish-stats') {
      const res = await publishApi.getList({ page: 1, pageSize: 1, status: 'pending' as any })
      publishPendingCount.value = res.total || 0
    }
    // 加载草稿待审核数
    if (featureType.value === 'draft-stats') {
      // 草稿审核 API 不在共享 api 中，通过通用请求获取
      const res = await publishApi.getList({ page: 1, pageSize: 1 })
      draftPendingCount.value = res.total || 0
    }
    // 加载分析统计
    if (featureType.value === 'analytics-stats') {
      const res = await dashboardApi.getStats()
      if (res.success && res.data) {
        totalViews.value = res.data.totalViews || 0
        totalLikes.value = res.data.totalLikes || 0
      }
    }
    // 加载闭环运行中数量
    if (featureType.value === 'pipeline-start') {
      const res = await pipelineApi.getRuns({ page: 1, pageSize: 1 })
      activePipelineCount.value = res.total || 0
    }
  } catch {
    // 统计加载失败静默处理
  }
}

/** 加载小红书登录状态 */
async function loadXhsLoginStatus(): Promise<void> {
  try {
    const response = await fetch('/api/xhs-login/status')
    const res = await response.json()
    if (res.success && res.data) {
      if (res.data.is_logged_in) {
        xhsLoginStatus.value = '已登录'
      } else {
        xhsLoginStatus.value = '未登录'
      }
    } else {
      xhsLoginStatus.value = '未检测'
    }
  } catch {
    xhsLoginStatus.value = '未检测'
  }
}

// 初始加载统计数据（仅对统计类节点）
if (['publish-stats', 'draft-stats', 'analytics-stats', 'pipeline-start'].includes(featureType.value)) {
  loadStats()
}

// 加载小红书登录状态（仅对 xhs-start 节点）
onMounted(() => {
  if (featureType.value === 'xhs-start') {
    loadXhsLoginStatus()
  }
})

// ============================================================================
// 事件处理
// ============================================================================

/** 点击进入详情按钮 */
function handleNavigate(event: MouseEvent): void {
  event.stopPropagation()
  if (props.data.navigate) {
    props.data.navigate(config.value.route)
  }
}

/** Skill 文件夹打开中状态 */
const skillOpening = ref<string | null>(null)

/** 点击 Skill 徽章 → 打开对应文件夹 */
async function handleSkillClick(event: MouseEvent, skill: ModuleSkill): Promise<void> {
  event.stopPropagation()
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
</script>

<template>
  <div
    class="module-node"
    :style="{
      '--node-bg': colors.bg,
      '--node-border': colors.border,
      '--node-text': colors.text,
    }"
  >
    <!-- 输入端口（左侧） -->
    <Handle type="target" :position="Position.Left" class="node-handle" />

    <!-- 顶部：图标 + 名称 + 状态徽章 + 大模型徽章 -->
    <div class="node-header">
      <!-- 纯 CSS 字母图标（替代 SVG el-icon） -->
      <div class="node-icon-box" :style="{ backgroundColor: colors.bg }">
        <span class="node-icon-letter" :style="{ color: colors.border }">{{ moduleInitial }}</span>
      </div>
      <span class="node-title">{{ config.label }}</span>
      <div class="node-header-badges">
        <el-tooltip
          v-if="llmConfig?.configured"
          :content="`${llmTypeInfo.label}: ${llmConfig.modelName} (${llmConfig.usage})`"
          placement="top"
          :show-after="200"
        >
          <span
            class="node-llm-badge"
            :style="{ color: llmTypeInfo.color, backgroundColor: llmTypeInfo.bg }"
          >
            <span class="node-llm-dot" :style="{ backgroundColor: llmTypeInfo.color }"></span>
            <span>LLM</span>
          </span>
        </el-tooltip>
        <span
          class="node-status-badge"
          :style="{ color: status.color, backgroundColor: status.bg }"
        >
          {{ status.label }}
        </span>
      </div>
    </div>

    <!-- 中部：内嵌功能区域 -->
    <div class="node-body">
      <!-- 趋势发现 -->
      <template v-if="featureType === 'trend-discover'">
        <div class="embedded-feature">
          <el-select v-model="trendPlatform" size="small" style="width: 90px" placeholder="平台">
            <el-option label="抖音" value="douyin" />
            <el-option label="小红书" value="xiaohongshu" />
            <el-option label="TikTok" value="tiktok" />
          </el-select>
          <el-button type="primary" size="small" :loading="loading" @click.stop="executeTrendDiscover">
            发现
          </el-button>
        </div>
      </template>

      <!-- 标签搜索 -->
      <template v-else-if="featureType === 'hashtag-search'">
        <div class="embedded-feature">
          <el-input
            v-model="hashtagKeyword"
            size="small"
            placeholder="搜索标签..."
            style="flex: 1"
            @click.stop
            @keyup.enter="executeHashtagSearch"
          />
          <el-button type="primary" size="small" :loading="loading" @click.stop="executeHashtagSearch">
            搜索
          </el-button>
        </div>
      </template>

      <!-- 内容生成 -->
      <template v-else-if="featureType === 'content-generate'">
        <div class="embedded-feature">
          <el-input
            v-model="contentKeyword"
            size="small"
            placeholder="输入关键词..."
            style="flex: 1"
            @click.stop
            @keyup.enter="executeContentGenerate"
          />
          <el-button type="primary" size="small" :loading="loading" @click.stop="executeContentGenerate">
            AI 生成
          </el-button>
        </div>
      </template>

      <!-- 情报监测 -->
      <template v-else-if="featureType === 'radar-monitor'">
        <div class="embedded-feature">
          <el-input
            v-model="radarKeyword"
            size="small"
            placeholder="输入监测词..."
            style="flex: 1"
            @click.stop
            @keyup.enter="executeRadarMonitor"
          />
          <el-button type="primary" size="small" @click.stop="executeRadarMonitor">
            监测
          </el-button>
        </div>
      </template>

      <!-- 发布队列统计 -->
      <template v-else-if="featureType === 'publish-stats'">
        <div class="embedded-stats">
          <div class="stat-mini">
            <span class="stat-number" :style="{ color: colors.border }">{{ publishPendingCount }}</span>
            <span class="stat-label">待发布</span>
          </div>
        </div>
      </template>

      <!-- 草稿审核统计 -->
      <template v-else-if="featureType === 'draft-stats'">
        <div class="embedded-stats">
          <div class="stat-mini">
            <span class="stat-number" :style="{ color: colors.border }">{{ draftPendingCount }}</span>
            <span class="stat-label">待审核</span>
          </div>
        </div>
      </template>

      <!-- 数据分析统计 -->
      <template v-else-if="featureType === 'analytics-stats'">
        <div class="embedded-stats">
          <div class="stat-mini">
            <span class="stat-number" :style="{ color: colors.border }">{{ totalViews.toLocaleString() }}</span>
            <span class="stat-label">总浏览</span>
          </div>
          <div class="stat-mini">
            <span class="stat-number" :style="{ color: colors.border }">{{ totalLikes.toLocaleString() }}</span>
            <span class="stat-label">总点赞</span>
          </div>
        </div>
      </template>

      <!-- 闭环管理启动 -->
      <template v-else-if="featureType === 'pipeline-start'">
        <div class="embedded-feature">
          <div class="stat-mini">
            <span class="stat-number" :style="{ color: colors.border }">{{ activePipelineCount }}</span>
            <span class="stat-label">运行中</span>
          </div>
          <el-button type="primary" size="small" :loading="loading" @click.stop="executePipelineStart">
            启动闭环
          </el-button>
        </div>
      </template>

      <!-- 小红书流水线启动 -->
      <template v-else-if="featureType === 'xhs-start'">
        <div class="embedded-feature">
          <el-tag size="small" :type="xhsLoginStatus === '已登录' ? 'success' : 'warning'" effect="light">
            {{ xhsLoginStatus }}
          </el-tag>
          <el-button type="primary" size="small" @click.stop="executeXhsStart">
            启动流水线
          </el-button>
        </div>
      </template>
    </div>

    <!-- Skill 徽章区域 -->
    <div v-if="skills.length > 0" class="node-skills">
      <div class="skills-label">
        <span class="skills-label-dot"></span>
        <span>集成技能</span>
      </div>
      <div class="skills-badges">
        <el-tooltip
          v-for="skill in skills"
          :key="skill.name"
          :content="`${skill.label} (${skill.name}) - ${skill.description}`"
          placement="top"
          :show-after="200"
          effect="dark"
        >
          <div
            class="skill-badge"
            :style="{
              color: getSkillTypeConfig(skill.type).color,
              backgroundColor: getSkillTypeConfig(skill.type).bg,
              borderColor: getSkillTypeConfig(skill.type).color,
            }"
            :class="{ 'skill-clickable': skill.path, 'skill-loading': skillOpening === skill.name }"
            @click="handleSkillClick($event, skill)"
          >
            <span
              class="skill-badge-dot"
              :style="{ backgroundColor: getSkillTypeConfig(skill.type).color }"
            ></span>
            <span class="skill-badge-label">{{ skill.label }}</span>
            <span class="skill-badge-name">{{ skill.name }}</span>
            <span v-if="skill.path" class="skill-badge-arrow">»</span>
          </div>
        </el-tooltip>
      </div>
    </div>

    <!-- 内部流程区域（仅当 showInternalFlows 开启时显示） -->
    <div v-if="showInternalFlow" class="node-internal-flow">
      <div class="internal-flow-label">
        <span class="internal-flow-dot"></span>
        <span>内部流程</span>
        <span class="internal-flow-count">{{ internalFlow!.steps.length }}步</span>
      </div>
      <div class="internal-flow-steps">
        <div
          v-for="(step, idx) in internalFlow!.steps"
          :key="step.id"
          class="internal-step"
          :style="{
            borderLeftColor: getStepTypeConfig(step.type).color,
            backgroundColor: getStepTypeConfig(step.type).bg,
          }"
        >
          <div class="internal-step-header">
            <span
              class="internal-step-index"
              :style="{ color: getStepTypeConfig(step.type).color }"
            >{{ idx + 1 }}</span>
            <span class="internal-step-label">{{ step.label }}</span>
            <span
              class="internal-step-type"
              :style="{
                color: getStepTypeConfig(step.type).color,
                backgroundColor: 'var(--color-bg-elevated)',
              }"
            >{{ getStepTypeConfig(step.type).label }}</span>
          </div>
          <p v-if="step.description" class="internal-step-desc">{{ step.description }}</p>
          <!-- 关联的 Skill 标签 -->
          <div v-if="getStepSkills(step.skillRef).length > 0" class="internal-step-skills">
            <span
              v-for="sk in getStepSkills(step.skillRef)"
              :key="sk.name"
              class="step-skill-tag"
              :style="{
                color: getSkillTypeConfig(sk.type).color,
                backgroundColor: getSkillTypeConfig(sk.type).bg,
                borderColor: getSkillTypeConfig(sk.type).color,
              }"
              @click.stop="handleSkillClick($event, sk)"
            >
              <span class="step-skill-dot" :style="{ backgroundColor: getSkillTypeConfig(sk.type).color }"></span>
              {{ sk.label }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部：进入详情按钮 -->
    <div class="node-footer">
      <el-button text size="small" :style="{ color: colors.text }" @click="handleNavigate">
        进入详情 →
      </el-button>
    </div>

    <!-- 输出端口（右侧） -->
    <Handle type="source" :position="Position.Right" class="node-handle" />
  </div>
</template>

<style scoped>
.module-node {
  width: 280px;
  min-height: 200px;
  background: var(--node-bg);
  border: 2px solid var(--node-border);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.1s ease;
  box-shadow: var(--box-shadow-raised-sm);
}

.module-node:hover {
  box-shadow: var(--box-shadow-hover);
  transform: translateY(-2px);
}

/* 头部 */
.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-lighter);
}

.node-icon-box {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* 纯 CSS 字母图标（替代 SVG el-icon） */
.node-icon-letter {
  font-size: 18px;
  font-weight: 700;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  user-select: none;
  line-height: 1;
}

.node-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--node-text);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-header-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.node-llm-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  white-space: nowrap;
}

/* LLM 圆点指示器（替代 SVG 图标） */
.node-llm-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.node-status-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

/* 中部功能区域 */
.node-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 50px;
}

.embedded-feature {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.embedded-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
}

.stat-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-number {
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.stat-label {
  font-size: 11px;
  color: var(--color-text-secondary);
}

/* Skill 徽章区域 */
.node-skills {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-lighter);
}

.skills-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* 技能标签圆点（替代 Cpu SVG 图标） */
.skills-label-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}

.skills-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.skill-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.skill-badge.skill-clickable {
  cursor: pointer;
}

.skill-badge.skill-clickable:hover {
  transform: translateY(-1px);
  box-shadow: var(--box-shadow-raised-sm);
  filter: brightness(0.95);
}

.skill-badge.skill-loading {
  opacity: 0.5;
  pointer-events: none;
}

/* 技能徽章圆点（替代 SVG 图标） */
.skill-badge-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skill-badge-name {
  font-size: 9px;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-badge-label {
  font-size: 10px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 技能徽章箭头（替代 FolderOpened SVG 图标） */
.skill-badge-arrow {
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
  flex-shrink: 0;
  line-height: 1;
}

/* 内部流程区域 */
.node-internal-flow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-lighter);
}

.internal-flow-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.internal-flow-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}

.internal-flow-count {
  font-size: 9px;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-left: auto;
  text-transform: none;
}

.internal-flow-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.internal-step {
  padding: 4px 8px;
  border-left: 3px solid;
  border-radius: 4px;
  transition: transform 0.1s ease;
}

.internal-step:hover {
  transform: translateX(2px);
}

.internal-step-header {
  display: flex;
  align-items: center;
  gap: 4px;
}

.internal-step-index {
  font-size: 10px;
  font-weight: 700;
  width: 14px;
  flex-shrink: 0;
  text-align: center;
}

.internal-step-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-step-type {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.internal-step-desc {
  font-size: 10px;
  color: var(--color-text-regular);
  margin: 2px 0 0 0;
  line-height: 1.3;
}

.internal-step-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 4px;
}

.step-skill-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.step-skill-tag:hover {
  transform: translateY(-1px);
  filter: brightness(0.95);
}

.step-skill-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 底部 */
.node-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--color-border-lighter);
}

/* Handle 端口 */
.node-handle {
  width: 10px;
  height: 10px;
  background: var(--node-border);
  border: 2px solid var(--color-bg-card);
  border-radius: 50%;
}

:deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--color-border-base) inset;
}

:deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--node-border) inset;
}

:global([data-theme='dark']) .module-node {
  background: var(--color-bg-card) !important;
}

:global([data-theme='dark']) .node-title,
:global([data-theme='dark']) .stat-number,
:global([data-theme='dark']) .node-footer {
  color: var(--color-text-primary) !important;
}
</style>
