/**
 * Social Radar 路由 (Express 版本)
 * 从 social-radar 的 Koa 路由迁移而来，合并所有子路由到一个 Express Router
 *
 * 挂载路径: /api/radar
 * 直接处理请求，不再通过 proxy.routes.ts 代理到 social-radar:3002
 *
 * 端点列表:
 * - GET    /health            - 健康检查
 * - GET    /                  - API 信息
 * - GET    /usage             - 查询 TikHub 账户用量与余额
 * - GET    /cost-estimate     - 估算指定端点的请求成本
 * - DELETE /cache             - 清空内存缓存
 * - GET    /trends            - 获取多平台趋势数据
 * - GET    /hashtags          - 搜索标签
 * - GET    /hashtags/:id      - 获取标签详情
 * - POST   /listening         - 多平台舆情监听
 * - POST   /competitors       - 多账号竞品分析
 *
 * costGuard 中间件逻辑（从 social-radar middleware/costGuard.ts 迁移）:
 * - 对数据请求路由预估 TikHub API 调用成本
 * - 在响应头中附加 X-Estimated-Cost / X-Cost-Warning / X-Account-Balance
 * - 余额不足时返回 402
 *
 * errorHandler 逻辑（从 social-radar middleware/errorHandler.ts 迁移）:
 * - 统一处理 AppError 和普通 Error，返回 { success, data, error, code } 结构
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import tikhubClient from '../services/tikhub-client';
import trendService from '../services/radar-trend.service';
import hashtagService from '../services/radar-hashtag.service';
import listeningService from '../services/radar-listening.service';
import competitorService from '../services/radar-competitor.service';
import { cache } from '../utils/radar-cache';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { AppError, ALL_PLATFORMS, type Platform } from '../types/radar.types';

const logger = createServiceLogger('radar-routes');

export const router = Router();

// ============================================================
// 辅助函数
// ============================================================

/**
 * 统一错误处理（从 social-radar middleware/errorHandler.ts 迁移）
 * 将 AppError 和普通 Error 转换为 JSON 响应
 */
function handleError(error: unknown, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      data: null,
      error: error.message,
      code: error.code,
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error('未处理的错误', { error: message, stack: (error as Error)?.stack });
  res.status(500).json({
    success: false,
    data: null,
    error: message,
  });
}

// ============================================================
// 成本预估中间件（从 social-radar middleware/costGuard.ts 迁移）
// ============================================================

/**
 * 根据路由路径和请求参数估算总成本
 * 路径为 router 内部相对路径（如 /trends, /hashtags/:id）
 */
function estimateRequestCost(path: string, body?: unknown): number {
  const avgCost = 0.015; // 平均每个端点成本

  // 各路由对应涉及的 TikHub 端点数量
  const ROUTE_ENDPOINT_COUNT: Record<string, number> = {
    '/trends': 4,        // 4 个趋势端点
    '/hashtags': 3,      // 搜索时可能涉及 3 个平台
    '/listening': 6,     // 最多 6 个平台搜索
    '/competitors': 2,   // 每个账号约 2 个端点
  };

  // hashtags/:id 详情路由
  if (path.match(/^\/hashtags\/[^/]+$/)) {
    return Math.round(2 * avgCost * 100) / 100;
  }

  // 对于 listening，根据平台数量估算
  if (path === '/listening' && body && typeof body === 'object') {
    const platforms = (body as { platforms?: string[] }).platforms;
    const platformCount = platforms?.length || 1;
    return Math.round(platformCount * avgCost * 100) / 100;
  }

  // 对于 competitors，根据账号数量估算
  if (path === '/competitors' && body && typeof body === 'object') {
    const accounts = (body as { accounts?: unknown[] }).accounts;
    const accountCount = accounts?.length || 1;
    // 每个账号约 2 个端点
    return Math.round(accountCount * 2 * avgCost * 100) / 100;
  }

  const baseCount = ROUTE_ENDPOINT_COUNT[path] || 1;
  return Math.round(baseCount * avgCost * 100) / 100;
}

