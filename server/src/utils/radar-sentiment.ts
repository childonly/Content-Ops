/**
 * 情感分析工具
 * 基于关键词匹配的简单情感分类（正面词列表/负面词列表）
 * 不依赖 AI，纯规则匹配
 * 从 social-radar 项目迁移
 */

import type { SentimentType, Mention, TopicCluster, SentimentBreakdown } from '../types/radar.types';

// ============================================================
// 情感词典
// ============================================================

/** 正面情感关键词 */
const POSITIVE_WORDS: string[] = [
  // 中文正面词
  '喜欢', '爱', '棒', '好', '优秀', '赞', '推荐', '支持', '满意', '开心',
  '快乐', '兴奋', '惊喜', '完美', '精彩', '漂亮', '可爱', '有趣', '牛', '厉害',
  '不错', '太好了', '加油', '期待', '点赞', '收藏', '种草', '真香', '绝了',
  '超棒', '好评', '良心', '值得', '宝藏', '神仙', '治愈', '感动', '幸福',
  // 英文正面词
  'love', 'great', 'awesome', 'amazing', 'good', 'excellent', 'perfect',
  'fantastic', 'wonderful', 'best', 'like', 'recommend', 'support', 'happy',
  'excited', 'beautiful', 'cute', 'fun', 'cool', 'nice', 'brilliant',
  'superb', 'outstanding', 'impressed', 'enjoy', 'favorite', 'wow', 'incredible',
];

/** 负面情感关键词 */
const NEGATIVE_WORDS: string[] = [
  // 中文负面词
  '讨厌', '差', '烂', '坏', '垃圾', '失望', '难过', '生气', '愤怒', '吐槽',
  '不行', '不好', '差评', '退款', '投诉', '问题', '故障', 'bug', '崩溃', '卡顿',
  '假', '骗', '坑', '踩雷', '避雷', '无语', '恶心', '烦', '糟糕', '可怕',
  '后悔', '浪费', '无聊', '低质', '劣质', '抄袭', '造假', '欺诈', '黑心',
  // 英文负面词
  'hate', 'bad', 'terrible', 'awful', 'worst', 'disappointing', 'horrible',
  'ugly', 'boring', 'stupid', 'broken', 'bug', 'crash', 'scam', 'fake',
  'poor', 'fail', 'useless', 'annoying', 'frustrating', 'waste', 'regret',
  'disgusting', 'rubbish', 'trash', 'garbage', 'suck', 'dreadful', 'lame',
];

/** 停用词（用于关键词提取时过滤） */
const STOP_WORDS: Set<string> = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '那', '它', '他', '她', '们', '这个', '那个',
  '什么', '怎么', '为什么', '可以', '能', '要', '把', '让', '从', '被', '给',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
  'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its',
]);

// ============================================================
// 情感分析
// ============================================================

export interface SentimentResult {
  type: SentimentType;
  score: number; // -1.0 到 1.0
  positiveCount: number;
  negativeCount: number;
}

/**
 * 分析文本的情感倾向
 * @param text 待分析文本
 * @returns 情感分析结果
 */
export function analyzeSentiment(text: string): SentimentResult {
  if (!text || text.trim().length === 0) {
    return { type: 'neutral', score: 0, positiveCount: 0, negativeCount: 0 };
  }

  const lowerText = text.toLowerCase();
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of POSITIVE_WORDS) {
    const lowerWord = word.toLowerCase();
    const count = countOccurrences(lowerText, lowerWord);
    if (count > 0) {
      positiveCount += count;
    }
  }

  for (const word of NEGATIVE_WORDS) {
    const lowerWord = word.toLowerCase();
    const count = countOccurrences(lowerText, lowerWord);
    if (count > 0) {
      negativeCount += count;
    }
  }

  const total = positiveCount + negativeCount;
  let type: SentimentType = 'neutral';
  let score = 0;

  if (total > 0) {
    score = (positiveCount - negativeCount) / total;
    if (score > 0.15) {
      type = 'positive';
    } else if (score < -0.15) {
      type = 'negative';
    } else {
      type = 'neutral';
    }
  }

  return { type, score, positiveCount, negativeCount };
}

/**
 * 统计子字符串出现次数
 */
