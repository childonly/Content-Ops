# 统一开发台账 (Unified Development Ledger)

> 本文件是 content-ops-hub 项目唯一的 operational status index（当前进度权威索引）。
> 架构定义、数据契约、Canonical Owner、Required Tests、工程债正式状态、发布规则、安全规则、产品规格一律由各自 canonical 文档负责，本台账只放链接和一句摘要。
> 台账本身**不授予**任何产品代码修改权限。

- 仓库根目录：`E:\000 【AI-项目】\Trae_work\content-ops-hub`
- 本台账路径：`docs/DEVELOPMENT-LEDGER.md`
- 创建日期：2026-09-10

---

## 1. 快速导航

| 角色 | 推荐阅读顺序 |
|------|-------------|
| 项目负责人 | §3 快照与警报 → §4 待办 → §6 进度表 → §5 证据 → §10 路径 |
| 开发/审计任务窗口 | §3 → §4 → §7 窗口登记 → §2 状态口径 → 相关 canonical 文档 |
| 集成/发布负责人 | §3 → §6 → §5 → §10 发布路径 → 发布的 canonical 文档 |
| 新加入的开发窗口 | §2 状态口径 → §4 → §7 → §9 最近审计 → canonical 文档 → 项目规则入口 |

---

## 2. 使用规则与状态口径

### 2.1 状态定义

| 状态标记 | 含义 |
|----------|------|
| `☑ ✅ CLOSED` | 整个 Task ID 满足销项条件，已关闭，永久保留 |
| `☐ 🟦 ACTIVE` | 正在实施中 |
| `☐ 🟨 PENDING` | 范围/Owner/依赖已确认，尚未开始实施 |
| `☐ ⛔ BLOCKED` | 被外部条件、依赖或未授权范围阻塞 |
| `☐ ❄️ FROZEN` | 冻结，不推进、不评分 |
| `☐ 🗑️ RETIREMENT_CANDIDATE` | 退役候选，等待明确裁决 |
| `N/A` | 冻结、未启动或不适用的事项，不作为完成 |

### 2.2 进度条统一口径

| 进度 | 含义 |
|------|------|
| 0% | 未启动 |
| 25% | 范围、Owner、依赖已确认 |
| 50% | 实施中 |
| 75% | 实现完成但验证未闭合 |
| 90% | 仅余人工验收、外部条件、集成或接力 |
| 100% | 满足整个 Task ID 的销项条件 |

> 冻结/未启动/不适用一律写 `N/A`，**不得伪装成完成**。

### 2.3 字段铁律

- Task ID 稳定，不因对话窗口变化改名。
- 完成时间只有整个 Task ID 为 `CLOSED` 时才填写；否则写 `—`（未启动写 `—（未启动）`）。
- 历史任务只有日期证据时只写日期，不猜时分。
- 任务接力窗口必须明确下一位接手者；完全销项写 `无（完全销项）`。
- 已关闭任务永不删除。
- 新回归不直接重开旧任务，说明重开依据或建新 Task ID。

---

## 3. 当前项目快照与警报

- **审计时间**：2026-09-20（独立审计 + 进度校正）(+08:00, Asia/Shanghai)
- **分支**：`UNVERIFIED`（非 git 仓库，无分支概念）
- **HEAD / commit**：`UNVERIFIED`（`git rev-parse` 返回 `fatal: not a git repository`）
- **git status**：`UNVERIFIED`（无 git 基线，无法生成 tracked/untracked 统计）
- **dirty worktree**：无法判定（无 `.git`）
- **路径事实（已验证，2026-09-20 审计）**：
  - 后端：`server/src/services/` 37 个服务文件（含 6 个测试），`server/src/routes/` 32 个路由
  - 前端：`client/src/views/` 16 个视图，`client/src/components/` 11 个组件（含 `flow/` 子目录 6 个）
  - **COH-005/006/007 代码真实存在**：WorkspaceView.vue (425行)、ProjectNodeWorkbench.vue (165行)、ProjectWorkflowCanvas.vue、project-workflow.service.ts (470行)、project-workflow.routes.ts、ContentStudio.vue (2579行)、moduleConfigs.ts (747行)、MainLayout.vue (563行) — 均为实测文件与行数
  - 权威文档：`README.md`、`ARCHITECTURE.md`、`CHANGELOG.md`（最新条目 2026-07-21）、`DATA_PROTECTION_RULES.md`
  - 根规则：`AGENTS.md`；无 `CLAUDE.md`、无 `.cursor/`、无 `.github/`
  - 历史规划：`docs/superpowers/plans/`、`docs/superpowers/specs/`（7 份 plan+spec，2026-07-30 ~ 08-02）
  - 测试：`server/src/services/__tests__/` 共 6 个 vitest 测试文件 / 116 用例（2026-09-19 全量重跑：116/116 通过，当前 PASS 基线）；无根级/前端测试脚本
  - `lint` 为占位符 `echo 'Add linter config'`
  - 门禁：`scripts/check-ledger.js`（章节匹配兼容 + `--test` 自检，正/负例 5/5 通过）；根 `package.json` 暴露 `ledger:check`/`ledger:validate`
