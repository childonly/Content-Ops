/**
 * 发布引擎注册中心 — 多引擎并行共存
 *
 * 设计原则：
 *   1. 现有 xiaohongshu-skill（Playwright）保持不变，作为默认引擎
 *   2. xiaohongshu-ops-skill 作为并行引擎接入，用户可切换
 *   3. 引擎切换不影响发布记录表结构，仅影响调用路径
 *   4. 每次发布记录中标注使用的引擎名称
 *
 * 引擎列表：
 *   - xhs-skill        xiaohongshu-skill（默认，Playwright 直接发布）
 *   - xhs-ops-skill    xiaohongshu-ops-skill（Playwright + SOP 策略发布）
 */

import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { getDb } from '../db';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { PYTHON_MAX_BUFFER } from '../utils/constants';

const execFileAsync = promisify(execFile);
const log = createServiceLogger('publish-engine');

// ============================================================================
// 类型定义
// ============================================================================

export interface PublishEngineInfo {
  name: string;
  label: string;
  description: string;
  available: boolean;
  isDefault: boolean;
  features: string[];
}

export interface PublishEngineParams {
  title: string;
  content: string;
  tags?: string[];
  images?: string[];
  autoPublish?: boolean;
  headless?: boolean;
}

export interface PublishEngineResult {
  success: boolean;
  url?: string;
  error?: string;
  message?: string;
  engine: string;
}

export class PublishEngineValidationError extends Error {}

export function parsePublishEngineOutput(
  stdout: string,
  engine: string,
): PublishEngineResult {
  const output = stdout.trim();
  const jsonLines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));

  if (jsonLines.length === 0) {
    return {
      success: false,
      error: '发布引擎未返回可解析的 JSON 结果',
      message: output.substring(0, 300),
      engine,
    };
  }

  let result: Record<string, unknown> | undefined;
  for (let index = jsonLines.length - 1; index >= 0; index -= 1) {
    try {
      result = JSON.parse(jsonLines[index]) as Record<string, unknown>;
      break;
    } catch {
      // Continue looking for the last valid structured result.
    }
  }

  if (!result) {
    return {
      success: false,
      error: '发布引擎返回了无效 JSON',
      message: output.substring(0, 300),
      engine,
    };
  }

  const message = typeof result.message === 'string' ? result.message : undefined;
  const error = typeof result.error === 'string' ? result.error : undefined;
  const url =
    (typeof result.url === 'string' && result.url) ||
    (typeof result.note_url === 'string' && result.note_url) ||
    (typeof result.publish_url === 'string' && result.publish_url) ||
    undefined;
  const status = typeof result.status === 'string' ? result.status : '';
  const declaredSuccess = result.success === true || status === 'success' || status === 'published';
  const success = declaredSuccess && Boolean(url);

  return {
    success,
    url,
    error: success ? undefined : (error || message || (declaredSuccess ? '发布结果缺少笔记 URL' : '发布未成功')),
    message,
    engine,
  };
}

export interface PublishEngine {
  name: string;
  label: string;
  description: string;
  features: string[];
  healthCheck(): Promise<boolean>;
  publish(params: PublishEngineParams): Promise<PublishEngineResult>;
}

// ============================================================================
// 引擎实现
// ============================================================================

/**
 * 引擎 1：xiaohongshu-skill（现有默认引擎）
 *
 * 通过 Playwright 直接操作浏览器，支持图文笔记和长文笔记发布。
 * 配置：XHS_SKILL_PATH 环境变量
 */
class XhsSkillEngine implements PublishEngine {
  name = 'xhs-skill';
  label = 'xiaohongshu-skill（默认）';
  description = 'Playwright 直接发布，支持图文笔记和长文笔记，已稳定运行';
  features = ['image-note', 'text-note', 'auto-login-check', 'headless-mode'];

  async healthCheck(): Promise<boolean> {
    return !!config.xhsSkillPath && fs.existsSync(config.xhsSkillPath);
  }

