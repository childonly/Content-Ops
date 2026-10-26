import { getDb, closeDb } from '../src/db/index';

const db = getDb();

console.log('=== 数据库统计 ===');
console.log('schedules:', db.prepare('SELECT COUNT(*) as c FROM schedules').get());
console.log('keywords:', db.prepare('SELECT COUNT(*) as c FROM keywords').get());
console.log('pipeline_runs:', db.prepare('SELECT COUNT(*) as c FROM pipeline_runs').get());
console.log('drafts:', db.prepare('SELECT COUNT(*) as c FROM drafts').get());
console.log('xhs_login_metadata:', db.prepare('SELECT COUNT(*) as c FROM xhs_login_metadata').get());

// 检查 schedules 是否有重复
const dups = db.prepare('SELECT keyword, COUNT(*) as c FROM schedules GROUP BY keyword, cron_expression HAVING c > 1').all() as any[];
if (dups.length > 0) {
  console.log('重复 schedules:', JSON.stringify(dups));
  db.exec('DELETE FROM schedules WHERE id NOT IN (SELECT MIN(id) FROM schedules GROUP BY keyword, cron_expression)');
  console.log('已清理重复 schedules');
  console.log('schedules (清理后):', db.prepare('SELECT COUNT(*) as c FROM schedules').get());
} else {
  console.log('schedules 无重复');
}

closeDb();
