import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it } from 'vitest';
import { firstExistingPath } from '../../utils/runtime-paths';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
it('skips stale configured paths and Windows Store aliases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coh-runtime-')); roots.push(dir);
  const binary = path.join(dir, 'python.exe'); fs.writeFileSync(binary, 'fixture');
  expect(firstExistingPath([path.join(dir, 'missing.exe'), binary])).toBe(binary);
  expect(firstExistingPath([path.join(dir, 'missing.exe')])).toBe('');
});
