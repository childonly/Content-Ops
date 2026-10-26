<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { serviceStatusApi } from '@/api'
import ModuleStatusIndicator from '@/components/ModuleStatusIndicator.vue'
import {
  Odometer,
  TrendCharts,
  PriceTag,
  EditPen,
  DataAnalysis,
  Connection,
  Fold,
  Expand,
  Search,
  Setting,
  Sunny,
  Moon,
  VideoCamera,
  Picture,
  Collection,
  Promotion
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()

// ============================================================
// 服务状态监控（端口管理器 + 各微服务在线状态）
// ============================================================
type ServiceStatusData = Awaited<ReturnType<typeof serviceStatusApi.getStatus>>['data']

const serviceStatus = ref<ServiceStatusData | null>(null)
const serviceLoading = ref<boolean>(false)
const startingAll = ref<boolean>(false)

let statusTimer: ReturnType<typeof setInterval> | null = null

/** 在线服务数 */
const onlineCount = computed<number>(() => serviceStatus.value?.summary?.online ?? 0)
/** 服务总数 */
const totalCount = computed<number>(() => serviceStatus.value?.summary?.total ?? 0)
/** 状态点样式类（按在线比例着色：全在线绿 / 部分离线黄 / 全离线红） */
const statusDotClass = computed<string>(() => {
  if (!serviceStatus.value) return 'unknown'
  const { online, total } = serviceStatus.value.summary
  if (total === 0) return 'unknown'
  if (online === total) return 'all-online'
  if (online === 0) return 'all-offline'
  return 'some-offline'
})

/** 加载服务状态 */
async function loadServiceStatus(): Promise<void> {
  serviceLoading.value = true
  try {
    const res = await serviceStatusApi.getStatus()
    serviceStatus.value = res.data ?? null
  } catch (error) {
    console.error('加载服务状态失败:', error)
  } finally {
    serviceLoading.value = false
  }
}

/** 一键启动全部服务 */
async function handleStartAll(): Promise<void> {
  startingAll.value = true
  try {
    await serviceStatusApi.startAll()
    ElMessage.success('已发起全部服务启动指令')
    await loadServiceStatus()
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`启动全部服务失败: ${errMsg}`)
  } finally {
    startingAll.value = false
  }
}

onMounted(() => {
  loadServiceStatus()
  // 每 30 秒轮询一次服务状态
  statusTimer = setInterval(loadServiceStatus, 30_000)
})

onUnmounted(() => {
  if (statusTimer !== null) {
    clearInterval(statusTimer)
    statusTimer = null
  }
})

/** 菜单分组配置 - 按实际使用顺序组织，旧路由保持不变 */
const menuGroups = [
  {
    title: '总览',
    items: [
      { index: '/workspace', title: '工作台', icon: Connection },
      { index: '/dashboard', title: '仪表盘总览', icon: Odometer },
    ]
  },
  {
    title: '内容生产',
    items: [
      { index: '/radar', title: '情报中心', icon: Search },
      { index: '/trends', title: '趋势发现', icon: TrendCharts },
      { index: '/hashtags', title: '标签研究', icon: PriceTag },
    ]
  },
  {
    title: '自动化',
    items: [
      { index: '/content?tab=pipeline', title: '流水线与编排', icon: Connection },
      { index: '/pipeline', title: '运行监控', icon: Collection },
    ]
  },
  {
    title: '数据洞察',
    items: [
      { index: '/analytics', title: '数据分析', icon: DataAnalysis },
    ]
  },
  {
    title: '系统设置',
    items: [
      { index: '/admin?group=business', title: '模型与模块', icon: Setting },
      { index: '/admin?group=system', title: '账号与系统', icon: Setting },
    ]
  },
]

/** 内容工作室子菜单项 */
const contentStudioSubItems = [
  { index: '/content?tab=creation', title: '内容创作', icon: EditPen },
  { index: '/content?tab=video', title: '视频工作室', icon: VideoCamera },
  { index: '/content?tab=image', title: '图片工作室', icon: Picture },
  { index: '/content?tab=manage', title: '内容管理', icon: Collection },
  { index: '/content?tab=publish', title: '发布列表', icon: Promotion },
]

/** 当前激活菜单 */
const activeMenu = computed(() => {
  if (route.path === '/content') {
    const tab = (route.query.tab as string) || 'creation'
    return `/content?tab=${tab}`
  }
  if (route.path === '/admin') {
    const group = (route.query.group as string) || 'business'
    return `/admin?group=${group}`
  }
  return route.path
})

/** 内容工作室子菜单是否展开 */
const contentStudioExpanded = ref(false)

/** 判断内容工作室是否处于激活状态（用于高亮父菜单） */
const isContentStudioActive = computed(() => route.path === '/content')

/** 当前页面标题 */
const currentTitle = computed(() => (route.meta.title as string) || 'Content Ops Hub')

