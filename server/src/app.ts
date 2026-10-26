import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { createServiceLogger } from './utils/logger';
import { initDb } from './db';

// 路由
import { router as trendRoutes } from './routes/trend.routes';
import { router as hashtagRoutes } from './routes/hashtag.routes';
import { router as contentRoutes } from './routes/content.routes';
import { router as publishRoutes } from './routes/publish.routes';
import { router as analyticsRoutes } from './routes/analytics.routes';
import { router as pipelineRoutes } from './routes/pipeline.routes';
import { router as dashboardRoutes } from './routes/dashboard.routes';
import { router as xhsRoutes } from './routes/xhs.routes';
import { router as radarRoutes } from './routes/radar.routes';
import { router as proxyRoutes } from './routes/proxy.routes';

// 三项目融合第二阶段:本地实现替换代理
import { router as xhsPipelineRoutes } from './routes/xhs-pipeline.routes';
import { router as xhsKeywordsRoutes } from './routes/xhs-keywords.routes';
import { router as xhsSchedulesRoutes } from './routes/xhs-schedules.routes';
import { router as xhsLoginRoutes } from './routes/xhs-login.routes';
import { router as skillRoutes } from './routes/skill.routes';

// 视频内容处理路由
import { router as videoAlchemistRoutes } from './routes/video-alchemist.routes';
import { router as transcriberRoutes } from './routes/transcriber.routes';
import { router as videoStudioRoutes } from './routes/video-studio.routes';

// 技能融合:brainstorming + Memory-Assistant + gpt-image-2 增强路由
import { router as brainstormingRoutes } from './routes/brainstorming.routes';
import { router as memoryRoutes } from './routes/memory.routes';

// TikHub API 扩展: 小红书 / YouTube 数据端点
import { router as xhsDataRoutes } from './routes/xhs-data.routes';
import { router as youtubeDataRoutes } from './routes/youtube-data.routes';

// 评论分析 + 媒体下载 (新集成技能)
import { router as commentsAnalysisRoutes } from './routes/comments-analysis.routes';
import { router as mediaDownloadRoutes } from './routes/media-download.routes';

// 业务流线 (类"扣子"自定义流程编排)
import { router as businessFlowRoutes } from './routes/business-flow.routes';
import { router as projectWorkflowRoutes } from './routes/project-workflow.routes';

// 对话式内容创作 (多轮对话 + LLM)
import { router as chatRoutes } from './routes/chat.routes';

// 内容模板库 + AI优化
import { router as templateRoutes } from './routes/template.routes';

// 服务状态管理（复用 port-manager）
import { router as serviceStatusRoutes } from './routes/service-status.routes';

// 图片工作室（多引擎架构：CogView + RedInk + guizang-card + Auto-Redbook + baoyu）
import { router as imageStudioRoutes } from './routes/image-studio.routes';

// 内容生产链路增强（Auto-Redbook + summarizer + baoyu 配图）
import { router as pipelineEnhancerRoutes } from './routes/pipeline-enhancer.routes';

// 系统管理（模板/Skill/LLM/模块统一管理）
import { router as adminRoutes } from './routes/admin.routes';

const log = createServiceLogger('app');

