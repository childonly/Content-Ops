# 架构文档 (ARCHITECTURE)

> Content Ops Hub — 内容运营中枢
> 三项目合并的一站式内容运营管理平台

---

## 1. 系统概览

Content Ops Hub 由三个独立项目合并而成：

| 原项目 | 功能 | 合并去向 |
|--------|------|----------|
| xhs-auto-pipeline | 小红书自动化流水线 | → content-ops-hub |
| social-radar | 社媒情报中心 | → content-ops-hub |
| content-ops-hub | 内容运营中枢（基座） | 保留，扩展 |

**合并后统一端口**：后端 `3100` + 前端 `5180`（核心服务仅 2 个端口）

---

## 2. 技术栈

| 层 | 技术 | 版本 | 用途 |
|----|------|------|------|
| 后端框架 | Express | ^4.18.2 | HTTP 服务 |
| 后端语言 | TypeScript | ^5.3.3 | 类型安全 |
| 数据库 | SQLite (better-sqlite3) | ^11.0.0 | 本地存储，11 张表 |
| 安全中间件 | helmet | ^8.3.0 | HTTP 安全头 |
| 限流 | express-rate-limit | ^8.6.0 | 写接口限流 |
| 定时任务 | node-cron | ^3.0.3 | 调度器 |
| 日志 | winston | ^3.11.0 | 结构化日志 |
| 前端框架 | Vue 3 | ^3.4.0 | SPA |
| UI 库 | Element Plus | ^2.5.0 | 组件库 |
| 状态管理 | Pinia | ^2.1.7 | 全局状态 |
| 图表 | ECharts + vue-echarts | ^5.4.3 / ^6.6.8 | 数据可视化 |
| 流程图 | Vue Flow + dagre | ^1.48.2 / ^0.8.5 | DAG 首页 |
| 构建工具 | Vite | ^5.0.12 | 前端构建 |
| HTTP 客户端 | Axios | ^1.6.5 | API 调用 |

---

## 3. 目录结构

```
content-ops-hub/
├── server/                          # 后端
│   ├── src/
│   │   ├── config/index.ts          # 配置定义（dotenv）
│   │   ├── db/index.ts              # 数据库初始化 + 11 张表
│   │   ├── app.ts                   # Express 应用创建 + 中间件 + 路由挂载
│   │   ├── index.ts                 # 入口：HTTP 启动 + 调度器 + 登录监控
│   │   ├── types/
│   │   │   ├── index.ts             # 核心类型（Pipeline/Trend/Content 等）
│   │   │   └── radar.types.ts       # Radar 模块类型（Platform/Mention 等）
│   │   ├── services/                # 18 个服务文件
│   │   │   ├── trend.service.ts
│   │   │   ├── hashtag.service.ts
│   │   │   ├── content.service.ts
│   │   │   ├── publish.service.ts
│   │   │   ├── analytics.service.ts
│   │   │   ├── pipeline.service.ts  # 核心：Pipeline 编排 + advanceStage
│   │   │   ├── scheduler.service.ts # node-cron 调度器
│   │   │   ├── llm-service.ts       # 多 LLM 提供商链
│   │   │   ├── image-generation.service.ts
│   │   │   ├── research.service.ts
│   │   │   ├── tikhub-client.ts     # TikHub API 客户端
│   │   │   ├── radar-trend.service.ts
│   │   │   ├── radar-hashtag.service.ts
│   │   │   ├── radar-listening.service.ts
│   │   │   ├── radar-competitor.service.ts
│   │   │   ├── xhs-pipeline.service.ts
│   │   │   ├── xhs-login.service.ts
│   │   │   └── xhs-publish.service.ts
│   │   ├── routes/                  # 14 个路由文件
│   │   ├── utils/
│   │   │   ├── constants.ts         # 共享常量（PYTHON_MAX_BUFFER 等）
│   │   │   ├── skill-bridge.ts      # Trae Skill 调用桥接
│   │   │   └── logger.ts            # Winston 日志
│   │   └── middleware/
│   ├── scripts/python/              # Python 脚本
│   │   ├── custom_publish.py        # 长文发布修复
│   │   └── xhs-search-edge.py       # Playwright 搜索回退
│   ├── data/                        # SQLite 数据库文件
│   └── .env                         # 环境变量（34 个）
├── client/                          # 前端
│   ├── src/
│   │   ├── views/                   # 10 个页面
│   │   │   ├── Dashboard.vue        # 仪表盘（流程图首页）
│   │   │   ├── TrendResearch.vue    # 趋势发现
│   │   │   ├── HashtagResearch.vue  # 标签研究
│   │   │   ├── ContentStudio.vue    # 内容工作室
│   │   │   ├── PublishQueue.vue     # 发布队列
│   │   │   ├── Analytics.vue        # 数据分析
│   │   │   ├── PipelineView.vue     # 闭环管理
│   │   │   ├── XhsPipelineView.vue  # 小红书流水线
│   │   │   ├── DraftReview.vue      # 草稿审核
│   │   │   └── RadarView.vue        # 社媒情报中心
│   │   ├── components/              # 7 个组件
│   │   │   ├── StatCard.vue
│   │   │   ├── TrendCard.vue
│   │   │   ├── PipelineFlow.vue
│   │   │   ├── ExternalPage.vue
│   │   │   └── flow/               # 流程图组件
│   │   │       ├── FlowHome.vue
│   │   │       ├── ModuleNode.vue
│   │   │       └── ModuleInfoCard.vue
│   │   ├── router/index.ts          # 路由配置
│   │   ├── stores/app.ts            # Pinia 状态管理
│   │   ├── api/index.ts             # API 封装层
│   │   ├── config/moduleConfigs.ts  # 9 个模块节点配置
│   │   ├── composables/
│   │   │   └── useModuleFlow.ts     # dagre 自动布局
│   │   └── types/index.ts
│   └── vite.config.ts
├── package.json                     # npm workspaces
└── start-all-services.ps1           # 启动脚本
```