- **当前最高优先级风险**：
  - [高风险] 项目无 git 基线，任何修改无法做版本回滚、归属追踪、审计取证。
  - [高风险] 无 CI / Branch Protection，治理门禁未托管端生效。
  - [中风险] 无远端/CI 平台，`ledger:validate` 仅能作为本地人工门禁。
- **并行修改冲突**：无已知并行窗口；台账由治理窗口持续维护。
- **外部环境阻塞**：无 git 远端、无 CI 平台、无 GitHub 仓库存在证据。
- **冻结/退役边界**：目前无 FROZEN / RETIREMENT_CANDIDATE 项。
- **尚未认领的代码范围**：COH-005/006/007 代码**真实存在**（非仅有文档），但无法从文件确认归属哪个开发窗口，继续标记"待原窗口认领"；`docs/superpowers/` 下历史计划归属未知。

---

## 4. 待办事项列表

| Task ID | 建立时间 | 完成时间 | 任务 | 进度 | 当前状态 / 正在做什么 | 开发受限或停止原因 | 负责人 | 任务接力窗口 |
|---------|----------|----------|------|------|------------------------|---------------------|--------|--------------|
| COH-001 | 2026-07-18 | — | 内容运营闭环核心（趋势→标签→内容→发布→效果→迭代） | 75% | 🟨 历史实现已完成，但验证未闭合 | 实现完成；需当前代码重跑最小验证 | 原窗口（历史） | 待当前窗口认领验证 |
| COH-002 | 2026-07-18 | — | 生产配置启用（TikHub/SkillBridge/小红书登录） | 75% | 🟨 已配置 .env 与 skill-bridge | 需在真实环境复核 API 连通 | 原窗口（历史） | 集成/发布负责人 |
| COH-003 | 2026-07-19 | — | 三项目合并为统一平台（30+ 路由合并） | 90% | 🟦 合并已完成，仅余收尾验证 | — | 原窗口（历史） | 无（合并主体已销项，待独立审计确认） |
| COH-004 | 2026-07-21 | 2026-07-21 | 审计修复（DELETE API/日期范围/CSV/ADVANCE 策略模式） | 100% | ✅ CLOSED | 历史销项于 CHANGELOG | 原窗口（历史） | 无（完全销项） |
| COH-005 | 2026-07-30 | — | 双工作区/深色主题/项目节点工作台 | 75% | 🟨 代码真实存在（WorkspaceView 425行、ProjectNodeWorkbench 165行等），但归属未知，验证未闭合 | 实现存在但无法确认完成度；无对应测试 | 待原窗口认领 | 待原窗口认领 |
| COH-006 | 2026-08-01 | — | Content Studio 节点工作流 / 单工作区 | 75% | 🟨 代码真实存在（ContentStudio 2579行、moduleConfigs 747行），但归属未知，验证未闭合 | 同上 | 待原窗口认领 | 待原窗口认领 |
| COH-007 | 2026-08-02 | — | Project Node Workbench | 75% | 🟨 代码真实存在（project-workflow.service 470行 + 路由 + 前端组件），但归属未知，验证未闭合 | 同上 | 待原窗口认领 | 待原窗口认领 |
| COH-GOV-001 | 2026-09-10 | — | 建立统一开发台账与跨任务窗口共同维护机制 | 90% | 🟦 台账/规则/门禁已建立；COH-GOV-002 已完成复审计与门禁补全，仅余人工验收 | 需用户确认台账口径与门禁接入 | 治理窗口（COH-GOV-001） | COH-GOV-002 复审计 → COH-GOV-003 接力 → COH-GOV-004 校正 → 项目负责人（验收） |
| COH-GOV-002 | 2026-09-19 | — | 治理机制独立复审计 + 门禁正/负例自检补全与全量验证 | 90% | 🟦 独立审计完成、门禁修复并全量验证通过，仅余人工验收 | — | 治理窗口（COH-GOV-002） | COH-GOV-003 接力 → COH-GOV-004 校正 → 项目负责人（验收） |
| COH-GOV-003 | 2026-09-19 | — | 台账接力维护与跨会话上下文同步 | 90% | 🟦 承接 COH-GOV-002 结论，同步台账并登记本窗口任务，仅余人工验收 | — | 治理窗口（COH-GOV-003） | COH-GOV-004 校正 → 项目负责人（验收） |
| COH-GOV-004 | 2026-09-20 | — | 台账进度校正（基于真实代码）+ 强制阅读规则强化 | 90% | 🟦 独立审计发现 COH-005/006/007 代码真实存在；进度校正完成；AGENTS.md 硬性铁律已加，仅余人工验收 | — | 治理窗口（COH-GOV-004） | 项目负责人（验收 COH-GOV-001~004） |
| COH-GOV-005 | 2026-09-21 | — | Auto-Redbook-Skills 集成可行性研究 | 25% | 🟨 范围/Owner/依赖已确认；完成对比分析与集成方案建议 | 待用户确认集成路线后进入实施 | 治理/研究窗口 | 项目负责人（确认路线）→ 实施窗口（开发） |
| COH-008 | 2026-09-22 | — | Auto-Redbook 卡片渲染引擎集成（阶段一+二） | 90% | 🟩 阶段一完成：card-render.service.ts 真实 Playwright 渲染引擎（8主题+4分页）、AutoRedbookEngine 替换、路由注册；阶段二完成：pipeline-enhancer 升级为真实卡片生成；前端完成：图片工作室 UI 接入 Auto-Redbook 选项；后端编译通过；116 测试全通过 | 待端到端联调验证；待人工验收 | 本窗口（实施） | 项目负责人（验收） |

