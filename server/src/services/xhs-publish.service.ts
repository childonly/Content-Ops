/**
 * 小红书发布服务 (从 xhs-auto-pipeline publish_service.py 移植)
 *
 * 发布策略:
 *   - 有图片 → xiaohongshu-skill publish (图文笔记)
 *   - 无图片 → xhs-auto-pipeline custom_publish (长文笔记,修复 div.creator-tab 拦截 bug)
 *
 * 关键修复:
 *   1. 使用 config.xhsPipelinePythonPath 而非裸 "python",避免 Windows Store stub 问题
 *   2. custom_publish 在 xhs-auto-pipeline/backend 目录运行
 *   3. skill 命令在 config.xhsSkillPath 目录运行
 *
 * 对应 Python 源: backend/app/services/publish_service.py
 */

import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { PYTHON_MAX_BUFFER } from '../utils/constants';

const execFileAsync = promisify(execFile);
const log = createServiceLogger('xhs-publish');

// ============================================================================
// 常量
// ============================================================================

const PUBLISH_TIMEOUT = 600000; // 10 分钟(上传可能较慢)
const LOGIN_CHECK_TIMEOUT = 60000; // 1 分钟

// ============================================================================
// 类型定义
// ============================================================================

export interface PublishNoteParams {
  title: string;
  content: string;
  tags?: string;
  images?: string;
}

export interface PublishResult {
  success: boolean;
  url?: string;
  error?: string;
  message?: string;
}

// ============================================================================
// 登录检查
// ============================================================================

/**
 * 检查 xiaohongshu-skill 是否已登录。
 *
 * 运行 `python -m scripts check-login` 在 skill 目录下。
 */
