/**
 * 图片生成服务 (从 xhs-auto-pipeline image_service.py 移植 + gpt-image-2 结构化模板增强)
 *
 * 图片生成提供商链:
 *   1. 智谱 CogView-4 (付费,与 GLM 共享 API Key)
 *   2. Pollinations.ai (免费备选,无需 API Key)
 *
 * 流程:
 *   1. 自动检测内容类别 (美食/穿搭/旅行/生活方式/产品/教程等)
 *   2. 根据类别选择结构化模板 (参考 gpt-image-2 的模板方法论)
 *   3. 通过 LLM 从标题/内容生成图片描述 prompt,与模板结合
 *   4. 按提供商链调用图片生成 API (CogView → Pollinations 兜底)
 *   5. 下载图片到本地存储
 *   6. 返回本地文件路径(逗号分隔) + 错误信息
 *
 * 对应 Python 源: backend/app/services/image_service.py
 */

import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { callLLM } from './llm-service';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

const log = createServiceLogger('image-service');

// ============================================================================
// 结构化图片 Prompt 模板 (gpt-image-2 方法论)
// ============================================================================
//
// 参考 gpt-image-2 skill 的结构化 JSON 模板方法论:
//   - 每个模板包含: 场景描述 / 主体元素 / 色彩风格 / 构图方式 / 氛围
//   - 模板字段职责清晰,可复用、可扩展
//   - 必须出现什么 (must_keep) / 必须避免什么 (avoid)

export type ImageCategory =
  | 'food'
  | 'fashion'
  | 'travel'
  | 'lifestyle'
  | 'product'
  | 'tutorial'
  | 'beauty'
  | 'fitness'
  | 'home'
  | 'generic';

export interface ImagePromptTemplate {
  scene: string; // 场景描述
  subject: string; // 主体元素
  style: string; // 色彩风格
  composition: string; // 构图方式
  atmosphere: string; // 氛围
  mustKeep: string[]; // 必须保留的元素
  avoid: string[]; // 必须避免的元素
}

const IMAGE_PROMPT_TEMPLATES: Record<ImageCategory, ImagePromptTemplate> = {
  food: {
    scene: '美食特写，自然光下的餐桌，桌面有质感',
    subject: '诱人的食物作为视觉焦点，细节清晰可见',
    style: '温暖色调，浅景深，高饱和度，食欲感强',
    composition: '45度俯拍或正面特写，主体居中，留白适中',
    atmosphere: '温馨、诱人、新鲜、有食欲',
    mustKeep: ['食物是绝对焦点', '光线自然柔和', '色彩温暖饱满'],
    avoid: ['过度滤镜', '食物看起来不新鲜', '杂乱背景抢戏'],
  },
  fashion: {
    scene: '时尚街拍或室内穿搭场景，背景简洁有质感',
    subject: '穿搭主体清晰可见，服饰细节、材质、剪裁突出',
    style: '明亮色调，清晰细节，质感突出，色彩协调',
    composition: '全身或半身构图，姿态自然，展示穿搭重点',
    atmosphere: '自信、时尚、个性化、有态度',
    mustKeep: ['穿搭是视觉核心', '姿态自然不做作', '服饰细节清晰'],
    avoid: ['过度修图', '姿态僵硬', '背景杂乱'],
  },
  travel: {
    scene: '旅行目的地风景或打卡点，场景开阔',
    subject: '人景结合，人物作为画面的活力点',
    style: '广角大场景，色彩鲜明，光影丰富',
    composition: '三分法构图，人景结合，层次分明',
    atmosphere: '自由、探索、美好、向往感',
    mustKeep: ['场景有旅行氛围', '人物融入自然', '光影层次丰富'],
    avoid: ['人物正脸过大', '背景平淡', '色彩失真'],
  },
  lifestyle: {
    scene: '日常生活场景，温馨的居家或咖啡厅环境',
    subject: '生活物件或人物局部，传递生活态度',
    style: '柔和色调，自然光，低饱和度，质感细腻',
    composition: '居中或偏侧构图，留白充足，呼吸感强',
    atmosphere: '治愈、舒适、慢生活、有温度',
    mustKeep: ['场景真实可信', '光线自然', '氛围治愈'],
    avoid: ['过度商业化', '场景虚假', '色彩过艳'],
  },
  product: {
    scene: '简洁背景下的产品展示，环境干净',
    subject: '产品作为绝对主角，材质、细节、logo 清晰',
    style: '高质感，光影精致，色彩还原准确',
    composition: '产品居中，多角度展示，细节特写',
    atmosphere: '专业、精致、高品质、值得信赖',
    mustKeep: ['产品是绝对焦点', '细节清晰锐利', '光影精致'],
    avoid: ['背景喧宾夺主', '产品模糊', '过度滤镜失真'],
  },
  tutorial: {
    scene: '步骤演示场景，桌面整洁有秩序',
    subject: '操作步骤清晰可见，关键动作突出',
    style: '明亮清晰，对比度高，细节可辨',
    composition: '俯拍或侧拍，步骤分明，重点突出',
    atmosphere: '专业、清晰、易学、实用',
    mustKeep: ['步骤清晰可辨', '重点突出', '画面整洁'],
    avoid: ['步骤混乱', '画面杂乱', '关键细节模糊'],
  },
  beauty: {
    scene: '化妆台或护肤场景，光线柔和均匀',
    subject: '美妆产品或妆容细节，质感细腻',
    style: '粉嫩或高级色调，柔光，质感突出',
    composition: '产品特写或妆容局部，构图精致',
    atmosphere: '精致、高级、少女感、治愈',
    mustKeep: ['产品/妆容质感细腻', '光线柔和', '色彩协调'],
    avoid: ['肤色失真', '过度磨皮', '色彩过艳'],
  },
  fitness: {
    scene: '健身房或户外运动场景，光线明亮',
    subject: '运动姿态或健身动作，肌肉线条清晰',
    style: '明亮色调，高对比度，动感十足',
    composition: '动态构图，突出运动姿态',
    atmosphere: '活力、坚持、健康、力量感',
    mustKeep: ['动作姿态标准', '光线明亮', '动感十足'],
    avoid: ['姿态僵硬', '光线昏暗', '画面模糊'],
  },
  home: {
    scene: '温馨的家居环境，客厅/卧室/书房',
    subject: '家居布置或装饰物件，空间感强',
    style: '暖色调，自然光，质感细腻',
    composition: '广角展示空间，或细节特写',
    atmosphere: '温馨、舒适、有品位、归属感',
    mustKeep: ['空间感强', '光线自然', '氛围温馨'],
    avoid: ['空间杂乱', '光线昏暗', '过度装饰'],
  },
  generic: {
    scene: '简洁有质感的场景，符合小红书审美',
    subject: '内容主题相关的主体元素',
    style: '明亮、清新、高质感',
    composition: '居中或三分法构图，留白适中',
    atmosphere: '美好、精致、有品质感',
    mustKeep: ['主体清晰', '光线自然', '氛围美好'],
    avoid: ['杂乱背景', '过度滤镜', '主体模糊'],
  },
};

