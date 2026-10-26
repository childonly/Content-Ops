/**
 * LLM 多提供商链服务 (从 xhs-auto-pipeline content_service.py 移植)
 *
 * auto 模式顺序:
 *   智谱 GLM(免费云端,2-5s) → DeepSeek(极低成本云端) → Ollama(本地兜底) → 模板
 *
 * 之前 ollama 优先导致使用 qwen2.5-coder:14b(14B 代码模型),
 * 内容创作极慢且质量差,改为云端优先策略。
 *
 * 对应 Python 源: backend/app/services/content_service.py
 */

import { config } from '../config';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('llm-service');

// 单次 LLM 调用超时(ms)
const LLM_TIMEOUT = config.llm.timeout;

// ============================================================================
// 默认 Prompt 模板 (当 xhs-content/references/prompt.md 不存在时使用)
// P1-2 fix: 800 -> 1500-2000 字,更丰富的内容指导
// ============================================================================

export const DEFAULT_PROMPT_TEMPLATE = `你是一个资深小红书内容创作者，拥有百万粉丝运营经验。根据下面的选题报告，生成 1-3 篇高质量小红书笔记草稿。

## 风格规则

### DO
- 标题简洁有力（15-20 字以内），纯文字不带 emoji
- 段落清晰，每段 2-3 行
- 用小红书原生语言：「亲测」「踩坑」「安利」「绝绝子」「救命」「真的会谢」
- 结尾带 3-5 个相关话题标签
- 内容要有「干货感」：步骤、清单、对比、数据支撑
- 用第一人称，像在跟朋友分享经验
- 开头直接抛出痛点或结论，不要铺垫
- 提供具体可操作的建议，不要空泛描述
- 适当使用数字列表增加可读性
- 结合报告中的真实数据和案例来增强说服力

### DON'T
- 正文长度控制在 1500-2000 字（足够详细才能提供价值）
- 不要书面语/学术腔
- 不要「首先…其次…最后」三段式
- 不要过度夸张——保持真实感，像个人经验分享
- 不要「总结一下」「综上所述」等收尾套话
- 不要术语堆砌——说人话
- 不要 AI 味词汇：「赋能」「驱动」「赛道」「底层逻辑」「抓手」「闭环」「链路」
- 不要用破折号（——）做解释，用括号或换行代替
- 不要编造虚假数据或案例

## 输出格式

每篇笔记用以下格式：

\`\`\`
## 笔记 1: [标题]

[正文]

#标签1 #标签2 #标签3
\`\`\`

## 输入

下面是选题报告，请基于报告中的热门角度、数据洞察和真实案例来创作。务必引用报告中的具体数据（如点赞数、热门标签等）来增强内容的可信度。

{report}
`;

// ============================================================================
// Prompt 模板加载
// ============================================================================

/**
 * 从 xhs-content 技能加载 prompt.md 模板。
 * 文件不存在时回退到 DEFAULT_PROMPT_TEMPLATE。
 */
export function loadPromptTemplate(): string {
  if (!config.xhsContentPath) {
    log.warn('XHS_CONTENT_PATH 未配置,使用内置默认 prompt 模板');
    return DEFAULT_PROMPT_TEMPLATE;
  }

  try {
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');
    const promptPath = path.join(config.xhsContentPath, 'references', 'prompt.md');

    if (fs.existsSync(promptPath)) {
      const content = fs.readFileSync(promptPath, 'utf-8');
      log.info(`已加载 prompt 模板: ${promptPath}`);
      return content;
    }

    log.warn(`prompt 模板不存在: ${promptPath},使用内置默认`);
    return DEFAULT_PROMPT_TEMPLATE;
  } catch (e) {
    log.warn(`加载 prompt 模板失败: ${(e as Error).message},使用内置默认`);
    return DEFAULT_PROMPT_TEMPLATE;
  }
}

// ============================================================================
// LLM 提供商实现
// ============================================================================

export interface LLMCallOptions {
  /** 本次调用指定提供商 */
  provider?: string;
  /** 本次调用指定模型 */
  model?: string;
}

export interface LLMCallResult {
  text: string;
  provider: string;
  model: string;
  durationMs: number;
  attemptedProviders?: string[];
}

