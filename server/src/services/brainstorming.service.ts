/**
 * 创意规划服务 (brainstorming skill 方法论移植)
 *
 * 在内容生成前进行创意规划和头脑风暴，基于趋势和标签生成多个创意方向。
 *
 * 方法论 (参考 brainstorming 技能):
 *   1. 先发散 - 生成尽可能多的创意角度
 *   2. 再收敛 - 筛选最符合小红书风格的方案
 *   3. 结合趋势数据和标签热度
 *
 * 流程:
 *   1. 发散阶段: LLM 生成 8-10 个原始创意角度
 *   2. 收敛阶段: LLM 从中筛选 3-5 个最优方向并结构化输出
 *   3. 返回结构化创意列表 + 推荐方向索引
 */

import { callLLM } from './llm-service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('brainstorming-service');

// ----------------------------------------------------------------------------
// 类型定义
// ----------------------------------------------------------------------------

export interface CreativeDirection {
  angle: string; // 创意角度
  title: string; // 建议标题
  outline: string[]; // 内容大纲
  targetAudience: string; // 目标受众
  hook: string; // 开头钩子
}

export interface BrainstormResult {
  keyword: string;
  directions: CreativeDirection[];
  recommendedDirection: number; // 推荐使用的方向索引
}

// 发散阶段产出的原始角度 (未结构化)
interface RawAngle {
  angle: string;
  rationale: string; // 为什么这个角度可行
}

interface DivergeResult {
  angles: RawAngle[];
}

// ----------------------------------------------------------------------------
// 发散阶段: 生成大量原始创意角度
// ----------------------------------------------------------------------------

/**
 * 发散阶段 - 生成尽可能多的创意角度 (8-10 个)。
 *
 * 不做筛选，只求数量和多样性，鼓励 LLM 跳出常规思维。
 */
async function divergeAngles(
  keyword: string,
  trends?: string[],
  hashtags?: string[],
): Promise<RawAngle[]> {
  const trendBlock = trends && trends.length > 0
    ? `\n## 当前热门趋势\n${trends.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '\n## 当前热门趋势\n(无趋势数据,请基于关键词自由发散)';

  const hashtagBlock = hashtags && hashtags.length > 0
    ? `\n## 相关标签热度\n${hashtags.map((h) => `#${h}`).join(' ')}`
    : '';

  const prompt = `你是一位资深小红书内容策划师,正在进行"发散式头脑风暴"。

## 任务

针对关键词「${keyword}」,生成 8-10 个**截然不同**的创意角度。
不要筛选,不要评判,只求数量和多样性。鼓励跳出常规思维。

${trendBlock}${hashtagBlock}

## 发散维度 (每个角度应来自不同维度)

- 情感维度: 治愈 / 焦虑共鸣 / 逆袭 / 怀旧 / 好奇
- 视角维度: 第一人称体验 / 第三方测评 / 对比 / 盘点 / 教程
- 结构维度: 清单 / 步骤 / 对比 / 故事 / 数据
- 受众维度: 新手 / 进阶 / 特定人群(学生/宝妈/职场)
- 情境维度: 早晨 / 通勤 / 周末 / 旅行 / 节日

## 输出格式 (严格 JSON,不要任何其他文字)

\`\`\`json
{
  "angles": [
    {
      "angle": "角度名称(10字以内)",
      "rationale": "为什么这个角度可行(结合趋势/标签/受众,20-40字)"
    }
  ]
}
\`\`\`

请生成 8-10 个角度,确保维度多样。`;

  try {
    const { text } = await callLLM(prompt);
    if (!text.trim()) {
      log.warn('[diverge] LLM 返回空,使用兜底角度');
      return fallbackAngles(keyword);
    }

    const parsed = parseJsonLoose<DivergeResult>(text);
    if (parsed && Array.isArray(parsed.angles) && parsed.angles.length > 0) {
      log.info(`[diverge] 发散出 ${parsed.angles.length} 个原始角度`);
      return parsed.angles.filter(
        (a) => a && typeof a.angle === 'string' && a.angle.trim(),
      );
    }

    log.warn('[diverge] LLM 响应无法解析为结构化角度,使用兜底');
    return fallbackAngles(keyword);
  } catch (e) {
    log.warn(`[diverge] 发散阶段失败: ${(e as Error).message}`);
    return fallbackAngles(keyword);
  }
}

// ----------------------------------------------------------------------------
// 收敛阶段: 筛选并结构化为创意方向
// ----------------------------------------------------------------------------