> 说明：COH-001/002 的历史完成度来自旧交接摘要，仅作**历史证据**，非当前 PASS。当前验证状态见 §5/§6。

---

## 5. 修改范围、影响与销项证据

| Task ID | 涉及代码/模块 | 可能影响 | 完成所需极简证据 | 其他提醒 |
|---------|---------------|----------|------------------|----------|
| COH-001 | server 核心闭环（trend/hashtag/content/publish/analytics/pipeline 服务与路由） | 平台主功能 | 5 个服务 vitest 通过；最小 API 冒烟；人工验收 | 历史证据；需当前代码重跑 |
| COH-002 | server/.env、config、skill-bridge.ts、xhs 路由 | 外部 API 连通 | TikHub 连通测试、小红书登录 check-login | 需真实环境复核 |
| COH-003 | 三合并后的整体 server/ 与 client/ | 全平台行为 | 全仓 build、回归通过 | 无 git 无从 diff 归属 |
| COH-004 | DELETE 系列、analytics date-range、CSV、advanceStage 重构 | 审计/数据管理 | 已在 CHANGELOG 2026-07-21 记录；历史证据 | 无需重跑（已销项，仅存证） |
| COH-005 | WorkspaceView.vue (425行)、MainLayout.vue (563行)、深色主题相关样式、docs/superpowers 计划与规格 | 桌面/工作区/主题 | UNVERIFIED — 代码存在但无测试、无人工验收证据；归属未知 | 待原窗口认领；进度从 50% 校正为 75%（实现存在，验证未闭合） |
| COH-006 | ContentStudio.vue (2579行)、moduleConfigs.ts (747行)、FlowHome.vue、ModuleNode.vue | 内容工作室/节点工作流 | UNVERIFIED — 代码存在但无对应测试、无人工验收证据；归属未知 | 待原窗口认领；进度从 50% 校正为 75% |
| COH-007 | project-workflow.service.ts (470行)、project-workflow.routes.ts、ProjectNodeWorkbench.vue (165行)、ProjectWorkflowCanvas.vue、ProjectResultNode.vue | 项目工作台/节点编排 | UNVERIFIED — 代码存在但无对应测试、无人工验收证据；归属未知 | 待原窗口认领；进度从 50% 校正为 75% |
| COH-GOV-001 | docs/DEVELOPMENT-LEDGER.md、AGENTS.md、.trae/rules、scripts/check-ledger.js、根 package.json scripts | 治理/规则/门禁 | 台账结构检查、正/负例测试、git diff --check | 2026-09-10 建立；2026-09-19 由 COH-GOV-002 复核 |
| COH-GOV-002 | scripts/check-ledger.js（修复章节匹配缺陷 + 新增 --test 自检）、docs/DEVELOPMENT-LEDGER.md（§3/§4/§5/§6/§7/§8/§9 更新） | 治理/规则/门禁 | ledger:validate 自检 5/5 通过；ledger:check 10 章节 + 5 表通过；server vitest 6 文件 116/116 通过（当前基线） | 未修改任何产品代码；快照计数已更正（视图 16、测试 6 文件/116 用例） |
| COH-GOV-003 | docs/DEVELOPMENT-LEDGER.md（§3/§4/§5/§6/§7/§8 行级更新，登记本窗口任务与接力关系） | 治理/规则/台账 | ledger:check 通过；未修改任何产品代码 | 纯台账维护，不涉及产品功能；承接 COH-GOV-002 结论 |

