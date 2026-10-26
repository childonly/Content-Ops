<script setup lang="ts">
/**
 * Dashboard — 仪表盘总览（流程图首页）
 *
 * 架构升级：
 *   - 顶部：4 张统计卡片（快速概览核心数据）
 *   - 中部：引擎切换面板（图片引擎 + 发布引擎并行共存）
 *   - 主体：FlowHome 流程图首页（DAG 展示模块关系 + 内嵌功能）
 */

import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Setting } from '@element-plus/icons-vue'
import StatCard from '@/components/StatCard.vue'
import FlowHome from '@/components/flow/FlowHome.vue'
import { dashboardApi, imageStudioApi, publishEngineApi, adminLLMApi } from '@/api'
import type { DashboardStats } from '@/types'
import type { ImageEngineInfo, PublishEngineInfo } from '@/api'

// ============================================================================
// 加载状态
// ============================================================================

const loading = ref<boolean>(false)
const router = useRouter()

// ============================================================================
// 仪表盘统计数据
// ============================================================================

const stats = ref<DashboardStats>({
  totalTrends: 0,
  totalContents: 0,
  totalPublications: 0,
  totalViews: 0,
  totalLikes: 0,
  avgEngagementRate: 0,
  activePipelines: 0,
  completedPipelines: 0
})

// ============================================================================
// 引擎切换面板
// ============================================================================

const imageEngines = ref<ImageEngineInfo[]>([])
const publishEngines = ref<PublishEngineInfo[]>([])
const selectedImageEngine = ref<string>('internal-cogview')
const selectedPublishEngine = ref<string>('xhs-skill')
const enginePanelCollapsed = ref<boolean>(true)
const llmConfigs = ref<Array<{ provider: string; label?: string; model?: string; enabled?: number; has_key?: number }>>([])
const selectedLlmProvider = ref('auto')

const engineConfigHints: Record<string, string> = {
  redink: '设置 REDINK_API_URL，并启动 RedInk 服务',
  'guizang-card': '安装技能后设置 GUIZANG_CARD_SKILL_PATH',
  'auto-redbook': '安装技能后设置 AUTO_REDBOOK_SKILL_PATH',
  'baoyu-skills': '安装技能后设置 BAOYU_SKILL_PATH',
  'xhs-ops-skill': '安装技能后设置 XHS_OPS_SKILL_PATH，并完成小红书扫码登录',
  'xhs-skill': '在系统配置中检查 Python、技能路径和小红书登录状态',
}

/** 加载引擎列表 */
async function loadEngines(): Promise<void> {
  try {
    const [imgRes, pubRes, llmRes, llmDefaultRes] = await Promise.all([
      imageStudioApi.getEngines(),
      publishEngineApi.getEngines(),
      adminLLMApi.getList(),
      adminLLMApi.getDefault(),
    ])
    if (imgRes.success && imgRes.data) {
      imageEngines.value = imgRes.data
      const imgDef = imgRes.data.find((e) => e.isDefault)
      if (imgDef) selectedImageEngine.value = imgDef.name
    }
    llmConfigs.value = (llmRes.data || []).filter(item => item.enabled !== 0)
    selectedLlmProvider.value = llmDefaultRes.data?.provider || 'auto'
    if (pubRes.success && pubRes.data) {
      publishEngines.value = pubRes.data
      const pubDef = pubRes.data.find((e) => e.isDefault)
      if (pubDef) selectedPublishEngine.value = pubDef.name
    }
  } catch {
    // 静默失败
  }
}

/** 切换图片引擎 */
async function handleImageEngineChange(name: string): Promise<void> {
  const engine = imageEngines.value.find(item => item.name === name)
  if (!engine?.available) { ElMessage.warning(engineConfigHints[name] || '请先完成此引擎配置'); return }
  try {
    await imageStudioApi.setDefaultEngine(name)
    selectedImageEngine.value = name
    ElMessage.success(`图片引擎已切换为: ${imageEngines.value.find((e) => e.name === name)?.label || name}`)
  } catch (e) {
    ElMessage.error('引擎切换失败: ' + (e as Error).message)
  }
}