/**
 * 收敛阶段 - 从原始角度中筛选 3-5 个最优方向并结构化。
 *
 * 筛选标准:
 *   - 是否符合小红书原生风格 (口语化、有钩子)
 *   - 是否能结合趋势/标签热度
 *   - 受众是否清晰
 *   - 是否有强开头钩子
 */
async function convergeDirections(
  keyword: string,
  rawAngles: RawAngle[],
  trends?: string[],
  hashtags?: string[],
): Promise<CreativeDirection[]> {
  const trendBlock = trends && trends.length > 0
    ? trends.map((t) => `- ${t}`).join('\n')
    : '(无趋势数据)';

  const hashtagBlock = hashtags && hashtags.length > 0
    ? hashtags.map((h) => `#${h}`).join(' ')
    : '(无标签数据)';

  const angleList = rawAngles
    .map((a, i) => `${i + 1}. [${a.angle}] ${a.rationale}`)
    .join('\n');

  const prompt = `你是一位资深小红书内容策划师,正在进行"收敛式筛选"。

## 任务

从以下 ${rawAngles.length} 个原始创意角度中,筛选出 3-5 个**最适合小红书**的方向,
并为每个方向生成完整的结构化内容规划。

## 关键词
${keyword}

## 热门趋势
${trendBlock}

## 相关标签
${hashtagBlock}

## 原始创意角度
${angleList}

## 筛选标准 (从严到宽)

1. **小红书原生风格**: 口语化、像朋友分享，不像公众号文章
2. **趋势契合度**: 能自然融入上面的热门趋势
3. **标签可延展性**: 内容能自然带出上面的相关标签
4. **开头钩子强度**: 第一句能否 3 秒抓住读者
5. **受众清晰度**: 目标人群是否明确

## 输出格式 (严格 JSON,不要任何其他文字)

\`\`\`json
{
  "directions": [
    {
      "angle": "创意角度(10字以内)",
      "title": "建议标题(15-25字,纯文字,简洁有力)",
      "outline": [
        "大纲要点1",
        "大纲要点2",
        "大纲要点3",
        "大纲要点4"
      ],
      "targetAudience": "目标受众(如:职场新人/宝妈/学生党)",
      "hook": "开头钩子(第一句话,15-30字,直击痛点或好奇心)"
    }
  ]
}
\`\`\`

要求:
- 输出 3-5 个方向
- 每个方向必须包含完整字段
- outline 至少 3 个要点
- title 必须为纯文字，不带 emoji
- hook 必须有强烈吸引力,不要套话`;

  try {
    const { text } = await callLLM(prompt);
    if (!text.trim()) {
      log.warn('[converge] LLM 返回空,使用兜底方向');
      return fallbackDirections(keyword, rawAngles);
    }

    const parsed = parseJsonLoose<{ directions: CreativeDirection[] }>(text);
    if (parsed && Array.isArray(parsed.directions) && parsed.directions.length > 0) {
      const valid = parsed.directions.filter(
        (d) =>
          d &&
          typeof d.angle === 'string' &&
          typeof d.title === 'string' &&
          Array.isArray(d.outline) &&
          typeof d.targetAudience === 'string' &&
          typeof d.hook === 'string',
      );
      if (valid.length > 0) {
        log.info(`[converge] 收敛为 ${valid.length} 个结构化方向`);
        return valid.slice(0, 5);
      }
    }

    log.warn('[converge] LLM 响应无法解析,使用兜底方向');
    return fallbackDirections(keyword, rawAngles);
  } catch (e) {
    log.warn(`[converge] 收敛阶段失败: ${(e as Error).message}`);
    return fallbackDirections(keyword, rawAngles);
  }
}

// ----------------------------------------------------------------------------
// 推荐方向选择
// ----------------------------------------------------------------------------

/**
 * 选择推荐方向索引。
 *
 * 启发式评分 (不调用 LLM,避免额外开销):
 *   - hook 越长越完整 → 越好
 *   - outline 要点越多 → 越好
 *   - 第一个方向通常最强 (LLM 输出顺序),作为基准
 */
