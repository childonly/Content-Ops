<script setup lang="ts">
/**
 * 图片工作室 — AI 生图与图片编辑
 *
 * 功能：
 *   1. 文生图（Text-to-Image）
 *   2. 图片编辑/变体（Image-to-Image）
 *   3. 图文卡片生成（小红书风格）
 *   4. 历史记录管理
 *   5. 支持多种后端引擎切换
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Picture, MagicStick, Download, Delete, CopyDocument, Setting } from '@element-plus/icons-vue'
import { imageStudioApi } from '@/api'
import type { GeneratedImage, ImageEngineInfo } from '@/api'

// ============================================================
// 生成模式
// ============================================================

type GenerationMode = 'text-to-image' | 'card' | 'edit'
const activeMode = ref<GenerationMode>('text-to-image')

const modeOptions = [
  { label: '文生图', value: 'text-to-image' as const, icon: MagicStick, desc: '输入文字描述，AI 生成图片' },
  { label: '图文卡片', value: 'card' as const, icon: Picture, desc: '生成小红书风格图文卡片' },
  { label: '图片编辑', value: 'edit' as const, icon: CopyDocument, desc: '对已有图片进行编辑和变体' },
]

// ============================================================
// 引擎切换
// ============================================================

const engines = ref<ImageEngineInfo[]>([])
const selectedEngine = ref<string>('internal-cogview')
const engineLoading = ref(false)

/** 加载引擎列表 */
async function loadEngines(): Promise<void> {
  engineLoading.value = true
  try {
    const res = await imageStudioApi.getEngines()
    if (res.success && res.data) {
      engines.value = res.data
      // 自动选中最初的默认引擎
      const def = res.data.find((e) => e.isDefault)
      if (def) selectedEngine.value = def.name
    }
  } catch {
    // 静默失败，使用默认值
  } finally {
    engineLoading.value = false
  }
}

/** 切换默认引擎 */
async function handleEngineChange(name: string): Promise<void> {
  try {
    await imageStudioApi.setDefaultEngine(name)
    selectedEngine.value = name
    ElMessage.success(`引擎已切换为: ${engines.value.find((e) => e.name === name)?.label || name}`)
  } catch (e) {
    ElMessage.error('引擎切换失败: ' + (e as Error).message)
  }
}

/** 当前模式下可用的引擎 */
const availableEngines = computed(() => {
  return engines.value.filter((e) => e.modes.includes(activeMode.value))
})

// 模式切换时，如果当前引擎不支持新模式，自动切换到第一个支持的引擎
watch(activeMode, (newMode) => {
  const current = engines.value.find((e) => e.name === selectedEngine.value)
  if (current && !current.modes.includes(newMode)) {
    const first = engines.value.find((e) => e.modes.includes(newMode))
    if (first) {
      selectedEngine.value = first.name
    }
  }
})

// 引擎切换时，如果切到 Auto-Redbook，加载主题列表
watch(selectedEngine, (engine) => {
  if (engine === 'auto-redbook' && autoRedbookThemes.value.length === 0) {
    loadAutoRedbookThemes()
  }
})

// ============================================================
// 文生图参数
// ============================================================

const textPrompt = ref('')
const negativePrompt = ref('')
const imageSize = ref<'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_16_9'>('square')
const imageStyle = ref('auto')
const generating = ref(false)

const sizeOptions = [
  { label: '1:1 方形', value: 'square' as const },
  { label: '3:4 竖版（小红书）', value: 'portrait_4_3' as const },
  { label: '9:16 全屏竖版', value: 'portrait_16_9' as const },
  { label: '16:9 横版', value: 'landscape_16_9' as const },
]

const styleOptions = [
  { label: '自动', value: 'auto' },
  { label: '写实摄影', value: 'photographic' },
  { label: '插画手绘', value: 'illustration' },
  { label: '3D 渲染', value: '3d-render' },
  { label: '扁平设计', value: 'flat-design' },
  { label: '水彩画', value: 'watercolor' },
  { label: '赛博朋克', value: 'cyberpunk' },
  { label: '极简主义', value: 'minimalist' },
]

