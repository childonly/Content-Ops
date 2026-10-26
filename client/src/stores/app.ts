import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dashboardApi } from '@/api'
import type { DashboardStats, PipelineStageInfo } from '@/types'

export type ThemeMode = 'light' | 'dark'

/** 主题在 localStorage 中的键名 */
const THEME_STORAGE_KEY = 'content-ops-hub-theme'

/**
 * 应用主题到 documentElement
 * 通过 data-theme 属性切换 CSS 变量集
 */
function applyThemeToDom(theme: ThemeMode): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
}

/**
 * 从 localStorage 读取主题，默认跟随系统偏好
 */
function loadInitialTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
  if (saved === 'light' || saved === 'dark') {
    return saved
  }
  // 首次访问：跟随系统偏好（ prefers-color-scheme ）
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export const useAppStore = defineStore('app', () => {
  /** 侧边栏折叠状态 */
  const sidebarCollapsed = ref<boolean>(false)

  /** 仪表盘统计数据 */
  const dashboardStats = ref<DashboardStats | null>(null)

  /** Pipeline 阶段定义 */
  const pipelineStages = ref<PipelineStageInfo[]>([])

  /** 全局加载状态 */
  const loading = ref<boolean>(false)

  /** 当前主题 */
  const theme = ref<ThemeMode>(loadInitialTheme())

  /** 是否深色主题 */
  const isDark = computed(() => theme.value === 'dark')

  /** 切换侧边栏折叠 */
  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /** 设置侧边栏折叠状态 */
  function setSidebarCollapsed(value: boolean): void {
    sidebarCollapsed.value = value
  }

  /** 切换主题 */
  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  /** 设置主题（持久化 + 应用到 DOM） */
  function setTheme(value: ThemeMode): void {
    theme.value = value
    localStorage.setItem(THEME_STORAGE_KEY, value)
    applyThemeToDom(value)
  }

  /** 初始化主题（在应用启动时调用） */
  function initTheme(): void {
    applyThemeToDom(theme.value)
  }

  /** 获取仪表盘统计数据 */
  async function fetchDashboardStats(): Promise<void> {
    try {
      loading.value = true
      const res = await dashboardApi.getStats()
      if (res.success && res.data) {
        dashboardStats.value = res.data
      } else {
        dashboardStats.value = null
      }
    } catch (error) {
      console.error('获取仪表盘统计失败:', error)
      dashboardStats.value = null
    } finally {
      loading.value = false
    }
  }

  /** 获取 Pipeline 阶段定义 */
  async function fetchPipelineStages(): Promise<void> {
    try {
      const res = await dashboardApi.getPipelineStages()
      if (res.success && res.data) {
        pipelineStages.value = res.data
      } else {
        pipelineStages.value = []
      }
    } catch (error) {
      console.error('获取 Pipeline 阶段定义失败:', error)
      pipelineStages.value = []
    }
  }

  return {
    sidebarCollapsed,
    dashboardStats,
    pipelineStages,
    loading,
    theme,
    isDark,
    toggleSidebar,
    setSidebarCollapsed,
    toggleTheme,
    setTheme,
    initTheme,
    fetchDashboardStats,
    fetchPipelineStages
  }
})
