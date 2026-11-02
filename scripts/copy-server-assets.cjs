const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'server');
for (const directory of ['templates', 'themes']) {
  const relative = path.join('services', 'card-render', directory);
  const source = path.join(root, 'src', relative);
  const target = path.join(root, 'dist', relative);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isFile()) fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
  }
}
console.log('Copied card templates and themes into server/dist.');
