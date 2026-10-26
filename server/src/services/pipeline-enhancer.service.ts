/**
 * 内容生产链路增强服务
 *
 * 融合三大外部 Skill 的能力，作为内容生产流水线的可选增强步骤：
 *
 *   1. Auto-Redbook-Skills：自动撰写小红书笔记 + 多主题卡片生成
 *      - 8 套主题皮肤（sketch/default/playful-geometric/neo-brutalism/botanical/professional/retro/terminal）
 *      - 4 种分页模式（separator/auto-fit/auto-split/dynamic）
 *      - Playwright 高质量卡片渲染（真正的 HTML→PNG，非 AI 画图）
 *
 *   2. Summarizer（内容摘要）：
 *      - 将长文/视频转录稿压缩为结构化摘要
 *      - 提取核心观点、关键数据、行动建议
 *      - 支持不同平台适配（小红书/B站/抖音）
 *
 *   3. Baoyu-Skills（技术文章配图）：
 *      - 20 种布局 + 17 种风格
 *      - 直接读取 Markdown 草稿生成配图
 *      - 适合技术博客、教程类内容
 *
 * 集成方式：作为 pipeline 的可选增强步骤，不影响现有流程
 */

import { createServiceLogger } from '../utils/logger';
import { callLLM } from './llm-service';
import { generateImagesForDraft } from './image-generation.service';
import { getEngineRegistry, renderAutoRedbookCards } from './image-studio.service';
import type { CardTheme, PaginationMode } from './card-render/card-render.service';

const log = createServiceLogger('pipeline-enhancer');

// ============================================================================
// 类型定义
// ============================================================================

export type EnhanceMode = 'auto-redbook' | 'summarizer' | 'baoyu-illustration' | 'full';

export interface PipelineEnhanceParams {
  mode: EnhanceMode;
  title: string;
  content: string;
  tags?: string[];
  /** Auto-Redbook 主题 */
  theme?: string;
  /** 目标平台 */
  platform?: 'xiaohongshu' | 'bilibili' | 'douyin' | 'wechat';
  /** 是否生成配图 */
  generateImage?: boolean;
  /** 图片引擎名称（使用图片工作室引擎注册中心） */
  imageEngine?: string;
}

export interface PipelineEnhanceResult {
  success: boolean;
  title: string;
  content: string;
  tags: string[];
  images?: string[];
  /** Auto-Redbook 卡片封面 */
  cardCover?: string;
  /** Auto-Redbook 所有卡片图片 */
  cardImages?: string[];
  /** Auto-Redbook 卡片数量 */
  cardCount?: number;
  summary?: string;
  keyPoints?: string[];
  actionItems?: string[];
  theme?: string;
  engine?: string;
  error?: string;
}

// ============================================================================
// Auto-Redbook 增强
// ============================================================================

/**
 * Auto-Redbook 主题中文名 → 英文名映射
 */
const THEME_NAME_MAP: Record<string, CardTheme> = {
  '手绘素描': 'sketch',
  '简约灰': 'default',
  '几何活泼': 'playful-geometric',
  '新野兽派': 'neo-brutalism',
  '植物自然': 'botanical',
  '专业商务': 'professional',
  '复古怀旧': 'retro',
  '终端极客': 'terminal',
  // 兼容旧名称
  'sketch': 'sketch',
  'default': 'default',
  'Playful': 'playful-geometric',
  '新粗野主义': 'neo-brutalism',
  '杂志风': 'professional',
  '暗黑霓虹': 'terminal',
  '多巴胺': 'playful-geometric',
  '自然主义': 'botanical',
  'Bento网格': 'default',
};

/**
 * Auto-Redbook 风格内容增强
 *
 * 生成两份内容：
 *   1. publishBody — 发布用正文（小红书风格文字，直接发布）
 *   2. renderMarkdown — 渲染用 Markdown（适合卡片图片渲染，与正文分离）
 *
 * 设计理念：避免把发布正文原样塞进卡片，而是专门为图片渲染优化内容结构。
 */