---

## 6. 开发进度表

| 模块 | 当前里程碑进度 | 关联 Task ID | 状态 | 受限原因 | 提醒 |
|------|----------------|--------------|------|----------|------|
| 内容运营核心闭环 | 75%（实现完成，验证未闭合） | COH-001 | 🟨 | 验证未闭合 | 模块整体不因个别测试 PASS 视为全绿 |
| 生产配置与外部集成 | 75% | COH-002 | 🟨 | 需真实环境 | — |
| 合并后平台整体 | 90%（仅余收尾验证） | COH-003 | 🟦 | — | 无 git 无法逐文件归属 |
| 数据管理（DELETE/date-range/CSV） | 100% | COH-004 | ✅ | — | 历史销项，存证 |
| 工作区/工作台（含 plans/specs） | 75%（实现存在，验证未闭合） | COH-005/006/007 | 🟨 | 归属未知；无测试、无人工验收 | 2026-09-20 审计确认代码真实存在，从 50% 校正为 75% |
| 台账与治理 | 90% | COH-GOV-001/002/003/004 | 🟦 | 仅余人工验收 | COH-GOV-004 正在校正进度 + 强化规则 |

---

## 7. 任务窗口与修改范围登记

> 每个窗口只维护自己的 Task ID 行。多窗口共同修改同一文件时只认领自己的**行级差异**；修改前重读最新文件；禁止整文件覆盖他人内容。

| 任务窗口 / Task ID | 窗口状态 | 当前 Modification Scope | Consumer Verification Scope / 禁止事项 | 最后更新与下一动作 |
|--------------------|----------|--------------------------|------------------------------------------|---------------------|
| 治理窗口 / COH-GOV-001 | 🟦 ACTIVE（待验收） | `docs/DEVELOPMENT-LEDGER.md`、`AGENTS.md`、`.trae/rules/project-rules.md`（仅门禁入口）、`scripts/check-ledger.js`、根 `package.json`（仅 `ledger:check`/`ledger:validate` 脚本） | 禁止修改任何 server/、client/ 产品代码与 db schema | 2026-09-10 建立；COH-GOV-002 于 2026-09-19 复核 |
| 治理窗口 / COH-GOV-002 | 🟦 ACTIVE（待验收） | `scripts/check-ledger.js`、`docs/DEVELOPMENT-LEDGER.md`（§3/§4/§5/§6/§7/§8/§9） | 禁止修改任何 server/、client/ 产品代码、db schema、.env 与生产配置 | 2026-09-19 复审计+门禁补全+全量验证；已接力至 COH-GOV-003 |
| 治理窗口 / COH-GOV-003 | 🟦 ACTIVE（待验收） | `docs/DEVELOPMENT-LEDGER.md`（行级更新：§3 快照、§4 任务、§5 证据、§6 进度、§7 窗口、§8 每日台账） | 禁止修改任何 server/、client/ 产品代码、db schema、.env 与生产配置；禁止整文件覆盖其他窗口内容 | 2026-09-19 承接 COH-GOV-002 接力；已接力至 COH-GOV-004 |
| 治理窗口 / COH-GOV-004 | 🟦 ACTIVE | `docs/DEVELOPMENT-LEDGER.md`（进度校正：§3/§4/§5/§6/§7/§8/§9）、`AGENTS.md`（强制阅读规则强化） | 禁止修改任何 server/、client/ 产品代码、db schema、.env 与生产配置；禁止整文件覆盖其他窗口内容 | 2026-09-20 独立审计 + 进度校正 + 规则强化；下一动作＝运行门禁验证 → 用户验收 |
| 历史窗口 / COH-001..007 | 待认领/部分销项 | 无法从文件确认归属，标记"待原窗口认领" | 见 §5 | 待原窗口认领 |
| 实施窗口 / COH-008 | 🟩 ACTIVE（待验收） | `server/src/services/card-render/`（新建：渲染引擎+模板+8主题CSS）、`server/src/services/image-studio.service.ts`、`server/src/routes/image-studio.routes.ts`、`server/src/services/pipeline-enhancer.service.ts`、`client/src/views/ImageStudioView.vue`、`client/src/api/index.ts` | 禁止修改其他业务模块、数据库 schema、生产配置 | 2026-09-22 完成阶段一+二+前端；后端编译通过；116测试全通过；下一动作＝端到端联调 → 人工验收 |

