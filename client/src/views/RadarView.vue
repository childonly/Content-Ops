<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

// ============================================================
// 类型定义（radar 接口数据结构）
// ============================================================

interface TrendItem {
  id?: string
  title?: string
  name?: string
  platform?: string
  heat?: number
  volume?: number
  growthRate?: number
  growth?: number
  viewCount?: number
  postCount?: number
  rank?: number
  fetchedAt?: string
  sourceType?: 'observed' | 'estimated' | 'simulated'
  raw?: unknown
  url?: string
  category?: string
  description?: string
  [key: string]: unknown
}

interface HashtagItem {
  id?: string
  tag?: string
  name?: string
  platform?: string
  volume?: number
  heat?: number
  growthRate?: number
  posts?: number
  url?: string
  viewCount?: number
  postCount?: number
  sourceType?: 'observed' | 'estimated' | 'simulated'
  raw?: unknown
  [key: string]: unknown
}

interface SentimentInfo {
  positive?: number
  negative?: number
  neutral?: number
}

interface ListeningPost {
  content?: string
  text?: string
  sentiment?: string
  author?: string
  url?: string
  [key: string]: unknown
}

interface ListeningPlatformResult {
  platform?: string
  sentiment?: SentimentInfo
  mentions?: number
  count?: number
  posts?: ListeningPost[]
  [key: string]: unknown
}

interface CompetitorAccount {
  platform: string
  handle: string
}

interface CompetitorResult {
  platform?: string
  handle?: string
  followers?: number
  engagementRate?: number
  postFrequency?: number
  posts?: number
  likes?: number
  url?: string
  [key: string]: unknown
}

interface HealthData {
  status?: string
  tikhubConfigured?: boolean
  cacheSize?: number
}

interface UsageData {
  balance?: number
  usedToday?: number
  limit?: number
}

// ============================================================
// 通用请求封装（直接调用 /api/radar/*）
// ============================================================

const API_BASE = '/api/radar'

async function radarRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  let json: { success?: boolean; data?: T; error?: string; message?: string }
  try {
    json = (await res.json()) as typeof json
  } catch {
    throw new Error(`HTTP ${res.status}: 响应解析失败`)
  }
  if (!res.ok || json.success === false) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`)
  }
  return json.data as T
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return qs ? `?${qs}` : ''
}

function radarGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  return radarRequest<T>(`${API_BASE}${path}${buildQuery(params)}`)
}

function radarPost<T>(path: string, body?: unknown): Promise<T> {
  return radarRequest<T>(`${API_BASE}${path}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined
  })
}

function radarDelete<T>(path: string): Promise<T> {
  return radarRequest<T>(`${API_BASE}${path}`, { method: 'DELETE' })
}

// ============================================================
// 工具函数
// ============================================================

const platformLabelMap: Record<string, string> = {
  tiktok: 'TikTok',
  twitter: 'Twitter',
  all: '全部',
  instagram: 'Instagram',
  xhs: '小红书',
  xiaohongshu: '小红书',
  douyin: '抖音',
  youtube: 'YouTube'
}

type TagType = '' | 'primary' | 'success' | 'info' | 'warning' | 'danger'

function platformLabel(p?: string): string {
  if (!p) return '-'
  return platformLabelMap[p] || p
}

function platformTagType(p?: string): TagType {
  const map: Record<string, TagType> = {
    tiktok: 'primary',
    twitter: 'info',
    instagram: 'danger',
    xhs: 'warning',
    xiaohongshu: 'warning',
    douyin: 'warning',
    youtube: 'danger',
    all: 'success'
  }
  return p ? (map[p] ?? 'info') : 'info'
}

function formatNumber(num?: number): string {
  if (num === undefined || num === null || isNaN(num)) return '-'
  if (num >= 100000000) return (num / 100000000).toFixed(2) + '亿'
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toLocaleString()
}

function formatPercent(num?: number): string {
  if (num === undefined || num === null || isNaN(num)) return '-'
  return num.toFixed(2) + '%'
}

// ============================================================
// Tab 1: 趋势监控
// ============================================================

const trendsLoading = ref<boolean>(false)
const trendList = ref<TrendItem[]>([])
const trendDetailVisible = ref(false)
const selectedTrend = ref<TrendItem | null>(null)
const trendsFilter = reactive({
  platform: 'all' as 'tiktok' | 'twitter' | 'all',
  country: 'US',
  period: 7
})