  async publish(params: PublishEngineParams): Promise<PublishEngineResult> {
    log.info('使用 xhs-skill 引擎发布', { title: params.title });

    const hasImages = (params.images?.length ?? 0) > 0;
    const fullContent = params.tags?.length
      ? `${params.content}\n\n${params.tags.map((t) => `#${t}`).join(' ')}`
      : params.content;

    try {
      if (hasImages) {
        // 图文笔记 — 调用 xiaohongshu-skill publish
        const args = [
          '-m', 'scripts', 'publish',
          `--title=${params.title}`,
          `--content=${fullContent}`,
          `--images=${params.images!.join(',')}`,
          params.autoPublish !== false ? '--auto-publish' : '',
          params.headless === false ? '--headless=false' : '--headless=true',
        ].filter(Boolean);

        const { stdout } = await execFileAsync(
          config.xhsPipelinePythonPath || 'python',
          args,
          { cwd: config.xhsSkillPath, timeout: 600000, maxBuffer: PYTHON_MAX_BUFFER, windowsHide: false }
        );

        return parsePublishEngineOutput(stdout, this.name);
      } else {
        // 长文笔记 — 调用 custom_publish.py
        const scriptPath = path.join(config.pythonScriptsPath, 'custom_publish.py');
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`custom_publish.py 不存在: ${scriptPath}`);
        }

        const args = [
          scriptPath,
          `--title=${params.title}`,
          `--content=${fullContent}`,
          params.autoPublish !== false ? '--auto-publish' : '',
          params.headless === false ? '--headless=false' : '--headless=true',
        ].filter(Boolean);

        const { stdout } = await execFileAsync(
          config.xhsPipelinePythonPath || 'python',
          args,
          { cwd: config.pythonScriptsPath, timeout: 600000, maxBuffer: PYTHON_MAX_BUFFER, windowsHide: false }
        );

        return parsePublishEngineOutput(stdout, this.name);
      }
    } catch (e) {
      const err = e as any;
      const errorMsg = (err.stderr || err.stdout || err.message || '').substring(0, 500);
      log.error('xhs-skill 发布失败', { error: errorMsg });
      return { success: false, error: errorMsg, engine: this.name };
    }
  }

}

/**
 * 引擎 2：xiaohongshu-ops-skill（并行引擎）
 *
 * 通过 Playwright + SOP 策略发布，支持 Markdown 长文、图文、视频笔记。
 * 配置：XHS_OPS_SKILL_PATH 环境变量
 *
 * 与 xhs-skill 的区别：
 *   - 支持 Markdown 格式长文
 *   - 内置 SOP 策略（登录 → 创作中心 → 编辑 → 发布）
 *   - 支持定时发布
 *   - 支持视频笔记上传
 */
class XhsOpsSkillEngine implements PublishEngine {
  name = 'xhs-ops-skill';
  label = 'xiaohongshu-ops-skill';
  description = 'Playwright + SOP 策略发布，支持 Markdown 长文、定时发布、视频笔记';
  features = ['image-note', 'text-note', 'markdown-support', 'scheduled-publish', 'video-note', 'sop-strategy'];

  private get skillPath(): string {
    return process.env.XHS_OPS_SKILL_PATH || '';
  }

  async healthCheck(): Promise<boolean> {
    if (!this.skillPath) return false;
    return fs.existsSync(this.skillPath);
  }

  async publish(params: PublishEngineParams): Promise<PublishEngineResult> {
    if (!this.skillPath) {
      throw new Error('xhs-ops-skill 引擎未配置：请设置 XHS_OPS_SKILL_PATH 环境变量');
    }

    log.info('使用 xhs-ops-skill 引擎发布', { title: params.title });

    const fullContent = params.tags?.length
      ? `${params.content}\n\n${params.tags.map((t) => `#${t}`).join(' ')}`
      : params.content;

    try {
      // xhs-ops-skill 使用 CLI 方式调用
      // 支持的命令: python -m xhs_ops publish --title=xxx --content=xxx
      const args = [
        '-m', 'xhs_ops', 'publish',
        `--title=${params.title}`,
        `--content=${fullContent}`,
        params.images?.length ? `--images=${params.images.join(',')}` : '',
        params.autoPublish !== false ? '--auto-publish' : '',
        params.headless === false ? '--headless=false' : '--headless=true',
      ].filter(Boolean);

      const { stdout } = await execFileAsync(
        config.xhsPipelinePythonPath || 'python',
        args,
        { cwd: this.skillPath, timeout: 600000, maxBuffer: PYTHON_MAX_BUFFER, windowsHide: false }
      );

      return parsePublishEngineOutput(stdout, this.name);
    } catch (e) {
      const err = e as any;
      const errorMsg = (err.stderr || err.stdout || err.message || '').substring(0, 500);
      log.error('xhs-ops-skill 发布失败', { error: errorMsg });
      return { success: false, error: errorMsg, engine: this.name };
    }
  }
}

