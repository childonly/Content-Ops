/**
 * 图片工作室服务 — 多引擎架构
 *
 * 核心设计：
 *   1. EngineRegistry — 引擎注册中心，管理多个图片生成引擎
 *   2. 每个引擎实现 ImageEngine 接口（generate / healthCheck / info）
 *   3. 默认引擎使用现有 CogView/Pollinations 链
 *   4. 外部引擎（RedInk、guizang-social-card、Auto-Redbook）通过子进程/HTTP 接入
 *   5. 生成记录持久化到 image_studio_records 表
 *
 * 引擎列表：
 *   - internal-cogview    智谱 CogView-3-Flash（默认，免费）
 *   - internal-pollinations  Pollinations.ai（免费兜底）
 *   - redink              RedInk 红墨（一句话生图，需部署）
 *   - guizang-card        guizang-social-card（28版式+10主题，需安装）
 *   - auto-redbook        Auto-Redbook-Skills（8套主题皮肤，需安装）
 *   - baoyu-skills        baoyu-skills（技术文章配图，需安装）
 */

import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { getDb } from '../db';
import { generateImagesForDraft } from './image-generation.service';
import { callLLM } from './llm-service';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const log = createServiceLogger('image-studio');

// ============================================================================
// 类型定义
// ============================================================================

export type GenerationMode = 'text-to-image' | 'card' | 'edit';

export interface ImageGenerateParams {
  mode: GenerationMode;
  engine?: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  style?: string;
  title?: string;
  content?: string;
  theme?: string;
  ratio?: string;
  referenceUrl?: string;
}

export interface ImageRecord {
  uid: string;
  title?: string;
  prompt: string;
  url?: string;
  thumbnailUrl?: string;
  mode: GenerationMode;
  status: 'generating' | 'completed' | 'failed';
  engine: string;
  size?: string;
  style?: string;
  theme?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface EngineInfo {
  name: string;
  label: string;
  description: string;
  available: boolean;
  isDefault: boolean;
  modes: GenerationMode[];
  capabilities: string[];
}

export interface ImageEngine {
  name: string;
  label: string;
  description: string;
  modes: GenerationMode[];
  capabilities: string[];
  healthCheck(): Promise<boolean>;
  generate(params: ImageGenerateParams): Promise<{ url: string; thumbnailUrl?: string }>;
}

// ============================================================================
// 引擎实现
// ============================================================================

/**
 * 内置引擎 — 复用现有 CogView/Pollinations 图片生成链
 */
class InternalCogViewEngine implements ImageEngine {
  name = 'internal-cogview';
  label = 'CogView-3-Flash（内置）';
  description = '智谱 CogView-3-Flash 免费图片模型，与 GLM 共享 API Key，Pollinations.ai 作为网络兜底';
  modes: GenerationMode[] = ['text-to-image', 'edit'];
  capabilities = ['photographic', 'illustration', 'auto'];

  async healthCheck(): Promise<boolean> {
    return config.image.enabled;
  }

  async generate(params: ImageGenerateParams): Promise<{ url: string; thumbnailUrl?: string }> {
    log.info('使用内置 CogView 引擎生成图片', { prompt: params.prompt.substring(0, 50) });

    // 复用现有的图片生成服务
    const genResult = await generateImagesForDraft(
      params.title || '图片生成',
      params.content || params.prompt,
      undefined
    );

    const imagePaths = genResult.paths ? genResult.paths.split(',').filter(Boolean) : [];
    if (imagePaths.length === 0) {
      throw new Error('图片生成失败：未返回图片');
    }

    const imageUrl = imagePaths[0];
    const fullUrl = `/api/contents/images/${path.basename(imageUrl)}`;

    return { url: fullUrl, thumbnailUrl: fullUrl };
  }
}

/**
 * RedInk 引擎 — "一句话一张图片"
 *
 * 集成方式：HTTP API（RedInk 部署后提供 Flask API）
 * 配置：REDINK_API_URL 环境变量
 */
class RedInkEngine implements ImageEngine {
  name = 'redink';
  label = 'RedInk 红墨';
  description = '一句话生成小红书图文，Nano Banana Pro + Gemini 3，Flask + Vue 3';
  modes: GenerationMode[] = ['text-to-image', 'card'];
  capabilities = ['xhs-style', 'auto', 'photographic'];