function pickRecommended(directions: CreativeDirection[]): number {
  if (directions.length === 0) return 0;
  if (directions.length === 1) return 0;

  let bestIdx = 0;
  let bestScore = -Infinity;

  directions.forEach((d, idx) => {
    let score = 0;
    // hook 完整度
    score += Math.min(d.hook.length / 30, 1) * 2;
    // outline 丰富度
    score += Math.min(d.outline.length / 4, 1) * 2;
    // targetAudience 明确
    if (d.targetAudience.length >= 2) score += 1;
    // 第一个方向轻微加分 (LLM 通常把最优放首位)
    if (idx === 0) score += 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  log.info(`[recommend] 推荐方向索引: ${bestIdx} (得分 ${bestScore.toFixed(2)})`);
  return bestIdx;
}

// ----------------------------------------------------------------------------
// 主函数: 生成创意方向
// ----------------------------------------------------------------------------

/**
 * 生成创意方向 - 发散 → 收敛 → 推荐。
 *
 * @param keyword  主题关键词
 * @param trends   可选,当前热门趋势列表
 * @param hashtags 可选,相关标签列表
 * @returns BrainstormResult 含 3-5 个结构化方向 + 推荐索引
 */
export async function generateCreativeDirections(
  keyword: string,
  trends?: string[],
  hashtags?: string[],
): Promise<BrainstormResult> {
  const kw = keyword.trim();
  if (!kw) {
    throw new Error('关键词不能为空');
  }

  log.info('开始创意规划', {
    keyword: kw,
    trendsCount: trends?.length ?? 0,
    hashtagsCount: hashtags?.length ?? 0,
  });

  // 阶段 1: 发散
  const rawAngles = await divergeAngles(kw, trends, hashtags);

  // 阶段 2: 收敛
  const directions = await convergeDirections(kw, rawAngles, trends, hashtags);

  // 阶段 3: 推荐
  const recommendedDirection = pickRecommended(directions);

  const result: BrainstormResult = {
    keyword: kw,
    directions,
    recommendedDirection,
  };

  log.info('创意规划完成', {
    keyword: kw,
    directionCount: directions.length,
    recommended: recommendedDirection,
  });

  return result;
}

// ----------------------------------------------------------------------------
// 辅助: 宽松 JSON 解析
// ----------------------------------------------------------------------------

/**
 * 宽松解析 LLM 输出中的 JSON。
 *
 * LLM 经常在 JSON 前后加 ```json 代码块标记或额外文字,
 * 这里尝试多种方式提取 JSON。
 */
function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;

  // 1. 直接尝试
  try {
    return JSON.parse(text) as T;
  } catch {
    // continue
  }

  // 2. 提取 ```json ... ``` 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  // 3. 提取第一个 { 到最后一个 } 之间的内容
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1)) as T;
    } catch {
      // continue
    }
  }

  return null;
}

// ----------------------------------------------------------------------------
// 兜底: LLM 不可用时使用
// ----------------------------------------------------------------------------

function fallbackAngles(keyword: string): RawAngle[] {
  log.info(`[fallback] 使用内置原始角度: ${keyword}`);
  return [
    { angle: '保姆级教程', rationale: `${keyword}新手最需要的入门指南,流量稳定` },
    { angle: '真实测评', rationale: `用户对${keyword}的真实反馈,信任度高` },
    { angle: '避坑指南', rationale: `${keyword}常见误区,痛点驱动` },
    { angle: '对比清单', rationale: `${keyword}同类方案横向对比,决策导向` },
    { angle: '个人故事', rationale: `${keyword}亲身经历,情感共鸣` },
    { angle: '隐藏玩法', rationale: `${keyword}不为人知的技巧,好奇心驱动` },
    { angle: '季节限定', rationale: `${keyword}结合当下时令,时效性强` },
    { angle: '人群专属', rationale: `${keyword}针对特定人群的定制方案` },
  ];
}

function fallbackDirections(
  keyword: string,
  rawAngles: RawAngle[],
): CreativeDirection[] {
  log.info(`[fallback] 使用内置结构化方向: ${keyword}`);
  const top3 = rawAngles.slice(0, 3);

  const directions: CreativeDirection[] = topAnglesToDirections(keyword, top3);
  if (directions.length === 0) {
    // 完全兜底
    return [
      {
        angle: '保姆级教程',
        title: `【保姆级教程】${keyword}超详细攻略，新手必看！`,
        outline: [
          `${keyword}是什么,为什么你需要了解`,
          '准备工作:工具/心态/资源',
          '详细步骤:从0到1的完整流程',
          '常见问题与注意事项',
        ],
        targetAudience: `${keyword}新手`,
        hook: `很多人问我${keyword}到底怎么入门,今天一次性讲清楚!`,
      },
    ];
  }
  return directions;
}

function topAnglesToDirections(keyword: string, angles: RawAngle[]): CreativeDirection[] {
  return angles.map((a) => ({
    angle: a.angle,
    title: `【${a.angle}】${keyword}必看攻略 ✨`,
    outline: [
      `${keyword}核心要点一`,
      `${keyword}核心要点二`,
      `${keyword}核心要点三`,
    ],
    targetAudience: '小红书用户',
    hook: a.rationale,
  }));
}
