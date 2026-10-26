/**
 * 关键词研究服务 (从 xhs-auto-pipeline research_service.py 移植)
 *
 * P0-2: 优先使用 TikHub API(无需浏览器/cookie,3-5s 响应,数据更丰富)
 * 失败时回退到 Playwright 脚本(xhs-search-edge.py)
 *
 * 对应 Python 源: backend/app/services/research_service.py
 */

import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { PYTHON_MAX_BUFFER } from '../utils/constants';

const execFileAsync = promisify(execFile);
const log = createServiceLogger('research');

// ============================================================================
// 类型定义
// ============================================================================

export interface XhsPost {
  title: string;
  author: string;
  likes: number;
  comments: number;
  favorites: number;
  shares: number;
  views: number;
  url: string;
  tags: string[];
  text: string;
  ip_location: string;
  images: string[];
  type: string;
  engagement_score: number;
}

// ============================================================================
// TikHub API 搜索 (主方法)
// ============================================================================

/**
 * 通过 TikHub API 搜索小红书笔记。
 *
 * 复用已迁移的 TikhubClient(支持重试/缓存/成本控制)。
 */
async function searchViaTikhub(keyword: string, limit: number): Promise<XhsPost[]> {
  if (!config.tikhubApiKey) {
    log.info('[research] TikHub API 未配置,使用 Playwright 兜底');
    return [];
  }

  try {
    // 动态导入避免循环依赖
    const { TikhubClient } = await import('./tikhub-client');
    const client = new TikhubClient();

    log.info(`[research] 使用 TikHub API 搜索: '${keyword}'`);

    // 调用小红书搜索端点
    const endpoint = `/xiaohongshu/web_v1/search_notes`;
    const result = await client.get<any>(endpoint, {
      keyword,
      page: 1,
      page_size: limit,
      sort: 'general',
      note_type: 0,
    });

    const items = result?.data?.items || result?.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      log.warn(`[research] TikHub 未返回 '${keyword}' 的结果`);
      return [];
    }

    const posts: XhsPost[] = items.slice(0, limit).map((item: any) => {
      const note = item.note_card || item.note || item;
      const interact = note.interact_info || {};
      const likes = parseInt(interact.liked_count || '0', 10) || 0;
      const comments = parseInt(interact.comment_count || '0', 10) || 0;
      const favorites = parseInt(interact.collected_count || '0', 10) || 0;
      const shares = parseInt(interact.share_count || '0', 10) || 0;

      return {
        title: note.display_title || note.title || '无标题',
        author: note.user?.nickname || note.user?.name || '未知',
        likes,
        comments,
        favorites,
        shares,
        views: parseInt(interact.view_count || '0', 10) || 0,
        url: note.note_id ? `https://www.xiaohongshu.com/explore/${note.note_id}` : '',
        tags: (note.tag_list || []).map((t: any) => (typeof t === 'string' ? t : t.name || '')).filter(Boolean),
        text: note.desc || note.content || '',
        ip_location: note.ip_location || '',
        images: (note.image_list || []).map((img: any) => (typeof img === 'string' ? img : img.url || '')).filter(Boolean),
        type: note.type || 'normal',
        engagement_score: likes + comments * 2 + favorites * 1.5 + shares * 3,
      };
    });

    log.info(`[research] TikHub 搜索完成: '${keyword}' 找到 ${posts.length} 篇`);
    return posts;
  } catch (e) {
    log.warn(`[research] TikHub 搜索失败: ${(e as Error).message},回退到 Playwright`);
    return [];
  }
}

// ============================================================================
// Playwright 搜索 (兜底方法)
// ============================================================================

/**
 * 通过 xhs-search-edge.py 搜索(兜底)。
 *
 * 需要 cookie 文件存在,使用 Edge 浏览器 + launch_persistent_context。
 * 脚本已迁移到本项目 scripts/python/ 目录下统一管理。
 */
