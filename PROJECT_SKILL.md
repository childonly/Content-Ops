# Content Ops Hub - 项目全景说明书

> 生成时间：2026-07-24 | 项目路径：`e:\000 【AI-项目】\Trae_work\content-ops-hub`

## 一、项目定位

**Content Ops Hub** 是一个"趋势驱动内容运营闭环"系统，由 3 个独立项目合并而成：
- **xhs-auto-pipeline**（小红书自动化流水线）
- **social-radar**（社媒情报雷达）
- **skill-ecosystem**（技能生态系统，已作为底座）

核心链路：**趋势发现 → 标签研究 → 内容生成 → 草稿审核 → 发布 → 效果追踪 → 迭代**

## 二、架构概览

```
content-ops-hub/
├── client/                    # Vue 3 前端 (端口 5180)
│   └── src/
│       ├── api/               # Axios API 封装
│       ├── components/        # 组件（含 Vue Flow 流程图）
│       ├── views/             # 12 个页面视图
│       ├── router/            # Vue Router 路由
│       ├── stores/            # Pinia 状态管理
│       └── config/            # 模块-技能映射配置
├── server/                    # Express 后端 (端口 3100)
│   ├── src/
│   │   ├── routes/            # 21 个路由模块
│   │   ├── services/          # 25 个服务层（含 BaseDataService 基类）
│   │   │   └── __tests__/     # 单元测试（Vitest, 106 个用例）
│   │   ├── db/                # SQLite 数据库 (13 张表)
│   │   ├── config/            # 环境变量配置
│   │   ├── types/             # TypeScript 类型定义
│   │   └── utils/             # 工具（日志/缓存/技能桥接）
│   ├── scripts/python/        # Python 脚本（Playwright 搜索/发布/转录）
│   └── data/                  # SQLite 数据库文件
├── package.json               # npm workspaces 根配置
├── .env.example               # 环境变量模板
├── start.bat                  # Windows 一键启动
└── stop.bat                   # 停止服务
```

### 请求流转图

```
浏览器 (localhost:5180)
    │
    ▼ Vue Router → 12 个页面
    │
    ▼ Axios → /api/*
    │
Express 后端 (localhost:3100)
    │
    ├── /api/trends        → trend.service.ts        → TikHub API
    ├── /api/hashtags      → hashtag.service.ts      → TikHub API
    ├── /api/contents      → content.service.ts      → LLM 链(智谱→DeepSeek→Ollama)
    ├── /api/publish       → publish.service.ts      → 小红书发布
    ├── /api/pipeline      → pipeline.service.ts     → 5 步流水线状态机
    ├── /api/radar         → radar-*.service.ts      → TikHub 多平台趋势/竞品/监听
    ├── /api/xhs-pipeline  → xhs-pipeline.service.ts → 小红书自动化流水线
    ├── /api/xhs-data      → xhs-data.service.ts     → TikHub 小红书数据 (继承 BaseDataService)
    ├── /api/youtube-data  → youtube-data.service.ts → TikHub YouTube 数据 (继承 BaseDataService)
    ├── /api/video-alchemist → video-alchemist.service.ts → 视频内容炼金术
    ├── /api/transcriber   → transcriber.service.ts  → faster-whisper 转录
    ├── /api/brainstorming → brainstorming.service.ts → 创意发散-收敛
    ├── /api/memory        → memory-enhancer.service.ts → 历史内容特征注入
    └── /api/skills        → skill.routes.ts         → 技能元数据查询
    │
    ▼
SQLite (content-ops-hub.db, 13 张表)
```

