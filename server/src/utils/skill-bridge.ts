/**
 * Skill Bridge - 技能调用桥接层
 *
 * 抽象 TRAE 技能的调用方式，支持两种模式：
 * 1. MockSkillBridge: 返回模拟数据，用于开发调试
 * 2. TraeSkillBridge: 通过 MCP/CLI 调用真实 TRAE 技能
 *
 * 切换方式：设置环境变量 SKILL_BRIDGE_MODE=mock|trae
 */

import {
  SkillBridge,
  SkillName,
  SkillParams,
  SkillResult,
  Trend,
  Hashtag,
  Content,
  Publication,
  AnalyticsRecord,
  TrendDiscoveryResult,
  HashtagResearchResult,
  ContentGenerationResult,
  PublishResult,
  AnalyticsTrackResult,
} from '../types';
import { config } from '../config';
import { createServiceLogger } from './logger';
import { PYTHON_MAX_BUFFER } from './constants';
import path from 'path';
import fs from 'fs';

const log = createServiceLogger('skill-bridge');

// ============================================================================
// Mock 数据生成器
// ============================================================================

/**
 * 动态生成 Mock 趋势数据。
 *
 * 每次调用从话题池中随机抽取，并附加随机后缀和波动数值，
 * 确保每次"发现新趋势"返回不同的结果。
 */
const mockTrendPool: Array<{ title: string; description: string; category: string }> = [
  { title: '夏日清凉穿搭指南', description: '高温天气下的清凉穿搭趋势，以轻薄面料和亮色系为主', category: 'fashion' },
  { title: '居家咖啡制作教程', description: '手冲咖啡、冷萃咖啡制作教程热度上升', category: 'lifestyle' },
  { title: '城市 Citywalk 攻略', description: '各城市 Citywalk 路线分享和探店攻略', category: 'travel' },
  { title: '极简主义收纳术', description: '小户型收纳整理技巧和好物推荐', category: 'lifestyle' },
  { title: '夏日饮品配方分享', description: '自制果茶、气泡水等夏日饮品配方', category: 'food' },
  { title: '健身打卡挑战', description: '30天健身打卡挑战，跟着博主一起运动', category: 'sport' },
  { title: '手机摄影技巧', description: '用手机拍出大片质感，构图与调色教程', category: 'digital' },
  { title: '烘焙入门教程', description: '零基础也能学会的家庭烘焙教程', category: 'food' },
  { title: '平价好物推荐', description: '百元以内的高性价比好物分享', category: 'lifestyle' },
  { title: '职场穿搭指南', description: '通勤穿搭灵感，简约又不失格调', category: 'fashion' },
  { title: '旅行vlog拍摄', description: '旅行vlog拍摄技巧与剪辑教程', category: 'travel' },
  { title: '护肤步骤详解', description: '不同肤质的护肤步骤和产品推荐', category: 'beauty' },
  { title: '读书笔记分享', description: '每月精读书单和读书笔记', category: 'education' },
  { title: '阳台种菜指南', description: '在阳台种蔬菜的实用指南', category: 'lifestyle' },
  { title: '宠物日常记录', description: '萌宠日常分享和养宠心得', category: 'life' },
  { title: '早餐创意食谱', description: '15分钟搞定的营养早餐食谱', category: 'food' },
  { title: '拍照pose大全', description: '各种场景的拍照姿势参考', category: 'fashion' },
  { title: '数字游民生活', description: '边旅行边工作的数字游民生活方式', category: 'travel' },
  { title: '手工DIY教程', description: '在家就能做的手工DIY项目', category: 'lifestyle' },
  { title: '省钱攻略分享', description: '每月生活费控制在2000以内的省钱技巧', category: 'lifestyle' },
];

/** 随机后缀，增加趋势标题的多样性 */
const trendSuffixes = ['', '｜超详细', '（2026最新）', '｜新手必看', '｜干货合集', '｜避坑指南', '（进阶版）', '｜零基础'];