export function createApp(): express.Application {
  const app = express();

  // 中间件
  app.use(helmet({
    contentSecurityPolicy: false, // 开发环境禁用 CSP，避免阻塞内联脚本
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({
    origin: config.clientUrl,
    credentials: true,
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 速率限制：写接口限 100 次/15 分钟
  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: '请求过于频繁，请稍后再试' },
  });
  // 对写接口应用限流
  app.use('/api/pipeline/run', writeLimiter);
  app.use('/api/publish/execute', writeLimiter);
  app.use('/api/xhs-pipeline/start', writeLimiter);
  app.use('/api/contents/generate', writeLimiter);
  app.use('/api/contents/generate-enhanced', writeLimiter);
  app.use('/api/brainstorming/generate', writeLimiter);
  app.use('/api/video-alchemist/process', writeLimiter);
  app.use('/api/transcriber/transcribe', writeLimiter);
  app.use('/api/video-studio/process', writeLimiter);
  app.use('/api/comments-analysis/analyze', writeLimiter);
  app.use('/api/media-download/fetch', writeLimiter);
  app.use('/api/business-flows/execute', writeLimiter);
  app.use('/api/project-workflows', writeLimiter);
  app.use('/api/chat/conversations/:id/messages', writeLimiter);
  app.use('/api/chat/conversations/:id/generate', writeLimiter);
  app.use('/api/contents/generate-images', writeLimiter);
  app.use('/api/contents/upload-image', writeLimiter);

  // 请求日志
  app.use((req: Request, _res: Response, next: NextFunction) => {
    log.info(`${req.method} ${req.url}`, {
      method: req.method,
      url: req.url,
      ip: req.ip,
    });
    next();
  });

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API 路由
  app.use('/api/trends', trendRoutes);
  app.use('/api/hashtags', hashtagRoutes);
  app.use('/api/contents', contentRoutes);
  app.use('/api/publish', publishRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/pipeline', pipelineRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/xhs', xhsRoutes);

  // Social Radar 路由（从 social-radar 项目完整迁移，直接处理，不再代理到 3002 端口）
  app.use('/api/radar', radarRoutes);

  // ============================================================
  // 三项目融合第二阶段:本地实现路由(替换原 proxy.routes.ts 代理)
  // ============================================================
  // 小红书自动化流水线(替换原 /api/xhs-pipeline 代理到 8000)
  app.use('/api/xhs-pipeline', xhsPipelineRoutes);
  // 关键词管理
  app.use('/api/xhs-keywords', xhsKeywordsRoutes);
  // 定时任务管理
  app.use('/api/xhs-schedules', xhsSchedulesRoutes);
  // 小红书登录管理
  app.use('/api/xhs-login', xhsLoginRoutes);

  // 技能管理（查询技能元数据 + 打开技能文件夹）
  app.use('/api/skills', skillRoutes);

  // ============================================================
  // 技能融合:brainstorming + Memory-Assistant + gpt-image-2 增强路由
  // ============================================================
  // 创意规划 (brainstorming 技能方法论: 发散-收敛)
  app.use('/api/brainstorming', brainstormingRoutes);
  // 记忆增强 (Memory-Assistant 技能方法论: 历史优质内容特征注入)
  app.use('/api/memory', memoryRoutes);

  // TikHub API 扩展: 小红书 / YouTube 数据端点
  app.use('/api/xhs-data', xhsDataRoutes);
  app.use('/api/youtube-data', youtubeDataRoutes);

  // ============================================================
  // 视频内容处理路由
  // ============================================================
  // 视频内容炼金术 (URL → 提取文字 → 提炼核心观点 → 改写多平台图文)
  app.use('/api/video-alchemist', videoAlchemistRoutes);
  // 视频转录 (URL → 下载音频 → faster-whisper ASR 转录)
  app.use('/api/transcriber', transcriberRoutes);
  // 视频工作室 (统一入口: strategy 选择 transcribe/alchemist)
  app.use('/api/video-studio', videoStudioRoutes);

  // ============================================================
  // 新集成技能路由
  // ============================================================
  // 评论分析 (TikHub 评论获取 + 情感分析 + 主题聚类)
  app.use('/api/comments-analysis', commentsAnalysisRoutes);
  // 媒体下载 (TikHub 无水印 URL + 本地下载)
  app.use('/api/media-download', mediaDownloadRoutes);

  // ============================================================
  // 业务流线路由
  // ============================================================
  // 业务流线 (类"扣子"自定义流程编排: 拖拽 skill 和模块组成新业务流线)
  app.use('/api/business-flows', businessFlowRoutes);
  app.use('/api/project-workflows', projectWorkflowRoutes);

  // ============================================================
  // 对话式内容创作 (多轮对话 + LLM)
  // ============================================================
  app.use('/api/chat', chatRoutes);

  // ============================================================
  // 内容模板库 + AI优化
  // ============================================================
  app.use('/api/templates', templateRoutes);

  // ============================================================
  // 服务状态管理（复用 port-manager，统一维护）
  // ============================================================
  app.use('/api/service-status', serviceStatusRoutes);

  // 图片工作室（多引擎图片生成：CogView/RedInk/guizang-card/Auto-Redbook/baoyu）
  app.use('/api/image-studio', imageStudioRoutes);

  // 内容生产链路增强（Auto-Redbook 风格改写 + summarizer 摘要 + baoyu 配图）
  app.use('/api/pipeline-enhancer', pipelineEnhancerRoutes);

  // 系统管理
  app.use('/api/admin', adminRoutes);

  // 静态文件服务: 生成/上传的图片
  const imageDir = path.join(process.cwd(), config.image.outputDir || 'data/generated_images');
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  app.use('/api/contents/images', express.static(imageDir));

  // API 网关健康检查（social-radar 代理已移除，radar 路由已直接处理）
  // /api/gateway-status → 网关健康检查
  app.use('/api', proxyRoutes);

  // 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: '接口不存在' });
  });

  // 错误处理
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error('未捕获的错误', { error: err.message, stack: err.stack });
    res.status(500).json({
      success: false,
      error: err.message || '服务器内部错误',
    });
  });

  // 初始化数据库
  initDb();

  return app;
}