async function searchViaPlaywright(keyword: string, limit: number): Promise<XhsPost[]> {
  // 查找搜索脚本(已迁移到本项目 scripts/python/)
  const searchScript = path.join(config.pythonScriptsPath, 'xhs-search-edge.py');

  if (!fs.existsSync(searchScript)) {
    log.error(`[research] 搜索脚本不存在: ${searchScript}`);
    return [];
  }

  // 查找 cookie 文件
  // 优先查找本项目 data/cookies/，回退到 xhs-auto-pipeline/backend/data/cookies/
  const localCookieDir = path.join(config.pythonScriptsPath, '..', '..', 'data', 'cookies');
  const legacyCookieDir = config.xhsPipelinePath
    ? path.join(config.xhsPipelinePath, 'backend', 'data', 'cookies')
    : '';
  let cookieFile = '';

  const cookieCandidates = [
    localCookieDir ? path.join(localCookieDir, 'xiaohongshu-skill.json') : '',
    localCookieDir ? path.join(localCookieDir, 'xhs-content.json') : '',
    legacyCookieDir ? path.join(legacyCookieDir, 'xiaohongshu-skill.json') : '',
    legacyCookieDir ? path.join(legacyCookieDir, 'xhs-content.json') : '',
  ].filter(Boolean);

  for (const candidate of cookieCandidates) {
    if (fs.existsSync(candidate)) {
      cookieFile = candidate;
      log.info(`[research] 使用 cookie 文件: ${cookieFile}`);
      break;
    }
  }

  if (!cookieFile) {
    log.warn(`[research] 未找到 cookie 文件,需先登录`);
  }

  const args = [searchScript, '--keyword', keyword, '--limit', String(limit)];
  if (cookieFile) {
    args.push('--cookie-file', cookieFile);
  }

  log.info(`[research] 使用 Edge 浏览器搜索 '${keyword}' (limit=${limit})`);

  try {
    const { stdout } = await execFileAsync(config.xhsPipelinePythonPath || 'python', args, {
      timeout: 180000, // 3 分钟
      maxBuffer: PYTHON_MAX_BUFFER,
      windowsHide: false,
    });

    const output = stdout.trim();
    if (!output) {
      log.error('[research] 搜索脚本无输出');
      return [];
    }

    const posts = JSON.parse(output) as XhsPost[];

    // 计算互动分
    for (const post of posts) {
      const likes = post.likes || 0;
      const comments = post.comments || 0;
      const favorites = post.favorites || 0;
      const shares = post.shares || 0;
      post.engagement_score = likes + comments * 2 + favorites * 1.5 + shares * 3;
    }

    log.info(`[research] Playwright 搜索完成: '${keyword}' 找到 ${posts.length} 篇`);
    return posts;
  } catch (e) {
    log.error(`[research] Playwright 搜索失败: ${(e as Error).message}`);
    return [];
  }
}

// ============================================================================
// 主入口: 搜索笔记
// ============================================================================

/**
 * 搜索小红书笔记。
 *
 * 优先 TikHub API,失败时回退到 Playwright 脚本。
 */
export async function searchPosts(keyword: string, limit: number = 20): Promise<XhsPost[]> {
  log.info(`[research] 搜索关键词: '${keyword}' (limit=${limit})`);

  // 1. 先尝试 TikHub API
  let posts = await searchViaTikhub(keyword, limit);

  // 2. TikHub 无结果时回退到 Playwright
  if (posts.length === 0) {
    log.info('[research] TikHub 无结果,回退到 Playwright');
    posts = await searchViaPlaywright(keyword, limit);
  }

  return posts.slice(0, limit);
}

// ============================================================================
// 报告生成
// ============================================================================

/**
 * 从搜索结果生成 Markdown 研究报告。
 */
