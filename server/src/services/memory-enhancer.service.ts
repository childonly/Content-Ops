/**
 * 记忆增强服务 (Memory-Assistant skill 方法论移植)
 *
 * 从历史优质内容中提取风格特征,作为记忆注入到新生成的内容中。
 *
 * 方法论 (参考 Memory-Assistant 技能):
 *   1. 区分 Facts (事实) 与 AI 推断
 *   2. Facts 来自数据库真实记录 (高浏览/高互动的历史内容)
 *   3. 记忆以 <memories> 结构注入 LLM 提示词
 *   4. LLM 应基于事实生成,不编造未知信息
 *
 * 数据来源:
 *   - contents 表: 标题、正文、标签
 *   - analytics 表: 浏览、点赞、互动率
 *   - JOIN 查询获取高表现内容的真实特征
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('memory-enhancer-service');

// ----------------------------------------------------------------------------
// 类型定义
// ----------------------------------------------------------------------------

export interface ContentMemory {
  topTitles: string[]; // 历史高点击标题
  popularTags: string[]; // 高频标签
  successfulAngles: string[]; // 成功内容角度
  avgEngagementRate: number; // 平均互动率
  styleNotes: string; // 风格备注
}

// 数据库行映射
interface ContentWithAnalyticsRow {
  id: number;
  title: string;
  body: string | null;
  tags: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collects: number;
  engagement_rate: number;
  generated_at: string;
}

// ----------------------------------------------------------------------------
// 提取历史记忆
// ----------------------------------------------------------------------------

/**
 * 从数据库提取历史优质内容的风格特征。
 *
 * 优质内容判定:
 *   - 有 analytics 记录 (已发布并追踪)
 *   - 按 engagement_rate * 0.4 + views 归一化得分排序
 *   - 取 top N (默认 20)
 *
 * @param limit 提取的历史内容条数 (默认 20)
 * @returns ContentMemory 记忆对象
 */
export function extractMemoryFromHistory(limit: number = 20): ContentMemory {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 100));

  log.info('提取历史内容记忆', { limit: safeLimit });

  // JOIN contents 和 analytics,获取高表现内容
  const rows = db
    .prepare(
      `SELECT
         c.id,
         c.title,
         c.body,
         c.tags,
         c.generated_at,
         COALESCE(a.views, 0) AS views,
         COALESCE(a.likes, 0) AS likes,
         COALESCE(a.comments, 0) AS comments,
         COALESCE(a.shares, 0) AS shares,
         COALESCE(a.collects, 0) AS collects,
         COALESCE(a.engagement_rate, 0) AS engagement_rate
       FROM contents c
       LEFT JOIN analytics a ON a.content_id = c.id
       WHERE c.status IN ('published', 'approved', 'draft')
       ORDER BY (COALESCE(a.engagement_rate, 0) * 0.4 + COALESCE(a.views, 0) * 0.0001) DESC,
                c.generated_at DESC
       LIMIT ?`,
    )
    .all(safeLimit) as ContentWithAnalyticsRow[];

  if (rows.length === 0) {
    log.warn('数据库中无历史内容,返回空记忆');
    return emptyMemory();
  }

  log.info(`[memory] 提取到 ${rows.length} 条历史内容`);

  // 提取 Top 标题 (按互动率排序前 10)
  const topTitles = rows
    .filter((r) => r.engagement_rate > 0 || r.views > 0)
    .sort((a, b) => b.engagement_rate - a.engagement_rate)
    .slice(0, 10)
    .map((r) => r.title);

  // 提取高频标签
  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.tags) continue;
    try {
      const tags = JSON.parse(row.tags) as string[];
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (typeof tag === 'string' && tag.trim()) {
            const normalized = tag.trim();
            tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
          }
        }
      }
    } catch {
      // tags 可能是逗号分隔的字符串
      const tags = String(row.tags).split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
  }
  const popularTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);

  // 提取成功内容角度 (从标题前缀模式推断)
  const angleCounts = new Map<string, number>();
  for (const row of rows) {
    const angle = inferAngleFromTitle(row.title);
    if (angle) {
      angleCounts.set(angle, (angleCounts.get(angle) ?? 0) + 1);
    }
  }
  const successfulAngles = Array.from(angleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([angle]) => angle);

  // 计算平均互动率
  const rates = rows.map((r) => r.engagement_rate).filter((r) => r > 0);
  const avgEngagementRate =
    rates.length > 0
      ? parseFloat((rates.reduce((sum, r) => sum + r, 0) / rates.length).toFixed(2))
      : 0;

  // 生成风格备注 (基于真实数据的 Facts,非 AI 推断)
  const styleNotes = buildStyleNotes(rows, avgEngagementRate, popularTags);

  const memory: ContentMemory = {
    topTitles,
    popularTags,
    successfulAngles,
    avgEngagementRate,
    styleNotes,
  };

  log.info('记忆提取完成', {
    topTitlesCount: topTitles.length,
    popularTagsCount: popularTags.length,
    successfulAnglesCount: successfulAngles.length,
    avgEngagementRate,
  });

  return memory;
}