## 三、技术选型

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥18 | 运行时 |
| Express | 4.18 | Web 框架 |
| TypeScript | 5.3 | 类型安全 |
| better-sqlite3 | 11.0 | 嵌入式数据库 |
| Helmet | 8.3 | HTTP 安全头 |
| express-rate-limit | 8.6 | API 限流 |
| node-cron | 3.0 | 定时任务调度 |
| cron-parser | 5.6 | Cron 表达式解析 |
| Winston | 3.11 | 日志 |
| Axios | 1.18 | HTTP 客户端 |
| Vitest | 4.1 | 单元测试 |

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue 3 | 3.4 | UI 框架 |
| Element Plus | 2.5 | UI 组件库 |
| Vite | 5.0 | 构建工具 |
| Pinia | 2.1 | 状态管理 |
| Vue Router | 4.2 | 路由 |
| Vue Flow | 1.48 | 流程图可视化 |
| ECharts | 5.4 | 数据可视化 |
| Axios | 1.6 | HTTP 请求 |
| Day.js | 1.11 | 日期处理 |

### 外部依赖

| 依赖 | 用途 | 配置项 |
|------|------|--------|
| TikHub API | 多平台社媒数据 | `TIKHUB_API_KEY` |
| 智谱 GLM | 内容生成 LLM | `ZHIPU_API_KEY` |
| DeepSeek | 内容生成 LLM（备选） | `DEEPSEEK_API_KEY` |
| Ollama | 本地 LLM 兜底 | `OLLAMA_BASE_URL` |
| 智谱 CogView-4 | AI 图片生成 | 复用 `ZHIPU_API_KEY` |
| Python 3 | Playwright 搜索/发布/转录 | `XHS_PIPELINE_PYTHON_PATH` |

## 四、服务层架构（BaseDataService 设计模式）

### 继承关系

```
BaseDataService (抽象基类)
├── XhsDataService        # 小红书数据服务
└── YoutubeDataService    # YouTube 数据服务
```

### BaseDataService 提供的 8 个共享方法

| 方法 | 可见性 | 用途 |
|------|--------|------|
| `tikhubGet<T>()` | protected | 统一 TikHub API GET 请求（基于 tikhubClient，自带重试/缓存/错误处理） |
| `extractList()` | protected | 从 TikHub 响应中提取列表（兼容 11 种返回格式） |
| `extractBool()` | protected | 从响应中提取布尔值（支持多 key 回退） |
| `extractString()` | protected | 从响应中提取字符串（支持多 key 回退） |
| `extractDetailObject()` | protected | 从详情响应中提取对象（兼容嵌套格式） |
| `safeNumber()` | protected | 安全数字转换（处理 undefined/null/NaN/字符串） |
| `safeString()` | protected | 安全字符串转换 |
| `normalizeDate()` | protected | 标准化日期字符串为 ISO 格式 |

### 设计原则

1. 子类只需实现平台特定的 `normalize` 方法和公开业务方法
2. 所有 TikHub API 调用统一走 `tikhubClient`（不使用裸 fetch）
3. 响应提取方法兼容 TikHub 多种返回格式（数组 / `{data: [...]}` / `{items: [...]}` 等）

### TikHub API 端点映射（2026-07-23 验证）

#### 小红书（XhsDataService）

| 方法 | 端点 | 参数 |
|------|------|------|
| `searchNotes` | `/xiaohongshu/app_v2/search_notes` | `keyword`, `page`, `page_size` |
| `getNoteDetail` | `/xiaohongshu/app_v2/get_image_note_detail` + `get_video_note_detail` | `note_id` |
| `getUserInfo` | `/xiaohongshu/app_v2/get_user_info` | `user_id` |
| `getUserNotes` | `/xiaohongshu/app_v2/get_user_posted_notes` | `user_id`, `cursor` |
| `getNoteComments` | `/xiaohongshu/app_v2/get_note_comments` | `note_id`, `cursor` |

#### YouTube（YoutubeDataService）

| 方法 | 端点 | 参数 |
|------|------|------|
| `searchVideos` | `/youtube/web_v2/get_general_search` | `search_query` |
| `getVideoInfo` | `/youtube/web_v2/get_video_info` | `video_id` |
| `getChannelInfo` | `/youtube/web/get_channel_info` | `channel_id` |
| `getVideoComments` | `/youtube/web_v2/get_video_comments` | `video_id`, `count` |

