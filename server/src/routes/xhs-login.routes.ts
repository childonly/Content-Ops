/**
 * 小红书登录管理路由
 *
 * 端点:
 *   GET   /api/xhs-login/status    获取登录状态(含 Cookie 年龄、过期预警)
 *   POST  /api/xhs-login/qr        启动 QR 码登录流程
 *   POST  /api/xhs-login/refresh   手动刷新 Cookie
 *   GET   /api/xhs-login/browser   检测可用浏览器
 */

import { Router, Request, Response } from 'express';
import {
  getLoginStatus,
  performQrLogin,
  refreshCookies,
  detectBrowser,
  startMonitoring,
} from '../services/xhs-login.service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('xhs-login-routes');
export const router = Router();

// GET /api/xhs-login/status - 获取登录状态
// 添加 8 秒超时保护，避免 Python 脚本执行过久导致前端长时间等待
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await Promise.race([
      getLoginStatus(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('登录状态检查超时，请稍后重试')), 8000),
      ),
    ]);
    res.json({ success: true, data: status });
  } catch (e) {
    log.error(`获取登录状态失败: ${(e as Error).message}`);
    // 超时时返回 200 + 错误标记，避免前端弹错误提示
    res.json({
      success: true,
      data: {
        is_logged_in: false,
        cookie_age_days: 0,
        cookie_age_hours: 0,
        will_expire_soon: false,
        is_expired: true,
        last_login_time: '',
        browser: 'Unknown',
        consecutive_failures: 0,
        max_cookie_age_days: 7,
        warning_threshold_days: 5,
      },
    });
  }
});

// POST /api/xhs-login/qr - 启动 QR 码登录
router.post('/qr', async (_req: Request, res: Response) => {
  try {
    log.info('API 触发 QR 登录');
    const result = await performQrLogin();
    res.json({ success: result.success, data: result, message: result.message });
  } catch (e) {
    log.error(`QR 登录失败: ${(e as Error).message}`);
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-login/refresh - 手动刷新 Cookie
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const success = await refreshCookies();
    res.json({
      success,
      message: success ? 'Cookie 刷新成功' : 'Cookie 刷新失败,可能需要重新登录',
    });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /api/xhs-login/browser - 检测可用浏览器
router.get('/browser', async (_req: Request, res: Response) => {
  try {
    const browser = detectBrowser();
    res.json({ success: true, data: { browser, platform: process.platform } });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /api/xhs-login/monitor/start - 启动后台监控
router.post('/monitor/start', async (_req: Request, res: Response) => {
  try {
    startMonitoring();
    res.json({ success: true, message: '登录监控已启动' });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