// ============================================================
// 图文卡片参数
// ============================================================

const cardTitle = ref('')
const cardContent = ref('')
const cardTheme = ref('sketch')
const cardMode = ref('auto-split')
const cardEmoji = ref('✨')
const cardSubtitle = ref('')
const cardRendering = ref(false)
const cardResultImages = ref<string[]>([])
const autoRedbookThemes = ref<{ name: string; label: string; description: string }[]>([])

/** 是否为 Auto-Redbook 引擎 */
const isAutoRedbookEngine = computed(() => selectedEngine.value === 'auto-redbook')

/** 加载 Auto-Redbook 主题列表 */
async function loadAutoRedbookThemes(): Promise<void> {
  try {
    const res = await imageStudioApi.getAutoRedbookThemes()
    if (res.success && res.data) {
      autoRedbookThemes.value = res.data
      if (res.data.length > 0) {
        cardTheme.value = res.data[0].name
      }
    }
  } catch {
    // 静默失败
  }
}

const paginationModeOptions = [
  { label: '自动拆分（推荐）', value: 'auto-split', desc: '根据内容高度自动拆分为多张卡片' },
  { label: '手动分隔', value: 'separator', desc: '按 --- 手动分隔每页内容' },
  { label: '固定缩放', value: 'auto-fit', desc: '固定尺寸，自动整体缩放内容' },
  { label: '动态高度', value: 'dynamic', desc: '根据内容动态调整图片高度' },
]

// 默认主题列表（非 Auto-Redbook 引擎时使用）
const defaultThemeOptions = [
  { label: '简约灰', value: 'minimal-gray' },
  { label: '杂志风', value: 'magazine' },
  { label: '瑞士国际', value: 'swiss' },
  { label: '新粗野主义', value: 'brutalist' },
  { label: 'Bento 网格', value: 'bento' },
  { label: '暗黑霓虹', value: 'dark-neon' },
  { label: '多巴胺', value: 'dopamine' },
  { label: '自然主义', value: 'natural' },
]

/** 当前可用的主题选项 */
const currentThemeOptions = computed(() => {
  if (isAutoRedbookEngine.value && autoRedbookThemes.value.length > 0) {
    return autoRedbookThemes.value.map(t => ({ label: t.label, value: t.name, desc: t.description }))
  }
  return defaultThemeOptions
})

// ============================================================
// 图片编辑参数
// ============================================================

const editPrompt = ref('')
const editReferenceUrl = ref('')

// ============================================================
// 历史记录
// ============================================================

const history = ref<GeneratedImage[]>([])
const historyLoading = ref(false)
const selectedImage = ref<GeneratedImage | null>(null)

// ============================================================
// 生成操作
// ============================================================

/** 执行图片生成 */
async function handleGenerate(): Promise<void> {
  if (activeMode.value === 'text-to-image' && !textPrompt.value.trim()) {
    ElMessage.warning('请输入图片描述')
    return
  }
  if (activeMode.value === 'card' && !cardContent.value.trim()) {
    ElMessage.warning('请输入卡片内容')
    return
  }
  if (activeMode.value === 'edit' && !editPrompt.value.trim()) {
    ElMessage.warning('请输入编辑描述')
    return
  }

  // Auto-Redbook 卡片渲染走专用接口（支持多图返回）
  if (activeMode.value === 'card' && isAutoRedbookEngine.value) {
    await handleAutoRedbookRender()
    return
  }

  generating.value = true
  try {
    const params: Record<string, unknown> = {
      mode: activeMode.value,
      engine: selectedEngine.value,
    }

    if (activeMode.value === 'text-to-image') {
      params.prompt = textPrompt.value
      params.negativePrompt = negativePrompt.value || undefined
      params.size = imageSize.value
      params.style = imageStyle.value
    } else if (activeMode.value === 'card') {
      params.title = cardTitle.value || undefined
      params.content = cardContent.value
      params.theme = cardTheme.value
      params.ratio = '3:4'
    } else if (activeMode.value === 'edit') {
      params.prompt = editPrompt.value
      params.referenceUrl = editReferenceUrl.value || undefined
    }

    const res = await imageStudioApi.generate(params)
    if (res.success && res.data) {
      history.value.unshift(res.data)
      selectedImage.value = res.data
      ElMessage.success('图片生成成功！')
    }
  } catch (e) {
    ElMessage.error('生成失败: ' + (e as Error).message)
  } finally {
    generating.value = false
  }
}

