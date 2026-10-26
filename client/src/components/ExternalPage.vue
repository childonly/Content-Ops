<script setup lang="ts">
/**
 * 外部页面嵌入组件 - 三项目融合第一阶段
 *
 * 通过 iframe 将 xhs-auto-pipeline (3000) 和 social-radar (5182) 的前端
 * 嵌入到 content-ops-hub (5180) 中，实现统一入口。
 *
 * 后续阶段会逐步将 iframe 替换为原生 Vue 组件。
 */
import { ref, watch } from 'vue'
import { Loading, WarningFilled, Refresh } from '@element-plus/icons-vue'

const props = defineProps<{
  src: string
  title?: string
}>()

const loading = ref(true)
const error = ref(false)
const iframeKey = ref(0) // 用于强制刷新 iframe

watch(() => props.src, () => {
  loading.value = true
  error.value = false
})

function onLoad() {
  loading.value = false
}

function onError() {
  loading.value = false
  error.value = true
}

function retry() {
  loading.value = true
  error.value = false
  iframeKey.value++
}
</script>

<template>
  <div class="external-page-container">
    <!-- 加载遮罩 -->
    <transition name="fade">
      <div v-if="loading" class="loading-overlay">
        <el-icon class="loading-icon is-loading"><Loading /></el-icon>
        <span class="loading-text">正在加载 {{ title || '页面' }}...</span>
        <span class="loading-hint">首次加载可能需要几秒钟</span>
      </div>
    </transition>

    <!-- 错误提示 -->
    <div v-if="error" class="error-overlay">
      <el-icon class="error-icon"><WarningFilled /></el-icon>
      <span class="error-text">{{ title || '页面' }} 加载失败</span>
      <span class="error-hint">请确认目标服务已启动（检查端口是否监听）</span>
      <el-button type="primary" :icon="Refresh" @click="retry">重试</el-button>
    </div>

    <!-- iframe 嵌入 -->
    <iframe
      v-show="!error"
      :key="iframeKey"
      :src="props.src"
      class="external-iframe"
      frameborder="0"
      allow="fullscreen"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.external-page-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.external-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-overlay);
  z-index: 10;
}

.loading-icon {
  font-size: 40px;
  color: var(--color-primary);
  margin-bottom: 16px;
}

.loading-text {
  font-size: 16px;
  color: var(--color-text-primary);
  font-weight: 500;
}

.loading-hint {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-top: 8px;
}

.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-overlay);
  z-index: 10;
}

.error-icon {
  font-size: 48px;
  color: var(--color-danger);
  margin-bottom: 16px;
}

.error-text {
  font-size: 16px;
  color: var(--color-text-primary);
  font-weight: 500;
  margin-bottom: 8px;
}

.error-hint {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 24px;
}

.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-leave-to {
  opacity: 0;
}
</style>
