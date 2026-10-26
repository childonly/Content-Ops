import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import MainLayout from '@/layouts/MainLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: MainLayout,
    redirect: '/workspace',
    children: [
      // === 内容运营中心（原生页面） ===
      {
        path: 'workspace',
        name: 'Workspace',
        component: () => import('@/views/WorkspaceView.vue'),
        meta: { title: '工作台', icon: 'Connection', group: 'workspace' }
      },
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '仪表盘总览', icon: 'Odometer', group: 'content-ops' }
      },
      {
        path: 'trends',
        name: 'TrendResearch',
        component: () => import('@/views/TrendResearch.vue'),
        meta: { title: '趋势发现', icon: 'TrendCharts', group: 'content-ops' }
      },
      {
        path: 'hashtags',
        name: 'HashtagResearch',
        component: () => import('@/views/HashtagResearch.vue'),
        meta: { title: '标签研究', icon: 'Hashtag', group: 'content-ops' }
      },
      {
        path: 'content',
        name: 'ContentStudio',
        component: () => import('@/views/ContentStudio.vue'),
        meta: { title: '内容工作室', icon: 'EditPen', group: 'content-ops' }
      },
      // 以下路由已合并到内容工作室，保留重定向以兼容书签和外链
      {
        path: 'publish',
        redirect: { path: '/content', query: { tab: 'publish' } }
      },
      {
        path: 'analytics',
        name: 'Analytics',
        component: () => import('@/views/Analytics.vue'),
        meta: { title: '数据分析', icon: 'DataAnalysis', group: 'content-ops' }
      },
      {
        path: 'pipeline',
        name: 'PipelineView',
        component: () => import('@/views/PipelineView.vue'),
        meta: { title: '闭环管理', icon: 'Connection', group: 'content-ops' }
      },
      // === 小红书自动化流水线（已合并到内容工作室） ===
      {
        path: 'xhs-pipeline',
        redirect: { path: '/content', query: { tab: 'pipeline' } }
      },
      {
        path: 'draft-review',
        redirect: { path: '/content', query: { tab: 'manage' } }
      },
      // === 社媒情报中心（原生组件，直接调用 /api/radar/* 端点） ===
      {
        path: 'radar',
        name: 'SocialRadar',
        component: () => import('@/views/RadarView.vue'),
        meta: { title: '社媒情报中心', icon: 'Search', group: 'radar' }
      },
      // === 系统管理 ===
      {
        path: 'admin',
        name: 'Admin',
        component: () => import('@/views/AdminView.vue'),
        meta: { title: '系统管理', icon: 'Setting', group: 'system' }
      },
      // === 视频工具（已合并到内容工作室） ===
      {
        path: 'video-studio',
        redirect: { path: '/content', query: { tab: 'video' } }
      },
      // === 图片工作室（已合并到内容工作室） ===
      {
        path: 'image-studio',
        redirect: { path: '/content', query: { tab: 'image' } }
      },
      // 旧路由保留为重定向（向后兼容书签和外链）
      {
        path: '/video-alchemist',
        redirect: { path: '/content', query: { tab: 'video' } }
      },
      {
        path: '/transcriber',
        redirect: { path: '/content', query: { tab: 'video' } }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 全局前置守卫 - 设置页面标题
router.beforeEach((to, _from, next) => {
  const title = (to.meta.title as string) || 'Content Ops Hub'
  document.title = `${title} - Content Ops Hub`
  next()
})

export default router