---

## 4. 架构层次

### 4.1 后端三层架构

```
┌─────────────────────────────────────┐
│          路由层 (Routes)             │  14 个路由文件
│  接收 HTTP 请求 → 参数校验 → 响应    │
├─────────────────────────────────────┤
│          服务层 (Services)           │  18 个服务文件
│  业务逻辑 → 技能调用 → 数据处理      │
├─────────────────────────────────────┤
│         数据访问层 (DB)              │  better-sqlite3
│  11 张表 → WAL 模式 → 外键约束       │
└─────────────────────────────────────┘
```

### 4.2 前端架构

```
┌─────────────────────────────────────┐
│          页面层 (Views)              │  10 个页面
│  用户交互 → 数据展示 → 表单提交      │
├─────────────────────────────────────┤
│          组件层 (Components)         │  7 个组件
│  StatCard / TrendCard / FlowHome    │
├─────────────────────────────────────┤
│          状态层 (Pinia Store)        │  1 个 store
│  主题 / 侧边栏 / 仪表盘统计          │
├─────────────────────────────────────┤
│          API 层 (api/index.ts)       │  Axios 封装
│  HTTP 请求 → 响应解包 → 错误处理     │
└─────────────────────────────────────┘
```

---

## 5. 核心业务流程

### 5.1 Pipeline 闭环（6 阶段）

```
趋势发现 → 标签研究 → 内容生成 → 发布执行 → 效果追踪 → 迭代优化
    ↑                                                    │
    └──────────────────数据反馈──────────────────────────┘
```

每个阶段由独立的 handler 函数处理（策略模式）：

| 阶段 | Handler | 调用服务 |
|------|---------|----------|
| TREND_DISCOVERY | handleTrendDiscovery | discoverTrends() |
| HASHTAG_RESEARCH | handleHashtagResearch | researchHashtags() |
| CONTENT_GENERATION | handleContentGeneration | generateContent() |
| PUBLISHING | handlePublishing | publishContent() |
| PERFORMANCE_TRACKING | handlePerformanceTracking | trackAnalytics() |
| ITERATION | handleIteration | 无（标记完成） |

### 5.2 小红书流水线

```
关键词管理 → 定时任务触发 → 搜索笔记 → 生成报告 → 生成草稿 → 人工审核 → 发布
```

- 支持 node-cron 定时触发
- 草稿保存到 drafts 表，需人工审核后发布
- 登录状态监控（Cookie 生命周期管理）

### 5.3 社媒情报中心