function generateMockTrends(limit: number): Trend[] {
  const timestamp = new Date().toISOString();
  // 随机抽取 limit 条，不重复
  const shuffled = [...mockTrendPool].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(limit + 2, shuffled.length));

  return selected.map((item, index) => {
    const suffix = trendSuffixes[Math.floor(Math.random() * trendSuffixes.length)];
    return {
      id: Date.now() + index,
      title: suffix ? `${item.title}${suffix}` : item.title,
      description: item.description,
      platform: 'xiaohongshu',
      category: item.category,
      heat: Math.floor(Math.random() * 15000) + 3000,
      growthRate: parseFloat((Math.random() * 35 + 5).toFixed(2)),
      status: 'new' as const,
      discoveredAt: timestamp,
    };
  });
}

const mockHashtags: Hashtag[] = [
  { id: 1, tag: '夏日穿搭', platform: 'xiaohongshu', volume: 456000, growthRate: 28.5, relatedTags: ['OOTD', '穿搭分享', '夏日ootd'], researchedAt: new Date().toISOString() },
  { id: 2, tag: '清凉一夏', platform: 'xiaohongshu', volume: 234000, growthRate: 22.1, relatedTags: ['夏日', '避暑', '清凉'], researchedAt: new Date().toISOString() },
  { id: 3, tag: '手冲咖啡', platform: 'xiaohongshu', volume: 312000, growthRate: 19.8, relatedTags: ['咖啡', '咖啡教程', '居家咖啡'], researchedAt: new Date().toISOString() },
  { id: 4, tag: 'Citywalk', platform: 'xiaohongshu', volume: 523000, growthRate: 35.2, relatedTags: ['城市漫步', '周末去哪', '探店'], researchedAt: new Date().toISOString() },
  { id: 5, tag: '极简收纳', platform: 'xiaohongshu', volume: 189000, growthRate: 14.3, relatedTags: ['收纳整理', '断舍离', '小户型'], researchedAt: new Date().toISOString() },
];

function generateMockContent(trendId?: number, hashtagIds?: number[]): Content {
  const hashtags = (hashtagIds
    ?.map(id => mockHashtags.find(h => h.id === id)?.tag)
    .filter((t): t is string => typeof t === 'string')) || [];

  const titles = [
    '夏日穿搭分享 | 清凉又时髦的 5 套穿搭',
    '居家手冲咖啡全攻略 | 零基础也能学会',
    'Citywalk 路线推荐 | 周末好去处',
    '极简收纳术 | 小户型也能很整洁',
    '夏日饮品配方 | 5 分钟搞定',
  ];

  const titleIdx = Math.floor(Math.random() * titles.length);

  return {
    id: Date.now(),
    title: titles[titleIdx],
    body: `今天分享一个超实用的内容！\n\n正文内容：\n这里是根据趋势和标签生成的小红书风格内容。\n包含详细的步骤说明和实用技巧。\n\n小贴士：\n- 要点一\n- 要点二\n- 要点三\n\n#${hashtags.join(' #') || '分享 #日常'}`,
    tags: hashtags.length ? hashtags : ['分享', '日常'],
    images: [],
    trendId,
    hashtagIds: (hashtagIds || []).join(','),
    status: 'draft',
    generatedAt: new Date().toISOString(),
    isFavorited: false,
  };
}

function generateMockAnalytics(publicationId: number, contentId: number): AnalyticsRecord {
  const views = Math.floor(Math.random() * 50000) + 1000;
  const likes = Math.floor(views * (0.05 + Math.random() * 0.1));
  const comments = Math.floor(likes * 0.1);
  const shares = Math.floor(likes * 0.05);
  const collects = Math.floor(likes * 0.3);
  const engagementRate = ((likes + comments + shares + collects) / views * 100);

  return {
    id: Date.now(),
    publicationId,
    contentId,
    views,
    likes,
    comments,
    shares,
    collects,
    engagementRate: parseFloat(engagementRate.toFixed(2)),
    trackedAt: new Date().toISOString(),
    errorMessage: '⚠️ MOCK 模式：模拟数据，非真实追踪数据',
  };
}

// ============================================================================
// Mock Skill Bridge
// ============================================================================

