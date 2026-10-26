#!/usr/bin/env node
/**
 * 统一开发台账机械门禁脚本
 *
 * 检查内容：
 * 1. 台账文件存在
 * 2. 10 个必需章节存在
 * 3. 待办主表表头和每行列数一致（9 列）
 * 4. 所有 CLOSED 任务都有完成时间
 * 5. 所有未关闭任务完成时间均为 — 或 —（未启动）
 * 6. 每个任务都有明确任务接力窗口
 *
 * 用法：
 *   node scripts/check-ledger.js [ledger-path]
 *   node scripts/check-ledger.js --strict
 *   node scripts/check-ledger.js --test        # 运行正例/负例自检（不检查真实台账）
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 检查失败（或自检存在失败用例）
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const DEFAULT_LEDGER = path.join(__dirname, '..', 'docs', 'DEVELOPMENT-LEDGER.md')
const STRICT = process.argv.includes('--strict')

// 必需章节标题（稳定锚点匹配，允许前后有编号或修饰词；[和与] 兼容两种常见措辞）
const REQUIRED_SECTIONS = [
  { pattern: /^##\s+\d*\.?\s*快速导航/m, name: '快速导航 (§1)' },
  { pattern: /^##\s+\d*\.?\s*使用规则[和与]状态口径/m, name: '使用规则和状态口径 (§2)' },
  { pattern: /^##\s+\d*\.?\s*当前项目快照与警报/m, name: '当前项目快照与警报 (§3)' },
  { pattern: /^##\s+\d*\.?\s*待办事项列表/m, name: '待办事项列表 (§4)' },
  { pattern: /^##\s+\d*\.?\s*修改范围、影响[和与]销项证据/m, name: '修改范围、影响和销项证据 (§5)' },
  { pattern: /^##\s+\d*\.?\s*开发进度表/m, name: '开发进度表 (§6)' },
  { pattern: /^##\s+\d*\.?\s*任务窗口与修改范围登记/m, name: '任务窗口与修改范围登记 (§7)' },
  { pattern: /^##\s+\d*\.?\s*每日台账/m, name: '每日台账 (§8)' },
  { pattern: /^##\s+\d*\.?\s*独立审计记录/m, name: '独立审计记录 (§9)' },
  { pattern: /^##\s+\d*\.?\s*重要访问[和与]维护路径/m, name: '重要访问和维护路径 (§10)' },
]

// 待办主表列数
const TASK_TABLE_COLUMNS = 9
const TASK_TABLE_HEADERS = ['Task ID', '建立时间', '完成时间', '任务', '进度', '当前状态 / 正在做什么', '开发受限或停止原因', '负责人', '任务接力窗口']

// 证据表列数
const EVIDENCE_TABLE_COLUMNS = 5

// 进度表列数
const PROGRESS_TABLE_COLUMNS = 6

// 窗口登记表列数
const WINDOW_TABLE_COLUMNS = 5

// 每日台账列数
const DAILY_TABLE_COLUMNS = 7

function fail(message) {
  console.error(`❌ ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`✅ ${message}`)
}

function warn(message) {
  console.warn(`⚠️  ${message}`)
}

function countPipes(line) {
  // 统计一行中 | 的数量（表格列数 = | 数量 - 1）
  // 排除代码块中的 |
  return (line.match(/\|/g) || []).length
}

function parseTableRows(sectionContent) {
  const lines = sectionContent.split('\n')
  const rows = []
  let inTable = false
  let headerPipeCount = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const pipeCount = countPipes(trimmed)
      if (!inTable) {
        // 表头
        inTable = true
        headerPipeCount = pipeCount
        rows.push({ line: trimmed, pipeCount, isHeader: true })
      } else if (trimmed.match(/^\|[\s\-:|]+\|$/)) {
        // 分隔行，跳过
        continue
      } else {
        rows.push({ line: trimmed, pipeCount, isHeader: false })
      }
    } else if (inTable && trimmed === '') {
      // 空行 = 表结束
      break
    }
  }
  return rows
}

function extractSection(content, sectionPattern) {
  const match = content.match(new RegExp(sectionPattern.source + '([\\s\\S]*?)(?=\\n##\\s|\\Z)', 'm'))
  return match ? match[1] : null
}

/**
 * 自检：构造最小合法台账夹具（正例），并派生 4 种负例，
 * 用子进程对夹具运行本脚本，断言退出码符合预期。
 */
