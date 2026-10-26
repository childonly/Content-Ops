/**
 * API 网关健康检查路由
 *
 * social-radar 代理已移除：radar 相关路由已完整迁移至 routes/radar.routes.ts，
 * 由 content-ops-hub 直接处理（挂载于 /api/radar/*），不再需要代理到 3002 端口。
 *
 * 路由映射:
 * - /api/gateway-status  → 网关健康检查
 */

import { Router } from 'express';

export const router = Router();

// ============================================================
// 网关健康检查 - 检查所有后端服务状态
// ============================================================

router.get('/gateway-status', async (_req, res) => {
  // social-radar 已合并为本地实现（routes/radar.routes.ts），不再作为独立服务检查
  const services = [
    { name: 'content-ops-hub', port: 3100, url: 'http://localhost:3100/health' },
  ];

  const results = await Promise.all(
    services.map(async (svc) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(svc.url, { signal: controller.signal });
        clearTimeout(timeout);
        return {
          name: svc.name,
          port: svc.port,
          status: 'online',
          httpStatus: resp.status,
        };
      } catch {
        return {
          name: svc.name,
          port: svc.port,
          status: 'offline',
          httpStatus: null,
        };
      }
    })
  );

  res.json({
    success: true,
    data: {
      gateway: 'content-ops-hub',
      version: '2.0.0-fusion-local',
      services: results,
      totalServices: results.length,
      onlineServices: results.filter((s) => s.status === 'online').length,
      note: 'social-radar 已合并为本地实现(routes/radar.routes.ts),不再需要代理;xhs-auto-pipeline 已在融合第二阶段合并为本地实现',
    },
  });
});