class MockSkillBridge implements SkillBridge {
  async invoke<T>(skillName: SkillName, params: SkillParams): Promise<SkillResult<T>> {
    const startTime = Date.now();
    log.info(`[MOCK] 调用技能: ${skillName}`, { params });

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));

    let data: any;
    const timestamp = new Date().toISOString();
    const duration = Date.now() - startTime;

    switch (skillName) {
      case 'trend-research': {
        const limit = (params as any).limit || 5;
        data = {
          trends: generateMockTrends(limit),
        } as TrendDiscoveryResult;
        break;
      }

      case 'hashtag-research': {
        const keyword = (params as any).keyword || '穿搭';
        data = {
          hashtags: mockHashtags.map((h, i) => ({
            ...h,
            id: Date.now() + i,
            tag: `${keyword}#${i + 1}`,
            researchedAt: timestamp,
          })),
        } as HashtagResearchResult;
        break;
      }

      case 'xhs-content': {
        const content = generateMockContent(
          (params as any).trendId,
          (params as any).hashtagIds,
        );
        data = { content } as ContentGenerationResult;
        break;
      }

      case 'xiaohongshu-skill': {
        const contentId = (params as any).contentId;
        data = {
          publication: {
            id: Date.now(),
            contentId,
            platform: 'xiaohongshu',
            postUrl: `https://www.xiaohongshu.com/discovery/item/MOCK-${Date.now()}`,  // 明确标注 MOCK
            status: 'published' as const,
            publishedAt: timestamp,
            errorMessage: '⚠️ MOCK 模式：未实际发布到小红书，仅模拟数据',
          },
        } as PublishResult;
        break;
      }

      case 'creator-analytics': {
        const publicationId = (params as any).publicationId || 1;
        const contentId = (params as any).contentId || 1;
        data = {
          analytics: generateMockAnalytics(publicationId, contentId),
        } as AnalyticsTrackResult;
        break;
      }

      default:
        return {
          success: false,
          error: `未知技能: ${skillName}`,
          metadata: { duration, skillName, timestamp },
        };
    }

    log.info(`[MOCK] 技能 ${skillName} 调用完成`, { duration: `${duration}ms` });

    return {
      success: true,
      data: data as T,
      metadata: { duration, skillName, timestamp },
    };
  }
}

// ============================================================================
// TRAE Skill Bridge (真实技能调用)
// 对接: TikHub REST API + Ollama 本地模型 + Python 子进程发布
// ============================================================================

class TraeSkillBridge implements SkillBridge {
  /**
   * TikHub API GET 请求
   */
  private async tikhubGet<T>(endpoint: string, params: Record<string, string | number>): Promise<T> {
    const url = new URL(`${config.tikhubBaseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

    log.debug(`[TikHub] GET ${endpoint}`, { params });

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.tikhubApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`TikHub API ${response.status}: ${errorBody.substring(0, 200)}`);
    }

    const body = await response.json() as any;
    if (body.code !== 200) {
      throw new Error(`TikHub API error: ${body.message || body.message_zh || 'Unknown error'}`);
    }

    return body.data as T;
  }

  /**
   * Ollama 本地模型生成
   */
  private async ollamaGenerate(prompt: string): Promise<string> {
    log.debug('[Ollama] 生成内容', { model: config.ollamaModel });

    const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt,
        stream: false,
        options: { temperature: 0.8, top_p: 0.9 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API ${response.status}: ${response.statusText}`);
    }

