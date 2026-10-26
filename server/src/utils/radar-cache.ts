/**
 * 简单内存缓存 - Map + TTL 机制
 * 避免对 TikHub API 的重复请求
 * 从 social-radar 项目迁移，适配 content-ops-hub 的 logger
 */

import type { CacheEntry } from '../types/radar.types';
import { config } from '../config';
import { createServiceLogger } from './logger';

const logger = createServiceLogger('radar-cache');

export class MemoryCache {
  private store: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTtl: number;

  constructor(ttl?: number) {
    this.defaultTtl = ttl ?? config.cacheTtl;
  }

  /**
   * 从缓存中获取数据
   * @param key 缓存键
   * @returns 缓存值或 undefined（过期/不存在时）
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      logger.debug(`缓存已过期并移除: ${key}`);
      return undefined;
    }

    logger.debug(`缓存命中: ${key}`);
    return entry.value as T;
  }

  /**
   * 写入缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 自定义 TTL（毫秒），不传则使用默认值
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl ?? this.defaultTtl);
    this.store.set(key, { value, expiresAt });
    logger.debug(`缓存已写入: ${key}, TTL=${(ttl ?? this.defaultTtl) / 1000}s`);
  }

  /**
   * 获取或设置缓存
   * 如果缓存中存在则直接返回，否则执行 factory 函数获取数据并缓存
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
  ): Promise<{ value: T; cached: boolean }> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return { value: cached, cached: true };
    }

    const value = await factory();
    this.set(key, value, ttl);
    return { value, cached: false };
  }

  /** 删除指定缓存 */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** 清空所有缓存 */
  clear(): void {
    this.store.clear();
    logger.info('所有缓存已清空');
  }

  /** 获取当前缓存条目数 */
  size(): number {
    return this.store.size;
  }

  /** 清理所有过期缓存 */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug(`清理过期缓存: 移除 ${removed} 条，剩余 ${this.store.size} 条`);
    }
  }
}

/** 全局缓存实例 */
export const cache = new MemoryCache();

/** 定期清理过期缓存（每 5 分钟） */
setInterval(() => {
  cache.cleanup();
}, 5 * 60 * 1000).unref();

export default cache;
