/**
 * 服务状态路由 — /api/service-status
 *
 * 复用 port-manager (端口 7400) 的能力，获取工作区所有项目的端口状态。
 * 提供"一键启动全部服务"功能，避免在 content-ops-hub 中重复造轮子。
 *
 * 端点:
 *   GET  /                  获取所有项目端口状态（代理 port-manager）
 *   POST /start-all         一键启动全部服务（代理 port-manager）
 *   POST /stop-all          一键停止全部服务（代理 port-manager）
 *   GET  /local             仅检查 content-ops-hub 自身的前后端状态
 */

import { Router, Request, Response } from 'express';
import { createServiceLogger } from '../utils/logger';
import net from 'net';

const log = createServiceLogger('service-status');
export const router = Router();

// port-manager 配置
const PORT_MANAGER_URL = 'http://localhost:7400';

/** 检查端口是否在线 */
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

// ============================================================================
// GET / - 获取所有项目端口状态（直接检查端口，快速响应）
// ============================================================================

// 关键服务端口列表（从 ports.config.json 提取）
const KEY_SERVICES = [
  { name: 'content-ops-hub', port: 5180, type: '前端', tech: 'Vue 3 + Vite' },
  { name: 'content-ops-hub', port: 3100, type: '后端', tech: 'Express + TS' },
  { name: 'xhs-auto-pipeline', port: 5100, type: '前端', tech: 'Vue 3 + Vite' },
  { name: 'xhs-auto-pipeline', port: 5101, type: '后端', tech: 'Python FastAPI' },
  { name: 'social-radar', port: 5182, type: '前端', tech: 'React + Vite' },
  { name: 'social-radar', port: 3002, type: '后端', tech: 'Koa + TS' },
  { name: 'skill-ecosystem', port: 7173, type: '前端', tech: 'React + Vite' },
  { name: 'skill-ecosystem', port: 7321, type: '后端', tech: 'Koa + TS' },
  { name: 'port-manager', port: 7400, type: '管理器', tech: 'Node.js + Express' },
  { name: 'ollama', port: 11434, type: 'AI推理', tech: 'Ollama 本地大模型' },
];

router.get('/', async (_req: Request, res: Response) => {
  try {
    // 并行检查所有关键端口
    const checks = await Promise.all(
      KEY_SERVICES.map(async (svc) => ({
        ...svc,
        online: await checkPort(svc.port),
      }))
    );

    const onlineCount = checks.filter((s) => s.online).length;

    return res.json({
      success: true,
      data: {
        portManagerOnline: checks.find((s) => s.port === 7400)?.online || false,
        services: checks,
        summary: {
          total: checks.length,
          online: onlineCount,
        },
      },
    });
  } catch (e) {
    log.error(`获取服务状态失败: ${(e as Error).message}`);
    return res.status(500).json({
      success: false,
      error: `获取服务状态失败: ${(e as Error).message}`,
    });
  }
});

// ============================================================================
// GET /local - 仅检查 content-ops-hub 自身的前后端状态
// ============================================================================

router.get('/local', async (_req: Request, res: Response) => {
  try {
    const [frontendOnline, backendOnline] = await Promise.all([
      checkPort(5180),
      checkPort(3100),
    ]);
    return res.json({
      success: true,
      data: {
        frontend: { port: 5180, online: frontendOnline },
        backend: { port: 3100, online: backendOnline },
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ============================================================================
// POST /start-all - 一键启动全部服务（代理 port-manager）
// ============================================================================

router.post('/start-all', async (_req: Request, res: Response) => {
  try {
    const pmOnline = await checkPort(7400);
    if (!pmOnline) {
      return res.status(503).json({
        success: false,
        error: 'port-manager (端口 7400) 未运行，无法启动全部服务。请先启动 port-manager。',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 分钟超时
    try {
      const response = await fetch(`${PORT_MANAGER_URL}/api/start-all`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`port-manager 返回 ${response.status}`);
      }
      const result = await response.json();
      return res.json({
        success: true,
        data: result,
        message: '全部服务启动指令已发送',
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    log.error(`启动全部服务失败: ${(e as Error).message}`);
    return res.status(500).json({
      success: false,
      error: `启动全部服务失败: ${(e as Error).message}`,
    });
  }
});

// ============================================================================
// POST /stop-all - 一键停止全部服务（代理 port-manager）
// ============================================================================

router.post('/stop-all', async (_req: Request, res: Response) => {
  try {
    const pmOnline = await checkPort(7400);
    if (!pmOnline) {
      return res.status(503).json({
        success: false,
        error: 'port-manager (端口 7400) 未运行',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${PORT_MANAGER_URL}/api/stop-all`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`port-manager 返回 ${response.status}`);
      }
      const result = await response.json();
      return res.json({
        success: true,
        data: result,
        message: '全部服务停止指令已发送',
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    log.error(`停止全部服务失败: ${(e as Error).message}`);
    return res.status(500).json({
      success: false,
      error: `停止全部服务失败: ${(e as Error).message}`,
    });
  }
});

export default router;