const trendPlatformOptions = [
  { label: '全部平台', value: 'all' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Twitter', value: 'twitter' }
]

const countryOptions = [
  { label: '美国 (US)', value: 'US' },
  { label: '英国 (GB)', value: 'GB' },
  { label: '日本 (JP)', value: 'JP' },
  { label: '德国 (DE)', value: 'DE' },
  { label: '法国 (FR)', value: 'FR' },
  { label: '巴西 (BR)', value: 'BR' },
  { label: '印度 (IN)', value: 'IN' }
]

const periodOptions = [
  { label: '近 1 天', value: 1 },
  { label: '近 3 天', value: 3 },
  { label: '近 7 天', value: 7 },
  { label: '近 14 天', value: 14 },
  { label: '近 30 天', value: 30 }
]

async function fetchTrends(): Promise<void> {
  trendsLoading.value = true
  try {
    const data = await radarGet<Array<TrendItem | { platform?: string; fetchedAt?: string; trends?: TrendItem[] }>>('/trends', {
      platform: trendsFilter.platform,
      country: trendsFilter.country,
      period: trendsFilter.period
    })
    trendList.value = Array.isArray(data) ? data.flatMap(group => {
      if ('trends' in group && Array.isArray(group.trends)) {
        return group.trends.map(item => ({
          ...item,
          platform: item.platform || group.platform,
          title: item.title || item.name,
          heat: item.heat ?? item.viewCount ?? item.postCount,
          growthRate: item.growthRate ?? item.growth,
          fetchedAt: group.fetchedAt,
          sourceType: 'observed' as const,
        }))
      }
      return [{ ...group, sourceType: 'observed' as const } as TrendItem]
    }) : []
    ElMessage.success(`查询到 ${trendList.value.length} 条趋势`)
  } catch (e) {
    ElMessage.error((e as Error).message || '查询趋势失败')
    trendList.value = []
  } finally {
    trendsLoading.value = false
  }
}

function openTrendDetail(trend: TrendItem): void { selectedTrend.value = trend; trendDetailVisible.value = true }

// ============================================================
// Tab 2: 标签搜索
// ============================================================

const hashtagsLoading = ref<boolean>(false)
const hashtagList = ref<HashtagItem[]>([])
const hashtagKeyword = ref<string>('')
const hashtagPlatform = ref<'tiktok' | 'instagram' | 'xhs'>('tiktok')

const hashtagPlatformOptions = [
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Instagram', value: 'instagram' },
  { label: '小红书', value: 'xhs' }
]

async function searchHashtags(): Promise<void> {
  if (!hashtagKeyword.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  hashtagsLoading.value = true
  try {
    const data = await radarGet<HashtagItem[] | { query?: string; results?: HashtagItem[] }>('/hashtags', {
      q: hashtagKeyword.value,
      platform: hashtagPlatform.value
    })
    const items = Array.isArray(data) ? data : data?.results || []
    hashtagList.value = items.map(item => ({
      ...item,
      tag: item.tag || item.name,
      volume: item.volume ?? item.viewCount ?? item.postCount,
      sourceType: 'observed',
    }))
    ElMessage.success(`找到 ${hashtagList.value.length} 个标签`)
  } catch (e) {
    ElMessage.error((e as Error).message || '搜索标签失败')
    hashtagList.value = []
  } finally {
    hashtagsLoading.value = false
  }
}

function copyHashtag(tag?: string): void {
  if (!tag) return
  const text = tag.startsWith('#') ? tag : `#${tag}`
  navigator.clipboard
    .writeText(text)
    .then(() => ElMessage.success(`已复制 ${text}`))
    .catch(() => ElMessage.error('复制失败'))
}

// ============================================================
// Tab 3: 舆情监听
// ============================================================

const listeningLoading = ref<boolean>(false)
const listeningResult = ref<ListeningPlatformResult[]>([])
const listeningKeyword = ref<string>('')
const listeningPlatforms = ref<string[]>(['tiktok', 'twitter'])
const listeningLimit = ref<number>(50)

const listeningPlatformOptions = [
  { label: 'TikTok', value: 'tiktok' },
  { label: '抖音', value: 'douyin' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Twitter', value: 'twitter' },
  { label: 'YouTube', value: 'youtube' },
  { label: '小红书', value: 'xhs' }
]

async function startListening(): Promise<void> {
  if (!listeningKeyword.value.trim()) {
    ElMessage.warning('请输入监听关键词')
    return
  }
  if (!listeningPlatforms.value.length) {
    ElMessage.warning('请至少选择一个平台')
    return
  }
  listeningLoading.value = true
  try {
    const data = await radarPost<
      ListeningPlatformResult[] | { platforms?: ListeningPlatformResult[] }
    >('/listening', {
      keyword: listeningKeyword.value,
      platforms: listeningPlatforms.value,
      limit: listeningLimit.value
    })
    if (Array.isArray(data)) {
      listeningResult.value = data
    } else if (data && data.platforms) {
      listeningResult.value = data.platforms
    } else {
      listeningResult.value = []
    }
    ElMessage.success('舆情监听完成')
  } catch (e) {
    ElMessage.error((e as Error).message || '舆情监听失败')
    listeningResult.value = []
  } finally {
    listeningLoading.value = false
  }
}

function sentimentTotal(s?: SentimentInfo): number {
  return (s?.positive || 0) + (s?.negative || 0) + (s?.neutral || 0)
}

function sentimentPercent(val: number, s?: SentimentInfo): number {
  const total = sentimentTotal(s)
  if (!total) return 0
  return Math.round((val / total) * 100)
}

function sentimentTagType(s?: string): TagType {
  if (s === 'positive') return 'success'
  if (s === 'negative') return 'danger'
  if (s === 'neutral') return 'info'
  return 'warning'
}

// ============================================================
// Tab 4: 竞品分析
// ============================================================

const competitorsLoading = ref<boolean>(false)
const competitorResults = ref<CompetitorResult[]>([])
const competitorAccounts = ref<CompetitorAccount[]>([
  { platform: 'tiktok', handle: '' },
  { platform: 'tiktok', handle: '' }
])

const competitorPlatformOptions = [
  { label: 'TikTok', value: 'tiktok' },
  { label: '抖音', value: 'douyin' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Twitter', value: 'twitter' },
  { label: 'YouTube', value: 'youtube' },
  { label: '小红书', value: 'xhs' }
]

function addCompetitorAccount(): void {
  competitorAccounts.value.push({ platform: 'tiktok', handle: '' })
}

function removeCompetitorAccount(index: number): void {
  if (competitorAccounts.value.length <= 1) {
    ElMessage.warning('至少保留一个账号')
    return
  }
  competitorAccounts.value.splice(index, 1)
}

async function analyzeCompetitors(): Promise<void> {
  const valid = competitorAccounts.value.filter((a) => a.handle.trim())
  if (!valid.length) {
    ElMessage.warning('请至少填写一个账号 handle')
    return
  }
  competitorsLoading.value = true
  try {
    const data = await radarPost<CompetitorResult[]>('/competitors', {
      accounts: valid.map((a) => ({
        platform: a.platform,
        handle: a.handle.trim().replace(/^@/, '')
      }))
    })
    competitorResults.value = Array.isArray(data) ? data : []
    ElMessage.success(`分析完成，共 ${competitorResults.value.length} 个账号`)
  } catch (e) {
    ElMessage.error((e as Error).message || '竞品分析失败')
    competitorResults.value = []
  } finally {
    competitorsLoading.value = false
  }
}

// ============================================================
// Tab 5: 系统状态
// ============================================================

const statusLoading = ref<boolean>(false)
const clearing = ref<boolean>(false)
const healthData = ref<HealthData>({})
const usageData = ref<UsageData>({})

async function fetchStatus(): Promise<void> {
  statusLoading.value = true
  try {
    const [health, usage] = await Promise.all([
      radarGet<HealthData>('/health'),
      radarGet<UsageData>('/usage')
    ])
    healthData.value = health || {}
    usageData.value = usage || {}
  } catch (e) {
    ElMessage.error((e as Error).message || '获取系统状态失败')
  } finally {
    statusLoading.value = false
  }
}

async function clearCache(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空所有缓存数据？此操作不可恢复。', '清空缓存', {
      confirmButtonText: '确认清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  clearing.value = true
  try {
    await radarDelete<{ cleared?: number }>('/cache')
    ElMessage.success('缓存已清空')
    await fetchStatus()
  } catch (e) {
    ElMessage.error((e as Error).message || '清空缓存失败')
  } finally {
    clearing.value = false
  }
}

function usagePercent(): number {
  const used = usageData.value.usedToday || 0
  const limit = usageData.value.limit || 0
  if (!limit) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function usageStatus(): '' | 'warning' | 'exception' {
  const p = usagePercent()
  if (p > 90) return 'exception'
  if (p > 80) return 'warning'
  return ''
}

// ============================================================
// 初始化
// ============================================================

const activeTab = ref<string>('trends')

onMounted(() => {
  fetchStatus()
})
</script>

<template>
  <div class="page-container radar-view">
    <!-- 顶部标题 -->
    <div class="page-header">
      <span class="page-title">社媒情报中心</span>
      <el-tag type="info" effect="plain">radar 原生组件</el-tag>
    </div>

    <el-card shadow="never" class="radar-card">
      <el-tabs v-model="activeTab" class="radar-tabs">
        <!-- ====== Tab 1: 趋势监控 ====== -->
        <el-tab-pane label="趋势监控" name="trends">
          <div class="filter-bar">
            <el-select v-model="trendsFilter.platform" style="width: 160px" @change="fetchTrends">
              <el-option
                v-for="o in trendPlatformOptions"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
            <el-select v-model="trendsFilter.country" style="width: 180px" @change="fetchTrends">
              <el-option
                v-for="o in countryOptions"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
            <el-select v-model="trendsFilter.period" style="width: 140px" @change="fetchTrends">
              <el-option
                v-for="o in periodOptions"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
            <el-button type="primary" :loading="trendsLoading" @click="fetchTrends">
              <el-icon v-if="!trendsLoading"><Search /></el-icon>
              查询趋势
            </el-button>
          </div>

          <div v-loading="trendsLoading" class="tab-content">
            <div v-if="trendList.length" class="card-grid">
              <el-card
                v-for="(t, i) in trendList"
                :key="i"
                shadow="hover"
                class="trend-card"
                @click="openTrendDetail(t)"
              >
                <div class="trend-card-header">
                  <el-tag :type="platformTagType(t.platform)" size="small">
                    {{ platformLabel(t.platform) }}
                  </el-tag>
                  <el-tag size="small" type="success" effect="plain">实时采集</el-tag>
                  <span
                    v-if="t.growthRate !== undefined"
                    class="trend-growth"
                    :class="(t.growthRate || 0) >= 0 ? 'text-success' : 'text-danger'"
                  >
                    {{ (t.growthRate || 0) >= 0 ? '+' : '' }}{{ t.growthRate }}%
                  </span>
                </div>
                <div class="trend-title">{{ t.title || t.name || '未命名趋势' }}</div>
                <div v-if="t.description" class="trend-desc">{{ t.description }}</div>
                <div class="trend-meta">
                  <span class="meta-item">
                    <el-icon><TrendCharts /></el-icon>
                    热度: {{ formatNumber(t.heat ?? t.volume) }}
                  </span>
                  <span v-if="t.category" class="meta-item">
                    <el-icon><Collection /></el-icon>
                    {{ t.category }}
                  </span>
                </div>
                <div class="trend-footer"><el-button text type="primary" size="small" @click.stop="openTrendDetail(t)">查看详情与来源</el-button></div>
              </el-card>
            </div>
            <el-empty v-else description="暂无趋势数据，点击「查询趋势」开始获取" />
          </div>
        </el-tab-pane>

        <!-- ====== Tab 2: 标签搜索 ====== -->
        <el-tab-pane label="标签搜索" name="hashtags">
          <div class="filter-bar">
            <el-input
              v-model="hashtagKeyword"
              placeholder="输入关键词搜索标签"
              style="width: 280px"
              clearable
              @keyup.enter="searchHashtags"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-select v-model="hashtagPlatform" style="width: 160px" @change="searchHashtags">
              <el-option
                v-for="o in hashtagPlatformOptions"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
            <el-button type="primary" :loading="hashtagsLoading" @click="searchHashtags">
              <el-icon v-if="!hashtagsLoading"><Search /></el-icon>
              搜索
            </el-button>
          </div>

          <el-card shadow="never" class="tab-content">
            <el-table
              v-loading="hashtagsLoading"
              :data="hashtagList"
              stripe
              style="width: 100%"
            >
              <el-table-column label="标签名" min-width="180">
                <template #default="{ row }">
                  <span class="font-bold text-primary">#{{ row.tag || row.name }}</span>
                </template>
              </el-table-column>
              <el-table-column label="平台" width="120">
                <template #default="{ row }">
                  <el-tag :type="platformTagType(row.platform)" size="small">
                    {{ platformLabel(row.platform) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="热度" width="120" align="right">
                <template #default="{ row }">
                  {{ formatNumber(row.volume ?? row.heat) }}
                </template>
              </el-table-column>
              <el-table-column label="增长率" width="110" align="right">
                <template #default="{ row }">
                  <span :class="(row.growthRate || 0) >= 0 ? 'text-success' : 'text-danger'">
                    {{ (row.growthRate || 0) >= 0 ? '+' : '' }}{{ row.growthRate }}%
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="120" align="center">
                <template #default="{ row }">
                  <el-button
                    size="small"
                    text
                    type="primary"
                    @click="copyHashtag(row.tag || row.name)"
                  >
                    复制
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-empty
              v-if="!hashtagsLoading && !hashtagList.length"
              description="暂无标签数据，输入关键词开始搜索"
            />
          </el-card>
        </el-tab-pane>

        <!-- ====== Tab 3: 舆情监听 ====== -->
        <el-tab-pane label="舆情监听" name="listening">
          <div class="filter-bar">
            <el-input
              v-model="listeningKeyword"
              placeholder="输入监听关键词"
              style="width: 240px"
              clearable
              @keyup.enter="startListening"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-select
              v-model="listeningPlatforms"
              multiple
              collapse-tags
              collapse-tags-tooltip
              placeholder="选择监听平台"
              style="width: 320px"
            >
              <el-option
                v-for="o in listeningPlatformOptions"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
            <el-input-number
              v-model="listeningLimit"
              :min="10"
              :max="500"
              :step="10"
              controls-position="right"
              style="width: 140px"
            />
            <el-button type="primary" :loading="listeningLoading" @click="startListening">
              <el-icon v-if="!listeningLoading"><Search /></el-icon>
              开始监听
            </el-button>
          </div>

          <div v-loading="listeningLoading" class="tab-content">
            <div v-if="listeningResult.length" class="listening-grid">
              <el-card
                v-for="(p, i) in listeningResult"
                :key="i"
                shadow="hover"
                class="listening-card"
              >
                <template #header>
                  <div class="listening-card-header">
                    <el-tag :type="platformTagType(p.platform)">
                      {{ platformLabel(p.platform) }}
                    </el-tag>
                    <span class="text-secondary">
                      提及 {{ formatNumber(p.mentions ?? p.count) }} 条
                    </span>
                  </div>
                </template>

                <div v-if="p.sentiment" class="sentiment-block">
                  <div class="sentiment-row">
                    <span class="text-success">正面</span>
                    <el-progress
                      :percentage="sentimentPercent(p.sentiment.positive || 0, p.sentiment)"
                      color="#67c23a"
                      :stroke-width="14"
                    />
                    <span class="text-secondary">{{ p.sentiment.positive || 0 }}</span>
                  </div>
                  <div class="sentiment-row">
                    <span class="text-secondary">中性</span>
                    <el-progress
                      :percentage="sentimentPercent(p.sentiment.neutral || 0, p.sentiment)"
                      color="#909399"
                      :stroke-width="14"
                    />
                    <span class="text-secondary">{{ p.sentiment.neutral || 0 }}</span>
                  </div>
                  <div class="sentiment-row">
                    <span class="text-danger">负面</span>
                    <el-progress
                      :percentage="sentimentPercent(p.sentiment.negative || 0, p.sentiment)"
                      color="#f56c6c"
                      :stroke-width="14"
                    />
                    <span class="text-secondary">{{ p.sentiment.negative || 0 }}</span>
                  </div>
                </div>

                <div v-if="p.posts && p.posts.length" class="post-list">
                  <div
                    v-for="(post, j) in p.posts.slice(0, 3)"
                    :key="j"
                    class="post-item"
                  >
                    <div class="post-content">{{ post.content || post.text || '-' }}</div>
                    <div class="post-meta">
                      <span v-if="post.author" class="text-secondary">@{{ post.author }}</span>
                      <el-tag
                        v-if="post.sentiment"
                        :type="sentimentTagType(post.sentiment)"
                        size="small"
                      >
                        {{ post.sentiment }}
                      </el-tag>
                    </div>
                  </div>
                </div>
              </el-card>
            </div>
            <el-empty
              v-else
              description="暂无监听结果，输入关键词并选择平台后开始监听"
            />
          </div>
        </el-tab-pane>

        <!-- ====== Tab 4: 竞品分析 ====== -->
        <el-tab-pane label="竞品分析" name="competitors">
          <el-card shadow="never" class="tab-content">
            <div class="competitor-accounts">
              <div
                v-for="(acc, i) in competitorAccounts"
                :key="i"
                class="competitor-row"
              >
                <el-select v-model="acc.platform" style="width: 160px">
                  <el-option
                    v-for="o in competitorPlatformOptions"
                    :key="o.value"
                    :label="o.label"
                    :value="o.value"
                  />
                </el-select>
                <el-input v-model="acc.handle" placeholder="账号 handle，如 username" style="flex: 1">
                  <template #prefix>
                    <el-icon><User /></el-icon>
                  </template>
                </el-input>
                <el-button text type="danger" @click="removeCompetitorAccount(i)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
            <div class="competitor-actions">
              <el-button @click="addCompetitorAccount">
                <el-icon><Plus /></el-icon>
                添加账号
              </el-button>
              <el-button type="primary" :loading="competitorsLoading" @click="analyzeCompetitors">
                <el-icon v-if="!competitorsLoading"><DataAnalysis /></el-icon>
                开始分析
              </el-button>
            </div>
          </el-card>

          <el-card shadow="never" class="tab-content mt-16">
            <el-table
              v-loading="competitorsLoading"
              :data="competitorResults"
              stripe
              style="width: 100%"
            >
              <el-table-column label="平台" width="120">
                <template #default="{ row }">
                  <el-tag :type="platformTagType(row.platform)" size="small">
                    {{ platformLabel(row.platform) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="账号" min-width="160">
                <template #default="{ row }">
                  <span class="font-bold">@{{ row.handle }}</span>
                </template>
              </el-table-column>
              <el-table-column label="粉丝数" width="140" align="right">
                <template #default="{ row }">{{ formatNumber(row.followers) }}</template>
              </el-table-column>
              <el-table-column label="互动率" width="140" align="right">
                <template #default="{ row }">
                  <span :class="(row.engagementRate || 0) >= 3 ? 'text-success' : 'text-warning'">
                    {{ formatPercent(row.engagementRate) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="发帖频率(周)" width="150" align="right">
                <template #default="{ row }">
                  {{ row.postFrequency ?? row.posts ?? '-' }}
                </template>
              </el-table-column>
            </el-table>
            <el-empty
              v-if="!competitorsLoading && !competitorResults.length"
              description="暂无分析结果，添加账号后开始分析"
            />
          </el-card>
        </el-tab-pane>

        <!-- ====== Tab 5: 系统状态 ====== -->
        <el-tab-pane label="系统状态" name="status">
          <div v-loading="statusLoading" class="tab-content">
            <div class="status-grid">
              <el-card shadow="hover" class="status-card">
                <div class="status-card-title">TikHub 配置状态</div>
                <div class="status-card-value">
                  <el-tag
                    :type="healthData.tikhubConfigured ? 'success' : 'danger'"
                    size="large"
                  >
                    {{ healthData.tikhubConfigured ? '已配置' : '未配置' }}
                  </el-tag>
                </div>
                <div class="status-card-desc">服务状态: {{ healthData.status || '-' }}</div>
              </el-card>

              <el-card shadow="hover" class="status-card">
                <div class="status-card-title">账户余额</div>
                <div class="status-card-value font-xl font-bold text-primary">
                  {{ formatNumber(usageData.balance) }}
                </div>
                <div class="status-card-desc">
                  今日已用: {{ formatNumber(usageData.usedToday) }} / {{ formatNumber(usageData.limit) }}
                </div>
                <el-progress
                  :percentage="usagePercent()"
                  :status="usageStatus()"
                  class="mt-8"
                />
              </el-card>

              <el-card shadow="hover" class="status-card">
                <div class="status-card-title">缓存大小</div>
                <div class="status-card-value font-xl font-bold text-warning">
                  {{ formatNumber(healthData.cacheSize) }}
                </div>
                <div class="status-card-desc">条缓存记录</div>
                <el-button
                  type="danger"
                  plain
                  :loading="clearing"
                  class="mt-8"
                  @click="clearCache"
                >
                  <el-icon v-if="!clearing"><Delete /></el-icon>
                  清空缓存
                </el-button>
              </el-card>
            </div>

            <div class="status-actions">
              <el-button @click="fetchStatus">
                <el-icon><Refresh /></el-icon>
                刷新状态
              </el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="trendDetailVisible" title="趋势详情与数据来源" width="640px">
      <template v-if="selectedTrend">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="趋势">{{ selectedTrend.title || selectedTrend.name }}</el-descriptions-item>
          <el-descriptions-item label="平台">{{ platformLabel(selectedTrend.platform) }}</el-descriptions-item>
          <el-descriptions-item label="热度">{{ formatNumber(selectedTrend.heat ?? selectedTrend.viewCount ?? selectedTrend.postCount) }}</el-descriptions-item>
          <el-descriptions-item label="排名">{{ selectedTrend.rank || '-' }}</el-descriptions-item>
          <el-descriptions-item label="采集时间">{{ selectedTrend.fetchedAt ? new Date(selectedTrend.fetchedAt).toLocaleString('zh-CN') : '-' }}</el-descriptions-item>
          <el-descriptions-item label="真实性"><el-tag type="success">observed · 平台采集</el-tag></el-descriptions-item>
        </el-descriptions>
        <p v-if="selectedTrend.url" class="source-link"><el-link :href="selectedTrend.url" target="_blank" type="primary">打开原始来源</el-link></p>
        <h4>原始指标</h4><pre class="raw-detail">{{ JSON.stringify(selectedTrend.raw || selectedTrend, null, 2) }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.radar-view .radar-card {
  min-height: 600px;
}

.radar-tabs {
  padding: 0 4px;
}

.tab-content {
  margin-top: 8px;
  min-height: 300px;
}

/* ---------- 趋势卡片 ---------- */
.trend-card {
  transition: transform 0.2s ease;
}
.trend-card:hover {
  transform: translateY(-2px);
}
.trend-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.trend-growth {
  font-weight: 600;
  font-size: 13px;
}
.trend-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 6px;
  line-height: 1.4;
}
.trend-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.trend-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
  color: var(--color-text-regular);
}
.trend-meta .meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.trend-footer {
  margin-top: 8px;
}

/* ---------- 舆情监听 ---------- */
.listening-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}
.listening-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sentiment-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sentiment-row {
  display: grid;
  grid-template-columns: 50px 1fr 50px;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.post-list {
  margin-top: 12px;
  border-top: 1px solid var(--color-border-lighter);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.post-item {
  background: var(--color-bg-page);
  border-radius: 6px;
  padding: 8px 10px;
}
.post-content {
  font-size: 13px;
  color: var(--color-text-regular);
  margin-bottom: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.post-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

/* ---------- 竞品分析 ---------- */
.competitor-accounts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.competitor-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.competitor-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

/* ---------- 系统状态 ---------- */
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.status-card {
  text-align: center;
}
.status-card-title {
  font-size: 14px;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}
.status-card-value {
  margin-bottom: 8px;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.status-card-desc {
  font-size: 13px;
  color: var(--color-text-regular);
}
.status-actions {
  margin-top: 20px;
  text-align: center;
}
.raw-detail { max-height: 300px; overflow: auto; padding: 12px; border-radius: 8px; background: var(--color-bg-subtle); color: var(--color-text-secondary); font-size: 11px; white-space: pre-wrap; }
.source-link { margin: 14px 0; }

/* ---------- 响应式 ---------- */
@media (max-width: 768px) {
  .listening-grid,
  .status-grid {
    grid-template-columns: 1fr;
  }
  .competitor-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
