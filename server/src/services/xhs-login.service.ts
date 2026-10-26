/**
 * 小红书登录服务 (从 xhs-auto-pipeline login_service.py 移植)
 *
 * Cookie 生命周期管理:
 *   - 最大有效期: 7 天
 *   - 预警阈值: 5 天
 *   - 自动刷新: 每 6 小时
 *   - 状态检查: 每 30 分钟
 *
 * 跨平台浏览器选择:
 *   - Windows: Quark → Edge → Chrome
 *   - macOS:   Safari → Chrome
 *
 * 对应 Python 源: backend/app/services/login_service.py
 */

import { config } from '../config';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PYTHON_MAX_BUFFER } from '../utils/constants';

const execFileAsync = promisify(execFile);
const log = createServiceLogger('xhs-login');

// ============================================================================
// 常量
// ============================================================================

const COOKIE_MAX_AGE_DAYS = 7;
const COOKIE_WARNING_DAYS = 5;
const COOKIE_REFRESH_INTERVAL_HOURS = 6;
const LOGIN_CHECK_INTERVAL_MINUTES = 30;

// ============================================================================
// 类型定义
// ============================================================================

export interface LoginStatus {
  is_logged_in: boolean;
  cookie_age_days: number;
  cookie_age_hours: number;
  will_expire_soon: boolean;
  is_expired: boolean;
  last_login_time: string;
  browser: string;
  consecutive_failures: number;
  max_cookie_age_days: number;
  warning_threshold_days: number;
}

// ============================================================================
// 元数据持久化(使用数据库 xhs_login_metadata 表)
// ============================================================================

interface LoginMetadata {
  id?: number;
  is_logged_in: number;
  last_login_time: string | null;
  last_check_time: string | null;
  last_refresh_time: string | null;
  browser: string | null;
  cookie_age_days: number;
  will_expire_soon: number;
  is_expired: number;
  login_count: number;
  refresh_count: number;
  consecutive_failures: number;
  metadata_json: string | null;
  updated_at: string;
}

/**
 * 从数据库加载登录元数据。
 */
function loadMetadata(): LoginMetadata | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM xhs_login_metadata ORDER BY id DESC LIMIT 1').get() as LoginMetadata | undefined;
  return row || null;
}

/**
 * 保存登录元数据到数据库(upsert)。
 */