/** 根据当前路由计算对应的模块 ID（用于状态指示器） */
const currentModuleId = computed<string | null>(() => {
  const path = route.path
  // 内容工作室根据 tab 参数映射到不同子模块
  if (path === '/content') {
    const tab = (route.query.tab as string) || 'creation'
    const tabToModule: Record<string, string> = {
      creation: 'content',
      video: 'video-studio',
      image: 'content',
      pipeline: 'xhs-pipeline',
      manage: 'content',
      publish: 'publish',
    }
    return tabToModule[tab] || 'content'
  }
  // 其他路由直接映射
  const pathToModule: Record<string, string> = {
    '/radar': 'radar',
    '/trends': 'trends',
    '/hashtags': 'hashtags',
    '/analytics': 'analytics',
    '/pipeline': 'pipeline',
  }
  return pathToModule[path] || null
})

/** 侧边栏折叠状态 */
const isCollapsed = computed(() => appStore.sidebarCollapsed)

/** 当前是否为深色主题 */
const isDark = computed(() => appStore.isDark)

/** 处理菜单选择 */
function handleSelect(index: string): void {
  // 内容工作室子菜单项带有 query 参数
  if (index.startsWith('/content?')) {
    const url = new URL(index, window.location.origin)
    const tab = url.searchParams.get('tab') || 'creation'
    router.push({ path: '/content', query: { tab } })
  } else if (index.startsWith('/admin?')) {
    const url = new URL(index, window.location.origin)
    const group = url.searchParams.get('group') || 'business'
    router.push({ path: '/admin', query: { group } })
  } else {
    router.push(index)
  }
}

/** 处理内容工作室父菜单点击 - 展开并导航到默认页 */
function handleContentStudioClick(): void {
  contentStudioExpanded.value = !contentStudioExpanded.value
  if (route.path !== '/content') {
    router.push({ path: '/content', query: { tab: 'creation' } })
  }
}

/** 切换主题 */
function handleToggleTheme(): void {
  appStore.toggleTheme()
}
</script>

<template>
  <el-container class="layout-container">
    <!-- 左侧侧边栏 -->
    <el-aside :width="isCollapsed ? '64px' : '220px'" class="layout-aside">
      <div class="sidebar-logo">
        <el-icon class="logo-icon"><Connection /></el-icon>
        <span v-show="!isCollapsed" class="logo-text">Content Ops Hub</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapsed"
        :collapse-transition="false"
        @select="handleSelect"
      >
        <template v-for="group in menuGroups" :key="group.title">
          <el-menu-item-group :title="isCollapsed ? '' : group.title">
            <el-menu-item v-for="item in group.items" :key="item.index" :index="item.index">
              <el-icon><component :is="item.icon" /></el-icon>
              <template #title>{{ item.title }}</template>
            </el-menu-item>
          </el-menu-item-group>
        </template>

        <!-- 内容工作室（生产工具子菜单） -->
        <el-menu-item-group :title="isCollapsed ? '' : '内容工作室'">
          <el-sub-menu
            index="content-studio-sub"
            :class="{ 'is-content-active': isContentStudioActive }"
          >
            <template #title>
              <el-icon><EditPen /></el-icon>
              <span @click.stop="handleContentStudioClick">内容工作室</span>
            </template>
            <el-menu-item
              v-for="sub in contentStudioSubItems"
              :key="sub.index"
              :index="sub.index"
            >
              <el-icon><component :is="sub.icon" /></el-icon>
              <template #title>{{ sub.title }}</template>
            </el-menu-item>
          </el-sub-menu>
        </el-menu-item-group>
      </el-menu>
    </el-aside>

    <!-- 右侧主体 -->
    <el-container>
      <!-- 顶部 Header -->
      <el-header class="main-header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="appStore.toggleSidebar()">
            <Fold v-if="!isCollapsed" />
            <Expand v-else />
          </el-icon>
          <span class="header-title">{{ currentTitle }}</span>
        </div>
        <div class="header-right">
          <!-- 模块 Skill/大模型状态指示器 -->
          <ModuleStatusIndicator
            v-if="currentModuleId"
            :module-id="currentModuleId"
          />

          <!-- 服务状态指示器 -->
          <el-popover
            v-if="serviceStatus"
            placement="bottom"
            :width="300"
            trigger="hover"
          >
            <template #reference>
              <div class="service-status-indicator">
                <span class="status-dot" :class="statusDotClass"></span>
                <span class="status-text">{{ onlineCount }}/{{ totalCount }}</span>
              </div>
            </template>
            <div class="service-status-detail">
              <div class="detail-header">
                服务状态（在线 {{ onlineCount }}/{{ totalCount }}）
              </div>
              <div
                v-for="svc in serviceStatus.services"
                :key="svc.name + ':' + svc.port"
                class="service-item"
              >
                <span class="service-dot" :class="svc.online ? 'online' : 'offline'"></span>
                <span class="service-name">{{ svc.name }}</span>
                <span class="service-port">:{{ svc.port }}</span>
                <el-tag
                  size="small"
                  :type="svc.online ? 'success' : 'danger'"
                  effect="plain"
                >
                  {{ svc.online ? '在线' : '离线' }}
                </el-tag>
              </div>
            </div>
          </el-popover>
          <div v-else class="service-status-indicator">
            <span class="status-dot unknown"></span>
            <span class="status-text">--</span>
          </div>

          <!-- 启动全部按钮 -->
          <el-button
            size="small"
            type="primary"
            :loading="startingAll"
            @click="handleStartAll"
          >
            启动全部
          </el-button>

          <!-- 主题切换 -->
          <div
            class="theme-toggle"
            :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
            @click="handleToggleTheme"
          >
            <el-icon :size="18">
              <Sunny v-if="isDark" />
              <Moon v-else />
            </el-icon>
          </div>
        </div>
      </el-header>

      <!-- 主体内容 -->
      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout-container {
  height: 100vh;
}