function countOccurrences(text: string, sub: string): number {
  if (!sub || sub.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(sub);
  while (index !== -1) {
    count++;
    index = text.indexOf(sub, index + sub.length);
  }
  return count;
}

// ============================================================
// 关键词提取
// ============================================================

/**
 * 从文本中提取关键词（简单的分词 + 过滤停用词）
 * @param text 文本
 * @param maxKeywords 最大关键词数量
 * @returns 关键词数组
 */
export function extractKeywords(text: string, maxKeywords: number = 5): string[] {
  if (!text || text.trim().length === 0) return [];

  // 提取 hashtag
  const hashtagRegex = /#(\w+)/g;
  const hashtags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hashtagRegex.exec(text)) !== null) {
    hashtags.push(match[1].toLowerCase());
  }

  // 简单分词：按空格、标点分割英文；按字符滑动窗口提取中文词
  const words = extractWords(text);

  // 过滤停用词和短词
  const filtered = words.filter(
    (word) =>
      word.length > 1 &&
      !STOP_WORDS.has(word.toLowerCase()) &&
      !/^\d+$/.test(word),
  );

  // 统计词频
  const wordCount: Map<string, number> = new Map();
  for (const word of filtered) {
    const lower = word.toLowerCase();
    wordCount.set(lower, (wordCount.get(lower) || 0) + 1);
  }

  // 按频率排序
  const sorted = Array.from(wordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);

  // 合并 hashtag 和关键词
  const keywords = [...hashtags, ...sorted].slice(0, maxKeywords);

  return keywords;
}

/**
 * 批量分析多条文本的情感倾向
 * @param items 待分析文本数组，每项包含 id 和 text
 * @returns 情感分析结果数组，每项包含 id 和完整的 SentimentResult 字段
 */
export function batchAnalyzeSentiment(
  items: Array<{ id: string; text: string }>,
): Array<{ id: string } & SentimentResult> {
  return items.map((item) => {
    const result = analyzeSentiment(item.text);
    return {
      id: item.id,
      type: result.type,
      score: result.score,
      positiveCount: result.positiveCount,
      negativeCount: result.negativeCount,
    };
  });
}

/**
 * 简单分词
 */
function extractWords(text: string): string[] {
  const words: string[] = [];

  // 英文分词
  const englishWords = text.match(/[a-zA-Z]{2,}/g);
  if (englishWords) {
    words.push(...englishWords);
  }

  // 中文分词（简单的双字符滑动窗口）
  const chineseChars = text.match(/[\u4e00-\u9fa5]+/g);
  if (chineseChars) {
    for (const segment of chineseChars) {
      // 2字符滑动窗口
      for (let i = 0; i < segment.length - 1; i++) {
        words.push(segment.substring(i, i + 2));
      }
      // 如果只有单个中文字符
      if (segment.length === 1) {
        words.push(segment);
      }
    }
  }

  return words;
}

// ============================================================
// 主题聚类
// ============================================================

/**
 * 基于关键词的主题聚类
 * 将提及按共同关键词分组
 * @param mentions 提及列表
 * @param minClusterSize 最小聚类大小
 * @returns 主题聚类列表
 */
export function clusterByTopic(
  mentions: Mention[],
  minClusterSize: number = 2,
): TopicCluster[] {
  // 统计每个关键词出现在多少条提及中
  const topicMentions: Map<string, Mention[]> = new Map();

  for (const mention of mentions) {
    const topics = mention.topics || [];
    const keywords = topics.length > 0
      ? topics
      : extractKeywords(mention.content, 3);

    for (const keyword of keywords) {
      if (!topicMentions.has(keyword)) {
        topicMentions.set(keyword, []);
      }
      topicMentions.get(keyword)!.push(mention);
    }
  }

  // 转换为聚类结构
  const clusters: TopicCluster[] = [];
  for (const [topic, topicMentionList] of topicMentions) {
    if (topicMentionList.length >= minClusterSize) {
      const breakdown = calculateBreakdown(topicMentionList);
      clusters.push({
        topic,
        count: topicMentionList.length,
        mentions: topicMentionList,
        sentimentBreakdown: breakdown,
      });
    }
  }

  // 按提及数量排序
  clusters.sort((a, b) => b.count - a.count);

  // 限制返回前 10 个主题
  return clusters.slice(0, 10);
}

/**
 * 计算提及列表的情感分布
 */
function calculateBreakdown(mentions: Mention[]): SentimentBreakdown {
  const breakdown: SentimentBreakdown = {
    positive: 0,
    negative: 0,
    neutral: 0,
  };
  for (const mention of mentions) {
    breakdown[mention.sentiment]++;
  }
  return breakdown;
}