function saveMetadata(metadata: Partial<LoginMetadata>): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = loadMetadata();

  if (existing) {
    // 更新现有记录
    const updates: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(metadata)) {
      if (key === 'id') continue;
      updates.push(`${key} = ?`);
      params.push(value);
    }
    updates.push('updated_at = ?');
    params.push(now);
    params.push(existing.id);

    db.prepare(`UPDATE xhs_login_metadata SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  } else {
    // 插入新记录
    db.prepare(`
      INSERT INTO xhs_login_metadata (is_logged_in, last_login_time, last_check_time, last_refresh_time,
        browser, cookie_age_days, will_expire_soon, is_expired, login_count, refresh_count,
        consecutive_failures, metadata_json, updated_at)
      VALUES (@is_logged_in, @last_login_time, @last_check_time, @last_refresh_time,
        @browser, @cookie_age_days, @will_expire_soon, @is_expired, @login_count, @refresh_count,
        @consecutive_failures, @metadata_json, @updated_at)
    `).run({
      is_logged_in: metadata.is_logged_in ?? 0,
      last_login_time: metadata.last_login_time ?? null,
      last_check_time: metadata.last_check_time ?? null,
      last_refresh_time: metadata.last_refresh_time ?? null,
      browser: metadata.browser ?? null,
      cookie_age_days: metadata.cookie_age_days ?? 0,
      will_expire_soon: metadata.will_expire_soon ?? 0,
      is_expired: metadata.is_expired ?? 0,
      login_count: metadata.login_count ?? 0,
      refresh_count: metadata.refresh_count ?? 0,
      consecutive_failures: metadata.consecutive_failures ?? 0,
      metadata_json: metadata.metadata_json ?? null,
      updated_at: now,
    });
  }
}

/**
 * 更新登录时间(成功/失败)。
 */
function updateLoginTime(success: boolean): void {
  const metadata = loadMetadata();
  const now = new Date().toISOString();

  if (success) {
    saveMetadata({
      last_login_time: now,
      last_check_time: now,
      login_count: (metadata?.login_count || 0) + 1,
      consecutive_failures: 0,
    });
  } else {
    saveMetadata({
      last_check_time: now,
      consecutive_failures: (metadata?.consecutive_failures || 0) + 1,
    });
  }
}

// ============================================================================
// 浏览器检测
// ============================================================================

/**
 * 检测系统可用的浏览器。
 *
 * 优先级:
 *   - Windows: Quark → Edge → Chrome
 *   - macOS:   Safari → Chrome
 */
export function detectBrowser(): string {
  const platform = os.platform();

  if (platform === 'win32') {
    // Quark(优先)
    const quarkPaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Quark', 'Quark.exe'),
      'C:\\Program Files\\Quark\\Quark.exe',
      'C:\\Program Files (x86)\\Quark\\Quark.exe',
    ];
    for (const p of quarkPaths) {
      if (fs.existsSync(p)) return 'Quark';
    }

    // Edge
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of edgePaths) {
      if (fs.existsSync(p)) return 'Edge';
    }

    // Chrome
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of chromePaths) {
      if (fs.existsSync(p)) return 'Chrome';
    }
  } else if (platform === 'darwin') {
    // macOS: Safari 优先
    if (fs.existsSync('/Applications/Safari.app')) return 'Safari';
    if (fs.existsSync('/Applications/Google Chrome.app')) return 'Chrome';
  }

  return 'Unknown';
}

// ============================================================================
// 登录状态检查
// ============================================================================

/**
 * 调用 xiaohongshu-skill 的 check-login 命令检查登录状态。
 */
async function checkLoginViaSkill(): Promise<boolean> {
  if (!config.xhsSkillPath) {
    log.error('XHS_SKILL_PATH 未配置,无法检查登录状态');
    return false;
  }

  log.info('检查 xiaohongshu-skill 登录状态');

  try {
    const { stdout } = await execFileAsync(
      config.xhsPipelinePythonPath || 'python',
      ['-m', 'scripts', 'check-login'],
      {
        cwd: config.xhsSkillPath,
        timeout: 60000, // 1 分钟
        maxBuffer: PYTHON_MAX_BUFFER,
        windowsHide: false,
      },
    );

    const output = stdout.trim();
    try {
      const result = JSON.parse(output);
      const isLoggedIn = result.is_logged_in === true;
      log.info(`xiaohongshu-skill 登录状态: ${isLoggedIn}`);
      return isLoggedIn;
    } catch {
      // 非 JSON 输出,检查是否包含 "true"
      const lower = output.toLowerCase();
      if (lower === 'true' || lower.includes('"is_logged_in": true')) {
        log.info('xiaohongshu-skill 已登录');
        return true;
      }
      log.warn(`无法解析登录检查输出: ${output.substring(0, 200)}`);
      return false;
    }
  } catch (e) {
    log.error(`登录检查失败: ${(e as Error).message}`);
    return false;
  }
}

/**
 * 获取完整的登录状态(含 Cookie 年龄、过期预警等)。
 */
export async function getLoginStatus(): Promise<LoginStatus> {
  // 检查实际登录状态
  const isLoggedIn = await checkLoginViaSkill();

  // 加载元数据
  const metadata = loadMetadata();
  const lastLoginStr = metadata?.last_login_time || '';

  // 计算 Cookie 年龄
  let cookieAgeDays = 0;
  let cookieAgeHours = 0;

  if (lastLoginStr) {
    const lastLogin = new Date(lastLoginStr);
    const delta = Date.now() - lastLogin.getTime();
    cookieAgeDays = delta / 86400000;
    cookieAgeHours = delta / 3600000;
  }

  // 判断过期状态
  const willExpireSoon = cookieAgeDays >= COOKIE_WARNING_DAYS && isLoggedIn;
  const isExpired = cookieAgeDays >= COOKIE_MAX_AGE_DAYS || !isLoggedIn;

  // 更新元数据
  updateLoginTime(isLoggedIn);

  // 检测浏览器
  const browser = detectBrowser();

  const status: LoginStatus = {
    is_logged_in: isLoggedIn,
    cookie_age_days: Math.round(cookieAgeDays * 10) / 10,
    cookie_age_hours: Math.round(cookieAgeHours * 10) / 10,
    will_expire_soon: willExpireSoon,
    is_expired: isExpired,
    last_login_time: lastLoginStr,
    browser,
    consecutive_failures: metadata?.consecutive_failures || 0,
    max_cookie_age_days: COOKIE_MAX_AGE_DAYS,
    warning_threshold_days: COOKIE_WARNING_DAYS,
  };

  // 持久化状态摘要
  saveMetadata({
    is_logged_in: isLoggedIn ? 1 : 0,
    browser,
    cookie_age_days: cookieAgeDays,
    will_expire_soon: willExpireSoon ? 1 : 0,
    is_expired: isExpired ? 1 : 0,
  });

  return status;
}

// ============================================================================
// Cookie 刷新
// ============================================================================

/**
 * 尝试通过访问小红书页面刷新 Cookie。
 *
 * checkLoginViaSkill() 会访问小红书页面,作为副作用刷新 Cookie。
 */
export async function refreshCookies(): Promise<boolean> {
  log.info('尝试刷新 Cookie...');

  const success = await checkLoginViaSkill();

  if (success) {
    saveMetadata({
      last_refresh_time: new Date().toISOString(),
      refresh_count: (loadMetadata()?.refresh_count || 0) + 1,
    });
    log.info('Cookie 刷新成功');
  } else {
    log.warn('Cookie 刷新失败 - 登录可能已过期');
  }

  return success;
}

// ============================================================================
// 后台监控
// ============================================================================

let monitoringInterval: NodeJS.Timeout | null = null;
let lastRefreshTime = 0;

/**
 * 启动后台登录监控。
 *
 * 每 30 分钟检查一次登录状态,每 6 小时尝试刷新 Cookie。
 */
export function startMonitoring(): void {
  if (monitoringInterval) {
    log.info('登录监控已在运行');
    return;
  }

  log.info(
    `登录监控已启动 (检查间隔: ${LOGIN_CHECK_INTERVAL_MINUTES}分钟, 刷新间隔: ${COOKIE_REFRESH_INTERVAL_HOURS}小时)`,
  );

  monitoringInterval = setInterval(async () => {
    try {
      const status = await getLoginStatus();

      if (!status.is_logged_in) {
        log.warn('登录会话已过期!需重新扫码登录才能继续发布');
      } else if (status.will_expire_soon) {
        log.warn(
          `Cookie 即将过期 (年龄: ${status.cookie_age_days}天, 最大: ${COOKIE_MAX_AGE_DAYS}天),建议刷新登录`,
        );
      }

      // 定期刷新
      const now = Date.now();
      if (status.is_logged_in && now - lastRefreshTime >= COOKIE_REFRESH_INTERVAL_HOURS * 3600000) {
        await refreshCookies();
        lastRefreshTime = now;
      }
    } catch (e) {
      log.error(`登录监控错误: ${(e as Error).message}`);
    }
  }, LOGIN_CHECK_INTERVAL_MINUTES * 60000);
}

/**
 * 停止后台登录监控。
 */
export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    log.info('登录监控已停止');
  }
}

// ============================================================================
// QR 码登录
// ============================================================================

/**
 * 启动 QR 码登录流程。
 */
export async function performQrLogin(): Promise<{ success: boolean; message: string; is_logged_in: boolean }> {
  if (!config.xhsSkillPath) {
    throw new Error('XHS_SKILL_PATH 未配置,无法启动登录');
  }

  log.info('启动 QR 码登录流程...');

  try {
    const { stdout, stderr } = await execFileAsync(
      config.xhsPipelinePythonPath || 'python',
      ['-m', 'scripts', 'qrcode', '--headless=false'],
      {
        cwd: config.xhsSkillPath,
        timeout: 120000, // 2 分钟
        maxBuffer: PYTHON_MAX_BUFFER,
        windowsHide: false,
      },
    );

    const output = (stdout || stderr || '').trim();
    log.info(`QR 登录流程完成: ${output.substring(0, 300)}`);

    // 检查登录是否成功
    const isLoggedIn = await checkLoginViaSkill();

    if (isLoggedIn) {
      saveMetadata({
        is_logged_in: 1,
        last_login_time: new Date().toISOString(),
        login_count: (loadMetadata()?.login_count || 0) + 1,
        consecutive_failures: 0,
      });
      log.info('QR 登录成功,元数据已更新');
    }

    return {
      success: isLoggedIn,
      message: output || 'QR 登录流程完成',
      is_logged_in: isLoggedIn,
    };
  } catch (e) {
    const err = e as Error;
    log.error(`QR 登录失败: ${err.message}`);
    const rawMessage = err.message || String(e);
    const message = /ProcessSingleton|profile directory|Target page, context or browser has been closed/i.test(rawMessage)
      ? '二维码登录无法启动：Edge 用户目录正在被占用，请关闭已有 Edge/XHS 自动化窗口后重试。'
      : rawMessage;
    return {
      success: false,
      message,
      is_logged_in: false,
    };
  }
}
