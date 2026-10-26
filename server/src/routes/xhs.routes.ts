/**
 * 小红书登录管理路由 - /api/xhs
 *
 * 提供小红书账号登录状态管理：
 * - GET  /login-status  检查登录状态
 * - POST /login          触发扫码登录（返回二维码路径）
 * - GET  /qrcode         获取二维码图片
 * - POST /logout         退出登录
 */

import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { ApiResponse } from '../types';
import { PYTHON_MAX_BUFFER } from '../utils/constants';

const execFileAsync = promisify(execFile);
const log = createServiceLogger('xhs-routes');

export const router = Router();

// 二维码默认保存路径
const QRCODE_PATH = path.join(config.xhsSkillPath, 'data', 'qrcode.png');

/**
 * 调用 xiaohongshu-skill Python 脚本
 */
async function runXhsScript(args: string[]): Promise<{ stdout: string; stderr: string }> {
  if (!config.xhsSkillPath) {
    throw new Error('XHS_SKILL_PATH 未配置');
  }
  return execFileAsync(config.xhsPipelinePythonPath || 'python', ['-m', 'scripts', ...args], {
    cwd: config.xhsSkillPath,
    timeout: 180000, // 3 分钟超时（扫码需要时间）
    maxBuffer: PYTHON_MAX_BUFFER,
    windowsHide: false,
  });
}

/**
 * 从 Python 脚本输出中提取 JSON
 * Python 脚本可能输出多行，包含日志和 JSON 结果
 */
function extractJsonFromStdout(stdout: string): any {
  // 移除 BOM 和空白字符
  const cleaned = stdout.replace(/\uFEFF/g, '').trim();
  
  // 尝试直接解析
  try {
    return JSON.parse(cleaned);
  } catch {
    // 失败则查找第一个 { 到最后一个 } 的内容
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(jsonStr);
      } catch {
        // 最后尝试：查找最后一行以 { 开头的
        const lines = cleaned.split('\n').filter(l => l.trim().startsWith('{'));
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            return JSON.parse(lines[i].trim());
          } catch {
            continue;
          }
        }
      }
    }
  }
  return {};
}

/**
 * GET /login-status - 检查小红书登录状态
 */
router.get('/login-status', async (req: Request, res: Response) => {
  try {
    const { stdout } = await runXhsScript(['check-login', '--headless=true']);
    const result = extractJsonFromStdout(stdout);

    const response: ApiResponse = {
      success: true,
      data: {
        isLoggedIn: result.is_logged_in === true,
        username: result.username || null,
        message: result.is_logged_in ? '已登录' : '未登录',
      },
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('检查登录状态失败', { error: message });
    res.status(500).json({
      success: false,
      error: `检查登录状态失败: ${message}`,
    } as ApiResponse);
  }
});

/**
 * POST /login - 触发扫码登录
 * 返回二维码图片路径，前端可通过 GET /qrcode 获取图片
 *
 * 注意：此接口会启动可见浏览器窗口，用户需要在前端确认后调用
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const headless = req.body?.headless === true ? 'true' : 'false';

    log.info('触发小红书扫码登录', { headless });

    // 异步启动登录流程（不等待完成，立即返回二维码路径）
    // 登录脚本会打开浏览器，用户扫码后自动保存 cookie
    const { stdout } = await runXhsScript(['qrcode', `--headless=${headless}`]);
    const result = extractJsonFromStdout(stdout);

    const qrcodeExists = fs.existsSync(QRCODE_PATH);

    const response: ApiResponse = {
      success: true,
      data: {
        status: result.status || 'unknown',
        qrcodePath: qrcodeExists ? QRCODE_PATH : null,
        qrcodeUrl: qrcodeExists ? '/api/xhs/qrcode' : null,
        message: result.message || (qrcodeExists ? '二维码已生成，请扫码' : '登录流程已启动'),
        username: result.username || null,
      },
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('扫码登录失败', { error: message });
    res.status(500).json({
      success: false,
      error: `扫码登录失败: ${message}`,
    } as ApiResponse);
  }
});

/**
 * GET /qrcode - 获取二维码图片
 * 返回 PNG 图片，可直接在 <img> 标签中使用
 */
router.get('/qrcode', async (req: Request, res: Response) => {
  try {
    if (!fs.existsSync(QRCODE_PATH)) {
      return res.status(404).json({
        success: false,
        error: '二维码不存在，请先调用 POST /api/xhs/login',
      } as ApiResponse);
    }

    // 防止缓存（每次请求都读最新文件）
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const imgBuffer = await fs.promises.readFile(QRCODE_PATH);
    res.send(imgBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('获取二维码失败', { error: message });
    res.status(500).json({
      success: false,
      error: `获取二维码失败: ${message}`,
    } as ApiResponse);
  }
});

/**
 * POST /logout - 退出登录
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { stdout } = await runXhsScript(['logout']);
    const result = extractJsonFromStdout(stdout);

    const response: ApiResponse = {
      success: true,
      data: {
        status: result.status || 'ok',
        message: result.message || '已退出登录',
      },
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('退出登录失败', { error: message });
    res.status(500).json({
      success: false,
      error: `退出登录失败: ${message}`,
    } as ApiResponse);
  }
});