/* === 侧边栏（新拟态浅色 / 玻璃拟态深色） === */
.layout-aside {
  background-color: var(--color-bg-sidebar);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-right: 1px solid var(--color-border-lighter);
  transition: width 0.28s ease, background-color 0.4s ease;
  overflow: hidden;
  box-shadow: var(--box-shadow-raised-sm);
}

[data-theme='dark'] .layout-aside {
  box-shadow: 2px 0 14px rgba(0, 0, 0, 0.24);
}

.layout-aside :deep(.el-menu) {
  border-right: none;
  background-color: transparent;
  padding: 8px 12px;
}

.layout-aside :deep(.el-menu-item),
.layout-aside :deep(.el-sub-menu__title) {
  border-radius: var(--border-radius-base);
  margin: 4px 0;
  height: 44px;
  line-height: 44px;
  transition: all 0.25s ease;
}

.layout-aside :deep(.el-menu-item.is-active) {
  background: var(--color-primary) !important;
  color: var(--color-text-inverse) !important;
  box-shadow: none;
}

/* 内容工作室子菜单激活时父级高亮 */
.layout-aside :deep(.el-sub-menu.is-content-active) {
  background: var(--color-primary-soft);
  border-radius: var(--border-radius-base);
}

.layout-aside :deep(.el-sub-menu.is-content-active > .el-sub-menu__title) {
  color: var(--color-primary) !important;
  font-weight: 600;
}

[data-theme='dark'] .layout-aside :deep(.el-menu-item.is-active) {
  box-shadow: inset 3px 0 0 var(--color-primary-hover);
}

.layout-aside :deep(.el-menu-item-group__title) {
  font-size: 11px;
  color: var(--color-text-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 12px 8px 4px;
  font-weight: 600;
}

/* === Logo === */
.sidebar-logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border-lighter);
}

.sidebar-logo .logo-icon {
  font-size: 28px;
  color: var(--color-primary);
  flex-shrink: 0;
}

.sidebar-logo .logo-text {
  margin-left: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
}

/* === Header === */
.main-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--color-bg-header);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--color-border-lighter);
  height: 60px !important;
  padding: 0 24px;
  transition: background-color 0.4s ease;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* === 服务状态指示器 === */
.service-status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--border-radius-pill);
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  box-shadow: var(--box-shadow-raised-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-regular);
  transition: all 0.25s ease;
}

.service-status-indicator:hover {
  transform: translateY(-1px);
  box-shadow: var(--box-shadow-hover);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color 0.3s ease;
}

.status-dot.all-online {
  background-color: var(--color-success);
}

.status-dot.some-offline {
  background-color: var(--color-warning);
}

.status-dot.all-offline {
  background-color: var(--color-danger);
}

.status-dot.unknown {
  background-color: var(--color-info);
}

.status-text {
  font-weight: 600;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
}

/* === 服务状态详情（Popover 内容） === */
.service-status-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border-lighter);
}

.service-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.service-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.service-dot.online {
  background-color: var(--color-success);
}

.service-dot.offline {
  background-color: var(--color-danger);
}

.service-name {
  flex: 1;
  color: var(--color-text-regular);
}

.service-port {
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: var(--color-text-regular);
  padding: 8px;
  border-radius: var(--border-radius-base);
  transition: all 0.25s ease;
}

.collapse-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-card-hover);
}

.header-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
}

/* === 主题切换按钮 === */
.theme-toggle {
  width: 40px;
  height: 40px;
  border-radius: var(--border-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  box-shadow: var(--box-shadow-raised-sm);
  color: var(--color-text-regular);
  transition: all 0.3s ease;
}

.theme-toggle:hover {
  transform: translateY(-2px) rotate(15deg);
  box-shadow: var(--box-shadow-hover);
  color: var(--color-primary);
}

/* === 主内容区 === */
.main-content {
  background-color: transparent;
  padding: 0;
  overflow-y: auto;
}
</style>