/** 切换发布引擎 */
async function handlePublishEngineChange(name: string): Promise<void> {
  const engine = publishEngines.value.find(item => item.name === name)
  if (!engine?.available) { ElMessage.warning(engineConfigHints[name] || '请先完成此引擎配置'); return }
  try {
    await publishEngineApi.setDefaultEngine(name)
    selectedPublishEngine.value = name
    ElMessage.success(`发布引擎已切换为: ${publishEngines.value.find((e) => e.name === name)?.label || name}`)
  } catch (e) {
    ElMessage.error('引擎切换失败: ' + (e as Error).message)
  }
}

async function handleLlmChange(provider: string): Promise<void> {
  try {
    await adminLLMApi.setDefault(provider)
    selectedLlmProvider.value = provider
    ElMessage.success(`默认 LLM 已切换为 ${provider === 'auto' ? '自动容错链' : provider}`)
  } catch (error) { ElMessage.error('LLM 切换失败: ' + (error as Error).message) }
}

function openEngineConfig(): void { router.push({ path: '/admin', query: { group: 'system', tab: 'api-keys' } }) }

// ============================================================================
// 数据加载
// ============================================================================

/** 加载仪表盘统计数据 */
async function loadData(): Promise<void> {
  loading.value = true
  try {
    const statsRes = await dashboardApi.getStats()
    stats.value = statsRes.data!
  } catch (error) {
    console.error('加载仪表盘数据失败:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
  loadEngines()
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- 统计卡片（快速概览） -->
    <div class="stat-card-row">
      <StatCard title="总趋势数" :value="stats.totalTrends" icon="TrendCharts" color="#4c8dff" />
      <StatCard title="总内容数" :value="stats.totalContents" icon="EditPen" color="#4c8dff" />
      <StatCard title="成功发布数" :value="stats.totalPublications" icon="Promotion" color="#4c8dff" />
      <StatCard title="总浏览量" :value="stats.totalViews" icon="View" color="#4c8dff" />
    </div>

    <!-- 引擎切换面板（可折叠） -->
    <div class="engine-panel" :class="{ collapsed: enginePanelCollapsed }">
      <div class="engine-panel-header" @click="enginePanelCollapsed = !enginePanelCollapsed">
        <el-icon><Setting /></el-icon>
        <span>引擎切换中心</span>
        <el-tag v-if="!enginePanelCollapsed" size="small" type="info">
          图片: {{ imageEngines.find(e => e.name === selectedImageEngine)?.label || '默认' }}
        </el-tag>
        <el-tag v-if="!enginePanelCollapsed" size="small" type="info">
          发布: {{ publishEngines.find(e => e.name === selectedPublishEngine)?.label || '默认' }}
        </el-tag>
        <el-tag v-if="!enginePanelCollapsed" size="small" type="info">LLM: {{ selectedLlmProvider }}</el-tag>
        <span class="toggle-icon">{{ enginePanelCollapsed ? '展开' : '收起' }}</span>
      </div>
      <div v-show="!enginePanelCollapsed" class="engine-panel-body">
        <div class="engine-group">
          <h4>图片生成引擎</h4>
          <div class="engine-list">
            <div
              v-for="eng in imageEngines"
              :key="eng.name"
              class="engine-item"
              :class="{ active: eng.name === selectedImageEngine }"
              @click="handleImageEngineChange(eng.name)"
            >
              <div class="engine-item-header">
                <span class="engine-name">{{ eng.label }}</span>
                <el-tag v-if="eng.isDefault" size="small" type="success">默认</el-tag>
                <el-tag v-if="!eng.available" size="small" type="info">未配置</el-tag>
                <el-tag v-if="eng.available" size="small" type="primary">可用</el-tag>
              </div>
              <p class="engine-desc">{{ eng.description }}</p>
              <p v-if="!eng.available" class="engine-config-hint">{{ engineConfigHints[eng.name] }}</p>
            </div>
          </div>
        </div>
        <div class="engine-group">
          <h4>发布引擎</h4>
          <div class="engine-list">
            <div
              v-for="eng in publishEngines"
              :key="eng.name"
              class="engine-item"
              :class="{ active: eng.name === selectedPublishEngine }"
              @click="handlePublishEngineChange(eng.name)"
            >
              <div class="engine-item-header">
                <span class="engine-name">{{ eng.label }}</span>
                <el-tag v-if="eng.isDefault" size="small" type="success">默认</el-tag>
                <el-tag v-if="!eng.available" size="small" type="info">未配置</el-tag>
                <el-tag v-if="eng.available" size="small" type="primary">可用</el-tag>
              </div>
              <p class="engine-desc">{{ eng.description }}</p>
              <div class="engine-features">
                <el-tag v-for="feat in eng.features" :key="feat" size="small" type="info" effect="plain">
                  {{ feat }}
                </el-tag>
              </div>
              <p v-if="!eng.available" class="engine-config-hint">{{ engineConfigHints[eng.name] }}</p>
            </div>
          </div>
        </div>
        <div class="engine-group llm-engine-group">
          <div class="engine-group-title"><h4>LLM 快速切换</h4><el-button text type="primary" size="small" @click="openEngineConfig">配置密钥与路径</el-button></div>
          <el-radio-group :model-value="selectedLlmProvider" size="small" @change="handleLlmChange(String($event))">
            <el-radio-button label="auto">自动容错链</el-radio-button>
            <el-radio-button v-for="llm in llmConfigs" :key="llm.provider" :label="llm.provider">{{ llm.label || llm.provider }} · {{ llm.model }}</el-radio-button>
          </el-radio-group>
          <p class="llm-recommendation">推荐：免费优先使用智谱 GLM Flash；低成本云端使用 DeepSeek Flash；离线兜底使用 Ollama Qwen3。</p>
        </div>
      </div>
    </div>

    <!-- 流程图首页（DAG 模块关系图 + 内嵌功能） -->
    <FlowHome class="flow-home-container" />
  </div>
</template>

<style scoped>
.flow-home-container {
  height: calc(100vh - 280px);
  min-height: 520px;
}

/* === 引擎切换面板 === */
.engine-panel {
  margin-bottom: 16px;
  background: var(--color-bg-card, #fff);
  border-radius: 8px;
  border: 1px solid var(--color-border-lighter, #e4e7ed);
  overflow: hidden;
  transition: all 0.3s ease;
}

.engine-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  background: var(--color-bg-page, #f5f7fa);
  transition: background 0.2s ease;
}

.engine-panel-header:hover {
  background: var(--color-bg-hover, #ecf0f5);
}

.engine-panel-header span {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary, #303133);
}

.toggle-icon {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-text-secondary, #909399);
  font-weight: 400;
}

.engine-panel-body {
  padding: 16px;
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.engine-group {
  flex: 1;
  min-width: 300px;
}

.engine-group h4 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary, #909399);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.engine-group-title { display:flex;align-items:center;justify-content:space-between;gap:12px; }
.engine-config-hint,.llm-recommendation { margin:6px 0 0;color:var(--color-warning);font-size:11px;line-height:1.5; }.llm-recommendation{color:var(--color-text-secondary)}

.engine-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.engine-item {
  padding: 10px 14px;
  border-radius: 6px;
  border: 2px solid transparent;
  background: var(--color-bg-page, #f5f7fa);
  cursor: pointer;
  transition: all 0.2s ease;
}

.engine-item:hover {
  border-color: var(--color-primary, #409eff);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.engine-item.active {
  border-color: var(--color-primary, #409eff);
  background: var(--color-primary-soft);
}

.engine-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.engine-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, #303133);
}

.engine-desc {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary, #909399);
  line-height: 1.4;
}

.engine-features {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
</style>
