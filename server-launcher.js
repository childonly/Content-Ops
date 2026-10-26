/**
 * pm2 启动包装脚本
 *
 * 使用 ts-node（而非 ts-node-dev）启动服务。
 *
 * 为什么不用 ts-node-dev？
 *   ts-node-dev 内置文件监听功能，--no-respawn 只防止进程退出后重启，
 *   但文件变更仍会触发重启，导致正在运行的 Python 转录子进程被杀死。
 *   改用 ts-node 彻底消除文件监听，确保服务持续运行不中断。
 *
 * 关键配置：
 *   --transpile-only: 跳过类型检查，加速启动
 *   如需修改代码后重启，手动执行: npx pm2 restart content-ops-hub
 */
const { spawn } = require('child_process');
const path = require('path');

const serverDir = path.join(__dirname, 'server');
const startTime = new Date().toISOString();

console.log(`[${startTime}] Starting content-ops-hub server in ${serverDir}...`);
console.log(`[${startTime}] Using ts-node (no file watching) for stable persistent service.`);

const child = spawn('npx', [
  'ts-node',
  '--transpile-only',
  'src/index.ts'
], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'development' },
});

child.on('error', (err) => {
  console.error(`[FATAL] Failed to start server process: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  const msg = signal 
    ? `killed by signal ${signal}` 
    : `exited with code ${code}`;
  console.log(`[${new Date().toISOString()}] Server process ${msg}`);
  
  // 非零退出码时，延迟退出让 pm2 触发重启
  if (code !== 0 && code !== null) {
    setTimeout(() => process.exit(code || 1), 2000);
  }
});

// 转发信号给子进程
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