function buildValidLedger() {
  return `# 测试台账

## 1. 快速导航

| 角色 | 推荐阅读顺序 |
|------|-------------|
| 项目负责人 | §3 → §4 |

## 2. 使用规则与状态口径

| 状态标记 | 含义 |
|----------|------|
| \`☑ ✅ CLOSED\` | 已关闭 |

## 3. 当前项目快照与警报

- **审计时间**：2026-01-01

## 4. 待办事项列表

| Task ID | 建立时间 | 完成时间 | 任务 | 进度 | 当前状态 / 正在做什么 | 开发受限或停止原因 | 负责人 | 任务接力窗口 |
|---------|----------|----------|------|------|------------------------|---------------------|--------|--------------|
| COH-TEST-001 | 2026-01-01 | 2026-01-02 | 测试任务 | 100% | ✅ CLOSED | — | 测试 | 无（完全销项） |
| COH-TEST-002 | 2026-01-01 | — | 测试任务2 | 50% | 🟦 ACTIVE | — | 测试 | 下一窗口 |

## 5. 修改范围、影响与销项证据

| Task ID | 涉及代码/模块 | 可能影响 | 完成所需极简证据 | 其他提醒 |
|---------|---------------|----------|------------------|----------|
| COH-TEST-001 | — | — | 自检通过 | — |

## 6. 开发进度表

| 模块 | 当前里程碑进度 | 关联 Task ID | 状态 | 受限原因 | 提醒 |
|------|----------------|--------------|------|----------|------|
| 测试模块 | 100% | COH-TEST-001 | ✅ | — | — |

## 7. 任务窗口与修改范围登记

| 任务窗口 / Task ID | 窗口状态 | 当前 Modification Scope | Consumer Verification Scope / 禁止事项 | 最后更新与下一动作 |
|--------------------|----------|--------------------------|------------------------------------------|---------------------|
| 测试窗口 / COH-TEST-002 | 🟦 ACTIVE | 测试 | 禁止 | 2026-01-01 |

## 8. 每日台账

| 日期 | 任务窗口 | 修改 / 审计摘要 | 关联模块 | 关联 Task ID | 状态 / 证据 | 其他提醒 |
|------|----------|------------------|----------|--------------|-------------|----------|
| 2026-01-01 | 测试窗口 | 自检 | 测试 | COH-TEST-001 | PASS | — |

## 9. 独立审计记录

### AUDIT-TEST-001

- **审计时间**：2026-01-01

## 10. 重要访问与维护路径

| 内容 | 路径 | 类型 |
|------|------|------|
| 台账 | \`docs/DEVELOPMENT-LEDGER.md\` | operational index |
`
}