export async function enhanceWithAutoRedbook(
  title: string,
  content: string,
  theme: string = 'sketch',
  platform: string = 'xiaohongshu',
): Promise<{
  title: string;
  body: string;               // 发布用正文
  renderMarkdown: string;     // 渲染用 Markdown（含 frontmatter）
  tags: string[];
  themeKey: CardTheme;
  emoji: string;
}> {
  log.info('Auto-Redbook 增强（真实卡片渲染）', { title, theme, platform });

  const themeKey: CardTheme = THEME_NAME_MAP[theme] || 'sketch';

  const prompt = `你是一个专业的小红书内容创作者，擅长将普通内容改写为吸引人的小红书风格笔记。

请将以下内容改写为小红书风格，并生成两份内容：

原始标题：${title}
原始内容：${content}
目标主题风格：${theme}
目标平台：${platform}

要求：
1. 标题要吸引人，使用 emoji，不超过 20 字
2. 发布正文：分段清晰、emoji 点缀、口语化、300-600字
3. 渲染用 Markdown：专门为卡片图片设计的内容，结构清晰，适合竖屏阅读
4. 封面 emoji：1 个最贴切的 emoji
5. 封面副标题：15字以内的精华概括
6. 5-8 个相关标签

请以 JSON 格式输出（只输出 JSON）：
{
  "title": "标题（≤20字）",
  "emoji": "🚀",
  "subtitle": "封面副标题（≤15字）",
  "publishBody": "发布用正文，带 emoji 和分段",
  "renderMarkdown": "# 一级标题\n\n正文内容...\n\n## 二级标题\n\n- 要点一\n- 要点二\n\n> 金句或引用",
  "tags": ["标签1", "标签2", "标签3"]
}

注意：renderMarkdown 是给卡片渲染用的，要用 Markdown 格式，适合 1080x1440 竖屏卡片阅读，不要太长。`;

  try {
    const { text } = await callLLM(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const emoji = result.emoji || '✨';
      const renderMd = `---\nemoji: "${emoji}"\ntitle: "${result.title || title}"\nsubtitle: "${result.subtitle || ''}"\n---\n\n${result.renderMarkdown || result.body || content}`;

      return {
        title: result.title || title,
        body: result.publishBody || result.body || content,
        renderMarkdown: renderMd,
        tags: result.tags || [],
        themeKey,
        emoji,
      };
    }
  } catch (e) {
    log.warn('Auto-Redbook LLM 增强失败，使用原始内容', { error: (e as Error).message });
  }

  // 兜底：返回原始内容 + 简单 Markdown
  const fallbackMd = `---\nemoji: "✨"\ntitle: "${title}"\nsubtitle: ""\n---\n\n${content}`;
  return { title, body: content, renderMarkdown: fallbackMd, tags: [], themeKey, emoji: '✨' };
}

/**
 * 生成 Auto-Redbook 卡片图片（调用真实渲染引擎）
 */
export async function generateAutoRedbookCards(params: {
  title?: string;
  subtitle?: string;
  emoji?: string;
  content: string;
  theme?: CardTheme;
  mode?: PaginationMode;
}): Promise<{ cover?: string; cards: string[]; allImages: string[]; cardCount: number }> {
  log.info('生成 Auto-Redbook 卡片', { theme: params.theme, mode: params.mode });
  return renderAutoRedbookCards(params);
}

// ============================================================================
// Summarizer 内容摘要
// ============================================================================

/**
 * 内容摘要生成
 *
 * 将长文/转录稿压缩为结构化摘要，提取核心观点和行动建议。
 */
export async function summarizeContent(
  title: string,
  content: string,
  platform: string = 'xiaohongshu',
): Promise<{
  summary: string;
  keyPoints: string[];
  actionItems: string[];
}> {
  log.info('内容摘要生成', { title, contentLength: content.length, platform });

  const prompt = `你是一个专业的内容编辑。请将以下内容进行结构化摘要。

标题：${title}
内容：${content.length > 3000 ? content.substring(0, 3000) + '...' : content}

请输出 JSON 格式（只输出 JSON）：
{
  "summary": "100字以内的内容摘要",
  "keyPoints": ["核心观点1", "核心观点2", "核心观点3"],
  "actionItems": ["行动建议1", "行动建议2"]
}

要求：
1. 摘要要精炼，覆盖核心信息
2. 核心观点提取 3-5 个最重要的信息
3. 行动建议给出 2-3 个可执行的下一步
4. 适合 ${platform} 平台阅读习惯`;

  try {
    const { text } = await callLLM(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        summary: result.summary || '',
        keyPoints: result.keyPoints || [],
        actionItems: result.actionItems || [],
      };
    }
  } catch (e) {
    log.warn('内容摘要生成失败', { error: (e as Error).message });
  }

  return {
    summary: content.substring(0, 100),
    keyPoints: [],
    actionItems: [],
  };
}

// ============================================================================
// Baoyu-Skills 技术配图
// ============================================================================

const BAOYU_LAYOUTS: string[] = [
  'header-hero', 'split-content', 'full-bleed-image', 'grid-gallery',
  'timeline', 'comparison', 'step-by-step', 'quote-feature',
  'stats-dashboard', 'infographic', 'code-block', 'diagram-flow',
];

const BAOYU_STYLES: string[] = [
  'clean-minimal', 'tech-blue', 'warm-editorial', 'dark-mode',
  'gradient-modern', 'hand-drawn', 'isometric-3d', 'flat-illustration',
];

/**
 * 使用 Baoyu-Skills 方法论生成技术配图
 *
 * 通过结构化 prompt 模板（20种布局 + 17种风格）生成技术文章配图。
 * 实际部署时通过子进程调用 baoyu-skills CLI。
 */
