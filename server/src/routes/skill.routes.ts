/**
 * Skill 路由 — 技能信息查询与文件夹打开
 *
 * 提供两个端点：
 *   GET  /api/skills          — 返回所有技能的元数据（名称/路径/描述/类型）
 *   POST /api/skills/open     — 在系统文件管理器中打开指定技能文件夹
 */

import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('skill-routes');

export const router = Router();

// ============================================================================
// 技能注册表 — 模块与 Skill 的映射关系
// ============================================================================

export type SkillType = 'file' | 'api' | 'local-model';

export interface SkillMeta {
  /** Skill 标识名（与 skill-bridge.ts 中的 SkillName 对应） */
  name: string;
  /** 中文显示名称 */
  label: string;
  /** 功能描述 */
  description: string;
  /** Skill 类型 */
  type: SkillType;
  /** 实现方式描述 */
  implementation: string;
  /** 本地文件夹绝对路径（null 表示 API/模型类型，无本地文件） */
  path: string | null;
  /** 关联的模块 ID 列表 */
  modules: string[];
}

/**
 * 技能注册表 — 模块与 Skill 的映射关系
 * 包含 5 个核心技能 + 7 个扩展技能 + 6 个补充注册技能 + 2 个新集成技能 = 20 个技能
 * 路径来源：.env 中的 XHS_SKILL_PATH / XHS_CONTENT_PATH + 系统默认 skills 目录
 */