interface RuntimeLlmConfig {
  provider: string;
  enabled: number;
  model: string | null;
}

function getRuntimeLlmConfigs(): RuntimeLlmConfig[] {
  try {
    return getDb().prepare('SELECT provider, enabled, model FROM llm_configs ORDER BY display_order').all() as RuntimeLlmConfig[];
  } catch {
    return [];
  }
}

function resolveModel(provider: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const row = getRuntimeLlmConfigs().find(item => item.provider === provider && item.enabled !== 0);
  if (row?.model?.trim()) return row.model.trim();
  if (provider === 'zhipu') return config.llm.zhipuModel;
  if (provider === 'deepseek') return config.llm.deepseekModel;
  if (provider === 'ollama') return config.ollamaModel;
  return '';
}

/**
 * 调用智谱 GLM API (OpenAI 兼容)
 * GLM-4-Flash 免费(128K 上下文,4K 输出,2 并发)
 */
async function callZhipu(prompt: string, model?: string): Promise<string> {
  const apiKey = config.llm.zhipuApiKey;
  if (!apiKey) {
    log.info('[zhipu] 未配置 ZHIPU_API_KEY,跳过');
    return '';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT);

  try {
    const resp = await fetch(config.llm.zhipuEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || resolveModel('zhipu'),
        messages: [
          { role: 'system', content: '你是一个专业的小红书内容创作者。' },
          { role: 'user', content: prompt },
        ],
        stream: false,
        temperature: 0.8,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      log.warn(`[zhipu] HTTP ${resp.status}: ${errBody.substring(0, 200)}`);
      return '';
    }

    const data = (await resp.json()) as any;
    const text = data?.choices?.[0]?.message?.content || '';
    return text;
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      log.warn(`[zhipu] 请求超时 (${LLM_TIMEOUT}ms)`);
    } else {
      log.warn(`[zhipu] 调用失败: ${err.name}: ${err.message}`);
    }
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 调用 DeepSeek API (OpenAI 兼容)
 * DeepSeek V4-Flash: $0.14/1M input, $0.28/1M output(极低成本)
 */
async function callDeepseek(prompt: string, model?: string): Promise<string> {
  const apiKey = config.llm.deepseekApiKey;
  if (!apiKey) {
    log.info('[deepseek] 未配置 DEEPSEEK_API_KEY,跳过');
    return '';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT);

  try {
    const resp = await fetch(config.llm.deepseekEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || resolveModel('deepseek'),
        messages: [
          { role: 'system', content: '你是一个专业的小红书内容创作者。' },
          { role: 'user', content: prompt },
        ],
        stream: false,
        temperature: 0.8,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      log.warn(`[deepseek] HTTP ${resp.status}: ${errBody.substring(0, 200)}`);
      return '';
    }

    const data = (await resp.json()) as any;
    const text = data?.choices?.[0]?.message?.content || '';
    return text;
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      log.warn(`[deepseek] 请求超时 (${LLM_TIMEOUT}ms)`);
    } else {
      log.warn(`[deepseek] 调用失败: ${err.name}: ${err.message}`);
    }
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 调用本地 Ollama 模型(兜底)
 */
async function callOllama(prompt: string, model?: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT);

  try {
    const resp = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || resolveModel('ollama'),
        prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      log.warn(`[ollama] HTTP ${resp.status}: ${resp.statusText}`);
      return '';
    }

    const data = (await resp.json()) as any;
    return data?.response || '';
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      log.warn(`[ollama] 请求超时 (${LLM_TIMEOUT}ms)`);
    } else {
      log.warn(`[ollama] 调用失败: ${err.name}: ${err.message}`);
    }
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

// 提供商分发表(auto 模式顺序: 智谱 → DeepSeek → Ollama)
const PROVIDERS: Record<string, (prompt: string, model?: string) => Promise<string>> = {
  zhipu: callZhipu,
  deepseek: callDeepseek,
  ollama: callOllama,
};

// auto 模式下的尝试顺序
const AUTO_ORDER = ['zhipu', 'deepseek', 'ollama'];

/**
 * 调用 LLM(auto 模式按顺序尝试所有提供商)
 *
 * - 若 llm.provider 为 'auto',按 智谱 → DeepSeek → Ollama 顺序尝试,首个非空响应胜出
 * - 若 llm.provider 为具体提供商名,只尝试该提供商
 * - 全部失败时返回空字符串,调用方应回退到模板生成
 */
export async function callLLM(prompt: string, options: LLMCallOptions = {}): Promise<LLMCallResult> {
  let persistedProvider = '';
  if (!options.provider) {
    try {
      const row = getDb().prepare("SELECT value FROM system_settings WHERE key = 'llm.default_provider'").get() as { value?: string } | undefined;
      persistedProvider = row?.value || '';
    } catch { /* 数据库初始化之前使用配置文件默认值 */ }
  }
  const provider = (options.provider || persistedProvider || config.llm.provider || 'auto').toLowerCase().trim();
  const startTime = Date.now();
  const attemptedProviders: string[] = [];

  if (provider === 'auto') {
    for (const name of AUTO_ORDER) {
      log.info(`[llm:auto] 尝试提供商: ${name}`);
      const fn = PROVIDERS[name];
      attemptedProviders.push(name);
      const text = await fn(prompt, undefined);
      if (text.trim()) {
        const duration = Date.now() - startTime;
        log.info(`[llm:auto] 提供商 '${name}' 成功 (${text.length} 字符, ${duration}ms)`);
        return { text, provider: name, model: resolveModel(name), durationMs: duration, attemptedProviders };
      }
      log.info(`[llm:auto] 提供商 '${name}' 返回空,尝试下一个`);
    }
    log.warn('[llm:auto] 所有提供商均失败,需回退到模板');
    return { text: '', provider: 'none', model: '', durationMs: Date.now() - startTime, attemptedProviders };
  }

  const fn = PROVIDERS[provider];
  if (!fn) {
    log.error(`[llm] 未知提供商 '${provider}',回退到模板`);
    return { text: '', provider: 'none', model: '', durationMs: 0, attemptedProviders };
  }

  log.info(`[llm] 使用提供商: ${provider}`);
  attemptedProviders.push(provider);
  const model = resolveModel(provider, options.model);
  const text = await fn(prompt, model);
  return { text, provider, model, durationMs: Date.now() - startTime, attemptedProviders };
}

// ============================================================================
// 草稿解析
// ============================================================================

export interface NoteDraft {
  title: string;
  content: string;
  tags: string;
}

/**
 * 解析 LLM 响应为草稿列表。
 *
 * 期望格式:
 *   ## 笔记 1: [标题]
 *   [正文内容]
 *   标签: [标签1, 标签2, 标签3]
 */
export function parseDrafts(llmResponse: string): NoteDraft[] {
  const drafts: NoteDraft[] = [];
  const pattern = /##\s*笔记\s*\d+\s*[:：]\s*([\s\S]+?)(?=\n##\s*笔记|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(llmResponse)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;

    const lines = raw.split('\n');
    const title = lines[0]?.trim() || '未命名笔记';

    const contentLines: string[] = [];
    let tags = '';

    for (const line of lines.slice(1)) {
      const stripped = line.trim();
      const lower = stripped.toLowerCase();
      // 检测标签行
      if (lower.startsWith('标签') || lower.startsWith('tags') || lower.startsWith('#')) {
        if (stripped.includes(':') || stripped.includes('：')) {
          const sep = stripped.includes('：') ? '：' : ':';
          tags = stripped.split(sep)[1]?.trim() || '';
        } else {
          tags = stripped;
        }
        continue;
      }
      contentLines.push(line);
    }

    let content = contentLines.join('\n').trim();
    if (!content) content = title;

    drafts.push({ title, content, tags: tags.trim() });
  }

  return drafts;
}