/** Auto-Redbook 卡片渲染（返回多张图片） */
async function handleAutoRedbookRender(): Promise<void> {
  cardRendering.value = true
  cardResultImages.value = []
  try {
    const res = await imageStudioApi.renderAutoRedbookCards({
      title: cardTitle.value || undefined,
      subtitle: cardSubtitle.value || undefined,
      emoji: cardEmoji.value || undefined,
      content: cardContent.value,
      theme: cardTheme.value,
      mode: cardMode.value,
    })
    if (res.success && res.data) {
      cardResultImages.value = res.data.allImages
      ElMessage.success(`卡片渲染成功！共 ${res.data.cardCount} 张图片`)
    }
  } catch (e) {
    ElMessage.error('卡片渲染失败: ' + (e as Error).message)
  } finally {
    cardRendering.value = false
  }
}

/** 在新窗口打开图片 */
function openImageInNewTab(url: string): void {
  window.open(url, '_blank')
}

// ============================================================
// 历史记录管理
// ============================================================

/** 加载历史记录 */
async function loadHistory(): Promise<void> {
  historyLoading.value = true
  try {
    const res = await imageStudioApi.getRecords({ page: 1, pageSize: 50 })
    if (res.data) {
      history.value = res.data
    }
  } catch {
    // 静默失败
  } finally {
    historyLoading.value = false
  }
}

/** 下载图片 */
function handleDownload(image: GeneratedImage): void {
  if (image.url) {
    const link = document.createElement('a')
    link.href = image.url
    link.download = image.title || 'generated-image.png'
    link.click()
  }
}

/** 删除记录 */
async function handleDelete(uid: string): Promise<void> {
  try {
    await imageStudioApi.deleteRecord(uid)
    history.value = history.value.filter((r) => r.uid !== uid)
    if (selectedImage.value?.uid === uid) {
      selectedImage.value = null
    }
    ElMessage.success('已删除')
  } catch {
    ElMessage.error('删除失败')
  }
}

// ============================================================
// 提示词模板
// ============================================================

const promptTemplates = [
  { label: '小红书封面', prompt: '精美的小红书风格封面图，柔和的自然光线，温暖色调，极简设计，留白构图，高级感' },
  { label: '产品展示', prompt: '专业产品摄影，白色背景，柔和的影棚灯光，高清细节，商业级画质' },
  { label: '风景插画', prompt: '唯美的风景插画，柔和色彩，治愈风格，宫崎骏风格，蓝天白云绿草地' },
  { label: '科技配图', prompt: '未来科技感配图，深色背景，霓虹蓝光效，数据流线条，赛博朋克风格' },
]

function useTemplate(template: (typeof promptTemplates)[number]): void {
  textPrompt.value = template.prompt
  activeMode.value = 'text-to-image'
}

// ============================================================
// 生命周期
// ============================================================

onMounted(() => {
  loadEngines()
  loadHistory()
})

// 轮询更新正在生成中的记录
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(() => {
    const hasGenerating = history.value.some((r) => r.status === 'generating')
    if (hasGenerating) {
      loadHistory()
    }
  }, 5000)
})

onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer)
})
</script>