const SKILL_REGISTRY: SkillMeta[] = [
  {
    name: 'trend-research',
    label: '趋势研究',
    description: '调用 TikHub API 获取各平台热门趋势榜单，为内容创作提供灵感来源。',
    type: 'api',
    implementation: 'TikHub API /xiaohongshu/web_v3/fetch_hot_list',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\trend-research',
    modules: ['radar', 'trends', 'pipeline'],
  },
  {
    name: 'hashtag-research',
    label: '标签研究',
    description: '调用 TikHub API 搜索和分析热门标签（Hashtag），优化内容曝光策略。',
    type: 'api',
    implementation: 'TikHub API /xiaohongshu/web_v3/fetch_homefeed',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\hashtag-research',
    modules: ['radar', 'hashtags', 'pipeline'],
  },
  {
    name: 'xhs-content',
    label: '小红书内容生成',
    description: '使用 Ollama 本地大模型（qwen2.5-coder:14b）生成小红书风格图文内容，支持加载 prompt.md 模板。',
    type: 'local-model',
    implementation: `Ollama ${config.ollamaModel} + prompt.md 模板`,
    path: config.xhsContentPath || 'C:\\Users\\wml1027\\.trae-cn\\skills\\xhs-content',
    modules: ['content', 'pipeline', 'xhs-pipeline'],
  },
  {
    name: 'xiaohongshu-skill',
    label: '小红书操作技能',
    description: '通过 Python 子进程调用 xiaohongshu-skill 执行笔记发布、登录管理等操作，支持 Playwright 自动化。',
    type: 'file',
    implementation: 'Python 子进程 (Playwright + custom_publish.py)',
    path: config.xhsSkillPath || 'C:\\Users\\wml1027\\.trae-cn\\skills\\xiaohongshu-skill',
    modules: ['publish', 'pipeline', 'xhs-pipeline', 'draft-review'],
  },
  {
    name: 'creator-analytics',
    label: '创作者数据分析',
    description: '追踪已发布内容的数据表现（浏览/点赞/评论/分享/收藏），当前为模拟数据模式。',
    type: 'api',
    implementation: '模拟数据（Math.random 生成）',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\creator-analytics',
    modules: ['analytics', 'pipeline'],
  },
  {
    name: 'xiaohongshu',
    label: '小红书数据',
    description: '扩展 TikHub API 获取小红书笔记详情、用户信息、搜索和评论数据。',
    type: 'api',
    implementation: 'TikHub API search_notes/note_detail/user_info',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\xiaohongshu',
    modules: ['radar', 'trends', 'hashtags'],
  },
  {
    name: 'youtube',
    label: 'YouTube数据',
    description: '通过 TikHub API 获取 YouTube 视频信息、频道数据和评论。',
    type: 'api',
    implementation: 'TikHub API youtube/web/v2',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\youtube',
    modules: ['radar', 'trends'],
  },
  {
    name: 'video-content-alchemist',
    label: '视频内容炼金术',
    description: '输入视频URL，自动转录、提炼核心观点，改写为多平台图文内容。',
    type: 'file',
    implementation: 'TikHub + LLM 多平台改写',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\video-content-alchemist',
    modules: ['video-alchemist', 'pipeline'],
  },
  {
    name: 'mrcarlsama-social-transcriber',
    label: '视频转录',
    description: '使用 faster-whisper 本地 ASR 引擎，将视频内容转录为带时间戳的文字。',
    type: 'file',
    implementation: 'Python faster-whisper + yt-dlp',
    path: config.pythonScriptsPath,
    modules: ['transcriber', 'video-alchemist'],
  },
  {
    name: 'brainstorming',
    label: '创意规划',
    description: '内容生成前进行创意头脑风暴，先发散再收敛，生成多个创意方向。',
    type: 'file',
    implementation: 'LLM 发散-收敛方法论',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\brainstorming',
    modules: ['content', 'pipeline'],
  },
  {
    name: 'Memory-Assistant',
    label: '记忆增强',
    description: '从历史优质内容中提取风格特征，作为记忆注入到新内容生成中。',
    type: 'file',
    implementation: '历史数据 Facts 注入 LLM',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\Memory-Assistant',
    modules: ['content', 'pipeline'],
  },
  {
    name: 'gpt-image-2',
    label: '图片生成(增强)',
    description: '基于 gpt-image-2 结构化提示词模板，增强 CogView-3-Flash 图片生成质量。',
    type: 'local-model',
    implementation: 'CogView-3-Flash + 结构化模板',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\gpt-image-2',
    modules: ['content', 'publish', 'video-alchemist'],
  },

  // ============================================================
  // 补充注册: 功能已在 radar-* 服务中实现，补充注册到 SKILL_REGISTRY
  // ============================================================

  {
    name: 'social-listening',
    label: '社交聆听',
    description: '跨平台关键词监听、情感分析、主题聚类，实时追踪品牌提及和舆情动态。',
    type: 'api',
    implementation: 'TikHub API 跨平台搜索 + radar-sentiment 情感分析',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\social-listening',
    modules: ['radar'],
  },
  {
    name: 'competitor-analysis',
    label: '竞品分析',
    description: '比较多个账号在各平台的表现，包括粉丝数、互动率、发布频率和热门内容。',
    type: 'api',
    implementation: 'TikHub API 多账号对比 + radar-competitor.service',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\competitor-analysis',
    modules: ['radar'],
  },
  {
    name: 'douyin',
    label: '抖音数据',
    description: '通过 TikHub API 获取抖音视频信息、用户资料、评论和搜索数据。',
    type: 'api',
    implementation: 'TikHub API douyin/app/v3 + douyin/search',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\douyin',
    modules: ['radar', 'trends'],
  },
  {
    name: 'instagram',
    label: 'Instagram数据',
    description: '通过 TikHub API 获取 Instagram 用户信息、帖子、标签和位置数据。',
    type: 'api',
    implementation: 'TikHub API instagram/v2',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\instagram',
    modules: ['radar'],
  },
  {
    name: 'tiktok',
    label: 'TikTok数据',
    description: '通过 TikHub API 获取 TikTok 视频、用户、评论和趋势数据。',
    type: 'api',
    implementation: 'TikHub API tiktok/app/v3',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\tiktok',
    modules: ['radar', 'trends'],
  },
  {
    name: 'twitter-threads',
    label: 'Twitter/X数据',
    description: '通过 TikHub API 获取 Twitter/X 推文、用户时间线、评论和热门话题。',
    type: 'api',
    implementation: 'TikHub API twitter/web',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\twitter-threads',
    modules: ['radar'],
  },

  // ============================================================
  // 新集成: 创建了完整的 service + route + 数据库表
  // ============================================================

  {
    name: 'comments-analysis',
    label: '评论分析',
    description: '拉取指定帖子/视频的评论数据，进行情感分析、主题聚类和关键词提取。',
    type: 'api',
    implementation: 'TikHub API 评论获取 + radar-sentiment 批量情感分析',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\comments-analysis',
    modules: ['radar', 'analytics', 'video-alchemist'],
  },
  {
    name: 'social-media-downloader',
    label: '媒体下载',
    description: '通过 TikHub API 获取各平台视频/图片的无水印下载链接，支持下载到本地。',
    type: 'api',
    implementation: 'TikHub API 无水印 URL + 本地流式下载',
    path: 'C:\\Users\\wml1027\\.trae-cn\\skills\\social-media-downloader',
    modules: ['radar', 'video-alchemist', 'transcriber'],
  },
];