// ============================================================================
// 引擎注册中心
// ============================================================================

class PublishEngineRegistry {
  private engines = new Map<string, PublishEngine>();
  private defaultEngine = 'xhs-skill';
  private persistedDefaultLoaded = false;

  constructor() {
    this.register(new XhsSkillEngine());
    this.register(new XhsOpsSkillEngine());
    log.info('发布引擎注册中心已初始化', {
      engines: Array.from(this.engines.keys()),
      default: this.defaultEngine,
    });
  }

  register(engine: PublishEngine): void {
    this.engines.set(engine.name, engine);
  }

  get(name: string): PublishEngine | undefined {
    return this.engines.get(name);
  }

  private loadPersistedDefault(): void {
    if (this.persistedDefaultLoaded) return;
    this.persistedDefaultLoaded = true;
    try {
      const row = getDb()
        .prepare("SELECT value FROM system_settings WHERE key = 'publish.default_engine'")
        .get() as { value?: string } | undefined;
      if (row?.value && this.engines.has(row.value)) {
        this.defaultEngine = row.value;
      }
    } catch (error) {
      log.warn('读取默认发布引擎失败，使用内置默认值', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getDefaultName(): string {
    this.loadPersistedDefault();
    return this.defaultEngine;
  }

  async setDefault(name: string): Promise<void> {
    this.loadPersistedDefault();
    const engine = this.engines.get(name);
    if (!engine) {
      throw new PublishEngineValidationError(`发布引擎不存在: ${name}`);
    }
    if (!(await engine.healthCheck())) {
      throw new PublishEngineValidationError(`发布引擎当前不可用: ${name}`);
    }

    getDb().prepare(`
      INSERT INTO system_settings (
        key, value, category, label, description, input_type, display_order
      ) VALUES (
        'publish.default_engine', ?, 'publish', '默认发布引擎',
        '发布队列使用的默认执行引擎', 'select', 0
      )
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now','localtime')
    `).run(name);
    this.defaultEngine = name;
    log.info(`默认发布引擎已持久化为: ${name}`);
  }

  async listWithHealth(): Promise<PublishEngineInfo[]> {
    this.loadPersistedDefault();
    const result: PublishEngineInfo[] = [];
    for (const engine of this.engines.values()) {
      try {
        const available = await engine.healthCheck();
        result.push({
          name: engine.name,
          label: engine.label,
          description: engine.description,
          available,
          isDefault: engine.name === this.defaultEngine,
          features: engine.features,
        });
      } catch {
        result.push({
          name: engine.name,
          label: engine.label,
          description: engine.description,
          available: false,
          isDefault: engine.name === this.defaultEngine,
          features: engine.features,
        });
      }
    }
    return result;
  }
}

// 单例
const registry = new PublishEngineRegistry();

// ============================================================================
// 服务方法
// ============================================================================

/** 获取可用发布引擎列表 */
export async function getPublishEngines(): Promise<PublishEngineInfo[]> {
  return registry.listWithHealth();
}

/** 设置默认发布引擎 */
export async function setDefaultPublishEngine(name: string): Promise<void> {
  await registry.setDefault(name);
}

/** 获取默认引擎名称 */
export function getDefaultPublishEngineName(): string {
  return registry.getDefaultName();
}

/** 使用指定引擎发布（如未指定则用默认引擎） */
export async function publishWithEngine(
  params: PublishEngineParams & { engine?: string }
): Promise<PublishEngineResult> {
  const engineName = params.engine?.trim() || registry.getDefaultName();
  const engine = registry.get(engineName);
  if (!engine) {
    return { success: false, error: `发布引擎不存在: ${engineName}`, engine: engineName };
  }
  if (!(await engine.healthCheck())) {
    return { success: false, error: `发布引擎当前不可用: ${engineName}`, engine: engineName };
  }
  return engine.publish(params);
}