> 注意：YouTube 搜索参数名是 `search_query`（非 `q`），评论限制参数是 `count`（非 `limit`）

### TikhubClient 核心能力

| 能力 | 说明 |
|------|------|
| Bearer token 认证 | 自动注入 `Authorization: Bearer {apiKey}` |
| 请求重试 | 指数退避（最大 5 秒），4xx 错误不重试 |
| 内存缓存 | GET 请求默认缓存 5 分钟，可配置 TTL |
| 响应数据提取 | 自动从 `{ code: 200, data: ... }` 中提取 `data` |
| 成本估算 | `estimateCost(endpoint, requestPerDay)` |
| 用量查询 | `getDailyUsage()` 查询余额和每日用量 |

## 五、单元测试覆盖

### 测试框架：Vitest 4.1.10

| 测试文件 | 测试用例数 | 覆盖范围 |
|---------|-----------|---------|
| `base-data.service.test.ts` | 48 | extractList (11 种格式)、extractBool (8 场景)、extractString (6 场景)、extractDetailObject (7 场景)、safeNumber (10 输入)、safeString (7 输入)、normalizeDate (6 输入)、tikhubGet (3 场景) |
| `xhs-data.service.test.ts` | 30 | searchNotes (6 场景)、getNoteDetail (4 场景双端点回退)、getUserInfo (3 场景)、getUserNotes (3 场景含 cursor)、getNoteComments (4 场景含子评论)、normalizeNote 边缘用例 (3 场景) |
| `youtube-data.service.test.ts` | 28 | searchVideos (6 场景含 search_query 验证)、getVideoInfo (4 场景)、getChannelInfo (3 场景)、getVideoComments (4 场景含 limit 封顶)、normalizeVideo 边缘用例 (6 场景)、extractThumbnail 优先级 (3 场景) |
| **合计** | **106** | **全部通过** |

### Mock 策略

- Mock `tikhub-client` 模块：验证正确的 API 端点路径和参数
- Mock `logger` 模块：避免 Winston 文件写入问题
- 使用 `vi.hoisted()` 解决 `vi.mock` 提升问题

## 六、数据库结构（13 张表）

| 表名 | 用途 |
|------|------|
| `trends` | 趋势数据 |
| `hashtags` | 标签研究 |
| `contents` | 内容草稿 |
| `publications` | 发布记录 |
| `analytics` | 效果分析 |
| `pipeline_runs` | 流水线运行记录（含 pipeline_type/keyword 等扩展字段） |
| `pipeline_stages` | 流水线阶段记录 |
| `keywords` | 关键词管理 |
| `schedules` | 定时任务 |
| `drafts` | 草稿审核 |
| `xhs_login_metadata` | 小红书登录元数据 |
| `video_alchemist_runs` | 视频炼金术记录 |
| `transcriptions` | 视频转录记录 |

## 七、启动与部署

### 快速启动

```bash
# 1. 安装所有依赖（npm workspaces）
npm install

# 2. 复制环境变量配置
copy .env.example .env
# 编辑 .env 填入 API Key

# 3. 初始化数据库
npm run db:init

# 4. 一键启动前后端
npm run dev
# 或 Windows 下双击 start.bat
```

### 端口分配

| 服务 | 端口 | 启动命令 |
|------|------|----------|
| 后端 API | 3100 | `npm run dev:server` |
| 前端 Web | 5180 | `npm run dev:client` |

### 测试

```bash
cd server
npm test            # 运行所有单元测试
npm run test:watch  # 监听模式
npm run test:coverage  # 覆盖率报告
```

### 健康检查

```
GET http://localhost:3100/health
 → { "status": "ok", "timestamp": "..." }
```

## 八、核心业务流程

### 5 步流水线（Pipeline）