---

## 8. 每日台账

> 新记录放顶部；每个 Task ID / 窗口每自然日最多一条；只记范围变化、有效修改、验证、阻塞、交接、销项。

| 日期 | 任务窗口 | 修改 / 审计摘要 | 关联模块 | 关联 Task ID | 状态 / 证据 | 其他提醒 |
|------|----------|------------------|----------|--------------|-------------|----------|
| 2026-09-22 | 实施窗口 / COH-008 | Auto-Redbook 卡片渲染引擎集成落地：① 新建 card-render.service.ts（Playwright Chromium 渲染，8套主题+4种分页模式）；② 替换 AutoRedbookEngine 占位实现为真实渲染；③ 新增 /auto-redbook/themes 和 /auto-redbook/render 路由；④ 升级 pipeline-enhancer 为真实卡片生成；⑤ 前端图片工作室 UI 接入 Auto-Redbook 专属选项（Emoji/副标题/分页模式/多图结果） | server/card-render、server/image-studio、server/pipeline-enhancer、client/ImageStudioView | COH-008 | 后端 tsc 编译通过；server vitest 116/116 通过；前端 vue-tsc 通过 | 新增 PLAYWRIGHT_BROWSERS_PATH 环境变量；模板文件编译后复制到 dist |
| 2026-09-21 | 治理窗口 / COH-GOV-005 | Auto-Redbook-Skills 集成可行性研究：确认现有项目已有"伪 Auto-Redbook"（仅 LLM prompt），缺真正 Playwright 卡片渲染核心；完成对比分析与四阶段集成方案建议 | 治理/研究 | COH-GOV-005 | 研究完成，待用户确认路线 | 纯研究任务，未修改产品代码 |
| 2026-09-20 | 治理窗口 / COH-GOV-004 | 独立审计：确认 COH-005/006/007 代码真实存在；进度从 50% 校正为 75%；强化 AGENTS.md 强制阅读规则 | 治理/台账 | COH-GOV-004 | 门禁验证通过；AGENTS.md 硬性铁律已加 | 纯台账治理，未修改产品代码 |
| 2026-09-19 | 治理窗口 / COH-GOV-003 | 承接 COH-GOV-002 接力；登记本窗口任务（COH-GOV-003）；更新 §3/§4/§5/§6/§7/§8 行级条目；确认治理窗口接力链完整 | 治理/台账 | COH-GOV-003 | 门禁验证通过（10 章节 + 5 表 + 10 任务行列数一致） | 纯台账维护，未修改产品代码 |
| 2026-09-19 | 治理窗口 / COH-GOV-002 | 独立复审计：确认仍非 git 仓库；修正快照计数（视图 16、测试 6 文件/116 用例）；修复 check-ledger.js "和/与"章节匹配缺陷；新增 `--test` 正/负例自检 | 治理/规则 | COH-GOV-002 | ledger:validate 5/5 自检通过；ledger:check 通过；server vitest 116/116 通过（当前基线） | 旧快照"18 视图/5 测试"更正为实测值 |
| 2026-09-19 | 治理窗口 / COH-GOV-002 | 台账 §3 快照、§9 审计记录更新至 2026-09-19 基点 | 治理/规则 | COH-GOV-002 | 新增 AUDIT-20260919-001 | — |
| 2026-09-10 | 治理窗口 | 完成独立审计；<br>新建统一台账 `docs/DEVELOPMENT-LEDGER.md`；建立状态口径与全部必需章节 | 治理/规则 | COH-GOV-001 | 台账文件已创建；审计确认项目非 git 仓库 | 无 git 基线为当前最大治理阻塞 |
| 2026-09-10 | 治理窗口 | 建立 AGENTS.md 根规则入口 + .trae 门禁入口 + 根 package.json 检查脚本 | 治理/规则 | COH-GOV-001 | 待门禁脚本正/负例验证 | 见 §7 修改范围 |