/**
 * 从报告第一行标题提取关键词。
 */
export function extractKeywordFromReport(report: string): string {
  for (const line of report.split('\n')) {
    if (line.includes('小红书搜索报告')) {
      for (const sep of ['：', ':']) {
        if (line.includes(sep)) {
          return line.split(sep)[1]?.trim() || '小红书';
        }
      }
    }
  }
  return '小红书';
}

// ============================================================================
// 模板兜底生成
// ============================================================================

/**
 * LLM 不可用时使用内置模板生成草稿。
 */
export function fallbackGenerateDrafts(report: string, maxDrafts: number): NoteDraft[] {
  log.info('使用模板兜底生成草稿');
  const keyword = extractKeywordFromReport(report);

  const templates: NoteDraft[] = [
    {
      title: `【保姆级教程】超实用的${keyword}指南，新手必看！`,
      content: `今天分享一个超实用的${keyword}小技巧！\n\n很多姐妹都在问${keyword}怎么做，今天一次性讲清楚！\n\n第一步：明确你的目标\n第二步：选择合适的方法\n第三步：坚持执行，记录过程\n\n注意事项：\n- 不要急于求成\n- 多看别人的经验\n- 及时复盘调整\n\n希望对你有帮助，记得点赞收藏哦～\n\n#${keyword} #教程 #干货分享`,
      tags: `${keyword},教程,干货分享`,
    },
    {
      title: `【真实测评】${keyword}到底值不值得？看完这篇就懂了`,
      content: `最近很多人问我关于${keyword}的问题\n今天来做个真实测评，不吹不黑！\n\n优点：\n- 效果明显，上手快\n- 性价比高\n- 适合大多数场景\n\n缺点：\n- 需要一定学习成本\n- 部分细节待优化\n\n总结：如果你正在考虑${keyword}，推荐尝试！\n但建议先做好功课再行动～\n\n记得点赞关注，持续分享真实体验！\n\n#${keyword} #测评 #真实分享`,
      tags: `${keyword},测评,真实分享`,
    },
    {
      title: `【避坑指南】${keyword}这些坑千万别踩！`,
      content: `踩过无数坑后，我把${keyword}的经验总结出来了！\n希望你们不要再走弯路～\n\n常见误区：\n- 盲目跟风，不考虑自身情况\n- 只看短期效果，忽略长期影响\n- 过度依赖，缺乏独立思考\n\n正确做法：\n- 结合自身需求理性选择\n- 分阶段进行，循序渐进\n- 多方验证，不轻信单一信息\n\n收藏这篇，随时翻看！\n\n#${keyword} #避坑 #经验分享`,
      tags: `${keyword},避坑,经验分享`,
    },
  ];

  return templates.slice(0, Math.min(maxDrafts, templates.length));
}