/**
 * 成本预估中间件（Express 版本）
 * 对数据请求路由进行成本预估，附加响应头，余额不足时返回 402
 */
async function costGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const path = req.path;
  const method = req.method;

  // 只对数据请求路由进行成本预估（排除 health/usage/cost-estimate/cache/info）
  if (method === 'OPTIONS') {
    next();
    return;
  }

  // 估算成本
  const body = req.body;
  const estimatedCost = estimateRequestCost(path, body);

  logger.info('请求成本预估', {
    path,
    method,
    estimatedCost: `$${estimatedCost.toFixed(2)}`,
    threshold: `$${config.costThreshold.toFixed(2)}`,
  });

  // 如果超过阈值，记录警告
  if (estimatedCost > config.costThreshold) {
    logger.warn('请求成本超过阈值', {
      path,
      estimatedCost,
      threshold: config.costThreshold,
      message: `预估成本 $${estimatedCost.toFixed(2)} 超过阈值 $${config.costThreshold.toFixed(2)}`,
    });
    res.setHeader('X-Cost-Warning', 'true');
  }

  // 在响应头中附加预估成本
  res.setHeader('X-Estimated-Cost', estimatedCost.toFixed(2));

  // 尝试查询实际余额（TikhubClient 内部已缓存 1 分钟）
  try {
    const usage = await tikhubClient.getDailyUsage();
    if (usage.balance > 0) {
      res.setHeader('X-Account-Balance', usage.balance.toFixed(2));

      // 如果余额不足以覆盖预估成本，阻止请求
      if (usage.balance < estimatedCost) {
        logger.error('账户余额不足', {
          balance: usage.balance,
          estimatedCost,
          path,
        });
        res.status(402).json({
          success: false,
          data: null,
          error: `账户余额不足: 当前余额 $${usage.balance.toFixed(2)}，预估花费 $${estimatedCost.toFixed(2)}`,
          meta: {
            code: 'INSUFFICIENT_BALANCE',
            balance: usage.balance,
            estimatedCost,
          },
        });
        return;
      }
    }
  } catch {
    // 余额查询失败不阻止请求
    logger.debug('余额查询失败，跳过余额检查');
  }

  next();
}

// ============================================================
// 健康检查与系统信息
// ============================================================

/**
 * GET /health - 健康检查
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      tikhubConfigured: tikhubClient.isEnabled(),
      cacheSize: cache.size(),
    },
  });
});

/**
 * GET / - API 信息
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      name: 'Social Radar API (migrated)',
      version: '2.0.0',
      description: '社媒情报中心后端 API - 已迁移至 content-ops-hub（直接处理，不再代理）',
      endpoints: [
        { method: 'GET', path: '/api/radar/trends', description: '获取多平台趋势数据', params: ['platform (tiktok|twitter|all)', 'country', 'period'] },
        { method: 'GET', path: '/api/radar/hashtags', description: '搜索标签', params: ['q (必填)', 'platform (tiktok|instagram|xhs)'] },
        { method: 'GET', path: '/api/radar/hashtags/:id', description: '获取标签详情', params: ['id (路径)', 'platform (tiktok|instagram)'] },
        { method: 'POST', path: '/api/radar/listening', description: '多平台舆情监听', body: ['keyword (必填)', 'platforms[] (必填)', 'limit'] },
        { method: 'POST', path: '/api/radar/competitors', description: '多账号竞品分析', body: ['accounts[{platform, handle}] (必填)'] },
        { method: 'GET', path: '/api/radar/usage', description: '查询 TikHub 账户用量与余额' },
        { method: 'GET', path: '/api/radar/cost-estimate', description: '估算指定端点的请求成本', params: ['endpoint', 'request_per_day'] },
        { method: 'GET', path: '/api/radar/health', description: '健康检查' },
      ],
    },
  });
});

/**
 * GET /usage - 查询 TikHub 账户用量与余额
 */
