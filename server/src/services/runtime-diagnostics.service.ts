import fs from 'fs';
import { spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { config } from '../config';

export function getRuntimeDiagnostics(): {
  node: string; python: { available: boolean; path: string; version: string; reason?: string };
  xhsSkill: { available: boolean; path: string; configuredPath: string; reason?: string };
  browser: { available: boolean; path: string }; readyForLogin: boolean;
} {
  const check = spawnSync(config.xhsPipelinePythonPath, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  const pythonOk = !check.error && check.status === 0;
  const skillOk = Boolean(config.xhsSkillPath && fs.existsSync(config.xhsSkillPath));
  const browserPath = chromium.executablePath();
  return {
    node: process.version,
    python: { available: pythonOk, path: config.xhsPipelinePythonPath, version: (check.stdout || check.stderr || '').trim(), reason: pythonOk ? undefined : 'Python 不可执行；请设置 XHS_PIPELINE_PYTHON_PATH 为实际 python.exe 路径' },
    xhsSkill: { available: skillOk, path: config.xhsSkillPath, configuredPath: process.env.XHS_SKILL_PATH || '', reason: skillOk ? undefined : '未找到 xiaohongshu-skill；请安装并设置 XHS_SKILL_PATH，安装方法见 README' },
    browser: { available: fs.existsSync(browserPath), path: browserPath }, readyForLogin: pythonOk && skillOk,
  };
}