// ----------------------------------------------------------------------------
// 构建记忆上下文文本
// ----------------------------------------------------------------------------

/**
 * 将 ContentMemory 构建为可注入 LLM 的上下文文本。
 *
 * 采用 Memory-Assistant 的 <memories> 结构,明确区分 Facts (事实)。
 * LLM 应基于这些事实生成内容,不编造未知信息。
 *
 * @param memory 从历史数据提取的记忆
 * @returns 结构化记忆上下文文本
 */
export function buildMemoryContext(memory: ContentMemory): string {
  const hasAnyData =
    memory.topTitles.length > 0 ||
    memory.popularTags.length > 0 ||
    memory.successfulAngles.length > 0 ||
    memory.avgEngagementRate > 0;

  if (!hasAnyData) {
    return '';
  }

  const lines: string[] = [
    '<memories>',
    '  <facts>',
    '    <!-- 以下为来自数据库的真实历史数据 (Facts),非 AI 推断 -->',
  ];

  if (memory.topTitles.length > 0) {
    lines.push('    <top_titles>');
    for (const title of memory.topTitles) {
      lines.push(`      <title>${title}</title>`);
    }
    lines.push('    </top_titles>');
  }

  if (memory.popularTags.length > 0) {
    lines.push('    <popular_tags>');
    lines.push(`      ${memory.popularTags.map((t) => `#${t}`).join(' ')}`);
    lines.push('    </popular_tags>');
  }

  if (memory.successfulAngles.length > 0) {
    lines.push('    <successful_angles>');
    for (const angle of memory.successfulAngles) {
      lines.push(`      <angle>${angle}</angle>`);
    }
    lines.push('    </successful_angles>');
  }

  if (memory.avgEngagementRate > 0) {
    lines.push(`    <avg_engagement_rate>${memory.avgEngagementRate}</avg_engagement_rate>`);
  }

  if (memory.styleNotes) {
    lines.push('    <style_notes>');
    lines.push(`      ${escapeXml(memory.styleNotes)}`);
    lines.push('    </style_notes>');
  }

  lines.push('  </facts>');
  lines.push('</memories>');

  return lines.join('\n');
}

// ----------------------------------------------------------------------------
// 增强提示词
// ----------------------------------------------------------------------------

/**
 * 将记忆注入到 LLM 提示词中。
 *
 * 策略 (参考 Memory-Assistant):
 *   - 在原提示词前插入记忆上下文
 *   - 明确告知 LLM 记忆是 Facts,应参考但可调整
 *   - 不强制复制,而是作为风格参考
 *
 * @param originalPrompt 原始 LLM 提示词
 * @param memory         历史内容记忆
 * @returns 增强后的提示词
 */
export function enhancePrompt(originalPrompt: string, memory: ContentMemory): string {
  if (!originalPrompt || !originalPrompt.trim()) {
    return originalPrompt;
  }

  const memoryContext = buildMemoryContext(memory);
  if (!memoryContext) {
    log.info('[enhance] 记忆为空,不增强提示词');
    return originalPrompt;
  }

  const enhancement = `## 历史优质内容记忆 (Memory-Enhanced Context)

以下记忆来自数据库中真实的历史优质内容数据 (Facts),请在生成新内容时参考这些风格特征,
但不要直接复制标题或内容。参考目标:使新内容达到或超过历史平均互动率。

${memoryContext}

## 记忆使用规则

1. **基于事实**: 上面的 <facts> 是真实历史数据,可放心参考
2. **风格借鉴**: 学习 top_titles 的标题结构,但生成新标题
3. **标签延展**: 优先使用 popular_tags 中的高频标签,可补充新标签
4. **角度复用**: successful_angles 是验证过的有效角度,可在此基础上创新
5. **互动率对标**: 平均互动率 ${memory.avgEngagementRate} 是基准线,力求超越

---

`;

  log.info('[enhance] 已将记忆注入提示词', {
    originalLength: originalPrompt.length,
    enhancedLength: originalPrompt.length + enhancement.length,
  });

  return enhancement + originalPrompt;
}

// ----------------------------------------------------------------------------
// 辅助函数
// ----------------------------------------------------------------------------

/**
 * 从标题推断内容角度 (基于小红书常见标题模式)。
 *
 * 这是基于规则的推断,属于 Facts 的延伸分析,非 AI 编造。
 */
function inferAngleFromTitle(title: string): string | null {
  if (!title) return null;

  // 小红书常见标题模式 (按优先级)
  const patterns: Array<{ regex: RegExp; angle: string }> = [
    { regex: /保姆级|手把手|详细教程|从零|入门/i, angle: '保姆级教程' },
    { regex: /测评|真实测|使用感|体验报告/i, angle: '真实测评' },
    { regex: /避坑|踩坑|误区|千万别|不要买/i, angle: '避坑指南' },
    { regex: /对比|vs|VS|横评|比较/i, angle: '对比清单' },
    { regex: /清单|合集|盘点|推荐|榜单/i, angle: '清单盘点' },
    { regex: /故事|经历|记录|日记|分享/i, angle: '个人故事' },
    { regex: /隐藏|不为人知|秘密|冷门/i, angle: '隐藏玩法' },
    { regex: /季节|夏天|冬天|春|秋|节日/i, angle: '季节限定' },
    { regex: /新手|小白|零基础|第一次/i, angle: '新手友好' },
    { regex: /进阶|高阶|资深|老司机/i, angle: '进阶玩法' },
  ];

  for (const { regex, angle } of patterns) {
    if (regex.test(title)) {
      return angle;
    }
  }
  return null;
}

/**
 * 基于真实数据生成风格备注。
 *
 * 注意: 这是基于 Facts 的总结性陈述,不是 AI 推断。
 * 仅陈述数据观察到的客观模式。
 */
function buildStyleNotes(
  rows: ContentWithAnalyticsRow[],
  avgEngagementRate: number,
  popularTags: string[],
): string {
  const notes: string[] = [];

  // 标题长度分布
  const titleLengths = rows.map((r) => r.title.length).filter((l) => l > 0);
  if (titleLengths.length > 0) {
    const avgTitleLen = Math.round(
      titleLengths.reduce((sum, l) => sum + l, 0) / titleLengths.length,
    );
    notes.push(`历史优质内容标题平均长度 ${avgTitleLen} 字`);
  }

  // 纯文字标题比例（记录趋势）
  const emojiTitles = rows.filter((r) =>
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(r.title),
  ).length;
  if (rows.length > 0) {
    const emojiRate = Math.round((emojiTitles / rows.length) * 100);
    // 仅记录趋势，不鼓励生成 emoji 标题
    notes.push(`当前 ${emojiRate}% 的历史标题含 emoji（趋势参考，新生成应使用纯文字标题）`);
  }

  // 互动率水平
  if (avgEngagementRate > 0) {
    if (avgEngagementRate >= 5) {
      notes.push(`平均互动率 ${avgEngagementRate}%,处于高水平`);
    } else if (avgEngagementRate >= 2) {
      notes.push(`平均互动率 ${avgEngagementRate}%,处于中等水平`);
    } else {
      notes.push(`平均互动率 ${avgEngagementRate}%,有提升空间`);
    }
  }

  // 高频标签提示
  if (popularTags.length > 0) {
    notes.push(`高频标签: ${popularTags.slice(0, 5).map((t) => `#${t}`).join(' ')}`);
  }

  return notes.join('; ');
}

/**
 * XML 转义 (用于 buildMemoryContext)。
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 空记忆对象 (数据库无数据时使用)。
 */
function emptyMemory(): ContentMemory {
  return {
    topTitles: [],
    popularTags: [],
    successfulAngles: [],
    avgEngagementRate: 0,
    styleNotes: '',
  };
}
