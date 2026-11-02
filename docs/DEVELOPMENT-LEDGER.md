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

- **当前日期 / 分支**：2026-11-02（Asia/Shanghai），`codex/closeout-20261101`；本窗口承接用户批准的 D1–D10。
- **已上传代码提交**：`c82119ca2684547c5fd5abfe27afc62d9d3a36ff`；[GitHub 分支](https://github.com/childonly/Content-Ops/tree/codex/closeout-20261101)。这是产品代码提交；后续文档取证提交以 Git HEAD 为准。
- **验证**：`npm run check` 全部通过：服务端 149 用例、前端 8 用例、37 项 HTTP 断言、真实 lint、前后端构建、台账门禁；`test:cards` 8 主题×4 模式 32/32 通过。API 断言数量随轮询次数变化，固定生命周期场景均通过。
- **独立复审**：3 个 Important 均已用 RED→GREEN 测试修复（配图写入内容、完整正文传给卡片、发布重试引用稳定）；无单列 minor。完整证据见 §9 IMPLEMENT-20261101-001。
- **运行**：Python 自动发现可用；小红书 Skill 仍未安装。后端新代码已启动；前端代理 dashboard API 实测 200。地址与方式见 §10；深浅模式及完整交互仍待人工验收。
- **GitHub Actions**：首个代码提交已触发 [quality](https://github.com/childonly/Content-Ops/actions/runs/41374402152)，Linux 平台绑定已修复；[最终代码 quality run](https://github.com/childonly/Content-Ops/actions/runs/41374855248) 对 c82119c 全部成功（check + 32 卡片矩阵）；required checks/Branch Protection 未确认启用。
- **发布阻塞**：真实小红书 Skill/账号与 TikHub/LLM 权限、真实视频长任务、完整业务验收仍未闭合；不宣称真实发布链路已验收。
- **依赖风险**：生产依赖审计 32 项（含级联影响）：2 critical、26 high、4 moderate；非强制自动修复遇 npm 工作区错误，未执行 force 升级；生产发布前需处理。
- **数据保护**：只做加法迁移；SQLite 一致性快照先于迁移，失败阻断。测试与恢复演练使用隔离库；未对外发帖、未删除业务数据。7 月两条遗留 pipeline running 记录保留，非本窗口新启动任务。
- **治理口径**：历史任务行永久保留，旧 75%/90% 与历史 PASS 不能代替当前验收。本窗口原 Task ID 保持 90%，等待外部/人工验收，不填写完成时间。未发现其他窗口新差异。

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
| COH-AUDIT-20261101 | 2026-11-01 | 2026-11-01 | 项目现状复核、访问与启动取证、任务书核查及收口计划 | 100% | ✅ CLOSED；当前代码/构建/测试/运行证据与详细实施清单已写入 §9，访问方式见 §10 | 调研无阻塞；产品构建、外部集成与功能缺口仍未解决，不因调研销项关闭 | 本审计窗口 | 无（调研完全销项；后续产品实施按原 Task ID 另行认领） |
| COH-CLOSEOUT-20261101 | 2026-11-01 | — | 用户批准 D1–D10 收口实施及 GitHub 上传；承接 COH-001/002/003/005/006/007/008 | 90% | 🟦 ACTIVE；代码修复/测试/独立复审完成，已普通推送 codex/closeout-20261101（33e6059），远端 CI 已触发；保留整体验收项 | 缺失小红书 Skill/账号与真实数据权限；生产依赖漏洞、远端保护及完整人工验收未闭合 | 本收口窗口 | 本窗口推送 → 项目负责人完成外部与人工验收 |

> 说明：原 Owner 的任务行保留历史里程碑与接力信息；其中 75%/90% 不构成 2026-11-01 当前 PASS，也不能平均为项目总完成率。当前分模块判断与失败证据见 §3、§6、`AUDIT-20261101-001`。本窗口未接管原任务的产品修改范围。

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
| COH-AUDIT-20261101 | 仅 `docs/DEVELOPMENT-LEDGER.md`（§3~§10）；只读复核产品代码；执行构建、服务启动及本地卡片样例渲染 | 当前状态、访问说明和后续排期 | main@ae6f3dc；116/116 单测、后端 tsc、8 项只读 API、PNG 渲染通过；前端 Vite 失败；完整证据、未执行项与实施计划见 AUDIT-20261101-001 | 调研范围已销项；仅台账为 tracked 差异。启动触发项目既有迁移/中断恢复及自动备份；样例图片/日志/dist 为忽略生成物，不是真实发布 |

---

## 6. 开发进度表

| 模块 | 当前里程碑进度 | 关联 Task ID | 状态 | 受限原因 | 提醒 |
|------|----------------|--------------|------|----------|------|
| 内容运营核心闭环 | 90%（代码/自动验证完成，外部待验收） | COH-001 | 🟨 | 真实追踪与来源持久化已接入；真实发布/数据源权限验收未闭合 | 116 个单测通过不等于完整运营闭环通过 |
| 生产配置与外部集成 | 90%（环境诊断就绪，Skill/账号待验收） | COH-002 | ⛔ | Python 路径自动发现已修复；小红书 Skill 缺失，账号及 TikHub/LLM 真实连通待验收 | 凭据存在不等于服务可用 |
| 合并后平台整体 | 90%（本地/CI 构建通过，人工待验收） | COH-003 | 🟨 | 完整人工业务验收未闭合 | Git 基线已建立；本地/CI check 与卡片矩阵通过 |
| 数据管理（DELETE/date-range/CSV） | 100% | COH-004 | ✅ | — | 历史销项，存证 |
| 工作台入口与主题 | 75%（主体存在，验证未闭合） | COH-005 | 🟨 | 工作台/项目画布抽查通过；深浅主题与全交互未验收 | 原 Owner 未重新认领 |
| 内容工作室与项目节点 | 75%（代码及自动回归完成，交互待验收） | COH-006/007 | 🟨 | 图片页可加载；真实项目配图/分析、后台任务恢复已实现；真人长视频及完整交互待验收 | 详见 §9 实施与新增定向/集成测试 |
| Auto-Redbook 卡片 | 90%（本地/CI 矩阵成功，人工待验收） | COH-008 | 🟨 | 已修复构建、重复渲染及资源复制；8×4 矩阵通过；最终视觉/业务人工验收未完成 | sketch/separator 样例返回 2 张 PNG；不视为整个 COH-008 销项 |
| 台账与治理 | 90%（历史机制待人工验收） | COH-GOV-001/002/003/004 | 🟦 | 本次台账门禁通过；历史治理任务仍待 Owner/负责人验收；CI 接入尚缺 | 本次调研 COH-AUDIT-20261101 单独销项，不代签历史验收 |

> 上表为 2026-11-01 的审计阶段判断，采用 §2 的里程碑档位；不是按功能数量计算的完成率，也不覆盖原 Owner 的任务登记。当前没有可据以计算可信总完成率的完整验收分母。

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
| 审计窗口 / COH-AUDIT-20261101 | ✅ CLOSED | 仅 `docs/DEVELOPMENT-LEDGER.md`（§3~§10 行级更新与审计计划）；构建/运行生成物不作为产品变更 | 未修改产品代码、schema、.env；未执行真实发布或业务删除；未代签原 Task ID 验收 | 2026-11-01 调研交付；当前验证和 10 项实施清单见 §9，运行方式见 §10；服务保持运行，产品修复交由后续窗口按原 ID 认领 |
| 收口窗口 / COH-CLOSEOUT-20261101（承接 COH-001/002/003/005/006/007/008） | 🟦 ACTIVE | client：ImageStudioView、Analytics、Dashboard、ProjectNodeWorkbench/ProjectWorkflowCanvas、API/types、共用 composables；server：config、db 及新迁移/备份工具、analytics/skill-bridge、project-workflow/video job、image-studio/card-render、运行时诊断与关联路由/types/tests；工程：scripts、package/lock、lint/CI、start-services、README/.env.example/AGENTS/CHANGELOG、当前规格与本台账 | 仅用户批准的 D1–D10；schema 只加法且一致性备份先于迁移；不删业务数据、不真实发帖、不公开 .env/数据库；Git 普通提交/推送已获用户明确授权；原 CLOSED 保留 | 2026-11-01 main@ae6f3dc 分支为 codex/closeout-20261101；初始差异仅前轮台账；先做 D1/D2/D3/D4，再节点、卡片、门禁、交付 |

---

## 8. 每日台账

> 新记录放顶部；每个 Task ID / 窗口每自然日最多一条；只记范围变化、有效修改、验证、阻塞、交接、销项。

| 日期 | 任务窗口 | 修改 / 审计摘要 | 关联模块 | 关联 Task ID | 状态 / 证据 | 其他提醒 |
|------|----------|------------------|----------|--------------|-------------|----------|
| 2026-11-02 | 收口窗口 | D1–D10 代码/门禁/独立复审修复；完整自动验证、32 卡片矩阵；准备上传 GitHub | 产品、测试、工程、文档 | COH-CLOSEOUT-20261101 | 90%；外部与人工验收保留；详见 IMPLEMENT-20261101-001 | 不真实发布，不关闭整个业务任务 |
| 2026-11-01 | 审计窗口 | 重新核对 Git/规格/代码/运行环境；修正过期快照；启动前后端；记录构建阻塞、发布路径失效、数据真实性及节点适配缺口；制定 10 项收口实施清单 | 全平台（只读审计）、台账 | COH-AUDIT-20261101 | CLOSED（调研）；116/116 单测、后端 tsc、8 项 API、卡片 PNG 样例通过；前端构建失败，登录检查 ENOENT；详见 AUDIT-20261101-001 | 仅台账 tracked 修改；无真实发布/业务删除；业务任务未销项；本次启动时启用定时任务数为 0 |
| 2026-10-26 | 发布窗口 | 项目首次 Git 初始化 + GitHub 推送：① 完善 .gitignore（补充 playwright-browsers、uploads、transcriptions、pm2 等忽略项）；② git init -b main → 193 文件 → commit c839a9d；③ HTTPS 443 被防火墙拦截，切换 SSH 22 端口成功推送；仓库地址 github.com:childonly/Content-Ops.git | 根目录 .gitignore、.git/ | —（发布操作，非 Task ID） | push 成功；工作区 clean；branch main track origin/main | 本机已配置 SSH key，git remote 用 SSH URL；首次提交未改写历史 |
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

### IMPLEMENT-20261101-001（用户批准的 D1–D10 收口实施）

- 原始计划：本节 AUDIT-20261101-001/D；规格：两层工作台与项目节点工作台设计。用户已明确“按建议实施”“完成后上传 github”。
- 执行分支：`codex/closeout-20261101`，基点 `ae6f3dc`；延续当前适用 checkout，不另建 worktree 或第二套进度文件。
- Pre-flight 接口：D3 来源字段由 D5 分析适配器、前端和统计消费；统一 observed/estimated/simulated/unknown，旧数据 unknown。D6 后台任务接口由工作台轮询消费；旧同步 API 保留兼容。D7 图片结果由项目配图与独立图片页消费，统一一次渲染结果。D8/CI 只用隔离 DB，不消费业务库。
- Ruling: 使用现有统一台账执行已批准计划，不运行会另建 progress.md 的技能脚本；项目 AGENTS 的唯一台账约束优先。代价：任务状态由本表与测试命令取证。
- Ruling: 保持现有 Vue/Express/SQLite 技术栈，以最小可验证变更收口；不自动对外发帖或伪造集成结果。外部条件未就绪时给出可执行诊断并保持待验收。

| 项目 | 执行状态 | 当前证据 / 下一动作 |
|------|----------|---------------------|
| D1 构建 | 自动验证通过 | 全仓 TypeScript/Vue/Vite 构建通过，图片页模板错误修复 |
| D2 运行环境 | 代码通过；外部待验收 | Python 自动发现及诊断通过；本机 Skill 缺失，未执行真实登录/发布 |
| D3 数据真实性 | 自动验证通过 | 来源字段/旧数据 unknown/模拟隔离/真实笔记读取/日期边界、CSV 测试通过 |
| D4 验收范围 | 已明确 | D1–D9 自动项已实现；真人账号、真实提供商、恢复运维、远端保护与全交互验收分开登记 |
| D5 真实适配器 | 自动验证通过 | 配图/分析/待发布引用接入；确认图片写入内容；模拟不伪装真实；发布失败重试保留引用 |
| D6 长任务恢复 | 自动验证通过 | 后台任务编号、轮询重开、中断恢复、幂等与并发校验测试通过；真人视频长任务待验收 |
| D7 卡片收口 | 自动验证通过 | 单次渲染、完整正文、几何占位符、尺寸/主题校验与 8×4 实渲染通过 |
| D8 自动门禁 | 本地及远端通过 | ESLint、服务端/前端单测、构建、隔离 API 冒烟通过；GitHub Actions run 41374855248 成功，含 32 卡片矩阵 |
| D9 交付验收 | 代码通过；人工/外部待定 | WAL 备份与隔离恢复、token 与服务代理验证通过；真实业务库恢复演练和公网发布未执行 |
| D10 维护改进 | 本轮模块提取完成；深度重构后续 | 提取 ContentStudio 模板、analytics CSV/来源、任务观察、运行路径、数据库安全；状态统计改为本项目 2 项；FlowHome 整体重构保留后续迭代 |

- 范围细化：为通过真实 lint，认领 `transcriber.service.ts` 与 `video-alchemist.service.ts` 的正则单行修正；不改变转录/改写策略。新增 `client/vitest.config.ts`、`eslint.config.mjs`、构建资源复制脚本与关联测试均属于 D7/D8。

- 2026-11-02 当前验证：独立复审发现并修复 3 个 Important：确认配图写入内容、AutoRedbook 读取完整正文、失败发布重试保留 handoff ID；均有 RED→GREEN 回归。复审无单列 minor。未判断真人账号、真实 TikHub 数据、Skill 安装与远端保护，维持人工/外部验收。
- 本地证据：logs/closeout-review-check.log（完整 check）、logs/card-matrix.log（32/32），测试数据库均隔离在 logs/ 下，未对外发帖或删除业务数据；后端已重启加载新代码，runtime/diagnostics 报 Python=true、Skill=false；前端代理 API 200。7 月遗留的 2 条 pipeline running 记录保持原样，不当作当前活跃任务。
- 依赖风险：npm audit --omit=dev 返回 32 项（2 critical、26 high、4 moderate，含级联影响）；非强制 audit fix 遇 npm Arborist edgesOut 错误，未采用 force/未经验证的大版本升级。生产发布前须独立处理此风险；本轮不宣称生产可发布。
- 决策：继续使用现有技术栈和统一台账；发布保留人工门；缺失外部依赖不伪造通过；大型画布深度重构不混入链路修复。代价为后续运维/人工验收及重构仍需排期。

- 上传取证：2026-11-02 已普通推送 `33e6059` 到 `origin/codex/closeout-20261101`，没有修改 main 或强推；[代码提交](https://github.com/childonly/Content-Ops/commit/33e60595f93d5ebb151a4103c7fe1f2f979a5ae3)。Actions run 41374402152 已触发，首次查询 in_progress。自动审批额度曾导致提交未执行，用户继续后重新审批通过，再执行提交/推送。
- 最新完整检查：149 个服务端测试、8 个前端测试、37 HTTP 断言、lint/build/ledger 全通过；卡片矩阵 32/32。补正新增文件 EOF 空行并再次检查差异；仅格式/台账后续提交，不改变产品行为。

- 跨平台修复：GitHub run 41374402152 的测试通过，Linux 构建缺 @rollup/rollup-linux-x64-gnu；补入与 Rollup 4.62.2 匹配的可选平台包和锁文件。没有跳过构建门禁，待新提交 CI 验证。

- 最终上传验收：c82119c 已推送；GitHub Actions [41374855248](https://github.com/childonly/Content-Ops/actions/runs/41374855248) completed/success，包含 npm ci、npm run check 和 test:cards。图片工作室浏览器抽查可见控件且无 Vite 错误层，本项目服务状态 2/2。工作区在最终台账补记前 clean；本条仅文档证据更新。

### AUDIT-20261101-001（当前代码、访问与收口计划复核）

- **Task ID / 日期**：COH-AUDIT-20261101；2026-11-01（Asia/Shanghai）。
- **基线**：`main@ae6f3dc0224ba090dd8566ee57be4e3a7dde0b77`；开始时工作区 clean；仅本台账为本次 tracked 修改。Git 远端已配置，9 月“无 Git”阻塞已解除。没有改写历史、提交或推送。
- **任务销项边界**：用户要求调研、访问说明、任务书检查、代码复核与详细计划；以上已完成。产品修复、外部发布和用户业务验收不属于本次调研销项。
- **Canonical 来源**：README、ARCHITECTURE、项目规则、DATA_PROTECTION_RULES、当前 routes/services/client router/package scripts；局部需求参考下列历史规格。旧文档的计数/自审勾选仅作历史证据。

#### A. 任务书与规格来源

当前 tracked 仓库内未发现独立的全项目总任务书/PRD，也没有将全部需求、Owner、Required Tests、验收结果逐项关联的矩阵。已有 5 份规格、3 份实施计划，可以作为收口依据，但不能直接按历史自审勾选认定当前通过。

| 文档 | 覆盖范围 / 使用限制 |
|------|--------------------|
| [正式目录与深色主题规格](superpowers/specs/2026-07-30-formal-workspace-sync-and-dark-theme-design.md) + [计划](superpowers/plans/2026-07-30-formal-workspace-sync-and-dark-theme-plan.md) | 运行时、配置持久化、发布真实性、数据真实性和主题；原迁移背景为历史 |
| [内容工作室节点规格](superpowers/specs/2026-08-01-content-studio-node-workflow-design.md) + [计划](superpowers/plans/2026-08-01-content-studio-node-workflow-plan.md) | 动作能力目录、节点壳层、人工审核、运行可观测性、旧入口兼容 |
| [单工作台入口规格](superpowers/specs/2026-08-01-single-workspace-design.md) | 默认入口、最近项目、URL 恢复；“不新建项目表”属于该入口阶段，不能覆盖后续双层实例模型 |
| [两层工作台规格](superpowers/specs/2026-08-01-two-level-workspace-design.md) + [计划](superpowers/plans/2026-08-01-two-level-workspace-plan.md) | 蓝图与项目实例、真实节点适配器、来源标识、CRUD、安全及验收 |
| [项目节点工作台规格](superpowers/specs/2026-08-02-project-node-workbench-design.md) | 输入选择、提示词推荐、视频候选、成果确认、进度与恢复；含 Given/When/Then 验收标准 |

建议项目负责人将“需求 → 原 Task ID → 实现文件 → 自动验证 → 人工验收 → Owner/依赖”矩阵补入本台账；将详细产品定义归回对应 canonical 规格，不新建第二套进度或交接文件。

#### B. 当前验证证据

| 检查 | 2026-11-01 结果 | 实际边界 |
|------|----------------|----------|
| 后端单元测试 | PASS：6 文件、116/116 用例 | 使用本机 Node 22.23.1 运行现有 Vitest；覆盖 base-data/xhs-data/youtube-data/trend/runtime-config/publish-engine；大量依赖为 mock 或内存库，不覆盖全平台 |
| 根 `npm run build` | FAIL | 后端 tsc、前端 vue-tsc 先通过，Vite 编译 `ImageStudioView.vue:531` 失败：`v-model` 绑定常量 `'3:4'` |
| 编译根因最小验证 | 原模板失败；仅在内存改为 `:model-value` 后模板编译无错误 | 没有写回产品文件；不等于修复后整仓构建已通过 |
| 只读 API 冒烟 | PASS：8 项 HTTP 200、业务 success=true（health 为 status=ok） | `/health`、`/api/service-status/local`、`/api/dashboard/stats`、`/api/project-workflows`、`/api/business-flows`、`/api/image-studio/auto-redbook/themes`、`/api/publish/engines`、`/api/admin/modules` |
| 前端运行抽查 | 工作台与项目画布可渲染；图片页 FAIL | `/workspace` 及项目工作流视图可见；`/content?tab=image` 出现与生产构建相同的 Vite 错误覆盖层；未穷举全部按钮 |
| 卡片后端实渲染 | PASS：sketch + separator，封面/正文共 2 张 PNG | POST `/api/image-studio/auto-redbook/render`；返回图片 GET 200，均为 1080×1440，正文已视觉抽查；仅审计示例，未发布 |
| 小红书集成 | FAIL：两个发布引擎 unavailable；登录检查 HTTP 500/ENOENT | 生效的 Skill 目录不存在，配置的 Python 可执行路径不存在；不能称为仅差扫码登录 |
| 外部提供商 | 仅配置存在 | TikHub/智谱/DeepSeek 的凭据已配置；未验证真实连通、余额、配额或生成质量；CogView 的 available 不代表真实生成验收 |
| 数据库 | PASS：只读 quick_check=ok、外键违规 0 | 31 张业务表；启动前后抽查 10 张表行数相同；不能据此声称全部字段未变化或备份已完成恢复验证 |
| 台账门禁 | 正/负例 5/5，通过；最终结构检查见本次执行结果 | 门禁只能检查台账结构，不检测进度事实是否正确 |
| 自动质量扫描 | Python 技能脚本不可运行，knip/jscpd 未获得结果 | 系统 Python alias/py launcher 无法启动；以 Node/rg 替代采集依赖、Git、源文件计数、TODO（0 命中）及大文件，未冒充完整静态审计通过 |

数据库抽查基线：contents=7、trends=15、drafts=30、publications=4、analytics=2、business_flows=3、project_workflows=1、project_workflow_nodes=4、transcriptions=6、schedules=2（enabled=0）。启动触发应用现有的 init/migrate、自动备份和中断恢复逻辑；未运行 db:init、删除、真实发布、云端内容生成或定时任务启用操作。

卡片样例返回路径：`/api/contents/images/autoredbook_1793520634304_flfozu_cover.png`、`/api/contents/images/autoredbook_1793520634304_flfozu_card_1.png`。代码先 `engine.generate()` 再 `renderCards()`，本次磁盘实际新增 4 张审计图、响应只引用后 2 张，证实重复渲染及孤立文件问题。

#### C. 已确认问题与规格差距

| 优先级 / 原任务 | 证据 / 代码位置 | 收口影响 |
|-----------------|-----------------|----------|
| P0 / COH-008、003 | `client/src/views/ImageStudioView.vue:531` 常量使用 v-model；构建与浏览器均复现 | 阻止完整前端构建和图片工作室使用；应先修固定值绑定，再重跑整仓构建 |
| P0 / COH-002 | `config.xhsSkillPath` 和 `xhsPipelinePythonPath` 失效；发布引擎 0/2 available；登录接口 ENOENT | 发布链路与 Python 视频处理环境不能据历史结论认定可用；需路径、依赖、登录分层诊断 |
| P0 / COH-001 | `server/src/utils/skill-bridge.ts:692` 起，trae 的 trackAnalytics 仍 Math.random；`analytics.service.ts` INSERT/mapRow 不保留 isMockData；GET 分析记录无该字段 | 模拟数据刷新后无法与真实数据可靠区分；先补来源/真实性链路，再接真实追踪，历史未知数据不能擅自认作 observed |
| P1 / COH-006、007 | `business-flow.service.ts:454` 起 skill/module 为 simulated、condition 恒 true；`project-workflow.service.ts` runAdapter 无 image-studio/analytics 分支 | 蓝图试跑不能算真实业务完成；两层规格中承诺的配图/效果节点仍需接入，未支持模块保持 blocked |
| P1 / COH-007 | `ProjectNodeWorkbench.vue` 视频执行为长 HTTP await，未发现进度轮询；项目节点输入、候选、选定结果已保存，但处理中的任务 UID/重开恢复尚缺验证 | 与规格要求“显示进度、关闭重开恢复、人工选择后推进”尚未完全闭合；状态机、并发重复执行与通用请求 30 秒超时需定向回归 |
| P1 / COH-008 | `image-studio.service.ts:724` 起专用渲染重复调用；`server/package.json` build 只有 tsc；模板/CSS 从 __dirname 读取 | 需复用一次渲染结果；干净构建要自动带资源。本机 dist 有 9 月旧模板，不能作为新克隆可部署的证据 |
| P1 / 工程治理 | lint 为 echo；无 tracked `.github` workflow；现有 6 测试不含 project-workflow/card-render/pipeline 等关键模块 | 需要实际 lint、关键契约测试、API/页面冒烟和 required checks；远端 Branch Protection 当前未知 |
| P1 / 发布与数据保护 | 后端监听 0.0.0.0；app/admin 未见认证中间件，匿名管理 GET 可访问；备份用 fs.copyFileSync，失败仍继续 | 本机访问与对外部署需明确边界；对外前补鉴权/授权；需 WAL 一致性备份与隔离恢复演练。本次未测试未授权写入 |
| P2 / 维护体验 | ContentStudio 约 2855 行、FlowHome 2369 行；service-status 仍列已合并旧服务和其他项目，页面显示 2/10；AGENTS/架构/README 部分统计过期 | 拆分职责、统一状态来源及启动文档，避免把“其他项目未启动”当成本项目完成度或核心阻塞 |

项目工作流的 publish 目前为人工 `waiting_review` 门，confirm 只推进节点，不执行外部发布。该行为符合“不自动发布”的边界，但还需验证最终成果进入待发布区的实际引用与显式发布按钮的衔接，不能把项目 completed 当成平台已发布。

#### D. 下一步收口与开发实施清单（建议顺序，尚未启动产品修改）

以下“建议 Owner”不是原窗口已接单；实施前须在 §7 认领原 Task ID 和精确范围。估算按一名熟悉项目的工程师计，外部权限/余额/账号等待另计。优先顺序为 D1/D2/D3 → D4/D5/D6/D7 → D8/D9 → D10；D4 可与环境修复独立排期。

| 项目 / 原 Task ID | 建议 Owner / 依赖 | 实施步骤与精确落点 | 验收 / 交付条件 | 参考工作量 |
|-------------------|-------------------|------------------|----------------|------------|
| D1 / COH-003、008：解除构建阻塞（P0） | 前端；无外部依赖 | ① ImageStudioView.vue 固定比例改为单向固定值绑定；② 检查其他模板同类绑定；③ 重跑根 build；④ 打开图片页与旧重定向入口 | server tsc + vue-tsc + vite 全通过，图片页无编译覆盖层；业务代码最小改动 | 0.25–0.5 人日 |
| D2 / COH-002：恢复运行依赖（P0） | 集成负责人；本机 Python/Skill 可用安装 | ① 使用 Node 22 启动入口；② 核实实际 Python/uv、Skill 路径及依赖；③ 统一运行时预检与配置提示；④ 区分未安装、命令失败、未登录；⑤ 仅健康检查后进行账号验收 | 启动不依赖失效 Trae 路径；check-login 可执行；至少 1 个发布引擎真实可用；视频运行时可检测；未配置的备用引擎清楚标为可选 | 0.5–1.5 人日；不含安装/账号等待 |
| D3 / COH-001：数据真实性兜底（P0） | 后端+前端；遵守加法迁移和自动备份 | ① analytics/来源契约增加 observed/estimated/simulated、provider、采集时间、源 ID/URL；② 保存、查询、导出全程保留；③ 迁移历史未知来源为 unknown/待确认，避免伪造；④ 页面/仪表盘明确标识，默认业务统计排除模拟；⑤ mock 分支不假装成功采集 | 模拟追踪保存、刷新、CSV 后仍标识一致；真实/模拟不能混算；新增迁移无删除、可回退到备份 | 1–2 人日 |
| D4 / COH-005/006/007、治理：验收范围冻结（P1） | 项目负责人+测试；现有 5 规格/3 计划 | ① 确定首版必需能力与可选引擎；② 逐项映射到 Task ID、Owner、实现路径；③ 确定同日历史方案的适用阶段；④ 为每项写成功、失败、刷新/重试验收；⑤ 补入本台账与原 canonical 规格 | 有完整验收分母，每条需求可追溯；原窗口认领；不再以文件存在或历史勾选代替完成 | 0.5–1 人日 |
| D5 / COH-001、006、007：补真实业务适配器（P1） | 后端+前端；D2、D3、D4 | ① 接 image-studio 项目节点并保存全部图片/实际引擎；② analytics 绑定真实 publicationId、接可用真实数据源；③ 蓝图明确标为试运行或转项目执行，不把 simulated 汇总为业务完成；④ 保留发布人工门，衔接待发布区与真实 URL 回写；⑤ 未支持模块禁用并说明原因 | 趋势/内容/配图/审核/显式发布/真实效果可串联；缺权限时明确 blocked，不生成随机真实指标；发布重试不重复发帖 | 2–4 人日；数据源权限等待另计 |
| D6 / COH-007：节点长任务与恢复（P1） | 后端+前端；D4、D5 契约 | ① 统一执行状态校验与幂等；② 生成任务 UID 及时持久化；③ 进度查询/轮询、弹窗重开与刷新恢复；④ 校验直接上游输入及候选选择；⑤ 失败保留参数、记录 attempt，重试不重复消费成果；⑥ 通用 LLM/连续执行超时与任务生命周期对齐 | 关闭重开、刷新、请求中断与服务重启均不伪报成功；未确认成果不点亮下游；缺配置可见原因 | 1.5–3 人日 |
| D7 / COH-008：卡片集成收口（P1） | 后端+前端；D1 | ① 删除专用接口的二次渲染，统一返回一次结果；② 构建脚本复制 templates/themes；③ 校验主题/模式输入、图片引用与错误清理；④ 覆盖 8 主题×4 模式、长短文、分页边界、中文/emoji；⑤ 页面多图预览/保存接入 | 单请求只生成一组图片；干净安装构建可渲染；图片 URL 可读，无内容截断/溢出；前后端完整样例通过 | 0.5–1.5 人日 |
| D8 / 原任务验证 + 治理：自动化质量门禁（P1） | 测试/工程；D1、D3、关键适配器 | ① 配置实际 ESLint/Vue/TS 检查替换 echo；② 补项目生命周期、适配器、发布真实性、删除引用和卡片测试；③ 加前端主路径与旧路由冒烟；④ CI 使用兼容 Node、隔离临时 DB、最小测试配置；⑤ 接入 ledger:validate + tests + build + lint，管理员确认 required checks | 新克隆能执行可重复门禁；不存在“echo lint PASS”；模拟外部依赖可测失败场景，真实集成另记；CI/保护实际生效后才标启用 | 1–2 人日 |
| D9 / COH-002、003 + 发布：交付与人工验收（P1） | 发布负责人+项目负责人；D1–D8 必需项 | ① 统一 start-services/README/.env.example，清理旧运行时说明；② SQLite 一致性备份、失败策略和隔离恢复演练；③ 明确仅本机部署或补认证/授权与访问控制；④ 测试启动、停止、重启和长任务不中断；⑤ 按需求矩阵验收含人工发布与真实 URL；⑥ 更新 CHANGELOG，逐个原 Task ID 销项 | 干净环境可部署；恢复演练成功；对外使用前访问控制通过；核心闭环、深浅主题/失败重试/兼容入口有验收记录；未通过项不 CLOSED | 1–2 人日；人工发布与账号步骤由负责人确认 |
| D10 / 后续维护：降低复杂度和配置漂移（P2） | 前端+后端；先完成必需收口 | ① 分拆 ContentStudio/FlowHome/转录服务职责；② 统一 API DTO 和错误处理、逐步清理 any；③ 服务状态区分本项目必需服务、可选引擎和其他项目；④ 清理旧统计/硬编码路径；⑤ 按验收价值再考虑备用图片引擎、分支/定时节点 | 保持已通过回归，功能不缩水；页面状态含义清楚；新增能力单独登记范围和验收 | 2–4 人日，可迭代安排 |

首批应先完成 D1+D2+D3+D4，预计约 2.25–5 人日。D1–D9 全部范围粗估约 8.25–17.5 人日，账号、数据源授权、真实发布及 CI 管理员等待不计入；这是依赖现状的计划估算，不是交付承诺。不要在真实闭环尚未验收时优先扩充备用引擎或分布式基础设施。

#### E. 未执行与关闭条件

- 未执行：真实 TikHub/LLM/CogView 调用、真实账号扫码/发布、真实视频长任务、完整 CRUD 破坏性回归、8×4 卡片矩阵、全页面/深浅模式验收、备份恢复演练、远端 CI/Branch Protection 核验、依赖漏洞审计及完整死代码/重复率扫描。
- 本次没有修复产品问题，不把内存模板试改、历史 PASS、健康接口 200 或 116 个单测通过称为整仓通过。
- 后续产品关闭标准：按 D4 的矩阵完成实现 → 当前代码上的自动门禁通过 → 真实外部条件验证 → 人工验收 → 原 Task ID 完整证据与完成日期 → CLOSED。外部阻塞保留 BLOCKED/PENDING，不提前填写完成时间。
- 本次审计关闭标准为证据与计划交付，失败结果是审计结论的一部分；只关闭 COH-AUDIT-20261101。

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
| 当前访问与启动方式 | 本节下方，2026-11-01 实测 | 本机运行快照；生产部署仍需 D9 |
| 收口任务与工程改进 | §9 AUDIT-20261101-001 的 C/D/E | 当前审计与建议计划；不另建平行任务板 |
| 台账检查脚本 | `scripts/check-ledger.js`（根） | 生成视图/门禁 |

> 标注原则：canonical source = 需遵守的事实来源；历史证据 = 仅供追溯；生成视图 = 由脚本产出，非人工权威。

### 10.1 当前访问链接（2026-11-01 本机实测）

| 用途 | 链接 | 状态 / 说明 |
|------|------|-------------|
| 主入口 / 工作台 | [工作台](http://127.0.0.1:5180/workspace) | 已启动、页面可渲染；默认根路径重定向到此 |
| 仪表盘 | [仪表盘](http://127.0.0.1:5180/dashboard) | 已配置的原生路由；本次验证的是 dashboard stats API，不把此页面全交互记为 PASS |
| 内容工作室 | [内容工作室](http://127.0.0.1:5180/content) | 当前内容入口；旧发布/草稿/视频/图片入口重定向到不同 tab |
| 图片工作室 | [图片页](http://127.0.0.1:5180/content?tab=image) | 已复现 Vite 模板编译错误，D1 修复前不可正常使用 |
| 系统管理 | [模型与模块](http://127.0.0.1:5180/admin) | 原生管理路由；本次只抽查 modules GET |
| 后端健康检查 | [health](http://127.0.0.1:3100/health) | 实测 200、status=ok；后端根地址不是前端页面 |
| 本项目前后端状态 | [local status](http://127.0.0.1:3100/api/service-status/local) | 实测 frontend/backend 均 online=true |
| 发布引擎诊断 | [publish engines](http://127.0.0.1:3100/api/publish/engines) | 实测 200，但两个引擎 available=false；200 不等于发布可用 |
| 卡片主题 | [Auto-Redbook themes](http://127.0.0.1:3100/api/image-studio/auto-redbook/themes) | 实测 8 主题；真实本地渲染样例见 §9 |
| Git 远端仓库 | [childonly/Content-Ops](https://github.com/childonly/Content-Ops) | 来自当前 git remote；本次未核验远端在线/权限/CI 状态 |

以上 HTTP 地址供这台电脑访问，未发现已配置的公网前端部署地址。本次前端绑定 127.0.0.1:5180，后端实际监听 0.0.0.0:3100；对外使用的认证和访问控制边界见 D9。页面状态栏的 2/10 包含已合并旧服务和其他项目，不能解释为本项目只有 20% 完成。

### 10.2 启动、日志和验证方式

在项目根目录打开 PowerShell：

```powershell
Set-Location -LiteralPath 'E:\000 【AI-项目】\Trae_work\content-ops-hub'

# 日常使用：后台启动前后端，已有端口监听时跳过
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-services.ps1

# 可选：启动后打开默认仪表盘
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-services.ps1 -OpenBrowser

# 单独启动后端或前端（二选一，按需要执行）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-services.ps1 -BackendOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-services.ps1 -FrontendOnly

# 健康检查
Invoke-RestMethod 'http://127.0.0.1:3100/health'
Invoke-RestMethod 'http://127.0.0.1:3100/api/service-status/local'
```

- **双击入口**：`start.bat`（前后端+打开页面）、`start-backend.bat`、`start-frontend.bat`；本次实测它们共用的 `start-services.ps1`，没有逐个双击 BAT。
- **当前兼容运行时**：脚本自动找到 `E:\Documents\.runtimes\node-v22.23.1-win-x64\node.exe`。默认 shell 为 Node 24.14.0，超出项目 engines 的 `<24`；当前测试与服务均使用 Node 22.23.1。换机需准备可用兼容运行时及本地配置；不能假定 Node 18 能运行现有 node:sqlite 测试。
- **开发调试**：`npm run dev`，或 `npm run dev:server` / `npm run dev:client`；后端 dev 会监听文件变更。转录等长任务日常使用已验证的无监听后台启动方式。
- **日志**：`logs/backend-node22.out.log`、`logs/backend-node22.err.log`、`logs/frontend-node22.out.log`、`logs/frontend-node22.err.log`。后端业务日志另在 `server/logs/`；日志可能含业务信息，勿把完整日志或 .env 直接公开。
- **停止**：现有 `stop.bat` 按 3100/5180 端口强制结束进程，执行前须等待转录/发布等长任务结束；本次未执行停止，服务保持运行。
- **质量验证**：兼容 Node 环境下运行 `npm run test --workspace server`、`npm run build`、`npm run ledger:validate`、`git diff --check`。本次 build 失败详见 §9；不能把现有 dist 当成成功的新构建。
- **数据**：已有 `server/data/content-ops-hub.db`；日常启动不需要再次执行 `db:init`。当前启动会自动执行项目既有幂等初始化/迁移和自动备份；恢复演练须使用隔离副本，不覆盖用户业务库。
- **生产发布**：前端构建和 D9 验收前暂不具备可发布基线；后端 `npm run start --workspace server` 依赖构建后的 dist，卡片模板/CSS 需先按 D7 纳入构建。