// ----------------------------------------------------------------------------
// 类别自动检测 (基于标题和标签关键词匹配)
// ----------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Record<Exclude<ImageCategory, 'generic'>, string[]> = {
  food: [
    '美食', '食谱', '做饭', '烹饪', '早餐', '午餐', '晚餐', '宵夜', '零食',
    '餐厅', '探店', '咖啡', '奶茶', '甜点', '蛋糕', '烘焙', '减脂餐',
    '好吃', '美味', '下厨', '料理', '轻食', '早餐',
  ],
  fashion: [
    '穿搭', 'ootd', '时尚', '服装', '搭配', '街拍', 'look', '风衣',
    '连衣裙', '牛仔裤', '外套', '衬衫', '针织', '秋冬穿搭', '春夏穿搭',
    '通勤穿搭', '约会穿搭', '显瘦', '显高',
  ],
  travel: [
    '旅行', '旅游', '打卡', '景点', '游记', '攻略', '拍照', '出片',
    '度假', '民宿', '酒店', '周末去哪', '周边游', 'citywalk', '旅行日记',
    '旅行穿搭', '旅行必备',
  ],
  lifestyle: [
    '生活方式', '日常', '生活', 'vlog', '记录', '治愈', '慢生活',
    '周末', '休息日', '独居', '合租', '居家', '早晨', '晚间',
  ],
  product: [
    '测评', '开箱', '产品', '商品', '推荐', '好物', '购物分享',
    '使用感', '体验', '新品', '种草', '拔草', '购物车',
  ],
  tutorial: [
    '教程', '步骤', '方法', '技巧', '教程', '入门', '指南', 'how',
    '教学', '示范', '流程', '动手', 'DIY', '手把手',
  ],
  beauty: [
    '美妆', '化妆', '护肤', '口红', '粉底', '眼影', '腮红', '护肤',
    '精华', '面霜', '水乳', '面膜', '美甲', '发型', '染发',
  ],
  fitness: [
    '健身', '运动', '减脂', '增肌', '跑步', '瑜伽', '普拉提',
    '腹肌', '马甲线', '翘臀', '拉伸', '训练', '健身房', '打卡运动',
  ],
  home: [
    '家居', '装修', '布置', '收纳', '整理', '房间', '客厅', '卧室',
    '书房', '厨房', '阳台', '软装', '家居好物', '收纳整理',
  ],
};