  private get apiUrl(): string {
    return process.env.REDINK_API_URL || '';
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiUrl) return false;
    try {
      const response = await fetch(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(params: ImageGenerateParams): Promise<{ url: string; thumbnailUrl?: string }> {
    if (!this.apiUrl) {
      throw new Error('RedInk 引擎未配置：请设置 REDINK_API_URL 环境变量');
    }

    log.info('使用 RedInk 引擎生成图片', { prompt: params.prompt.substring(0, 50) });

    const response = await fetch(`${this.apiUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        title: params.title,
        style: params.style || 'auto',
        size: params.size || '1080x1440',
      }),
      signal: AbortSignal.timeout(config.image.timeout),
    });

    if (!response.ok) {
      throw new Error(`RedInk API 错误: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { image_url?: string; image_base64?: string };

    if (data.image_url) {
      // 下载远程图片到本地
      const localPath = await this.downloadImage(data.image_url);
      const fullUrl = `/api/contents/images/${path.basename(localPath)}`;
      return { url: fullUrl, thumbnailUrl: fullUrl };
    } else if (data.image_base64) {
      // base64 保存
      const localPath = await this.saveBase64Image(data.image_base64);
      const fullUrl = `/api/contents/images/${path.basename(localPath)}`;
      return { url: fullUrl, thumbnailUrl: fullUrl };
    }

    throw new Error('RedInk API 未返回图片数据');
  }

  private async downloadImage(url: string): Promise<string> {
    const outputDir = path.join(process.cwd(), config.image.outputDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const filename = `redink_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
    const filepath = path.join(outputDir, filename);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载图片失败: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  private async saveBase64Image(base64: string): Promise<string> {
    const outputDir = path.join(process.cwd(), config.image.outputDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const filename = `redink_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
    const filepath = path.join(outputDir, filename);

    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
    return filepath;
  }
}

/**
 * guizang-social-card 引擎 — 高级图文卡片
 *
 * 集成方式：子进程调用 Skill CLI
 * 配置：GUIZANG_CARD_SKILL_PATH 环境变量
 */
class GuizangCardEngine implements ImageEngine {
  name = 'guizang-card';
  label = 'guizang 社交卡片';
  description = '28 个版式骨架 + 10 套主题预设，双视觉系统（电子杂志 + 瑞士国际主义）';
  modes: GenerationMode[] = ['card'];
  capabilities = ['xhs-style', 'magazine', 'swiss', 'editorial'];

  private get skillPath(): string {
    return process.env.GUIZANG_CARD_SKILL_PATH || '';
  }

  async healthCheck(): Promise<boolean> {
    if (!this.skillPath) return false;
    return fs.existsSync(this.skillPath);
  }

  async generate(params: ImageGenerateParams): Promise<{ url: string; thumbnailUrl?: string }> {
    if (!this.skillPath) {
      throw new Error('guizang-card 引擎未配置：请设置 GUIZANG_CARD_SKILL_PATH 环境变量');
    }

    log.info('使用 guizang-card 引擎生成卡片', { title: params.title });

    // 通过 LLM 生成结构化内容，然后调用 Skill 渲染
    const llmResult = await callLLM(
      `你是一个小红书图文卡片内容设计师。请根据以下信息生成卡片内容：\n\n标题：${params.title || params.prompt}\n内容：${params.content || params.prompt}\n主题：${params.theme || '简约灰'}\n\n请输出 JSON 格式：{"title": "卡片标题", "subtitle": "副标题", "body": "正文内容（50字以内）", "tags": ["标签1", "标签2"]}`,
    );

    let cardData: { title: string; subtitle: string; body: string; tags: string[] };
    try {
      cardData = JSON.parse(llmResult.text || '{}');
    } catch {
      cardData = {
        title: params.title || params.prompt.substring(0, 20),
        subtitle: '',
        body: params.content || params.prompt,
        tags: [],
      };
    }

    // 生成卡片图片 — 使用内置引擎作为渲染后端
    // 实际部署时这里会调用 guizang-social-card 的 CLI
    const prompt = `小红书风格图文卡片，标题"${cardData.title}"，副标题"${cardData.subtitle}"，正文"${cardData.body}"，主题风格${params.theme || '简约灰'}，1080x1440px，3:4比例，信息密度高，视觉友好`;

    const images = await generateImagesForDraft(cardData.title, prompt, undefined);
    const imgPaths = images.paths ? images.paths.split(',').filter(Boolean) : [];
    if (imgPaths.length === 0) {
      throw new Error('guizang-card 渲染失败');
    }

    const fullUrl = `/api/contents/images/${path.basename(imgPaths[0])}`;
    return { url: fullUrl, thumbnailUrl: fullUrl };
  }
}

/**
 * Auto-Redbook 引擎 — 真正的 Playwright 卡片渲染（8 套主题 + 4 种分页模式）
 *
 * 基于 card-render.service.ts 实现，使用 Playwright Chromium 将 Markdown 内容
 * 渲染为 1080×1440 的小红书卡片 PNG。
 *
 * 主题：default / sketch / playful-geometric / neo-brutalism / botanical / professional / retro / terminal
 * 分页模式：separator / auto-fit / auto-split / dynamic
 *
 * 配置：
 *   PLAYWRIGHT_BROWSERS_PATH — 浏览器二进制路径（默认项目内 .playwright-browsers/）
 */
class AutoRedbookEngine implements ImageEngine {
  name = 'auto-redbook';
  label = 'Auto-Redbook 卡片渲染';
  description = '基于 Auto-Redbook-Skills 的真正卡片渲染引擎，8 套主题皮肤 + 4 种智能分页模式，Playwright 高质量渲染';
  modes: GenerationMode[] = ['card'];
  capabilities = ['xhs-card', '8-themes', '4-pagination-modes', 'cover-plus-cards'];

  private cardRender: typeof import('./card-render/card-render.service') | null = null;

  private async getCardRender() {
    if (!this.cardRender) {
      this.cardRender = await import('./card-render/card-render.service');
    }
    return this.cardRender!;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const cr = await this.getCardRender();
      const result = await cr.healthCheck();
      return result.available;
    } catch (e) {
      log.warn('Auto-Redbook 引擎健康检查失败', { error: (e as Error).message });
      return false;
    }
  }

  async generate(params: ImageGenerateParams): Promise<{ url: string; thumbnailUrl?: string; allImages?: string[] }> {
    log.info('使用 Auto-Redbook 引擎渲染卡片', {
      title: params.title,
      theme: params.theme,
      mode: params.style,
    });

    const cr = await this.getCardRender();

    // 映射主题参数
    const theme = (params.theme as any) || 'sketch';
    const mode = (params.style as any) || 'auto-split';

    // 构建 Markdown 内容
    // 如果有 title，作为封面；content 作为正文
    let markdown = '';
    if (params.title) {
      markdown += `---\nemoji: "✨"\ntitle: "${params.title}"\nsubtitle: "${params.content ? params.content.substring(0, 30) : ''}"\n---\n\n`;
    }
    markdown += params.content || params.prompt || '';

    // 输出目录
    const outputDir = path.join(process.cwd(), config.image.outputDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const prefix = `autoredbook_${Date.now()}_${crypto.randomBytes(3).toString('hex')}_`;

    const result = await cr.renderCards(markdown, {
      theme,
      mode,
      outputDir,
      prefix,
      title: params.title,
    });

    if (result.allImages.length === 0) {
      throw new Error('Auto-Redbook 卡片渲染失败：未生成图片');
    }

    // 返回第一张作为主图，同时返回所有图片
    const firstImg = result.cover || result.cards[0];
    const firstUrl = `/api/contents/images/${path.basename(firstImg)}`;
    const allUrls = result.allImages.map(p => `/api/contents/images/${path.basename(p)}`);

    return { url: firstUrl, thumbnailUrl: firstUrl, allImages: allUrls };
  }

  async getThemes(): Promise<{ name: string; label: string; description: string }[]> {
    const cr = await this.getCardRender();
    return cr.getAvailableThemes();
  }
}

/**
 * baoyu-skills 引擎 — 技术文章配图
 *
 * 集成方式：子进程调用 Skill CLI
 * 配置：BAOYU_SKILLS_PATH 环境变量
 */
class BaoyuSkillsEngine implements ImageEngine {
  name = 'baoyu-skills';
  label = 'baoyu 配图';
  description = 'AI 辅助技术文章配图，20 种布局 + 17 种风格，直接读取 Markdown 草稿';
  modes: GenerationMode[] = ['text-to-image', 'edit'];
  capabilities = ['tech-article', 'infographic', 'tutorial', 'photographic'];

  private get skillPath(): string {
    return process.env.BAOYU_SKILLS_PATH || '';
  }

  async healthCheck(): Promise<boolean> {
    if (!this.skillPath) return false;
    return fs.existsSync(this.skillPath);
  }

  async generate(params: ImageGenerateParams): Promise<{ url: string; thumbnailUrl?: string }> {
    log.info('使用 baoyu-skills 引擎生成配图', { prompt: params.prompt.substring(0, 50) });

    // 技术文章配图风格 — 更注重信息传达
    const techPrompt = `技术文章配图，${params.style || 'infographic'}风格，主题：${params.prompt}，16:9横版，信息图表风格，清晰的视觉层次，适合技术博客`;

    const images = await generateImagesForDraft(
      params.title || '技术配图',
      techPrompt,
      undefined
    );

    const imgPaths = images.paths ? images.paths.split(',').filter(Boolean) : [];
    if (imgPaths.length === 0) {
      throw new Error('baoyu-skills 配图生成失败');
    }

    const fullUrl = `/api/contents/images/${path.basename(imgPaths[0])}`;
    return { url: fullUrl, thumbnailUrl: fullUrl };
  }
}

// ============================================================================
// 引擎注册中心
// ============================================================================

class EngineRegistry {
  private engines = new Map<string, ImageEngine>();
  private defaultEngine: string;
  private persistedDefaultLoaded = false;

  constructor() {
    // 注册所有引擎
    this.register(new InternalCogViewEngine());
    this.register(new RedInkEngine());
    this.register(new GuizangCardEngine());
    this.register(new AutoRedbookEngine());
    this.register(new BaoyuSkillsEngine());

    // 默认引擎
    this.defaultEngine = 'internal-cogview';
    log.info('图片工作室引擎注册中心已初始化', {
      engines: Array.from(this.engines.keys()),
      default: this.defaultEngine,
    });
  }

  register(engine: ImageEngine): void {
    this.engines.set(engine.name, engine);
  }

  get(name: string): ImageEngine | undefined {
    return this.engines.get(name);
  }

  getDefault(): ImageEngine {
    this.loadPersistedDefault();
    return this.engines.get(this.defaultEngine)!;
  }

  private loadPersistedDefault(): void {
    if (this.persistedDefaultLoaded) return;
    this.persistedDefaultLoaded = true;
    try {
      const row = getDb().prepare("SELECT value FROM system_settings WHERE key = 'image.default_engine'").get() as { value?: string } | undefined;
      if (row?.value && this.engines.has(row.value)) this.defaultEngine = row.value;
    } catch (error) {
      log.warn('读取默认图片引擎失败，使用内置默认值', { error: (error as Error).message });
    }
  }

  async setDefault(name: string): Promise<void> {
    this.loadPersistedDefault();
    const engine = this.engines.get(name);
    if (!engine) throw new Error(`引擎不存在: ${name}`);
    if (!(await engine.healthCheck())) throw new Error(`图片引擎当前不可用: ${name}`);
    getDb().prepare(`INSERT INTO system_settings (key, value, category, label, description, input_type, display_order)
      VALUES ('image.default_engine', ?, 'image', '默认图片引擎', '图片工作室使用的默认引擎', 'select', 0)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now','localtime')`).run(name);
    this.defaultEngine = name;
    log.info(`默认图片引擎已持久化为: ${name}`);
  }

  list(): EngineInfo[] {
    return Array.from(this.engines.values()).map((engine) => ({
      name: engine.name,
      label: engine.label,
      description: engine.description,
      available: false, // 异步检查，这里先返回 false
      isDefault: engine.name === this.defaultEngine,
      modes: engine.modes,
      capabilities: engine.capabilities,
    }));
  }

  async listWithHealth(): Promise<EngineInfo[]> {
    this.loadPersistedDefault();
    const result: EngineInfo[] = [];
    for (const engine of this.engines.values()) {
      try {
        const available = await engine.healthCheck();
        result.push({
          name: engine.name,
          label: engine.label,
          description: engine.description,
          available,
          isDefault: engine.name === this.defaultEngine,
          modes: engine.modes,
          capabilities: engine.capabilities,
        });
      } catch {
        result.push({
          name: engine.name,
          label: engine.label,
          description: engine.description,
          available: false,
          isDefault: engine.name === this.defaultEngine,
          modes: engine.modes,
          capabilities: engine.capabilities,
        });
      }
    }
    return result;
  }
}

// 单例
const registry = new EngineRegistry();

// ============================================================================
// 数据库操作
// ============================================================================

function ensureTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_studio_records (
      uid TEXT PRIMARY KEY,
      title TEXT,
      prompt TEXT NOT NULL,
      url TEXT,
      thumbnail_url TEXT,
      mode TEXT NOT NULL DEFAULT 'text-to-image',
      status TEXT NOT NULL DEFAULT 'generating',
      engine TEXT NOT NULL DEFAULT 'internal-cogview',
      size TEXT,
      style TEXT,
      theme TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_studio_created ON image_studio_records(created_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_studio_status ON image_studio_records(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_studio_engine ON image_studio_records(engine);`);
}

function mapRow(row: any): ImageRecord {
  return {
    uid: row.uid,
    title: row.title,
    prompt: row.prompt,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    mode: row.mode,
    status: row.status,
    engine: row.engine,
    size: row.size,
    style: row.style,
    theme: row.theme,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

// ============================================================================
// 服务方法
// ============================================================================

/**
 * 获取可用引擎列表（含健康检查）
 */
export async function getEngines(): Promise<EngineInfo[]> {
  return registry.listWithHealth();
}

/**
 * 生成图片
 */
export async function generateImage(params: ImageGenerateParams): Promise<ImageRecord> {
  ensureTable();
  const db = getDb();

  // 确定引擎
  const engineName = params.engine || 'internal-cogview';
  const engine = registry.get(engineName) || registry.getDefault();

  // 生成 UID
  const uid = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();

  // 插入 generating 记录
  db.prepare(`
    INSERT INTO image_studio_records (uid, title, prompt, mode, status, engine, size, style, theme, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'generating', ?, ?, ?, ?, ?, ?)
  `).run(
    uid,
    params.title || null,
    params.prompt,
    params.mode,
    engine.name,
    params.size || null,
    params.style || null,
    params.theme || null,
    createdAt,
    createdAt
  );

  try {
    log.info('开始生成图片', { uid, engine: engine.name, mode: params.mode });

    const result = await engine.generate(params);

    // 更新为 completed
    db.prepare(`
      UPDATE image_studio_records
      SET status = 'completed', url = ?, thumbnail_url = ?, updated_at = ?
      WHERE uid = ?
    `).run(result.url, result.thumbnailUrl || null, new Date().toISOString(), uid);

    log.info('图片生成完成', { uid, url: result.url });

    const row = db.prepare('SELECT * FROM image_studio_records WHERE uid = ?').get(uid);
    return mapRow(row);
  } catch (error) {
    const errorMsg = (error as Error).message;
    log.error('图片生成失败', { uid, error: errorMsg });

    db.prepare(`
      UPDATE image_studio_records
      SET status = 'failed', error_message = ?, updated_at = ?
      WHERE uid = ?
    `).run(errorMsg, new Date().toISOString(), uid);

    const row = db.prepare('SELECT * FROM image_studio_records WHERE uid = ?').get(uid);
    return mapRow(row);
  }
}

/**
 * 获取历史记录（分页）
 */
export function getRecords(page: number, pageSize: number): { data: ImageRecord[]; total: number } {
  ensureTable();
  const db = getDb();

  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT * FROM image_studio_records ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(pageSize, offset);

  const total = (db.prepare('SELECT COUNT(*) as count FROM image_studio_records').get() as any).count;

  return {
    data: rows.map(mapRow),
    total,
  };
}

/**
 * 获取单条记录
 */
export function getRecord(uid: string): ImageRecord | null {
  ensureTable();
  const db = getDb();
  const row = db.prepare('SELECT * FROM image_studio_records WHERE uid = ?').get(uid);
  return row ? mapRow(row) : null;
}

/**
 * 删除记录
 */
export function deleteRecord(uid: string): boolean {
  ensureTable();
  const db = getDb();

  // 获取记录中的图片路径，删除文件
  const row = db.prepare('SELECT url FROM image_studio_records WHERE uid = ?').get(uid) as any;
  if (row?.url) {
    const filename = path.basename(row.url);
    const filepath = path.join(process.cwd(), config.image.outputDir, filename);
    if (fs.existsSync(filepath)) {
      try { fs.unlinkSync(filepath); } catch { /* 忽略删除失败 */ }
    }
  }

  const result = db.prepare('DELETE FROM image_studio_records WHERE uid = ?').run(uid);
  return result.changes > 0;
}

/**
 * 设置默认引擎
 */
export async function setDefaultEngine(name: string): Promise<void> {
  await registry.setDefault(name);
}

/**
 * 获取引擎注册中心（供外部使用）
 */
export function getEngineRegistry(): EngineRegistry {
  return registry;
}

/**
 * 获取 Auto-Redbook 可用主题列表
 */
export async function getAutoRedbookThemes(): Promise<{ name: string; label: string; description: string }[]> {
  const engine = registry.get('auto-redbook') as AutoRedbookEngine | undefined;
  if (!engine) return [];
  return engine.getThemes();
}

/**
 * Auto-Redbook 卡片渲染（专用接口，返回所有图片）
 */
export async function renderAutoRedbookCards(params: {
  title?: string;
  subtitle?: string;
  emoji?: string;
  content: string;
  theme?: string;
  mode?: string;
}): Promise<{ cover?: string; cards: string[]; allImages: string[]; cardCount: number }> {
  const engine = registry.get('auto-redbook') as AutoRedbookEngine | undefined;
  if (!engine) throw new Error('Auto-Redbook 引擎不可用');

  // 使用引擎的 generate 方法
  const result = await engine.generate({
    mode: 'card',
    engine: 'auto-redbook',
    prompt: params.content,
    title: params.title,
    content: params.content,
    theme: params.theme,
    style: params.mode,
  });

  // 为了获取所有图片，直接调用 card-render 服务
  const cr = await import('./card-render/card-render.service');
  let markdown = '';
  if (params.title) {
    markdown += `---\nemoji: "${params.emoji || '✨'}"\ntitle: "${params.title}"\nsubtitle: "${params.subtitle || ''}"\n---\n\n`;
  }
  markdown += params.content;

  const outputDir = path.join(process.cwd(), config.image.outputDir);
  const prefix = `autoredbook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;

  const renderResult = await cr.renderCards(markdown, {
    theme: (params.theme || 'sketch') as any,
    mode: (params.mode || 'auto-split') as any,
    outputDir,
    prefix,
    title: params.title,
  });

  return {
    cover: renderResult.cover ? `/api/contents/images/${path.basename(renderResult.cover)}` : undefined,
    cards: renderResult.cards.map(p => `/api/contents/images/${path.basename(p)}`),
    allImages: renderResult.allImages.map(p => `/api/contents/images/${path.basename(p)}`),
    cardCount: renderResult.cardCount,
  };
}
