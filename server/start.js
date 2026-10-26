const { spawn } = require('child_process');
const path = require('path');

const serverDir = path.join(__dirname, 'content-ops-hub', 'server');

const child = spawn('npx', ['ts-node-dev', '--transpile-only', 'src/index.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env },
});

child.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log(`Server exited with code ${code}, pm2 will restart...`);
});

// Keep the process alive
process.on('SIGINT', () => {
  child.kill('SIGINT');
  process.exit(0);
});