/**
 * 通过标题和标签关键词匹配自动检测内容类别。
 *
 * @param title      笔记标题
 * @param tags       标签数组 (可选)
 * @returns 检测到的类别,无匹配时返回 'generic'
 */
export function detectImageCategory(title: string, tags?: string[]): ImageCategory {
  const text = `${title} ${(tags ?? []).join(' ')}`.toLowerCase();

  let bestCategory: ImageCategory = 'generic';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category as ImageCategory;
    }
  }

  log.info(`[image] 类别检测: ${bestCategory} (得分 ${bestScore})`);
  return bestCategory;
}

// ----------------------------------------------------------------------------
// 构建结构化图片 Prompt
// ----------------------------------------------------------------------------

/**
 * 构建结构化图片 Prompt (参考 gpt-image-2 模板方法论)。
 *
 * 将类别模板与标题/内容结合,生成结构化的图片描述 prompt。
 * 结构: 场景 + 主体 + 风格 + 构图 + 氛围 + 约束。
 *
 * @param title    笔记标题
 * @param content  笔记内容
 * @param category 可选,指定类别;不传则自动检测
 * @returns 结构化图片 prompt 文本
 */
export function buildStructuredImagePrompt(
  title: string,
  content: string,
  category?: ImageCategory,
): string {
  const detectedCategory = category ?? detectImageCategory(title);
  const template = IMAGE_PROMPT_TEMPLATES[detectedCategory];

  const contentPreview = content.length > 200 ? content.substring(0, 200) : content;

  // 参考 gpt-image-2 的结构化输出
  const structuredPrompt = [
    `【场景】${template.scene}`,
    `【主体】${template.subject}。主题相关: ${title}`,
    `【风格】${template.style}`,
    `【构图】${template.composition}`,
    `【氛围】${template.atmosphere}`,
    `【内容参考】${contentPreview}`,
    `【必须保留】${template.mustKeep.join('、')}`,
    `【必须避免】${template.avoid.join('、')}`,
  ].join('\n');

  log.info(`[image] 构建结构化 prompt (类别: ${detectedCategory})`);
  return structuredPrompt;
}

/**
 * 获取所有可用的图片类别 (供外部查询/展示)。
 */
export function getAvailableImageCategories(): ImageCategory[] {
  return Object.keys(IMAGE_PROMPT_TEMPLATES) as ImageCategory[];
}

/**
 * 获取指定类别的模板 (供外部查询/展示)。
 */
export function getImageTemplate(category: ImageCategory): ImagePromptTemplate {
  return IMAGE_PROMPT_TEMPLATES[category] ?? IMAGE_PROMPT_TEMPLATES.generic;
}

// ============================================================================
// 图片 prompt 生成
// ============================================================================

/**
 * 通过 LLM 从笔记标题/内容生成图片描述 prompt。
 *
 * 增强版: 结合结构化模板 (gpt-image-2 方法论) 与 LLM 生成的描述。
 * - 先用 buildStructuredImagePrompt 构建类别化模板
 * - 再让 LLM 基于模板生成具体的图片描述
 * - LLM 不可用时使用模板兜底
 *
 * LLM 不可用时使用简单模板兜底。
 */