---

## 9. 独立审计记录

### AUDIT-20260920-001 （进度校正审计：COH-005/006/007 代码真实性复核）

- **审计时间**：2026-09-20 (+08:00, Asia/Shanghai)
- **分支 / commit**：`UNVERIFIED`（非 git 仓库）
- **worktree 状态**：无法判定（无 `.git`）
- **审计触发原因**：用户要求"根据最新代码真实情况，更新目前进度，修正台账信息"；对 COH-005/006/007 的"仅有文档 50%"结论做独立复核
- **实际执行的验证**：
  - 列目录 + 行数统计：确认 `server/src/services/` 37 服务、`server/src/routes/` 32 路由、`client/src/views/` 16 视图、`client/src/components/` 11 组件（含 flow/ 子目录 6 个）
  - **关键发现**：COH-005/006/007 对应代码**真实存在**：
    - COH-005: WorkspaceView.vue (425行)、MainLayout.vue (563行)
    - COH-006: ContentStudio.vue (2579行)、moduleConfigs.ts (747行)、FlowHome.vue、ModuleNode.vue
    - COH-007: project-workflow.service.ts (470行)、project-workflow.routes.ts、ProjectNodeWorkbench.vue (165行)、ProjectWorkflowCanvas.vue、ProjectResultNode.vue
  - 验证路由注册：project-workflow.routes.ts 存在
  - 复核测试：6 个 vitest 测试文件仍为 6 个，无新增
- **明确未执行的验证**：前端 build 未跑；COH-005/006/007 功能级测试未执行（无对应测试文件）；人工验收未进行
- **发现的失败及归属**：
  - 台账 COH-005/006/007 "仅有文档，无代码证据"描述与事实不符（代码真实存在）— 已校正为 75%（实现存在，验证未闭合）
  - 台账快照缺少组件数量统计 — 已补充（11 组件，含 flow/ 子目录）
- **审计结论**：COH-005/006/007 进度从 50% 校正为 75%（实现存在，但验证未闭合、归属仍未知）；不改变"待原窗口认领"状态
- **下次需重新取证的触发条件**：COH-005/006/007 被原窗口认领并补充验证证据；或代码发生实质变化

### AUDIT-20260910-001 （首次基线审计）

- **审计时间**：2026-09-10 14:58 (+08:00)
- **分支 / commit**：`UNVERIFIED`（非 git 仓库）
- **worktree 状态**：无法判定（无 `.git`）
- **审计触发原因**：建立统一开发台账前的强制独立审计（不照抄旧交接/对话）
- **实际执行的验证**：
  - `git rev-parse` / `git status` → 确认非 git 仓库（根与父目录均无 `.git`）
  - 列目录：确认 server 30+ 路由、37+ 服务、client 18 视图、docs/、.trae/rules
  - 读取权威文档：project-rules.md、README.md、CHANGELOG.md（2026-07-21 最新）
  - 枚举历史规划：`docs/superpowers/plans+specs`（2026-07-30~08-02）
  - 枚举测试：`server/src/services/__tests__` 5 个 vitest；client 无测试脚本
  - 确认无 AGENTS.md / CLAUDE.md / .cursor / .github / 任何 ledger/board/handoff
- **明确未执行的验证**：服务级测试未实际重跑（当前基线文件刚识别）；前端 build 未跑；TikHub 真实连通未在当前窗口复核
- **发现的失败及归属**：项目无 git 基线（治理阻塞，非产品缺陷）；`lint` 为占位符
- **审计结论**：无现成台账 → 新建唯一台账；旧交接摘要视为历史证据；COH-005/006/007 归属未知
- **下次需重新取证的触发条件**：任一 Task 的代码/Owner/Contract/Required Tests/失败集合/基线发生实质变化；或用户建立 git 基线后

