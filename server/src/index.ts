import { createApp } from './app';
import { config } from './config';
import { createServiceLogger } from './utils/logger';
import { pipelineScheduler } from './services/scheduler.service';
import { startMonitoring, stopMonitoring } from './services/xhs-login.service';

const log = createServiceLogger('server');

const app = createApp();

const server = app.listen(config.port, async () => {
  log.info(`🚀 Content Ops Hub 服务已启动`, {
    port: config.port,
    env: config.nodeEnv,
    skillBridge: config.skillBridgeMode,
  });
  log.info(`📍 API 地址: http://localhost:${config.port}`);
  log.info(`📍 健康检查: http://localhost:${config.port}/health`);

  // 三项目融合第二阶段: 启动定时任务调度器
  try {
    await pipelineScheduler.start();
    log.info('✓ 定时任务调度器已启动');
  } catch (e) {
    log.error('调度器启动失败', { error: (e as Error).message });
  }

  // 启动登录状态后台监控
  try {
    startMonitoring();
    log.info('✓ 登录状态监控已启动');
  } catch (e) {
    log.error('登录监控启动失败', { error: (e as Error).message });
  }
});

// 优雅关闭
const shutdown = (signal: string) => {
  log.info(`收到 ${signal} 信号,正在关闭服务...`);

  // 1. 停止调度器
  try {
    pipelineScheduler.shutdown();
  } catch (e) {
    log.error('调度器关闭失败', { error: (e as Error).message });
  }

  // 2. 停止登录监控
  try {
    stopMonitoring();
  } catch (e) {
    log.error('登录监控关闭失败', { error: (e as Error).message });
  }

  // 3. 关闭 HTTP 服务
  server.close(() => {
    log.info('服务已关闭');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  log.error('未处理的 Promise 拒绝', { reason, promise: String(promise) });
});

process.on('uncaughtException', (error) => {
  log.error('未捕获的异常', { error: error.message, stack: error.stack });
  process.exit(1);
});