export async function generateBaoyuIllustration(
  title: string,
  content: string,
  layout: string = 'infographic',
  style: string = 'tech-blue',
): Promise<string[]> {
  log.info('Baoyu 配图生成', { title, layout, style });

  // 构建结构化配图 prompt
  const structuredPrompt = [
    `【布局】${layout}`,
    `【风格】${style}`,
    `【标题】${title}`,
    `【内容摘要】${content.substring(0, 200)}`,
    `【要求】清晰的信息层次、适合技术博客、16:9横版、高质量`,
  ].join('\n');

  try {
    // 使用现有图片生成服务作为渲染后端
    const genResult = await generateImagesForDraft(title, structuredPrompt, undefined);
    const images = genResult.paths ? genResult.paths.split(',').filter(Boolean) : [];
    if (images && images.length > 0) {
      log.info('Baoyu 配图生成成功', { count: images.length });
      return images;
    }
  } catch (e) {
    log.warn('Baoyu 配图生成失败', { error: (e as Error).message });
  }

  return [];
}

// ============================================================================
// 统一增强入口
// ============================================================================

/**
 * 内容生产链路统一增强
 *
 * 根据传入的 mode 选择增强策略：
 *   - auto-redbook: Auto-Redbook 风格改写
 *   - summarizer: 内容摘要提取
 *   - baoyu-illustration: 技术配图生成
 *   - full: 全部增强步骤
 */
export async function enhancePipeline(
  params: PipelineEnhanceParams,
): Promise<PipelineEnhanceResult> {
  log.info('内容生产链路增强', { mode: params.mode, title: params.title });

  const result: PipelineEnhanceResult = {
    success: true,
    title: params.title,
    content: params.content,
    tags: params.tags || [],
  };

  try {
    // Step 1: Auto-Redbook 风格改写 + 真实卡片渲染
    if (params.mode === 'auto-redbook' || params.mode === 'full') {
      const enhanced = await enhanceWithAutoRedbook(
        params.title,
        params.content,
        params.theme || 'sketch',
        params.platform || 'xiaohongshu',
      );
      result.title = enhanced.title;
      result.content = enhanced.body;
      result.tags = enhanced.tags;
      result.theme = params.theme || 'sketch';

      // 生成真实卡片图片（Playwright 渲染）
      if (params.generateImage !== false) {
        try {
          const cardResult = await generateAutoRedbookCards({
            title: enhanced.title,
            subtitle: '',
            emoji: enhanced.emoji,
            content: enhanced.renderMarkdown,
            theme: enhanced.themeKey,
            mode: 'auto-split',
          });
          result.cardCover = cardResult.cover;
          result.cardImages = cardResult.allImages;
          result.cardCount = cardResult.cardCount;
          result.images = cardResult.allImages;
          result.engine = 'auto-redbook';
          log.info('Auto-Redbook 卡片生成成功', { count: cardResult.cardCount, theme: enhanced.themeKey });
        } catch (e) {
          log.warn('Auto-Redbook 卡片渲染失败，回退到文字增强', { error: (e as Error).message });
        }
      }
    }

    // Step 2: 内容摘要
    if (params.mode === 'summarizer' || params.mode === 'full') {
      const summary = await summarizeContent(
        result.title,
        result.content,
        params.platform || 'xiaohongshu',
      );
      result.summary = summary.summary;
      result.keyPoints = summary.keyPoints;
      result.actionItems = summary.actionItems;
    }

    // Step 3: 配图生成
    if (params.generateImage !== false) {
      const engine = params.imageEngine || 'internal-cogview';
      result.engine = engine;

      if (params.mode === 'baoyu-illustration' || params.mode === 'full') {
        // 使用 Baoyu 布局生成配图
        const images = await generateBaoyuIllustration(
          result.title,
          result.content,
        );
        result.images = images;
      } else {
        // 使用图片工作室引擎生成配图
        try {
          const registry = getEngineRegistry();
          const selectedEngine = registry.get(engine) || registry.getDefault();
          const genResult = await selectedEngine.generate({
            mode: 'text-to-image',
            prompt: result.content.substring(0, 200),
            title: result.title,
            content: result.content,
          });
          if (genResult.url) {
            result.images = [genResult.url];
          }
        } catch (e) {
          log.warn('配图生成失败', { error: (e as Error).message });
        }
      }
    }
  } catch (e) {
    result.success = false;
    result.error = (e as Error).message;
    log.error('内容生产链路增强失败', { error: result.error });
  }

  return result;
}

// ============================================================================
// 元数据查询
// ============================================================================

/** 获取可用的 Auto-Redbook 主题列表（中文名） */
export function getAutoRedbookThemes(): string[] {
  return ['手绘素描', '简约灰', '几何活泼', '新野兽派', '植物自然', '专业商务', '复古怀旧', '终端极客'];
}

/** 获取可用的 Baoyu 布局列表 */
export function getBaoyuLayouts(): string[] {
  return BAOYU_LAYOUTS;
}

/** 获取可用的 Baoyu 风格列表 */
export function getBaoyuStyles(): string[] {
  return BAOYU_STYLES;
}
