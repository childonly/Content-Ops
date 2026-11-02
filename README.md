# Content Ops Hub - 趋势驱动内容运营闭环

> 趋势发现 → 标签研究 → 内容生成 → 发布 → 效果追踪 → 迭代优化

## 项目概述

Content Ops Hub 是一个内容运营自动化平台，通过编排多个社媒技能（Skill），实现从趋势发现到内容发布再到效果追踪的完整闭环。

### 核心闭环

```
┌─────────────────────────────────────────────────────────┐
│                    内容运营闭环                          │
│                                                         │
│  1. 趋势发现          trend-research                     │
│     ↓                   (发现热门话题)                    │
│  2. 标签研究          hashtag-research                   │
│     ↓                   (研究热门标签)                    │
│  3. 内容生成          xhs-content                        │
│     ↓                   (生成小红书笔记)                  │
│  4. 发布执行          xiaohongshu-skill                   │
│     ↓                   (发布到小红书)                    │
│  5. 效果追踪          creator-analytics                  │
│     ↓                   (追踪互动数据)                    │
│  6. 迭代优化          ← 数据反馈到趋势发现                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | Node.js + TypeScript + Express | RESTful API 服务 |
| 前端 | Vue 3 + TypeScript + Vite | SPA 单页应用 |
| UI库 | Element Plus | 组件库 |
| 数据库 | SQLite (better-sqlite3) | 轻量级本地存储 |
| 图表 | ECharts | 数据可视化 |
| 状态管理 | Pinia | Vue 状态管理 |

## 项目结构

```
content-ops-hub/
├── package.json              # 工作区根配置
├── server/                   # 后端服务
│   ├── src/
│   │   ├── config/           # 配置管理
│   │   ├── db/               # 数据库初始化
│   │   ├── routes/           # API 路由
│   │   ├── services/         # 业务服务
│   │   ├── types/            # 类型定义
│   │   └── utils/            # 工具函数 (Skill Bridge)
│   └── data/                 # SQLite 数据库文件
├── client/                   # 前端应用
│   ├── src/
│   │   ├── api/              # API 请求封装
│   │   ├── components/       # 公共组件
│   │   ├── layouts/          # 布局组件
│   │   ├── router/           # 路由配置
│   │   ├── stores/           # Pinia 状态管理
│   │   ├── styles/           # 全局样式
│   │   ├── types/            # 前端类型定义
│   │   └── views/            # 页面视图
│   └── vite.config.ts
└── .trae/
    └── rules/
        └── project-rules.md  # 项目规则
```

## 快速开始

### 当前运行与收口说明（2026-11-02）

- 使用 Node.js 22（本机验证 22.23.1，见 `.nvmrc`）。在根目录双击 `start.bat`，或执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-services.ps1`；单独启动可加 `-BackendOnly` / `-FrontendOnly`。
- 工作台：[http://127.0.0.1:5180/workspace](http://127.0.0.1:5180/workspace)；后端健康检查：[http://127.0.0.1:3100/health](http://127.0.0.1:3100/health)；运行依赖诊断：[runtime diagnostics](http://127.0.0.1:3100/api/runtime/diagnostics)。日志见 `logs/*-node22.*.log`。
- 已有数据库日常启动无需再次初始化。迁移只增加字段/表，迁移前通过 SQLite 一致性快照备份 WAL 内容；备份失败会中止迁移。恢复应先在隔离副本验证，不覆盖现有业务库。
- 未配置 `.env` 时复制根 `.env.example` 到 `server/.env` 并填写本机配置；不要提交凭据、Cookie、数据库或生成文件。
- 小红书发布需要独立安装 `xiaohongshu-skill`，安装步骤见[上游安装文档](https://github.com/DeliciousBuding/xiaohongshu-skill/blob/main/docs/INSTALL.md)。设置 `XHS_SKILL_PATH` 为实际目录；可通过 `XHS_PIPELINE_PYTHON_PATH` 指定 Python。路径发现会跳过失效路径和 Windows Store alias。安装、依赖、登录和真实发布应分步验证；没有 Skill 时诊断明确报告缺失。
- 真实效果追踪要求已发布的小红书 canonical 笔记 URL 及可用 TikHub 权限；未提供的指标显示缺失，历史来源标为 unknown，模拟数据不混入实测统计。
- 项目节点后台任务可关闭重开后恢复查看。发布节点只生成待发布记录，不自动发帖；在发布列表显式发布取得真实 URL 后，才能返回确认并进入分析。
- 默认只监听 `127.0.0.1`。若显式设置 `CONTENT_OPS_HOST` 为非回环地址，必须设置 `CONTENT_OPS_API_TOKEN`；API 客户端携带 `Authorization: Bearer <token>`。公网部署还需要独立完成 TLS、账号权限、网络访问控制验收。
- 验证：Node 22 环境运行 `npm run check`（台账、真实 lint、服务端/前端测试、构建、隔离数据库 API 冒烟）；`npm run test:cards` 运行 8 主题×4 分页模式实渲染。测试产物在忽略的 `logs/` 下；不会对外发布或删除业务库。
- `.github/workflows/quality.yml` 已加入检查与卡片矩阵；远端 Actions/required checks 实际生效状态以台账取证为准。完整实施与剩余人工验收见 [统一台账](docs/DEVELOPMENT-LEDGER.md)。

### 1. 安装依赖

```bash
cd content-ops-hub
npm install
```

### 2. 初始化数据库

```bash
npm run db:init
```

### 3. 启动开发服务器

```bash
npm run dev
```

- 后端 API: http://localhost:3100
- 前端页面: http://localhost:5180

### 4. 构建生产版本

```bash
npm run build
```

## 技能编排架构

项目通过 **Skill Bridge** 模式抽象技能调用，支持以下技能：

| 技能 | 阶段 | 说明 |
|------|------|------|
| `trend-research` | 趋势发现 | 发现 TikTok/抖音/Twitter 等平台热门趋势 |
| `hashtag-research` | 标签研究 | 研究标签热度和相关标签 |
| `xhs-content` | 内容生成 | 生成小红书风格的图文笔记 |
| `xiaohongshu-skill` | 发布执行 | 通过 Playwright 发布到小红书 |
| `creator-analytics` | 效果追踪 | 分析创作者数据表现 |

### Skill Bridge 模式

```typescript
// 技能调用接口
interface SkillBridge {
  invoke<T>(skillName: string, params: SkillParams): Promise<SkillResult<T>>;
}

// 默认使用 MockSkillBridge (返回模拟数据)
// 可切换为 TraeSkillBridge (通过 MCP/CLI 调用真实技能)
```

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/trends` | 获取趋势列表 |
| POST | `/api/trends/discover` | 发现新趋势 |
| GET | `/api/hashtags` | 获取标签列表 |
| POST | `/api/hashtags/research` | 研究标签 |
| GET | `/api/contents` | 获取内容列表 |
| POST | `/api/contents/generate` | 生成内容 |
| GET | `/api/publish` | 获取发布队列 |
| POST | `/api/publish/execute` | 执行发布 |
| GET | `/api/analytics` | 获取分析数据 |
| POST | `/api/analytics/track` | 追踪效果 |
| GET | `/api/pipeline` | 获取 Pipeline 状态 |
| POST | `/api/pipeline/run` | 启动 Pipeline |
| POST | `/api/pipeline/stage/:stage/next` | 推进到下一阶段 |

## License

MIT