function runSelfTests() {
  const scriptPath = __filename
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-self-test-'))
  let passed = 0
  let failed = 0

  const valid = buildValidLedger()
  const cases = [
    { name: '正例：完整合法台账 → 退出码 0', fixture: valid, expectExit: 0 },
    { name: '负例：缺少必需章节(§2) → 退出码 1', fixture: valid.replace('## 2. 使用规则与状态口径\n', ''), expectExit: 1 },
    { name: '负例：CLOSED 任务缺完成时间 → 退出码 1', fixture: valid.replace('| COH-TEST-001 | 2026-01-01 | 2026-01-02 |', '| COH-TEST-001 | 2026-01-01 | — |'), expectExit: 1 },
    { name: '负例：未关闭任务填完成时间 → 退出码 1', fixture: valid.replace('| COH-TEST-002 | 2026-01-01 | — |', '| COH-TEST-002 | 2026-01-01 | 2026-01-02 |'), expectExit: 1 },
    { name: '负例：任务缺接力窗口 → 退出码 1', fixture: valid.replace('| COH-TEST-002 | 2026-01-01 | — | 测试任务2 | 50% | 🟦 ACTIVE | — | 测试 | 下一窗口 |', '| COH-TEST-002 | 2026-01-01 | — | 测试任务2 | 50% | 🟦 ACTIVE | — | 测试 |  |'), expectExit: 1 },
  ]

  console.log('\n🧪 台账门禁自检（正例/负例）')
  for (const c of cases) {
    const fixturePath = path.join(tmpDir, 'ledger.md')
    fs.writeFileSync(fixturePath, c.fixture, 'utf-8')
    let actualExit
    try {
      execFileSync(process.execPath, [scriptPath, fixturePath], { stdio: 'ignore' })
      actualExit = 0
    } catch (e) {
      actualExit = typeof e.status === 'number' ? e.status : 1
    }
    if (actualExit === c.expectExit) {
      pass(`  ${c.name}（实际退出码 ${actualExit}）`)
      passed++
    } else {
      fail(`  ${c.name}（预期退出码 ${c.expectExit}，实际 ${actualExit}）`)
      failed++
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })

  console.log(`\n自检结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) {
    process.exitCode = 1
  }
}

function main() {
  if (process.argv.includes('--test')) {
    runSelfTests()
    return
  }
  const ledgerPath = process.argv.find(a => !a.startsWith('--') && a.endsWith('.md')) || DEFAULT_LEDGER
  const absolutePath = path.resolve(ledgerPath)

  console.log(`\n📋 台账门禁检查`)
  console.log(`   台账路径: ${absolutePath}`)
  console.log(`   严格模式: ${STRICT ? '是' : '否'}`)
  console.log('')

  // 1. 文件存在检查
  if (!fs.existsSync(absolutePath)) {
    fail(`台账文件不存在: ${absolutePath}`)
    process.exit(1)
  }
  pass('台账文件存在')

  const content = fs.readFileSync(absolutePath, 'utf-8')
  const lines = content.split('\n')

  // 2. 必需章节检查
  console.log('\n📑 必需章节检查:')
  let missingSections = 0
  for (const section of REQUIRED_SECTIONS) {
    if (section.pattern.test(content)) {
      pass(`  ${section.name}`)
    } else {
      fail(`  缺少章节: ${section.name}`)
      missingSections++
    }
  }
  if (missingSections > 0) {
    fail(`共缺少 ${missingSections} 个必需章节`)
  }

  // 3. 待办主表检查
  console.log('\n📊 待办主表结构检查:')
  const taskSectionPattern = /^##\s+\d*\.?\s*待办事项列表/m
  const taskSection = extractSection(content, taskSectionPattern)

  if (!taskSection) {
    fail('无法找到待办事项列表章节')
  } else {
    const taskRows = parseTableRows(taskSection)
    if (taskRows.length === 0) {
      fail('待办主表为空或未找到')
    } else {
      const headerRow = taskRows.find(r => r.isHeader)
      if (!headerRow) {
        fail('待办主表缺少表头')
      } else {
        const expectedColumns = TASK_TABLE_COLUMNS
        const headerColumns = headerRow.pipeCount - 1

        if (headerColumns !== expectedColumns) {
          fail(`待办主表表头列数错误: 预期 ${expectedColumns} 列，实际 ${headerColumns} 列`)
        } else {
          pass(`  表头列数正确 (${expectedColumns} 列)`)
        }

        // 检查每行列数一致性
        let columnMismatches = 0
        for (const row of taskRows.filter(r => !r.isHeader)) {
          const cols = row.pipeCount - 1
          if (cols !== expectedColumns) {
            fail(`  行 "${row.line.substring(0, 60)}..." 列数错误: 预期 ${expectedColumns}，实际 ${cols}`)
            columnMismatches++
          }
        }
        if (columnMismatches === 0) {
          pass(`  所有数据行列数一致 (${taskRows.filter(r => !r.isHeader).length} 行)`)
        }
      }
    }

    // 4. CLOSED 任务完成时间检查
    console.log('\n✅ CLOSED 任务完成时间检查:')
    const dataRows = taskRows.filter(r => !r.isHeader)
    let closedWithDate = 0
    let closedMissingDate = 0
    let openWithDate = 0
    let handoffMissing = 0

    for (const row of dataRows) {
      const cells = row.line.split('|').slice(1, -1).map(c => c.trim())
      if (cells.length < 9) continue

      const taskId = cells[0]
      const status = cells[5]
      const completeDate = cells[2]
      const handoff = cells[8]

      const isClosed = status.includes('CLOSED') || status.includes('✅')

      if (isClosed) {
        if (completeDate === '—' || completeDate === '' || completeDate.includes('未启动')) {
          fail(`  ${taskId}: CLOSED 但完成时间为 "${completeDate}"`)
          closedMissingDate++
        } else {
          closedWithDate++
        }
      } else {
        // 未关闭的任务
        if (completeDate !== '—' && completeDate !== '—（未启动）' && completeDate !== '') {
          fail(`  ${taskId}: 未关闭但完成时间已填 "${completeDate}"`)
          openWithDate++
        }
      }

      // 6. 任务接力窗口检查
      if (!handoff || handoff === '') {
        fail(`  ${taskId}: 缺少任务接力窗口`)
        handoffMissing++
      }
    }

    if (closedWithDate > 0) pass(`  ${closedWithDate} 个 CLOSED 任务有完成时间`)
    if (closedMissingDate > 0) fail(`  ${closedMissingDate} 个 CLOSED 任务缺少完成时间`)
    if (openWithDate > 0) fail(`  ${openWithDate} 个未关闭任务错误填写了完成时间`)
    if (handoffMissing > 0) fail(`  ${handoffMissing} 个任务缺少接力窗口`)
  }

  // 5. 其他表结构粗略检查
  console.log('\n📋 其他表格列数检查:')

  const tablesToCheck = [
    { name: '修改范围与证据表', pattern: /^##\s+\d*\.?\s*修改范围、影响[和与]销项证据/m, cols: EVIDENCE_TABLE_COLUMNS },
    { name: '开发进度表', pattern: /^##\s+\d*\.?\s*开发进度表/m, cols: PROGRESS_TABLE_COLUMNS },
    { name: '窗口登记表', pattern: /^##\s+\d*\.?\s*任务窗口与修改范围登记/m, cols: WINDOW_TABLE_COLUMNS },
    { name: '每日台账表', pattern: /^##\s+\d*\.?\s*每日台账/m, cols: DAILY_TABLE_COLUMNS },
  ]

  for (const t of tablesToCheck) {
    const section = extractSection(content, t.pattern)
    if (!section) {
      warn(`  ${t.name}: 未找到章节（跳过）`)
      continue
    }
    const rows = parseTableRows(section)
    if (rows.length === 0) {
      warn(`  ${t.name}: 无表格（跳过）`)
      continue
    }
    const headerRow = rows.find(r => r.isHeader)
    if (!headerRow) {
      warn(`  ${t.name}: 无表头（跳过）`)
      continue
    }
    const headerCols = headerRow.pipeCount - 1
    if (headerCols !== t.cols) {
      fail(`  ${t.name}: 表头列数错误 (预期 ${t.cols}，实际 ${headerCols})`)
    } else {
      pass(`  ${t.name}: ${rows.filter(r => !r.isHeader).length} 行，列数一致 (${t.cols} 列)`)
    }
  }

  // 总结
  console.log('\n' + '═'.repeat(50))
  if (process.exitCode === 1) {
    console.log('❌ 台账门禁检查失败')
    console.log('   请修复上述问题后再提交。')
  } else {
    console.log('✅ 台账门禁检查通过')
    console.log(`   检查了 ${REQUIRED_SECTIONS.length} 个章节 + 5 张表格`)
  }
  console.log('')
}

main()
