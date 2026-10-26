# Content Ops Hub - 项目规则

## 项目概述

趋势驱动内容运营闭环平台，编排 5 个社媒技能实现从趋势发现到效果追踪的完整闭环。

## 技术栈约束

- **后端**: Node.js 18+ / TypeScript / Express / better-sqlite3
- **前端**: Vue 3 (Composition API, `<script setup>`) / TypeScript / Element Plus / Vite
- **数据库**: SQLite (better-sqlite3 同步 API)
- **包管理**: npm workspaces (根目录统一管理)

## 代码规范

### TypeScript
- 严格模式 (strict: true)
- 所有函数和接口必须有明确返回类型和参数类型
- 优先使用 interface 定义对象类型，type 定义联合类型
- 禁止使用 `any`，确需使用时用 `unknown` + 类型守卫

### 后端 (server/)
- Express 路由使用 `express.Router()` 模块化
- 数据库查询使用参数化绑定 (`?` 占位符)，禁止字符串拼接 SQL
- JSON 字段读取时 `JSON.parse()`，写入时 `JSON.stringify()`
- 服务层返回业务对象，路由层包装为 `ApiResponse<T>`
- 日志使用 `createServiceLogger(serviceName)` 创建独立日志器
- 错误处理：路由层 try/catch，返回 `{ success: false, error: string }`

### 前端 (client/)
- Vue 3 `<script setup lang="ts">` 语法
- Composition API (ref, reactive, computed, onMounted)
- Element Plus 完整引入，不需要按需导入
- API 调用通过 `@/api` 统一封装
- 状态管理使用 Pinia (`@/stores`)
- 类型从 `@/types` 导入
- 图表使用 vue-echarts `<v-chart>` 组件

### Skill Bridge 模式
- 默认使用 MockSkillBridge (模拟数据)，设置 `SKILL_BRIDGE_MODE=mock`
- 对接真实技能时设置 `SKILL_BRIDGE_MODE=trae`，需配置对应 API Key
- 新增技能时在 `server/src/types/index.ts` 的 `SkillName` 类型中添加
- 在 `server/src/utils/skill-bridge.ts` 的 MockSkillBridge 中添加对应 mock 数据
- 在 PIPELINE_STAGES 常量中配置阶段信息

## 目录结构约定

```
server/src/
├── config/          # 配置
├── db/              # 数据库数据库初始化和连接
├── routes/          # Express 路由 (每个模块一个文件)
├── services/        # 业务逻辑 (每个技能一个 service)
├── types/           # 类型定义
└── utils/           # 工具 (logger, skill-bridge)

client/src/
├── api/             # API 请求封装
├── components/      # 公共组件
├── layouts/         # 布局组件
├── router/          # 路由配置
├── stores/          # Pinia 状态管理
├── styles/          # 全局样式
├── types/           # 前端类型定义
└── views/           # 页面视图
```

## Pipeline 阶段流转规则

1. **TREND_DISCOVERY** → 调用 `trend-research` 技能 → 产出 trendId
2. **HASHTAG_RESEARCH** → 调用 `hashtag-research` 技能 → 产出 hashtagIds
3. **CONTENT_GENERATION** → 调用 `xhs-content` 技能 → 产出 contentId
4. **PUBLISHING** → 调用 `xiaohongshu-skill` 技能 → 产出 publicationId
5. **PERFORMANCE_TRACKING** → 调用 `creator-analytics` 技能 → 产出 analyticsId
6. **ITERATION** → 标记完成，数据反馈到下一轮趋势发现

- 每个阶段执行前状态改为 `running`，成功后 `completed`，失败 `failed`
- 失败时 Pipeline 运行状态改为 `failed`，可手动重试
- `startPipeline` 传入 `trendId` 时跳过 `TREND_DISCOVERY` 阶段

## 常用命令

```bash
# 安装依赖
npm install

# 初始化数据库
npm run db:init

# 开发模式 (前后端同时启动)
npm run dev

# 单独启动后端
npm run dev:server

# 单独启动前端
npm run dev:client

# 构建
npm run build
```

## 数据库表命名

- 表名：复数形式，snake_case (trends, hashtags, contents, publications, analytics)
- 列名：snake_case (trend_id, growth_rate, published_at)
- TypeScript 对象：camelCase (trendId, growthRate, publishedAt)
- 转换在 service 层的 `mapRow` 函数中完成

## API 路由规范

- 所有 API 路径以 `/api/` 开头
- 分页参数：`page` (从1开始), `pageSize` (默认10)
- 响应格式：`{ success: boolean, data?: T, error?: string }`
- 分页响应：`{ success: boolean, data: T[], total: number, page: number, pageSize: number }`
- 创建资源用 POST，更新用 PUT/PATCH，查询用 GET

## 统一台账与共同维护（强制）

- 所有开发/审计任务启动前**必须先读**统一台账 `docs/DEVELOPMENT-LEDGER.md`（§3 快照 → §4 待办 → §7 窗口登记）。
- 修改产品代码前须建立/更新稳定 Task ID 与精确 Modification Scope；更新台账前重读分支/HEAD、git status、canonical source、当前测试与失败证据。
- 普通任务不得另建 progress/handoff/task-board 文件，统一写入台账。
- 台账更新不扩大产品代码修改权限；未执行测试不得写 PASS。
- 门禁：`npm run ledger:check`（结构检查）与 `npm run ledger:validate`（含正/负例自检）。
- 所有共同维护规则的权威定义见根 `AGENTS.md`。