```
1. 趋势发现 (trend_discovery)
   └→ TikHub API 搜索热门趋势

2. 标签研究 (hashtag_research)
   └→ 基于趋势搜索热门标签

3. 内容生成 (content_generation)
   └→ LLM 链: 智谱 GLM → DeepSeek → Ollama → 模板兜底
   └→ CogView-4 生成配图

4. 发布 (publishing)
   └→ 草稿审核 → 确认后发布到小红书

5. 效果追踪 (analytics)
   └→ 采集互动数据 → 计算互动率
```

### 小红书自动化流水线

```
关键词输入 → TikHub API 搜索笔记 → LLM 生成草稿 → 草稿审核 → 发布
     ↑                                                        │
     └──── 定时任务 (node-cron) ←──────────────────────────────┘
```

### LLM 多提供商链

```
auto 模式（按序尝试）:
  智谱 GLM-4.7-flash (免费, 128K 上下文)
    ↓ 失败
  DeepSeek V4-flash ($0.14/1M input)
    ↓ 失败
  Ollama qwen2.5-coder:14b (本地兜底)
    ↓ 失败
  模板生成 (确定性回退)
```

## 九、路由清单（21 个路由模块）

| 路由前缀 | 路由文件 | 功能 |
|---------|---------|------|
| `/api/trends` | trend.routes.ts | 趋势发现与管理 |
| `/api/hashtags` | hashtag.routes.ts | 标签研究 |
| `/api/contents` | content.routes.ts | 内容生成与管理 |
| `/api/publish` | publish.routes.ts | 发布管理 |
| `/api/analytics` | analytics.routes.ts | 数据分析 |
| `/api/pipeline` | pipeline.routes.ts | 5 步流水线 |
| `/api/dashboard` | dashboard.routes.ts | 仪表盘聚合 |
| `/api/xhs` | xhs.routes.ts | 小红书通用 |
| `/api/radar` | radar.routes.ts | 社媒情报中心 |
| `/api/xhs-pipeline` | xhs-pipeline.routes.ts | 小红书自动化流水线 |
| `/api/xhs-keywords` | xhs-keywords.routes.ts | 关键词管理 |
| `/api/xhs-schedules` | xhs-schedules.routes.ts | 定时任务管理 |
| `/api/xhs-login` | xhs-login.routes.ts | 小红书登录管理 |
| `/api/skills` | skill.routes.ts | 技能元数据查询 |
| `/api/brainstorming` | brainstorming.routes.ts | 创意发散-收敛 |
| `/api/memory` | memory.routes.ts | 记忆增强 |
| `/api/xhs-data` | xhs-data.routes.ts | 小红书数据（TikHub） |
| `/api/youtube-data` | youtube-data.routes.ts | YouTube 数据（TikHub） |
| `/api/video-alchemist` | video-alchemist.routes.ts | 视频内容炼金术 |
| `/api/transcriber` | transcriber.routes.ts | 视频转录 |
| `/api` | proxy.routes.ts | 网关状态检查 |

## 十、前端页面清单（12 个视图）

| 路由路径 | 组件 | 功能 |
|---------|------|------|
| `/dashboard` | Dashboard.vue | 仪表盘总览 |
| `/trends` | TrendResearch.vue | 趋势发现 |
| `/hashtags` | HashtagResearch.vue | 标签研究 |
| `/content` | ContentStudio.vue | 内容工作室 |
| `/publish` | PublishQueue.vue | 发布队列 |
| `/analytics` | Analytics.vue | 数据分析 |
| `/pipeline` | PipelineView.vue | 闭环管理 |
| `/xhs-pipeline` | XhsPipelineView.vue | 小红书流水线 |
| `/draft-review` | DraftReview.vue | 草稿审核 |
| `/radar` | RadarView.vue | 社媒情报中心 |
| `/video-alchemist` | VideoAlchemistView.vue | 视频炼金术 |
| `/transcriber` | TranscriberView.vue | 视频转录 |