async function generateImagePrompt(title: string, content: string): Promise<string> {
  const contentPreview = content.length > 500 ? content.substring(0, 500) : content;

  // 1. 构建结构化模板 (gpt-image-2 方法论)
  const structuredTemplate = buildStructuredImagePrompt(title, content);

  // 2. 让 LLM 基于结构化模板生成具体描述
  const llmPrompt = `请根据以下小红书笔记的标题、内容和结构化模板，生成一个用于AI图片生成的描述性提示词。

要求：
1. 描述要具体、视觉化，严格遵循结构化模板的【场景】【主体】【风格】【构图】【氛围】要求
2. 适合小红书风格的精美图片
3. 必须满足【必须保留】的条件，避免【必须避免】的元素
4. 只输出图片描述，不要其他解释，不要输出 JSON
5. 描述长度 80-150 字
6. 用中文描述

标题：${title}
内容摘要：${contentPreview}

结构化模板：
${structuredTemplate}`;

  try {
    const { text } = await callLLM(llmPrompt);
    if (text.trim()) {
      // 清理引号和换行
      const cleaned = text.trim().replace(/^["']|["']$/g, '').trim();
      log.info(`[image] 生成图片 prompt: ${cleaned.substring(0, 100)}`);
      return cleaned;
    }
  } catch (e) {
    log.warn(`[image] LLM prompt 生成失败: ${(e as Error).message}`);
  }

  // 兜底: 使用结构化模板本身作为 prompt
  log.info('[image] 使用结构化模板作为兜底 prompt');
  return structuredTemplate;
}

// ============================================================================
// 图片生成结果类型
// ============================================================================

export interface ImageGenResult {
  /** 逗号分隔的本地图片路径,失败返回空字符串 */
  paths: string;
  /** 错误信息(无错误时为空) */
  error: string;
  /** 使用的提供商名称 */
  provider: string;
}

// ============================================================================
// CogView API 调用
// ============================================================================

/**
 * 调用智谱 CogView-4 API 生成图片。
 *
 * @returns 图片 URL 和错误信息,失败时 url 为 null
 */
async function callCogview(prompt: string): Promise<{ url: string | null; error: string }> {
  const apiKey = config.llm.zhipuApiKey;

  if (!apiKey) {
    log.warn('[image] 智谱 API Key 未配置,跳过 CogView');
    return { url: null, error: '智谱 API Key 未配置' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.image.timeout);

  try {
    log.info(`[image] 调用 CogView API (model=${config.image.model})`);

    const resp = await fetch(config.image.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.image.model,
        prompt,
        size: config.image.size,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      let errMsg = `CogView API 错误 (${resp.status})`;
      try {
        const errJson = JSON.parse(errBody);
        if (errJson?.error?.message) {
          errMsg = `CogView: ${errJson.error.message}`;
        }
      } catch {
        errMsg += `: ${errBody.substring(0, 200)}`;
      }
      log.error(`[image] ${errMsg}`);
      return { url: null, error: errMsg };
    }

    const data = (await resp.json()) as any;
    const images = data?.data || [];

    if (Array.isArray(images) && images.length > 0) {
      const url = images[0]?.url;
      if (url) {
        log.info(`[image] CogView 生成图片: ${url.substring(0, 100)}`);
        return { url, error: '' };
      }
    }

    log.warn(`[image] CogView 响应无图片 URL: ${JSON.stringify(data).substring(0, 200)}`);
    return { url: null, error: 'CogView 响应中无图片 URL' };
  } catch (e) {
    const err = e as Error;
    let errMsg: string;
    if (err.name === 'AbortError') {
      errMsg = `CogView 请求超时 (${config.image.timeout}ms)`;
      log.error(`[image] ${errMsg}`);
    } else {
      errMsg = `CogView 调用失败: ${err.message}`;
      log.error(`[image] ${errMsg}`);
    }
    return { url: null, error: errMsg };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Pollinations.ai 免费图片生成 (无需 API Key)
// ============================================================================

/**
 * 调用 Pollinations.ai 免费图片生成 API。
 *
 * Pollinations.ai 是一个免费的 AI 图片生成服务:
 * - 无需 API Key
 * - 无需注册
 * - 直接通过 URL 返回图片
 * - 支持中文 prompt
 *
 * @returns 图片 URL 和错误信息
 */
async function callPollinations(prompt: string): Promise<{ url: string | null; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.image.timeout);

  try {
    log.info('[image] 调用 Pollinations.ai (免费备选)');

    // 将中文 prompt 编码为 URL 安全格式
    // 使用 flux 模型 (质量较好且免费)
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 500));
    const seed = Math.floor(Math.random() * 1000000);
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;

    // Pollinations 直接返回图片二进制数据,需要先 HEAD 请求验证可用性
    const checkResp = await fetch(pollinationsUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!checkResp.ok) {
      const errMsg = `Pollinations.ai 错误 (${checkResp.status})`;
      log.error(`[image] ${errMsg}`);
      return { url: null, error: errMsg };
    }

    // 验证返回的是图片
    const contentType = checkResp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      const errMsg = `Pollinations.ai 返回非图片内容: ${contentType}`;
      log.error(`[image] ${errMsg}`);
      return { url: null, error: errMsg };
    }

    log.info(`[image] Pollinations.ai 生成图片成功: ${pollinationsUrl.substring(0, 100)}`);
    return { url: pollinationsUrl, error: '' };
  } catch (e) {
    const err = e as Error;
    let errMsg: string;
    if (err.name === 'AbortError') {
      errMsg = `Pollinations.ai 请求超时 (${config.image.timeout}ms)`;
    } else {
      errMsg = `Pollinations.ai 调用失败: ${err.message}`;
    }
    log.error(`[image] ${errMsg}`);
    return { url: null, error: errMsg };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// 图片下载
// ============================================================================

/**
 * 下载图片到本地路径。
 */
async function downloadImage(url: string, savePath: string): Promise<boolean> {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      log.error(`[image] 下载失败 HTTP ${resp.status}`);
      return false;
    }

    // 根据内容类型确定扩展名
    const contentType = resp.headers.get('content-type') || '';
    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';

    const finalPath = savePath.endsWith(ext) ? savePath : savePath + ext;

    // 流式下载
    const buffer = Buffer.from(await resp.arrayBuffer());
    await fs.promises.writeFile(finalPath, buffer);

    log.info(`[image] 已下载图片: ${finalPath} (${buffer.length} 字节)`);
    return true;
  } catch (e) {
    const err = e as Error;
    log.error(`[image] 下载失败: ${err.name}: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// 主入口: 为草稿生成图片
// ============================================================================

/**
 * 为笔记草稿生成图片。
 *
 * 提供商链: CogView(付费) → Pollinations.ai(免费兜底)
 *
 * @param title   笔记标题
 * @param content 笔记内容
 * @param draftId 草稿 ID(用于命名文件)
 * @returns 图片生成结果(路径、错误信息、提供商)
 */
export async function generateImagesForDraft(
  title: string,
  content: string,
  draftId?: number,
): Promise<ImageGenResult> {
  // 检查是否启用
  if (!config.image.enabled) {
    log.info('[image] 图片生成已禁用,跳过');
    return { paths: '', error: '图片生成已禁用', provider: 'none' };
  }

  if (config.image.provider === 'none') {
    log.info("[image] provider='none',跳过");
    return { paths: '', error: '图片生成 provider 设为 none', provider: 'none' };
  }

  const count = Math.max(1, Math.min(config.image.count, 4));
  log.info(`[image] 为草稿 '${title}' 生成 ${count} 张图片`);

  // 生成图片 prompt
  const imagePrompt = await generateImagePrompt(title, content);

  // 生成图片
  const imagePaths: string[] = [];
  const idSuffix = draftId ? `_${draftId}` : '';
  const errors: string[] = [];
  let usedProvider = '';

  // 图片输出目录(相对于 server 工作目录)
  const imageDir = path.resolve(process.cwd(), config.image.outputDir);
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }

  for (let i = 0; i < count; i++) {
    let imageUrl: string | null = null;
    let providerName = '';

    // 1. 尝试 CogView (付费)
    const cogviewResult = await callCogview(imagePrompt);
    if (cogviewResult.url) {
      imageUrl = cogviewResult.url;
      providerName = 'cogview';
    } else {
      errors.push(cogviewResult.error);
      log.warn(`[image] CogView 第 ${i + 1}/${count} 张失败: ${cogviewResult.error}`);

      // 2. CogView 失败,尝试 Pollinations.ai (免费兜底)
      log.info(`[image] 切换到 Pollinations.ai 兜底`);
      const pollinationsResult = await callPollinations(imagePrompt);
      if (pollinationsResult.url) {
        imageUrl = pollinationsResult.url;
        providerName = 'pollinations';
      } else {
        errors.push(pollinationsResult.error);
        log.warn(`[image] Pollinations.ai 第 ${i + 1}/${count} 张也失败: ${pollinationsResult.error}`);
      }
    }

    if (!imageUrl) {
      continue;
    }

    const filename = `draft${idSuffix}_${i + 1}`;
    const savePath = path.join(imageDir, filename);

    const success = await downloadImage(imageUrl, savePath);
    if (success) {
      usedProvider = providerName;
      // downloadImage 会根据 content-type 添加扩展名,需重新查找实际文件
      const possibleExts = ['.png', '.jpg', '.webp'];
      for (const ext of possibleExts) {
        if (fs.existsSync(savePath + ext)) {
          imagePaths.push(savePath + ext);
          break;
        }
      }
    }

    // 避免 rate limit
    if (i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (imagePaths.length > 0) {
    const result = imagePaths.join(',');
    log.info(`[image] 共生成 ${imagePaths.length} 张图片 (提供商: ${usedProvider}): ${result}`);
    return { paths: result, error: '', provider: usedProvider };
  }

  const errorMsg = errors.length > 0 ? errors[0] : '未知错误';
  log.warn(`[image] 未生成任何图片,错误: ${errorMsg}`);
  return { paths: '', error: errorMsg, provider: 'none' };
}

/**
 * 获取图片存储目录。
 */
export function getImageDir(): string {
  return path.resolve(process.cwd(), config.image.outputDir);
}