router.get('/usage', async (_req: Request, res: Response) => {
  try {
    const usage = await tikhubClient.getDailyUsage();
    res.json({
      success: true,
      data: usage,
      meta: { cached: true },
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /cost-estimate - 估算指定端点的请求成本
 * 查询参数: endpoint (TikHub API 路径), request_per_day (每日请求次数)
 */
router.get('/cost-estimate', async (req: Request, res: Response) => {
  try {
    const endpoint = String(req.query.endpoint || '');
    const requestPerDayStr = String(req.query.request_per_day || '1');
    const requestPerDay = parseInt(requestPerDayStr, 10) || 1;

    if (!endpoint) {
      res.status(400).json({
        success: false,
        data: null,
        error: 'endpoint 参数必填',
      });
      return;
    }

    const estimate = await tikhubClient.estimateCost(endpoint, requestPerDay);
    res.json({
      success: true,
      data: estimate,
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * DELETE /cache - 清空内存缓存
 */
router.delete('/cache', (_req: Request, res: Response) => {
  const sizeBefore = cache.size();
  cache.clear();
  res.json({
    success: true,
    data: {
      cleared: sizeBefore,
      remaining: cache.size(),
    },
    message: `已清空 ${sizeBefore} 条缓存`,
  });
});

// ============================================================
// 趋势路由（应用成本预估中间件）
// ============================================================

/**
 * GET /trends
 * 查询参数:
 *   - platform: 平台筛选 (tiktok, twitter, all)，默认 all
 *   - country: 国家代码 (US, JP, CN 等)，默认 US
 *   - period: 时间范围（天），默认 7
 */
router.get('/trends', costGuard, async (req: Request, res: Response) => {
  try {
    const platform = (String(req.query.platform || 'all')) as Platform | 'all';
    const country = String(req.query.country || 'US');
    const periodStr = String(req.query.period || '7');
    const period = parseInt(periodStr, 10) || 7;

    // 参数校验
    if (Number.isNaN(period) || period < 1 || period > 30) {
      throw new AppError(
        'period 参数无效，必须是 1-30 之间的整数',
        400,
        'INVALID_PARAMETER',
      );
    }

    const validPlatforms = ['tiktok', 'twitter', 'all'];
    if (!validPlatforms.includes(platform)) {
      throw new AppError(
        `platform 参数无效，支持: ${validPlatforms.join(', ')}`,
        400,
        'INVALID_PARAMETER',
      );
    }

    const result = await trendService.getTrends({
      platform: platform as Platform | 'all',
      country,
      period,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

// ============================================================
// 标签路由（应用成本预估中间件）
// ============================================================

/**
 * GET /hashtags
 * 查询参数:
 *   - q: 搜索关键词（可选，不提供时返回热门标签列表）
 *   - platform: 平台筛选 (tiktok, instagram, xhs)，可选
 */
router.get('/hashtags', costGuard, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '');
    const platformStr = req.query.platform ? String(req.query.platform) : undefined;

    let platform: Platform | undefined;
    if (platformStr) {
      if (!ALL_PLATFORMS.includes(platformStr as Platform)) {
        throw new AppError(
          `platform 参数无效，支持: ${ALL_PLATFORMS.join(', ')}`,
          400,
          'INVALID_PARAMETER',
        );
      }
      platform = platformStr as Platform;
    }

    const result = await hashtagService.searchHashtags(q, platform);
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * GET /hashtags/:id
 * 查询参数:
 *   - platform: 平台 (tiktok, instagram)，必填
 * 路径参数:
 *   - id: 标签 ID
 */
router.get('/hashtags/:id', costGuard, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const platformStr = String(req.query.platform || '');

    if (!id) {
      throw new AppError('标签 ID 不能为空', 400, 'MISSING_PARAMETER');
    }

    if (!platformStr) {
      throw new AppError('platform 参数必填 (tiktok 或 instagram)', 400, 'MISSING_PARAMETER');
    }

    const supportedPlatforms: Platform[] = ['tiktok', 'instagram'];
    if (!supportedPlatforms.includes(platformStr as Platform)) {
      throw new AppError(
        `platform 参数无效，标签详情支持: ${supportedPlatforms.join(', ')}`,
        400,
        'INVALID_PARAMETER',
      );
    }

    const result = await hashtagService.getHashtagDetail(id, platformStr as Platform);
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

// ============================================================
// 舆情路由（应用成本预估中间件）
// ============================================================

/**
 * POST /listening
 * 请求体:
 *   - keyword: 搜索关键词（必填）
 *   - platforms: 平台数组 (tiktok, douyin, instagram, twitter, youtube, xhs)
 *   - limit: 每平台结果数量上限，默认 20
 */
router.post('/listening', costGuard, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      keyword?: string;
      platforms?: string[];
      limit?: number;
    };

    // 参数校验
    if (!body.keyword || body.keyword.trim().length === 0) {
      throw new AppError('keyword 不能为空', 400, 'MISSING_PARAMETER');
    }

    if (!body.platforms || !Array.isArray(body.platforms) || body.platforms.length === 0) {
      throw new AppError('platforms 不能为空，至少指定一个平台', 400, 'MISSING_PARAMETER');
    }

    // 验证平台参数
    const invalidPlatforms = body.platforms.filter(
      (p) => !ALL_PLATFORMS.includes(p as Platform),
    );
    if (invalidPlatforms.length > 0) {
      throw new AppError(
        `不支持的平台: ${invalidPlatforms.join(', ')}，支持: ${ALL_PLATFORMS.join(', ')}`,
        400,
        'INVALID_PARAMETER',
      );
    }

    const platforms = body.platforms as Platform[];
    const limit = body.limit ?? 20;

    if (limit < 1 || limit > 100) {
      throw new AppError('limit 必须在 1-100 之间', 400, 'INVALID_PARAMETER');
    }

    const result = await listeningService.listen({
      keyword: body.keyword,
      platforms,
      limit,
    });

    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

// ============================================================
// 竞品路由（应用成本预估中间件）
// ============================================================

/**
 * POST /competitors
 * 请求体:
 *   - accounts: 账号数组，每项包含:
 *     - platform: 平台 (tiktok, instagram, twitter, youtube, xhs)
 *     - handle: 用户标识 (sec_uid / username / screen_name / channel_id / user_id)
 */
router.post('/competitors', costGuard, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      accounts?: Array<{ platform: string; handle: string }>;
    };

    // 参数校验
    if (!body.accounts || !Array.isArray(body.accounts) || body.accounts.length === 0) {
      throw new AppError('accounts 不能为空，至少指定一个账号', 400, 'MISSING_PARAMETER');
    }

    if (body.accounts.length > 20) {
      throw new AppError('accounts 最多支持 20 个账号', 400, 'INVALID_PARAMETER');
    }

    // 验证每个账号参数
    for (let i = 0; i < body.accounts.length; i++) {
      const account = body.accounts[i];
      if (!account.platform) {
        throw new AppError(`accounts[${i}].platform 不能为空`, 400, 'MISSING_PARAMETER');
      }
      if (!ALL_PLATFORMS.includes(account.platform as Platform)) {
        throw new AppError(
          `accounts[${i}].platform 无效: ${account.platform}，支持: ${ALL_PLATFORMS.join(', ')}`,
          400,
          'INVALID_PARAMETER',
        );
      }
      if (!account.handle || account.handle.trim().length === 0) {
        throw new AppError(`accounts[${i}].handle 不能为空`, 400, 'MISSING_PARAMETER');
      }
    }

    const accounts = body.accounts.map((a) => ({
      platform: a.platform as Platform,
      handle: a.handle,
    }));

    const result = await competitorService.analyzeCompetitors({ accounts });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