<template>
  <div class="image-studio">
    <!-- 左侧：生成面板 -->
    <div class="studio-panel">
      <!-- 模式切换 -->
      <div class="mode-selector">
        <el-radio-group v-model="activeMode" size="default">
          <el-radio-button
            v-for="mode in modeOptions"
            :key="mode.value"
            :value="mode.value"
          >
            <el-icon><component :is="mode.icon" /></el-icon>
            {{ mode.label }}
          </el-radio-button>
        </el-radio-group>
        <p class="mode-desc">{{ modeOptions.find(m => m.value === activeMode)?.desc }}</p>
      </div>

      <!-- 引擎切换 -->
      <div class="engine-selector" v-loading="engineLoading">
        <div class="engine-header">
          <el-icon><Setting /></el-icon>
          <label class="param-label">生成引擎</label>
        </div>
        <el-select
          v-model="selectedEngine"
          placeholder="选择生成引擎"
          style="width: 100%"
          @change="handleEngineChange"
        >
          <el-option
            v-for="eng in availableEngines"
            :key="eng.name"
            :label="`${eng.label}${eng.available ? '' : ' (未配置)'}`"
            :value="eng.name"
          >
            <div class="engine-option">
              <span>{{ eng.label }}</span>
              <el-tag v-if="eng.isDefault" size="small" type="success">默认</el-tag>
              <el-tag v-if="!eng.available" size="small" type="info">未配置</el-tag>
            </div>
          </el-option>
        </el-select>
        <p class="engine-desc">{{ engines.find(e => e.name === selectedEngine)?.description || '' }}</p>
      </div>

      <!-- 文生图参数 -->
      <div v-if="activeMode === 'text-to-image'" class="params-section">
        <div class="param-group">
          <label class="param-label">图片描述</label>
          <el-input
            v-model="textPrompt"
            type="textarea"
            :rows="4"
            placeholder="描述你想要生成的图片，越详细越好..."
            maxlength="1000"
            show-word-limit
          />
        </div>
        <div class="param-group">
          <label class="param-label">反向提示词（不希望出现的内容）</label>
          <el-input
            v-model="negativePrompt"
            type="textarea"
            :rows="2"
            placeholder="例如：模糊、低质量、水印、变形"
            maxlength="500"
          />
        </div>
        <div class="param-row">
          <div class="param-group">
            <label class="param-label">尺寸</label>
            <el-select v-model="imageSize" style="width: 100%">
              <el-option
                v-for="opt in sizeOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
          <div class="param-group">
            <label class="param-label">风格</label>
            <el-select v-model="imageStyle" style="width: 100%">
              <el-option
                v-for="opt in styleOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
        </div>

        <!-- 提示词模板 -->
        <div class="param-group">
          <label class="param-label">快速模板</label>
          <div class="template-chips">
            <el-tag
              v-for="tpl in promptTemplates"
              :key="tpl.label"
              class="template-chip"
              type="info"
              @click="useTemplate(tpl)"
            >
              {{ tpl.label }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 图文卡片参数 -->
      <div v-if="activeMode === 'card'" class="params-section">
        <!-- Auto-Redbook 专属参数 -->
        <div v-if="isAutoRedbookEngine" class="param-row">
          <div class="param-group">
            <label class="param-label">封面 Emoji</label>
            <el-input v-model="cardEmoji" placeholder="✨" maxlength="4" style="width: 100%" />
          </div>
          <div class="param-group">
            <label class="param-label">封面副标题</label>
            <el-input v-model="cardSubtitle" placeholder="一句话副标题（≤15字）" maxlength="20" />
          </div>
        </div>
        <div class="param-group">
          <label class="param-label">卡片标题（可选）</label>
          <el-input v-model="cardTitle" placeholder="输入卡片标题" maxlength="50" />
        </div>
        <div class="param-group">
          <label class="param-label">卡片内容</label>
          <el-input
            v-model="cardContent"
            type="textarea"
            :rows="6"
            :placeholder="isAutoRedbookEngine ? '支持 Markdown 格式，# 标题、列表、加粗等...' : '输入卡片正文内容...'"
            maxlength="2000"
            show-word-limit
          />
        </div>
        <div class="param-row">
          <div class="param-group">
            <label class="param-label">主题风格</label>
            <el-select v-model="cardTheme" style="width: 100%">
              <el-option
                v-for="opt in currentThemeOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
          <div class="param-group" v-if="isAutoRedbookEngine">
            <label class="param-label">分页模式</label>
            <el-select v-model="cardMode" style="width: 100%">
              <el-option
                v-for="opt in paginationModeOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
          <div class="param-group" v-else>
            <label class="param-label">比例</label>
            <el-select v-model="'3:4'" style="width: 100%" disabled>
              <el-option label="3:4 竖版" value="3:4" />
            </el-select>
          </div>
        </div>
        <!-- Auto-Redbook 渲染结果（多图） -->
        <div v-if="isAutoRedbookEngine && cardResultImages.length > 0" class="card-result-section">
          <div class="param-label">渲染结果（{{ cardResultImages.length }} 张）</div>
          <div class="card-result-grid">
            <div
              v-for="(img, idx) in cardResultImages"
              :key="idx"
              class="card-result-item"
              @click="openImageInNewTab(img)"
            >
              <img :src="img" :alt="`卡片${idx + 1}`" />
              <span class="card-result-index">第 {{ idx + 1 }} 张</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 图片编辑参数 -->
      <div v-if="activeMode === 'edit'" class="params-section">
        <div class="param-group">
          <label class="param-label">参考图片 URL（可选）</label>
          <el-input v-model="editReferenceUrl" placeholder="输入参考图片的 URL 地址" />
        </div>
        <div class="param-group">
          <label class="param-label">编辑描述</label>
          <el-input
            v-model="editPrompt"
            type="textarea"
            :rows="4"
            placeholder="描述你想要的编辑效果，例如：将背景替换为海滩、添加文字标题..."
            maxlength="500"
          />
        </div>
      </div>

      <!-- 生成按钮 -->
      <div class="action-bar">
        <el-button
          type="primary"
          size="large"
          :loading="generating || cardRendering"
          :icon="MagicStick"
          @click="handleGenerate"
          class="generate-btn"
        >
          {{ generating || cardRendering ? '生成中...' : '开始生成' }}
        </el-button>
      </div>
    </div>

    <!-- 右侧：预览与历史 -->
    <div class="studio-preview">
      <!-- 当前预览 -->
      <div class="preview-area" v-if="selectedImage">
        <div class="preview-image-wrapper">
          <img
            v-if="selectedImage.url"
            :src="selectedImage.url"
            :alt="selectedImage.prompt"
            class="preview-image"
          />
          <div v-else class="preview-placeholder">
            <el-icon :size="48"><Picture /></el-icon>
            <p>图片加载中...</p>
          </div>
        </div>
        <div class="preview-info">
          <p class="preview-prompt">{{ selectedImage.prompt }}</p>
          <div class="preview-actions">
            <el-button
              size="small"
              :icon="Download"
              @click="handleDownload(selectedImage)"
              :disabled="!selectedImage.url"
            >
              下载
            </el-button>
            <el-button
              size="small"
              :icon="Delete"
              type="danger"
              plain
              @click="handleDelete(selectedImage.uid)"
            >
              删除
            </el-button>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="preview-empty">
        <el-icon :size="64"><Picture /></el-icon>
        <p>在左侧输入描述，点击生成按钮</p>
        <p class="sub-text">生成的图片将显示在此区域</p>
      </div>

      <!-- 历史记录 -->
      <div class="history-section">
        <div class="history-header">
          <h3>历史记录</h3>
          <el-button
            size="small"
            :icon="Refresh"
            @click="loadHistory"
            :loading="historyLoading"
            text
          >
            刷新
          </el-button>
        </div>
        <div class="history-grid" v-loading="historyLoading">
          <div
            v-for="item in history"
            :key="item.uid"
            class="history-item"
            :class="{ active: selectedImage?.uid === item.uid }"
            @click="selectedImage = item"
          >
            <img
              v-if="item.thumbnailUrl || item.url"
              :src="item.thumbnailUrl || item.url"
              class="history-thumb"
              loading="lazy"
            />
            <div v-else class="history-thumb-placeholder">
              <el-icon><Picture /></el-icon>
            </div>
            <div class="history-item-info">
              <span class="history-mode">{{ item.mode === 'card' ? '卡片' : item.mode === 'edit' ? '编辑' : '生图' }}</span>
              <span v-if="item.status === 'generating'" class="history-status generating">生成中</span>
            </div>
          </div>
          <div v-if="history.length === 0 && !historyLoading" class="history-empty">
            <p>暂无历史记录</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-studio {
  display: flex;
  height: 100%;
  gap: 0;
  background: var(--color-bg-page);
}

/* === 左侧面板 === */
.studio-panel {
  width: 420px;
  min-width: 420px;
  padding: 24px;
  border-right: 1px solid var(--color-border-lighter);
  overflow-y: auto;
  background: var(--color-bg-card);
}

.mode-selector {
  margin-bottom: 24px;
}

.mode-desc {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.engine-selector {
  margin-bottom: 20px;
  padding: 12px 14px;
  background: var(--color-bg-page);
  border-radius: 8px;
  border: 1px solid var(--color-border-lighter);
}

.engine-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.engine-header .param-label {
  margin: 0;
}

.engine-desc {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.engine-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.engine-option span {
  flex: 1;
}

.params-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.param-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.param-row {
  display: flex;
  gap: 12px;
}

.param-row .param-group {
  flex: 1;
}

.template-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.template-chip {
  cursor: pointer;
  transition: all 0.2s ease;
}

.template-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.action-bar {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-lighter);
}

.generate-btn {
  width: 100%;
  height: 44px;
  font-size: 15px;
  font-weight: 600;
}

/* === 右侧预览 === */
.studio-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 24px;
}

.preview-area {
  background: var(--color-bg-card);
  border-radius: var(--border-radius-base);
  padding: 20px;
  margin-bottom: 24px;
  border: 1px solid var(--color-border-lighter);
}

.preview-image-wrapper {
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-bg-page);
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.preview-image {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
}

.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px;
  color: var(--color-text-placeholder);
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  color: var(--color-text-placeholder);
  background: var(--color-bg-card);
  border-radius: var(--border-radius-base);
  border: 1px dashed var(--color-border-light);
  margin-bottom: 24px;
}

.preview-empty .sub-text {
  font-size: 13px;
  margin-top: 4px;
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-prompt {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.preview-actions {
  display: flex;
  gap: 8px;
}

/* === 历史记录 === */
.history-section {
  flex: 1;
  min-height: 0;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.history-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.history-item {
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--color-bg-card);
}

.history-item:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: var(--box-shadow-raised-sm);
}

.history-item.active {
  border-color: var(--color-primary);
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

.history-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}

.history-thumb-placeholder {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-page);
  color: var(--color-text-placeholder);
}

.history-item-info {
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.history-mode {
  color: var(--color-text-secondary);
}

.history-status.generating {
  color: var(--color-warning);
  font-weight: 600;
}

.history-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px;
  color: var(--color-text-placeholder);
}
/* === Auto-Redbook 卡片结果 === */
.card-result-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-lighter);
}

.card-result-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 10px;
}

.card-result-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--color-border-lighter);
  transition: transform 0.2s, box-shadow 0.2s;
}

.card-result-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-result-item img {
  width: 100%;
  height: auto;
  display: block;
}

.card-result-index {
  position: absolute;
  bottom: 6px;
  left: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}
</style>
