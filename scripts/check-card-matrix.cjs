const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = path.join(root, 'server');
process.chdir(server);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(path.join(server, '.playwright-browsers'))) process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(server, '.playwright-browsers');
const renderer = require(path.join(server, 'dist/services/card-render/card-render.service.js'));
const output = path.join(root, 'logs', `card-matrix-${Date.now()}`);
const results = [];
async function main() {
  try {
    for (const { name: theme } of renderer.getAvailableThemes()) {
      for (const mode of ['separator', 'auto-fit', 'auto-split', 'dynamic']) {
        const content = mode === 'auto-split'
          ? '# 长文验证\n\n' + Array.from({ length: 18 }, (_, n) => `## 第 ${n + 1} 段\n\n中文排版与分页验证。保留全部正文、数字 123 和 emoji 🌿，不把内容截断。`).join('\n\n')
          : '# 卡片验证 🌿\n\n中文、数字 123、粗体 **检查**。\n\n- 第一项\n- 第二项';
        const result = await renderer.renderCards(content, { theme, mode, title: '收口验证', outputDir: path.join(output, theme, mode) });
        if (result.cardCount < 2 || (mode === 'auto-split' && result.cards.length < 2)) throw new Error(`${theme}/${mode}: expected card artifacts`);
        for (const image of result.allImages) {
          const bytes = fs.readFileSync(image);
          if (bytes.readUInt32BE(16) !== 1080 || bytes.readUInt32BE(20) < 1440 || bytes.length < 1000) throw new Error(`Invalid PNG ${image}`);
        }
        results.push({ theme, mode, count: result.cardCount });
        console.log(`PASS ${theme}/${mode}: ${result.cardCount} images`);
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`Card matrix passed: ${results.length}/32. Artifacts: ${output}`);
  } finally { await renderer.closeCardBrowser(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