export function generateReport(posts: XhsPost[], keyword: string): string {
  if (posts.length === 0) {
    return `# 小红书搜索报告：${keyword}\n\n未找到相关内容。`;
  }

  // 按互动分排序
  const sorted = [...posts].sort((a, b) => b.engagement_score - a.engagement_score);

  const totalLikes = sorted.reduce((s, p) => s + (p.likes || 0), 0);
  const totalComments = sorted.reduce((s, p) => s + (p.comments || 0), 0);
  const totalFavorites = sorted.reduce((s, p) => s + (p.favorites || 0), 0);

  const lines: string[] = [
    `# 小红书搜索报告：${keyword}`,
    '',
    `**调研时间**: ${new Date().toISOString().substring(0, 16).replace('T', ' ')} UTC`,
    `**样本数量**: ${sorted.length} 篇笔记`,
    `**总点赞**: ${totalLikes.toLocaleString()}`,
    `**总评论**: ${totalComments.toLocaleString()}`,
    `**总收藏**: ${totalFavorites.toLocaleString()}`,
    '',
    '## 热门内容 TOP 10',
    '',
  ];

  sorted.slice(0, 10).forEach((post, i) => {
    lines.push(`### ${i + 1}. ${post.title}`);
    lines.push('');
    lines.push(`- **作者**: ${post.author}`);
    lines.push(`- **点赞**: ${post.likes.toLocaleString()} | **评论**: ${post.comments.toLocaleString()} | **收藏**: ${post.favorites.toLocaleString()}`);
    if (post.views) {
      lines.push(`- **浏览量**: ${post.views.toLocaleString()}`);
    }
    if (post.ip_location) {
      lines.push(`- **IP归属地**: ${post.ip_location}`);
    }
    if (post.type && post.type !== 'normal') {
      lines.push(`- **类型**: ${post.type}`);
    }
    if (post.tags.length > 0) {
      lines.push(`- **标签**: ${post.tags.map((t) => `#${t}`).join(' ')}`);
    }
    if (post.url) {
      lines.push(`- **链接**: ${post.url}`);
    }
    if (post.images.length > 0) {
      lines.push(`- **图片数量**: ${post.images.length} 张`);
    }
    if (post.text) {
      const preview = post.text.substring(0, 300) + (post.text.length > 300 ? '...' : '');
      lines.push(`- **内容摘要**: ${preview}`);
    }
    lines.push('');
  });

  // 内容特征分析
  lines.push('## 内容特征分析');
  lines.push('');

  // 标题长度分析
  const titleLengths = sorted.filter((p) => p.title).map((p) => p.title.length);
  if (titleLengths.length > 0) {
    const avgLen = titleLengths.reduce((s, l) => s + l, 0) / titleLengths.length;
    lines.push(`- **平均标题长度**: ${avgLen.toFixed(1)} 字符`);
  }

  // 标签分析
  const tagCount: Record<string, number> = {};
  for (const p of sorted) {
    for (const t of p.tags) {
      if (t) {
        tagCount[t] = (tagCount[t] || 0) + 1;
      }
    }
  }

  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (topTags.length > 0) {
    lines.push('- **热门标签**:');
    for (const [tag, count] of topTags) {
      lines.push(`  - #${tag} (${count}次)`);
    }
  }

  // 互动分布
  if (sorted.length > 0) {
    const top = sorted[0].engagement_score;
    const median = sorted[Math.floor(sorted.length / 2)].engagement_score;
    lines.push(`- **最高互动分**: ${top.toLocaleString()}`);
    lines.push(`- **中位互动分**: ${median.toLocaleString()}`);
  }

  lines.push('');
  lines.push('## 创作建议');
  lines.push('');
  lines.push(`基于「${keyword}」的调研结果，建议：`);
  lines.push('');
  lines.push('1. **标题策略**: 参考热门标题的用词和长度');
  lines.push('2. **标签使用**: 使用热门标签增加曝光');
  lines.push('3. **内容方向**: 结合高互动内容的主题方向');
  lines.push('4. **发布时机**: 参考热门内容的发布时间');
  lines.push('');

  return lines.join('\n');
}