    const body = await response.json() as any;
    return body.response as string;
  }

  /**
   * Python 子进程调用 (xiaohongshu-skill)
   */
  private async runPythonScript(args: string[]): Promise<string> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    log.debug('[Python] 调用脚本', { cwd: config.xhsSkillPath, args });

    const result = await execFileAsync(config.xhsPipelinePythonPath || 'python', ['-m', 'scripts', ...args], {
      cwd: config.xhsSkillPath,
      timeout: config.pipeline.stageTimeout,
      maxBuffer: PYTHON_MAX_BUFFER,
      windowsHide: false,
    });

    return result.stdout;
  }

  async invoke<T>(skillName: SkillName, params: SkillParams): Promise<SkillResult<T>> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    log.info(`[TRAE] 调用技能: ${skillName}`, { params });

    try {
      let data: any;

      switch (skillName) {
        case 'trend-research':
          data = await this.discoverTrends(params);
          break;
        case 'hashtag-research':
          data = await this.researchHashtags(params);
          break;
        case 'xhs-content':
          data = await this.generateContent(params);
          break;
        case 'xiaohongshu-skill':
          data = await this.publishContent(params);
          break;
        case 'creator-analytics':
          data = await this.trackAnalytics(params);
          break;
        default:
          throw new Error(`未知技能: ${skillName}`);
      }

      const duration = Date.now() - startTime;
      log.info(`[TRAE] 技能 ${skillName} 调用完成`, { duration: `${duration}ms` });

      return {
        success: true,
        data: data as T,
        metadata: { duration, skillName, timestamp },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      log.error(`[TRAE] 技能 ${skillName} 调用失败`, { error: error.message, duration });

      return {
        success: false,
        error: error.message,
        metadata: { duration, skillName, timestamp },
      };
    }
  }

  /**
   * 趋势发现 - 调用 TikHub 小红书热门榜 API
   * 使用 fetch_hot_list 获取热词排行，保留平台原始排序和来源元数据
   */
  private async discoverTrends(params: SkillParams): Promise<TrendDiscoveryResult> {
    const limit = (params as any).limit || 10;
    const category = (params as any).category || '';

    const result = await this.tikhubGet<any>('/xiaohongshu/web_v3/fetch_hot_list', {});
    const items = result?.items || result?.data?.items || [];

    const sourceItems = Array.isArray(items) ? items : [];
    const capturedAt = new Date().toISOString();
    const trends: Trend[] = sourceItems.slice(0, Math.min(limit + 5, sourceItems.length)).map((item: any, index: number) => {
      const rawGrowth = item.growth_rate ?? item.growthRate ?? item.growth;
      const growthRate = Number.isFinite(Number(rawGrowth)) ? Number(rawGrowth) : 0;

      return {
        id: Date.now() + index,
        title: item.title || '未知趋势',
        description: `热词排行 #${item.rank || index + 1} | 热度: ${item.hot || item.hot_value || '未知'}`,
        platform: 'xiaohongshu',
        category: category || 'hot_list',
        heat: typeof item.hot_value === 'number' ? item.hot_value : parseInt(String(item.hot || '0').replace(/[^\d]/g, ''), 10) || 0,
        growthRate: parseFloat(growthRate.toFixed(2)),
        status: 'new' as const,
        discoveredAt: capturedAt,
        metadata: JSON.stringify({ sourceType: 'observed', provider: 'TikHub', endpoint: '/xiaohongshu/web_v3/fetch_hot_list', sourceId: item.id || item.note_id || item.word_id || null, sourceUrl: item.url || item.link || null, rank: item.rank || index + 1, capturedAt, growthAvailable: rawGrowth !== undefined && rawGrowth !== null }),
      };
    });

    log.info(`[TRAE] 发现 ${trends.length} 条趋势 (来自热榜, 保留原始排序)`);
    return { trends };
  }

  /**
   * 标签研究 - 调用 TikHub 小红书首页推荐 API
   * 使用 fetch_homefeed 获取推荐笔记，按关键词过滤后提取热门标签
   */
  private async researchHashtags(params: SkillParams): Promise<HashtagResearchResult> {
    const keyword = (params as any).keyword || '推荐';
    const limit = (params as any).limit || 10;

    // 根据关键词选择不同的推荐分类，增加结果多样性
    const categoryMap: Record<string, string> = {
      '时尚': 'homefeed_fashion',
      '美食': 'homefeed_food',
      '美妆': 'homefeed_makeup',
      '旅行': 'homefeed_travel',
      '健身': 'homefeed_sport',
      '数码': 'homefeed_digital',
    };
    let feedCategory = 'homefeed_recommend';
    for (const [kw, cat] of Object.entries(categoryMap)) {
      if (keyword.includes(kw)) {
        feedCategory = cat;
        break;
      }
    }

    // 调用首页推荐流获取内容
    const result = await this.tikhubGet<any>('/xiaohongshu/web_v3/fetch_homefeed', {
      category: feedCategory,
    });

    let notes = result?.data?.items || result?.items || result?.data || [];
    if (!Array.isArray(notes)) notes = [];

    // 按关键词过滤笔记：只保留标题/描述中包含关键词的笔记
    // 这样不同关键词会得到不同的标签集
    if (keyword && keyword !== '推荐') {
      const filtered = notes.filter((note: any) => {
        const card = note.note_card || note.note || note;
        const title = (card.display_title || card.title || note.title || '').toLowerCase();
        const desc = (card.desc || note.desc || '').toLowerCase();
        return title.includes(keyword.toLowerCase()) || desc.includes(keyword.toLowerCase());
      });
      // 如果过滤后仍有结果，使用过滤后的；否则使用全部
      if (filtered.length > 0) {
        notes = filtered;
      }
    }

    // 从推荐内容中提取标签信息
    const tagMap = new Map<string, { volume: number; related: Set<string> }>();

    notes.forEach((note: any) => {
      const card = note.note_card || note.note || note;
      const tags = card.tag_list || card.tags || note.tag_list || [];
      const likedCount = parseInt(card.interact_info?.liked_count || note.liked_count || '0', 10) || 0;

      (tags || []).forEach((t: any) => {
        const tagName = typeof t === 'string' ? t : (t.name || t.title || '');
        if (tagName) {
          if (!tagMap.has(tagName)) {
            tagMap.set(tagName, { volume: 0, related: new Set() });
          }
          const entry = tagMap.get(tagName)!;
          entry.volume += likedCount;
          if (tags.length > 1) {
            (tags as any[]).forEach((other: any) => {
              const otherName = typeof other === 'string' ? other : (other.name || '');
              if (otherName && otherName !== tagName) entry.related.add(otherName);
            });
          }
        }
      });
    });

    // 如果推荐流没有标签，使用关键词构造基础标签
    if (tagMap.size === 0) {
      const baseTags = [keyword, `${keyword}分享`, `${keyword}推荐`, `${keyword}教程`, `${keyword}攻略`];
      baseTags.forEach(tag => tagMap.set(tag, { volume: 0, related: new Set() }));
    }

    const hashtags: Hashtag[] = Array.from(tagMap.entries())
      .map(([tag, info], index) => ({
        id: Date.now() + index,
        tag,
        platform: 'xiaohongshu' as const,
        volume: info.volume,
        growthRate: 0,
        relatedTags: Array.from(info.related).slice(0, 5),
        researchedAt: new Date().toISOString(),
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);

    log.info(`[TRAE] 研究 ${hashtags.length} 个标签 (关键词="${keyword}", 分类=${feedCategory}, 过滤后笔记=${notes.length}/${result?.data?.items?.length || 0})`);
    return { hashtags };
  }

  /**
   * 内容生成 - 调用 Ollama 本地模型
   */
  private async generateContent(params: SkillParams): Promise<ContentGenerationResult> {
    const trendId = (params as any).trendId;
    const hashtagIds: number[] = (params as any).hashtagIds || [];
    const keywords: string[] = (params as any).keywords || ['分享', '日常'];

    const prompt = `你是一个专业的小红书内容创作者。请根据以下信息生成一篇小红书风格的图文笔记：

关键词：${keywords.join('、')}

要求：
1. 标题要吸引人，使用 emoji
2. 正文使用小红书风格，分段清晰
3. 包含实用建议和小贴士
4. 结尾添加 3-5 个相关标签
5. 字数控制在 300-500 字

请以 JSON 格式输出（只输出 JSON，不要其他内容）：
{"title": "标题", "body": "正文内容", "tags": ["标签1", "标签2", "标签3"]}`;

    let contentData: { title: string; body: string; tags: string[] };

    try {
      const ollamaResponse = await this.ollamaGenerate(prompt);
      const jsonMatch = ollamaResponse.match(/\{[\s\S]*\}/);
      contentData = jsonMatch ? JSON.parse(jsonMatch[0]) : {
        title: `${keywords[0]}分享 | 超实用攻略`,
        body: ollamaResponse,
        tags: keywords,
      };
    } catch (error) {
      log.warn('Ollama 不可用，使用默认模板', { error: (error as Error).message });
      contentData = {
        title: `${keywords[0]}分享 | 超实用攻略`,
        body: `今天分享一个超实用的内容！\n\n📝 正文内容：\n这里是根据关键词「${keywords.join('、')}」生成的小红书风格内容。\n包含详细的步骤说明和实用技巧。\n\n💡 小贴士：\n- 要点一\n- 要点二\n- 要点三\n\n#${keywords.join(' #')}`,
        tags: keywords.slice(0, 5),
      };
    }

    const content: Content = {
      id: Date.now(),
      title: contentData.title || '小红书笔记',
      body: contentData.body || '',
      tags: contentData.tags || keywords,
      images: [],
      trendId,
      hashtagIds: hashtagIds.join(','),
      status: 'draft' as const,
      generatedAt: new Date().toISOString(),
      isFavorited: false,
    };

    log.info(`[TRAE] 生成内容: ${content.title}`);
    return { content };
  }

  /**
   * 发布内容 - 通过 Python 子进程调用 xiaohongshu-skill
   *
   * 发布策略（与 xhs-auto-pipeline 保持一致）：
   * - 有图片 → xiaohongshu-skill publish (图文笔记)
   * - 无图片 → xhs-auto-pipeline custom_publish (长文笔记，修复版)
   * - 默认 --auto-publish=true (前端已确认发布意图)
   *
   * 修复记录：
   * 1. 移除假 URL fallback（原代码在失败时仍构造假 URL 掩盖失败）
   * 2. 无图片时改用 custom_publish.py（原 publish-longform 有 div.creator-tab 拦截 bug）
   * 3. 发布失败时 postUrl 保持 undefined，不再伪造
   */
  private async publishContent(params: SkillParams): Promise<PublishResult> {
    const contentId = (params as any).contentId;
    const title = (params as any).title || '测试笔记';
    const body = (params as any).body || '测试内容';
    const tags: string[] = (params as any).tags || [];
    const images: string[] = (params as any).images || [];

    let postUrl = '';
    let publishStatus: 'published' | 'failed' = 'failed';  // 默认失败，成功时才改为 published
    let errorMessage = '';

    try {
      const hasImages = images.length > 0;
      const fullContent = tags.length > 0 ? `${body}\n\n${tags.join(' ')}` : body;

      if (hasImages) {
        // 图文笔记 - 调用 xiaohongshu-skill 的 publish 命令
        const args: string[] = [
          'publish',
          `--title=${title}`,
          `--content=${fullContent}`,
          `--images=${images.join(',')}`,
          '--auto-publish',
          '--headless=false',
        ];

        log.info(`[TRAE] 调用 publish 发布图文笔记`, { title, imageCount: images.length });
        const stdout = await this.runPythonScript(args);

        // 解析最后一行 JSON 输出
        const lastLine = stdout.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}';
        const pyResult = JSON.parse(lastLine);

        if (pyResult.status === 'success') {
          postUrl = pyResult.url || pyResult.note_url || pyResult.publish_url || '';
          if (!postUrl) {
            errorMessage = '发布引擎返回成功但缺少笔记 URL';
            log.warn(`[TRAE] 图文笔记结果不完整`, { result: pyResult });
          } else {
            publishStatus = 'published';
            log.info(`[TRAE] 图文笔记发布成功: ${postUrl}`);
          }
        } else {
          errorMessage = pyResult.message || pyResult.error || '发布未成功';
          log.warn(`[TRAE] 图文笔记发布未成功`, { result: pyResult });
        }
      } else {
        // 长文笔记 - 调用本地 custom_publish.py（修复版，已从 xhs-auto-pipeline 迁移）
        // 原 publish-longform 命令因 div.creator-tab 拦截点击事件导致 Timeout
        // 修复: 不再使用 -m 加文件路径（-m 需要模块名而非路径），改为直接调用脚本文件
        const xhsPipelinePython = config.xhsPipelinePythonPath || 'python';
        const customPublishScript = path.join(config.pythonScriptsPath, 'custom_publish.py');

        // 检查脚本是否存在
        if (!fs.existsSync(customPublishScript)) {
          throw new Error(`custom_publish.py 不存在: ${customPublishScript}`);
        }

        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        const args = [
          customPublishScript,
          `--title=${title}`,
          `--content=${fullContent}`,
          '--auto-publish',
          '--headless=false',
        ];

        log.info(`[TRAE] 调用 custom_publish 发布长文笔记`, { title, script: customPublishScript });
        const result = await execFileAsync(xhsPipelinePython, args, {
          cwd: config.pythonScriptsPath,
          timeout: config.pipeline.stageTimeout,
          maxBuffer: PYTHON_MAX_BUFFER,
          windowsHide: false,
        });

        const stdout = result.stdout;
        const lastLine = stdout.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}';
        const pyResult = JSON.parse(lastLine);

        if (pyResult.success === true || pyResult.status === 'success') {
          postUrl = pyResult.url || pyResult.note_url || pyResult.publish_url || '';
          if (!postUrl) {
            errorMessage = '发布引擎返回成功但缺少笔记 URL';
            log.warn('[TRAE] 长文笔记结果不完整', { result: pyResult });
          } else {
            publishStatus = 'published';
            log.info(`[TRAE] 长文笔记发布成功: ${postUrl}`);
          }
        } else {
          errorMessage = pyResult.message || pyResult.error || pyResult.stderr || '长文发布未成功';
          log.warn(`[TRAE] 长文笔记发布未成功`, { result: pyResult });
        }
      }
    } catch (error) {
      log.error('[TRAE] Python 发布失败', { error: (error as Error).message });
      errorMessage = (error as Error).message;
    }

    // 修复：发布失败时 postUrl 保持空，不再构造假 URL
    const publication: Publication = {
      id: Date.now(),
      contentId,
      platform: 'xiaohongshu',
      postUrl: postUrl || undefined,  // 修复：失败时不构造假 URL
      status: publishStatus,
      publishedAt: publishStatus === 'published' ? new Date().toISOString() : undefined,
      errorMessage: publishStatus === 'failed' ? `发布失败: ${errorMessage}` : undefined,
    };

    return { publication };
  }

  /**
   * 效果追踪 - 生成分析数据
   *
   * ⚠️ 注意：当前使用模拟数据（Math.random），非真实追踪数据。
   * TikHub 的小红书 API 需要具体 user_id 才能查询真实数据。
   * 后续可对接真实 API（如 /xiaohongshu/web_v3/user_info 或创作者中心数据）。
   *
   * 返回的 AnalyticsRecord 中 isMockData=true 标识此为模拟数据。
   */
  private async trackAnalytics(params: SkillParams): Promise<AnalyticsTrackResult> {
    const publicationId = (params as any).publicationId || 1;
    const contentId = (params as any).contentId || 1;

    const views = Math.floor(Math.random() * 50000) + 1000;
    const likes = Math.floor(views * (0.05 + Math.random() * 0.1));
    const comments = Math.floor(likes * 0.1);
    const shares = Math.floor(likes * 0.05);
    const collects = Math.floor(likes * 0.3);
    const engagementRate = parseFloat(((likes + comments + shares + collects) / views * 100).toFixed(2));

    const analytics: AnalyticsRecord = {
      id: Date.now(),
      publicationId,
      contentId,
      views,
      likes,
      comments,
      shares,
      collects,
      engagementRate,
      trackedAt: new Date().toISOString(),
      isMockData: true,  // ⚠️ 标识为模拟数据
    };

    log.warn(`[TRAE] ⚠️ 返回模拟追踪数据（非真实）: ${views} 浏览, ${likes} 点赞`);
    return { analytics };
  }
}

// ============================================================================
// Skill Bridge 工厂
// ============================================================================

let bridgeInstance: SkillBridge | null = null;

export function getSkillBridge(): SkillBridge {
  if (!bridgeInstance) {
    if (config.skillBridgeMode === 'trae') {
      log.info('使用 TRAE Skill Bridge (真实技能调用)');
      bridgeInstance = new TraeSkillBridge();
    } else {
      log.info('使用 Mock Skill Bridge (模拟数据)');
      bridgeInstance = new MockSkillBridge();
    }
  }
  return bridgeInstance;
}

export function resetSkillBridge(): void {
  bridgeInstance = null;
}
