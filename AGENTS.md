# AGENTS.md — content-ops-hub 通用工程契约（Cross-Window）

> 本文件是**所有开发/审计任务窗口共享的最小契约入口**。它本身不复制项目完整事实，只指向权威来源并强制共同维护规矩。
> Trae 完整代码规范见 `.trae/rules/project-rules.md`。当前进度/状态唯一索引见 `docs/DEVELOPMENT-LEDGER.md`。

> ⚠️ **硬性铁律（违反视为未合规）**：
> 1. **任何开发/审计窗口开始工作前，必须先读取统一台账**，了解当前并行窗口、修改范围和阻塞项。未读台账不得开始修改任何文件。
> 2. **任务最终汇报的最后一行，必须单独提供可点击的台账链接**。缺少链接视为汇报未完成，需补充。

## 0. 权威源（不在此重复事实，仅链接）

- 当前进度唯一索引（operational index）：`docs/DEVELOPMENT-LEDGER.md`
- 架构：`ARCHITECTURE.md`
- 项目规则（技术栈/代码规范/Pipeline）：`.trae/rules/project-rules.md`
- 变更历史（历史证据）：`CHANGELOG.md`
- 项目自述与启动：`README.md`

## 1. 所有窗口共同维护规矩（强制）

1. **任务启动前必须先读统一台账**：`docs/DEVELOPMENT-LEDGER.md`（§3 快照 → §4 待办 → §7 窗口登记）。
2. **修改产品代码前必须先建立/更新稳定 Task ID 与精确 Modification Scope**（写入台账 §7）。
3. **更新台账前必须重新读取**：当前分支与 HEAD、`git status`、当前 Modification Scope、canonical source、当前测试与失败证据。
4. **旧对话总结不能直接作为当前事实**；历史 PASS 必须标注时间/commit，重跑后才可为当前 PASS。
5. **范围变化、里程碑、阻塞、解除阻塞、验证、交接、关闭任务时**都要更新原 Task ID。
6. **完成记录永久保留**，已关闭任务永不删除。
7. **普通任务不得另建** progress/handoff/task-board 文件；统一写进 ledger。
8. **台账更新不扩大产品代码修改权限**。
9. **未执行的测试不得写 PASS**；模块不因个别定向测试 PASS 视为整仓全绿。
10. **关闭条件**：整个 Task ID 满足销项条件才可 CLOSED；完成时间仅 CLOSED 时填写。

## 2. 状态口径

`✅ CLOSED` / `🟦 ACTIVE` / `🟨 PENDING` / `⛔ BLOCKED` / `❄️ FROZEN` / `🗑️ RETIREMENT_CANDIDATE`；进度 0/25/50/75/90/100%，冻结与未启动用 `N/A`。详见台账 §2。

## 3. 机械门禁（如配置）

- 本项目当前根 `package.json` 暴露 `ledger:check`（结构检查）与 `ledger:validate`（运行正/负例测试）。
- 若实现型 preflight 存在，应把台账纳入必需上下文；closeout 未含台账必须失败。
- **注意**：当前仓库无 git 基线、无 CI/Branch Protection，任何 claims 视为未生效；需仓库管理员配置 required status check 与直推限制。

## 4. 最终汇报格式

最终汇报必须分别给出：
- `IMPLEMENTATION_STATUS`
- `VALIDATION_STATUS`
- `MANUAL_ACCEPTANCE_STATUS`
- `BLOCKERS`

**最后一行必须单独提供可点击的统一台账链接**（缺少链接视为汇报未完成）。本地工具使用绝对路径：
```
[DEVELOPMENT-LEDGER.md](computer://E:\000 【AI-项目】\Trae_work\content-ops-hub\docs\DEVELOPMENT-LEDGER.md)
```
远程工具使用相对路径：`[DEVELOPMENT-LEDGER.md](docs/DEVELOPMENT-LEDGER.md)`