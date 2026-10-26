/**
 * 数据库初始化脚本
 * 运行: npm run db:init
 */

import { initDb, closeDb } from './index';

console.log('正在初始化数据库...');

try {
  initDb();
  console.log('✅ 数据库初始化完成');
} catch (error) {
  console.error('❌ 数据库初始化失败:', error);
  process.exit(1);
} finally {
  closeDb();
}