// ============================================================================
// GET /api/skills — 返回所有技能元数据
// ============================================================================

router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: SKILL_REGISTRY,
    metadata: {
      total: SKILL_REGISTRY.length,
      types: {
        file: SKILL_REGISTRY.filter(s => s.type === 'file').length,
        api: SKILL_REGISTRY.filter(s => s.type === 'api').length,
        'local-model': SKILL_REGISTRY.filter(s => s.type === 'local-model').length,
      },
    },
  });
});

// ============================================================================
// GET /api/skills/:name — 返回单个技能详情
// ============================================================================

router.get('/:name', (req: Request, res: Response) => {
  const skill = SKILL_REGISTRY.find(s => s.name === req.params.name);
  if (!skill) {
    res.status(404).json({ success: false, error: `技能 "${req.params.name}" 不存在` });
    return;
  }
  res.json({ success: true, data: skill });
});

// ============================================================================
// POST /api/skills/open — 在系统文件管理器中打开技能文件夹
// ============================================================================

router.post('/open', (req: Request, res: Response) => {
  const { skillName } = req.body as { skillName?: string };

  if (!skillName) {
    res.status(400).json({ success: false, error: '缺少 skillName 参数' });
    return;
  }

  const skill = SKILL_REGISTRY.find(s => s.name === skillName);
  if (!skill) {
    res.status(404).json({ success: false, error: `技能 "${skillName}" 不存在` });
    return;
  }

  if (!skill.path) {
    res.status(400).json({ success: false, error: `技能 "${skillName}" 无本地文件夹（类型: ${skill.type}）` });
    return;
  }

  // 规范化路径
  const targetPath = path.resolve(skill.path);

  // 检查路径是否存在
  if (!fs.existsSync(targetPath)) {
    log.warn(`技能文件夹不存在`, { skillName, path: targetPath });
    res.status(200).json({
      success: false,
      error: `技能文件夹不存在: ${targetPath}`,
      path: targetPath,
      hint: '该技能可能尚未安装或路径配置不正确',
    });
    return;
  }

  log.info(`打开技能文件夹`, { skillName, path: targetPath });

  // Windows: 使用 cmd /c start 打开文件夹
  // 注意: explorer.exe 即使成功也会返回非零退出码，因此使用 start 命令并忽略退出码
  const command = `cmd /c start "" "${targetPath}"`;

  // 设置 5 秒超时，避免 exec 回调不触发导致 HTTP 请求挂起
  const childProcess = exec(command, { timeout: 5000 }, (error) => {
    // start 命令在成功时也可能返回非零退出码，因此不严格检查错误
    if (error && !error.message.includes('exit code')) {
      log.error(`打开文件夹失败`, { skillName, error: error.message });
      res.status(500).json({
        success: false,
        error: `无法打开文件夹: ${error.message}`,
        path: targetPath,
      });
      return;
    }

    res.json({
      success: true,
      data: {
        skillName: skill.name,
        path: targetPath,
        message: `已打开文件夹: ${targetPath}`,
      },
    });
  });

  // 兜底：如果 exec 回调因某种原因未触发，5.5 秒后强制返回成功
  // 因为 start 命令通常是异步的，文件夹可能已经打开但回调未触发
  childProcess.on('error', (err) => {
    log.error(`exec 进程错误`, { skillName, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: `无法启动文件管理器: ${err.message}`,
        path: targetPath,
      });
    }
  });
});

export default router;
