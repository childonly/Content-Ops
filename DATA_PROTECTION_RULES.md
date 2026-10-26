# 数据保护规则 (DATA PROTECTION RULES)

## 核心原则

**严禁清空或删除用户的任何业务数据。** 本系统的数据库包含用户通过视频转录、内容创作等功能产生的所有历史数据，这些数据不可恢复，一旦丢失将造成不可逆的业务损失。

## 数据库操作规范

### 1. Schema 迁移

- 迁移只能做加法（添加新表、新列），不能做减法（删除表、删除列、修改列类型）
- 每次迁移前必须自动备份数据库（已通过 `backupDatabaseBeforeMigration` 实现）
- 备份文件命名：`{dbName}.pre-migrate-{timestamp}`
- 使用 `addColumnIfMissing` 函数幂等添加列

### 2. 禁止的操作

以下操作**严禁**在任何代码变更中执行：

| 操作 | 原因 |
|------|------|
| DROP TABLE | 直接清空用户数据 |
| DELETE FROM ... (无条件) | 清空表中所有数据 |
| TRUNCATE TABLE | 清空表中所有数据 |
| DROP COLUMN | 删除用户已有字段数据 |
| ALTER TABLE ... RENAME TO (覆盖) | 可能导致原表数据丢失 |
| 删除 .db 文件 | 销毁整个数据库 |
| 在 init 脚本中使用 CREATE TABLE IF NOT EXISTS 后直接 DROP | 重建表会导致数据丢失 |

### 3. 查询操作

- DELETE 操作必须有 WHERE 条件，且 WHERE 条件由用户输入指定（如按 ID 删除）
- 批量删除必须经过用户确认（前端已有确认弹窗）
- 查询操作使用只读事务或 readonly 模式

### 4. 服务器运行

- **后端服务器必须保持运行**。如果后端服务器未启动，前端所有功能都无法正常使用。
- 数据库文件路径：`server/data/content-ops-hub.db`
- 备份文件位于同目录，文件名格式：`content-ops-hub.db.pre-migrate-{timestamp}`
- 如需恢复数据，可将最新的 `.pre-migrate-*` 备份文件重命名为 `content-ops-hub.db`
- 启动命令：`cd server && npx ts-node-dev --transpile-only src/index.ts`

### 5. 代码审查检查点

每次代码变更前，必须检查：
- [ ] 是否包含 DROP TABLE/COLUMN？
- [ ] 是否包含无条件 DELETE？
- [ ] 是否修改了 init 脚本中的建表语句？
- [ ] Schema 变更是否使用了幂等升级模式？
- [ ] 修改后是否通过了 TypeScript 编译？
- [ ] 后端服务器能否正常启动？