### AUDIT-20260919-001 （复审计：治理机制校正与门禁补全）

- **审计时间**：2026-09-19 11:44 (+08:00, Asia/Shanghai)
- **分支 / commit**：`UNVERIFIED`（非 git 仓库；根与父目录均无 `.git`）
- **worktree 状态**：无法判定（无 `.git`）；无法生成 tracked/untracked 统计
- **审计触发原因**：用户要求"建立并落实统一台账与跨任务窗口共同维护机制"；对 COH-GOV-001 已建台账/门禁做独立复核（不照抄旧结论）
- **实际执行的验证**：
  - `git rev-parse` / `git status` → 再次确认非 git 仓库（根与父目录均无 `.git`）
  - 枚举事实：32 路由 / 37 服务 / 16 视图（更正旧快照"18 视图"）；测试 6 文件（更正旧快照"5 个"）
  - 运行 `npm run ledger:check` → **发现失败**：check-ledger.js 以"和"匹配章节名，而台账用"与"（§2/§5/§10 被误判缺失）
  - 修复 `scripts/check-ledger.js`：章节匹配改为 `[和与]` 兼容；新增 `--test` 正/负例自检（此前 `ledger:validate` 的 `--test` 为空操作）
  - 运行 `npm run ledger:validate` → 5 个正/负例自检全部通过；真实台账检查通过（10 章节 + 5 表）
  - 运行 `npm run test --workspace server` → 6 文件 116 用例全部通过（当前 PASS 基线，2026-09-19 11:48）
  - 搜索 ledger/board/handoff/roadmap/audit/release-checklist/debt 类文件 → 仅 `docs/DEVELOPMENT-LEDGER.md` 为治理台账；`progress_*.json` 为转录运行时进度，非治理文档
  - 读取权威文档：README.md、ARCHITECTURE.md、CHANGELOG.md（最新 2026-07-21）、.trae/rules/project-rules.md、client/server package.json
- **明确未执行的验证**：前端 `vue-tsc + vite build` 未跑（本任务不涉及前端产物）；TikHub/小红书真实连通未复核（外部环境）；无 CI/workflow 可检查
- **发现的失败及归属**：
  - check-ledger.js 章节匹配缺陷（门禁缺陷，已修复并验证）
  - `--test` 自检缺失（门禁缺口，已补全）
  - 快照计数偏差：视图 18→16、测试 5→6（台账事实错误，已更正）
- **审计结论**：唯一台账 = `docs/DEVELOPMENT-LEDGER.md`，无需迁移合并；门禁修复后全量验证通过；COH-005/006/007 仍归属未知，待原窗口认领
- **下次需重新取证的触发条件**：任一 Task 的代码/Owner/Contract/Required Tests/失败集合/基线发生实质变化；或用户建立 git 基线 / 接入 CI 后

---

## 10. 重要访问与维护路径

| 内容 | 路径 | 类型 |
|------|------|------|
| 统一台账 | `docs/DEVELOPMENT-LEDGER.md` | **operational index（权威进度索引）** |
| 项目规则入口 | `.trae/rules/project-rules.md`、`AGENTS.md` | canonical source |
| 架构文档 | `ARCHITECTURE.md` | canonical source |
| 数据保护规则 | `DATA_PROTECTION_RULES.md` | canonical source |
| 项目技能说明 | `PROJECT_SKILL.md` | canonical source（项目技能定义） |
| 变更日志 / 历史证据 | `CHANGELOG.md` | 历史证据 |
| 项目自述 | `README.md` | canonical source |
| 历史规划（规格） | `docs/superpowers/specs/` | 历史证据 / 详细规格 |
| 历史规划（计划） | `docs/superpowers/plans/` | 历史证据 / 详细规格 |
| 测试入口 | `server` 内 `vitest`（`server/src/services/__tests__/`） | 测试入口 |
| 发布/部署文档 | 无独立文件（见 README 启动章节） | 缺失，已登记风险 |
| 工程债登记 | 无独立文件（待补） | 缺失 |
| 台账检查脚本 | `scripts/check-ledger.js`（根） | 生成视图/门禁 |

> 标注原则：canonical source = 需遵守的事实来源；历史证据 = 仅供追溯；生成视图 = 由脚本产出，非人工权威。