// ============================================================================
// 主入口: 从报告生成草稿
// ============================================================================

/**
 * 从研究报告生成笔记草稿。
 *
 * 1. 加载 prompt 模板(xhs-content/references/prompt.md)
 * 2. 用报告填充模板,拼接完整 prompt
 * 3. 调用 LLM(auto 模式: 智谱 → DeepSeek → Ollama)
 * 4. 解析响应为草稿列表
 * 5. LLM 不可用时回退到模板生成
 */
export async function generateDrafts(report: string, maxDrafts: number = 3): Promise<NoteDraft[]> {
  log.info(`开始生成草稿,最多 ${maxDrafts} 篇`);

  const promptTemplate = loadPromptTemplate();

  // P1-2 fix: 正确替换 {report} 占位符
  let promptBody: string;
  try {
    promptBody = promptTemplate.replace(/\{report\}/g, report);
  } catch {
    promptBody = promptTemplate.replace('{report}', report);
  }

  const prompt = `${promptBody}\n\n---\n\n## 任务要求\n\n请生成 ${maxDrafts} 篇小红书笔记草稿。每篇草稿必须包含标题、正文和标签。\n\n请严格按照以下格式输出：\n\n## 笔记 1: [标题]\n[正文内容]\n\n标签: [标签1, 标签2, 标签3]\n\n## 笔记 2: [标题]\n[正文内容]\n\n标签: [标签1, 标签2, 标签3]\n\n（以此类推，共 ${maxDrafts} 篇）\n`;

  const { text: llmResponse, provider } = await callLLM(prompt);

  if (llmResponse) {
    const drafts = parseDrafts(llmResponse);
    if (drafts.length > 0) {
      log.info(`LLM(${provider}) 生成 ${drafts.length} 篇草稿`);
      return drafts.slice(0, maxDrafts);
    }
    log.warn('LLM 响应无可解析草稿,回退到模板');
  } else {
    log.info('LLM 不可用,使用模板生成');
  }

  return fallbackGenerateDrafts(report, maxDrafts);
}
