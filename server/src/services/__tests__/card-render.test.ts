import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const page = vi.hoisted(() => ({ setViewportSize: vi.fn(), setContent: vi.fn(), waitForTimeout: vi.fn(), screenshot: vi.fn(), close: vi.fn(), evaluate: vi.fn().mockResolvedValue(100) }));
vi.mock('playwright', () => ({ chromium: { launch: vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page), close: vi.fn() }) } }));
vi.mock('../../utils/logger', () => ({ createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { renderCards } from '../card-render/card-render.service';
let dir: string;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); dir=fs.mkdtempSync(path.join(os.tmpdir(),'coh-card-test-')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); fs.rmSync(dir,{recursive:true,force:true}); });
describe('card render contract', () => {
  it('fills every repeated geometry token and escapes title/emoji as literal text', async () => {
    await renderCards('# 正文', { outputDir:dir, title:'$& <标题>', emoji:'<script>', theme:'sketch', mode:'separator' });
    const html=page.setContent.mock.calls.map(call=>String(call[0])).join('\n');
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(html).toContain('$&amp; &lt;标题&gt;');
    expect(html).not.toContain('<script>');
  });
  it('rejects traversal themes before touching templates or starting rendering', async () => {
    await expect(renderCards('text',{outputDir:dir, theme:'../../private' as never})).rejects.toThrow('主题');
    expect(page.setContent).not.toHaveBeenCalled();
  });
  it('rejects unsupported modes and unreasonable dimensions', async () => {
    await expect(renderCards('text',{outputDir:dir,mode:'bad' as never})).rejects.toThrow('分页');
    await expect(renderCards('text',{outputDir:dir,width:100000})).rejects.toThrow('尺寸');
  });
});