```
跨平台趋势监测 → 标签分析 → 情感分析 → 社交聆听 → 竞品分析
```

- 支持 6 个平台：TikTok / 抖音 / Instagram / Twitter / YouTube / 小红书
- TikHub API 统一接入，含重试/缓存/成本控制

---

## 6. 数据库设计

### 11 张表

| 表名 | 用途 | 关键外键 |
|------|------|----------|
| trends | 趋势表 | - |
| hashtags | 标签表 | trend_id → trends |
| contents | 内容表 | trend_id → trends |
| publications | 发布表 | content_id → contents |
| analytics | 分析表 | publication_id → publications, content_id → contents |
| pipeline_runs | Pipeline 运行 | trend_id, content_id, publication_id, analytics_id |
| pipeline_stages | Pipeline 阶段 | run_id → pipeline_runs |
| keywords | 关键词管理 | - |
| schedules | 定时任务 | - |
| drafts | 草稿表 | pipeline_run_id → pipeline_runs |
| xhs_login_metadata | 登录元数据 | - |

**配置**：WAL 模式 + 外键约束 + 16 个索引

---

## 7. 外部服务依赖

| 服务 | 用途 | 配置状态 | 是否付费 |
|------|------|----------|----------|
| TikHub API | 社媒数据 | ✅ 已配置 | 按量付费 |
| Ollama | 本地大模型 | ✅ 已配置 | 免费 |
| 智谱 GLM | LLM 提供商 | ❌ 空 Key | 免费 |
| DeepSeek | LLM 提供商 | ❌ 空 Key | 按量付费 |
| 智谱 CogView-4 | 图片生成 | ❌ 依赖 GLM Key | 免费 |

**LLM 链**：auto 模式 → 智谱 GLM → DeepSeek → Ollama → 模板兜底

---

## 8. 安全机制

| 机制 | 实现 | 配置 |
|------|------|------|
| HTTP 安全头 | helmet | 11 项头（CSP 开发环境禁用） |
| CORS | cors 中间件 | origin: http://localhost:5180 |
| 请求体限制 | express.json | limit: 2mb |
| 写接口限流 | express-rate-limit | 100 次/15 分钟（4 个写接口） |
| API Key 存储 | .env 文件 | .gitignore 排除 |
| 数据库 | better-sqlite3 | WAL 模式 + 外键约束 |

---

## 9. 部署架构

```
start-all-services.ps1
├── content-ops-hub
│   ├── 后端: tsx src/index.ts (port 3100)
│   └── 前端: vite --port 5180
└── skill-ecosystem
    ├── 后端: tsx packages/server/src/index.ts (port 7321)
    └── 前端: vite --port 7173
```

**启动方式**：
- `.\start-all-services.ps1 -All` — 启动全部
- `.\start-all-services.ps1 -Project content-ops-hub` — 单项目启动
- 后端使用 tsx 直接运行 TypeScript，前端使用 Vite 开发服务器

---

## 10. API 路由总览

| 路由前缀 | 文件 | 核心功能 |
|----------|------|----------|
| /api/trends | trend.routes.ts | 趋势 CRUD + 发现 |
| /api/hashtags | hashtag.routes.ts | 标签 CRUD + 研究 |
| /api/contents | content.routes.ts | 内容 CRUD + 生成 |
| /api/publish | publish.routes.ts | 发布 CRUD + 队列 |
| /api/analytics | analytics.routes.ts | 分析 CRUD + 追踪 + 日期范围 |
| /api/pipeline | pipeline.routes.ts | Pipeline 运行 + 暂停/恢复/删除 |
| /api/dashboard | dashboard.routes.ts | 仪表盘统计 |
| /api/xhs | xhs.routes.ts | 小红书工具 |
| /api/radar | radar.routes.ts | 社媒情报（趋势/标签/聆听/竞品） |
| /api/xhs-pipeline | xhs-pipeline.routes.ts | 流水线 + 草稿 + 运行删除 |
| /api/xhs-keywords | xhs-keywords.routes.ts | 关键词 CRUD |
| /api/xhs-schedules | xhs-schedules.routes.ts | 定时任务 CRUD + 触发 |
| /api/xhs-login | xhs-login.routes.ts | 登录状态 + 刷新 + 扫码 |

---

*文档更新日期: 2026-07-21*