export async function checkLogin(): Promise<boolean> {
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
        timeout: LOGIN_CHECK_TIMEOUT,
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

// ============================================================================
// 笔记发布
// ============================================================================

/**
 * 发布笔记到小红书。
 *
 * 根据是否有图片自动选择发布命令:
 *   - 有图片: xiaohongshu-skill publish (图文笔记)
 *   - 无图片: xhs-auto-pipeline custom_publish (长文笔记,修复 div.creator-tab 拦截 bug)
 *
 * @param params.title   笔记标题
 * @param params.content 笔记正文
 * @param params.tags    标签(逗号分隔,会追加到正文末尾)
 * @param params.images  图片路径(逗号分隔)
 */
export async function publishNote(params: PublishNoteParams): Promise<PublishResult> {
  const { title, content, tags = '', images = '' } = params;

  if (!config.xhsSkillPath) {
    log.error('XHS_SKILL_PATH 未配置,无法发布');
    return { success: false, error: 'XHS_SKILL_PATH 未配置' };
  }

  // 将 tags 追加到 content 末尾(长文发布不支持单独 tags 参数)
  let fullContent = content;
  if (tags && tags.trim()) {
    // 转换为 #标签 格式
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      fullContent = `${content}\n\n${tagList.map((t) => `#${t}`).join(' ')}`;
    }
  }

  const hasImages = Boolean(images && images.trim());

  // 构建命令
  let cmd: string[];
  let cwd: string;

  if (hasImages) {
    // 图文笔记发布 - 调用 xiaohongshu-skill publish
    log.info(`发布图文笔记: '${title}' (${images.split(',').length} 张图片)`);
    cmd = [
      config.xhsPipelinePythonPath || 'python',
      '-m', 'scripts', 'publish',
      `--title=${title}`,
      `--content=${fullContent}`,
      `--images=${images}`,
      '--auto-publish',
      '--headless=false',
    ];
    cwd = config.xhsSkillPath;
  } else {
    // 长文笔记发布 - 调用本地 custom_publish.py(修复 div.creator-tab 拦截 bug)
    // 脚本已从 xhs-auto-pipeline 迁移到本项目 scripts/python/ 目录
    log.info(`发布长文笔记(无图片) via custom_publish: '${title}'`);

    const customPublishScript = path.join(config.pythonScriptsPath, 'custom_publish.py');

    if (!fs.existsSync(customPublishScript)) {
      log.error(`custom_publish.py 不存在: ${customPublishScript}`);
      return { success: false, error: 'custom_publish.py 不存在' };
    }

    cmd = [
      config.xhsPipelinePythonPath || 'python',
      customPublishScript,
      `--title=${title}`,
      `--content=${fullContent}`,
      '--auto-publish',
      '--headless=false',
    ];
    cwd = config.pythonScriptsPath;
  }

  log.info(`执行命令: ${cmd.slice(0, 4).join(' ')} ...`);

  try {
    const { stdout, stderr } = await execFileAsync(cmd[0], cmd.slice(1), {
      cwd,
      timeout: PUBLISH_TIMEOUT,
      maxBuffer: PYTHON_MAX_BUFFER,
      windowsHide: false,
    });

    // 解析输出
    const output = stdout.trim();
    if (!output) {
      log.warn('发布命令无 stdout 输出');
      if (stderr) {
        log.warn(`stderr: ${stderr.substring(0, 500)}`);
      }
      return { success: false, error: '发布命令无输出' };
    }

    // 尝试解析 JSON 输出
    try {
      const result = JSON.parse(output) as any;

      // xiaohongshu-skill 返回 {"status": "success"/"error", ...}
      // 统一映射为 success 字段
      const url = result.url || result.note_url || result.publish_url;
      const declaredSuccess = result.success === true || result.status === 'success' || result.status === 'published';
      const success = declaredSuccess && Boolean(url);

      if (success) {
        log.info(`笔记发布成功: ${url || '(无 URL)'}`);
        return { success: true, url, message: result.message };
      } else {
        const error = result.error || result.message || '发布未成功';
        log.warn(`笔记发布未成功: ${error}`);
        return { success: false, error, message: result.message };
      }
    } catch {
      // 非 JSON 响应,认为发布成功(部分版本不返回 JSON)
      log.info(`笔记发布完成(非 JSON 响应): ${output.substring(0, 300)}`);
      return { success: false, error: '发布引擎未返回可解析的 JSON 结果', message: output.substring(0, 300) };
    }
  } catch (e) {
    const err = e as any;

    // 超时
    if (err.killed || err.signal === 'SIGTERM') {
      log.error(`发布超时 (${PUBLISH_TIMEOUT / 1000}s): '${title}'`);
      return { success: false, error: `发布超时 (${PUBLISH_TIMEOUT / 1000}s)` };
    }

    // 命令执行失败
    const stderr = err.stderr || '';
    const stdout = err.stdout || '';
    const errorMsg = (stderr || stdout || err.message).substring(0, 500);

    log.error(`发布命令失败 (exit ${err.code || 'unknown'}): ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// ============================================================================
// QR 码登录
// ============================================================================

/**
 * 启动 QR 码登录流程。
 *
 * 运行 `python -m scripts qrcode --headless=false` 在 skill 目录下。
 */
export async function startQrLogin(): Promise<string> {
  if (!config.xhsSkillPath) {
    throw new Error('XHS_SKILL_PATH 未配置,无法启动 QR 登录');
  }

  log.info('启动 QR 码登录流程');

  try {
    const { stdout, stderr } = await execFileAsync(
      config.xhsPipelinePythonPath || 'python',
      ['-m', 'scripts', 'qrcode', '--headless=false'],
      {
        cwd: config.xhsSkillPath,
        timeout: 120000,
        maxBuffer: PYTHON_MAX_BUFFER,
        windowsHide: false,
      },
    );

    const output = (stdout || stderr || '').trim();
    log.info(`QR 登录流程完成: ${output.substring(0, 300)}`);
    return output || 'QR 登录流程完成';
  } catch (e) {
    const err = e as Error;
    log.error(`QR 登录失败: ${err.message}`);
    return `QR 登录失败: ${err.message}`;
  }
}
