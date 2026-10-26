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
