# 变更日志 (CHANGELOG)

本项目所有重要变更均记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [2026-07-21] 审计修复 + 功能增强

### 新增
- **DELETE API**: 为 7 个资源添加删除操作（趋势/内容/发布/分析/Pipeline运行/草稿/流水线运行）
  - `DELETE /api/trends/:id` — 删除趋势
  - `DELETE /api/contents/:id` — 删除内容
  - `DELETE /api/publish/:id` — 删除发布记录
  - `DELETE /api/analytics/:id` — 删除分析记录
  - `DELETE /api/pipeline/:id` — 删除 Pipeline 运行（含阶段记录）
  - `DELETE /api/xhs-pipeline/drafts/:id` — 删除草稿
  - `DELETE /api/xhs-pipeline/runs/:id` — 删除流水线运行（含关联草稿）
- **日期范围查询**: 分析模块新增 `GET /api/analytics/date-range` 端点，支持按日期范围筛选数据
- **CSV 导出**: Analytics 页面新增导出 CSV 功能，支持 BOM 头中文显示
- **日期筛选 UI**: Analytics 页面新增日期范围选择器（el-date-picker），支持切换默认分页/日期筛选模式
- **删除按钮**: Analytics 表格新增删除操作列

### 重构
- **advanceStage 策略模式**: 将 178 行单体函数拆分为 6 个独立阶段处理器 + DB 辅助函数
  - 提取 `StageContext` 接口统一管理阶段产出
  - 每个阶段一个 handler 函数（`handleTrendDiscovery` / `handleHashtagResearch` 等）
  - 提取 `markStageStatus` 辅助函数统一处理阶段状态更新
  - `STAGE_HANDLERS` 映射表实现策略模式分发
- **API 层补全**: 前端 API 封装层新增 5 个 delete 方法（trends/contents/publish/analytics/pipeline）

### 文档
- 新建 `CHANGELOG.md` 变更日志
- 新建 `ARCHITECTURE.md` 架构文档

---

## [2026-07-19] 三项目合并完成

### 重大变更
- **三项目合并**: xhs-auto-pipeline + social-radar → content-ops-hub
- **统一端口**: 后端 3100 + 前端 5180（核心服务仅 2 个端口）
- **端口变化**: 9 → 5（停止 3000/3002/5182/8000）
- **统一数据库**: content-ops-hub.db（11 张表）
- **技术栈**: 后端 Express + TypeScript + better-sqlite3，前端 Vue 3 + Element Plus + Vite

### 迁移
- xhs-auto-pipeline: 7 个服务(Python→TS) + 4 routes
- social-radar: 5 个服务(Koa→Express) + radar.routes.ts
- 数据迁移: 1 keyword + 2 schedules + 10 runs + 24 drafts

---

## [2026-07-21] 安全审计修复（前一轮）

### 安全
- 添加 `helmet` 安全中间件（11 项 HTTP 安全头）
- 添加 `express-rate-limit` 写接口限流（100 次/15 分钟）
- 降低请求体大小限制 10mb → 2mb

### 性能
- 修复 N+1 查询：pipeline.service.ts 批量 IN 查询 + Map 分组
- 提取 `PYTHON_MAX_BUFFER` 常量，消除 9 处魔法数字

### 代码质量
- 安装缺失依赖 `cron-parser`
- 卸载死依赖 `zod` / `http-proxy-middleware`
- 修复同步 I/O：`readFileSync` → `fs.promises.readFile`（2 处）
- 修复 `ModuleNode.vue` 3 项部分实现（radar API 调用 / xhs pipeline 启动 / 登录状态加载）