## 十一、特殊配置与注意事项

1. **TikHub API 端点**: 中国大陆使用 `api.tikhub.dev`，海外使用 `api.tikhub.io`
2. **LLM 多提供商链**: `auto` 模式按序尝试：智谱（免费）→ DeepSeek（低成本）→ Ollama（本地兜底）→ 模板
3. **dotenv override**: 配置加载使用 `override: true`，防止系统环境变量覆盖 `.env`
4. **SQLite WAL 模式**: 数据库启用 WAL 日志模式，支持并发读
5. **Python 脚本**: `xhs-search-edge.py` 需要 Edge 浏览器和 Cookie 文件
6. **CORS**: 仅允许 `http://localhost:5180` 前端访问
7. **限流**: 写接口限制 100 次/15 分钟（pipeline/run, publish/execute, xhs-pipeline/start 等）
8. **图片生成**: 默认使用智谱 CogView-4，与 GLM 共享 API Key
9. **TikHub 端点验证**: 所有 TikHub API 端点已通过 `get_all_endpoints_info` 接口验证（2026-07-23）
10. **getNoteDetail 双端点回退**: 图文笔记端点失败时自动尝试视频笔记端点

## 十二、安全注意事项

| 风险等级 | 事项 | 建议 |
|---------|------|------|
| 中 | `child_process.exec` 用于打开技能文件夹 | 确保路径参数不来自用户输入 |
| 中 | SQL 动态拼接 `updates.join(', ')` | 列名来自代码内部，但应加入白名单校验 |
| 低 | Helmet CSP 在开发环境禁用 | 生产环境必须启用 CSP |
| 低 | 未配置 HTTPS | 生产环境需通过 Nginx 反向代理启用 TLS |
| 低 | `.env` 文件含 API 密钥 | 确认 `.gitignore` 已排除 `.env` |

## 十三、关键文件索引

| 文件 | 职责 |
|------|------|
| `server/src/index.ts` | 后端入口，启动 HTTP + 调度器 + 登录监控 |
| `server/src/app.ts` | Express 应用创建，21 个路由注册 |
| `server/src/config/index.ts` | 所有环境变量配置集中管理 |
| `server/src/db/index.ts` | SQLite 连接 + 13 张表 DDL + 迁移 |
| `server/src/services/tikhub-client.ts` | TikHub API 客户端（重试/缓存/错误处理/成本控制） |
| `server/src/services/base-data.service.ts` | 数据服务抽象基类（8 个共享方法） |
| `server/src/services/xhs-data.service.ts` | 小红书数据服务（继承 BaseDataService） |
| `server/src/services/youtube-data.service.ts` | YouTube 数据服务（继承 BaseDataService） |
| `server/src/services/llm-service.ts` | LLM 多提供商链 |
| `server/src/services/pipeline.service.ts` | 5 步流水线状态机 |
| `server/src/services/scheduler.service.ts` | node-cron 定时任务调度 |
| `server/src/services/xhs-login.service.ts` | 小红书登录状态监控 |
| `server/src/services/video-alchemist.service.ts` | 视频内容炼金术 |
| `server/src/services/transcriber.service.ts` | faster-whisper 视频转录 |
| `server/vitest.config.ts` | Vitest 测试配置 |
| `server/src/services/__tests__/` | 单元测试目录（3 个文件, 106 个用例） |
| `client/src/router/index.ts` | 前端路由（12 个页面） |
| `client/src/config/moduleConfigs.ts` | 模块-技能映射配置 |
| `client/src/components/flow/` | Vue Flow 流程图组件 |
| `server/scripts/python/xhs-search-edge.py` | Playwright 小红书搜索（Edge） |
| `server/scripts/python/custom_publish.py` | 小红书长文发布 |
| `server/scripts/python/transcribe.py` | faster-whisper 转录脚本 |
