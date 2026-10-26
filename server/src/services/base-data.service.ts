/**
 * BaseDataService - TikHub 数据服务基类
 *
 * 提取 XhsDataService 和 YoutubeDataService 的共享方法：
 * - tikhubGet<T>:  统一 TikHub API GET 请求（使用成熟的 tikhubClient，自带重试/缓存/错误处理）
 * - extractList:   从 TikHub 响应中提取列表数据
 * - extractBool:   从响应中提取布尔值（支持多 key 回退）
 * - extractString: 从响应中提取字符串（支持多 key 回退）
 * - safeNumber:    安全数字转换
 * - safeString:    安全字符串转换
 * - normalizeDate: 标准化日期字符串
 *
 * 设计原则：
 * 1. 子类只需实现平台特定的 normalize 方法和公开业务方法
 * 2. 所有 TikHub API 调用统一走 tikhubClient（不使用裸 fetch）
 * 3. 响应提取方法兼容 TikHub 多种返回格式（数组 / {data: [...]} / {items: [...]} 等）
 */

import tikhubClient from './tikhub-client';
import { createServiceLogger } from '../utils/logger';

export abstract class BaseDataService {
  protected logger: ReturnType<typeof createServiceLogger>;

  constructor(serviceName: string) {
    this.logger = createServiceLogger(serviceName);
  }

  // ============================================================
  // TikHub API 请求
  // ============================================================

  /**
   * TikHub API GET 请求
   * 使用成熟的 tikhubClient，自带：
   * - Bearer token 认证
   * - 请求重试（指数退避）
   * - 内存缓存
   * - 统一错误处理（TikhubApiError）
   * - 响应数据自动提取（{ code: 200, data: ... } → data）
   *
   * @param endpoint API 路径（不含 baseURL，如 '/xiaohongshu/app_v2/search_notes'）
   * @param params   查询参数
   * @param options  缓存选项
   */
  protected async tikhubGet<T>(
    endpoint: string,
    params: Record<string, string | number | boolean>,
    options?: { useCache?: boolean; cacheTtl?: number },
  ): Promise<T> {
    return tikhubClient.get<T>(endpoint, params, options);
  }

  // ============================================================
  // 响应提取辅助方法
  // ============================================================

  /**
   * 从 TikHub 响应中提取列表数据
   * 兼容多种返回格式：
   * - 直接数组: [...]
   * - { items: [...] }
   * - { data: { items: [...] } }
   * - { data: [...] }
   * - { notes/videos/comments: [...] }
   */
  protected extractList(response: unknown): unknown[] {
    if (!response) return [];
    if (Array.isArray(response)) return response;

    const resp = response as Record<string, unknown>;
    if (typeof resp !== 'object' || resp === null) return [];

    // 优先检查常见的列表字段名
    const directKeys = ['items', 'notes', 'videos', 'comments', 'list', 'data'];
    for (const key of directKeys) {
      if (Array.isArray(resp[key])) return resp[key] as unknown[];
    }

    // 检查 data 字段内的列表
    const dataObj = resp.data;
    if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
      const data = dataObj as Record<string, unknown>;
      for (const key of ['items', 'notes', 'videos', 'comments', 'list']) {
        if (Array.isArray(data[key])) return data[key] as unknown[];
      }
    }

    // 回退：返回第一个非空数组字段
    for (const key of Object.keys(resp)) {
      if (Array.isArray(resp[key]) && (resp[key] as unknown[]).length > 0) {
        return resp[key] as unknown[];
      }
    }

    return [];
  }

  /**
   * 从响应中提取布尔值（支持多 key 回退）
   * @param response 响应对象
   * @param keys     候选 key 列表（按优先级）
   */
  protected extractBool(response: unknown, keys: string[]): boolean {
    if (!response || typeof response !== 'object') return false;
    const resp = response as Record<string, unknown>;

    for (const key of keys) {
      if (resp[key] !== undefined && resp[key] !== null) {
        const val = resp[key];
        if (typeof val === 'string') return val.length > 0;
        return Boolean(val);
      }
    }

    const dataObj = resp.data;
    if (dataObj && typeof dataObj === 'object') {
      const data = dataObj as Record<string, unknown>;
      for (const key of keys) {
        if (data[key] !== undefined && data[key] !== null) {
          const val = data[key];
          if (typeof val === 'string') return val.length > 0;
          return Boolean(val);
        }
      }
    }
    return false;
  }

  /**
   * 从响应中提取字符串（支持多 key 回退）
   * @param response 响应对象
   * @param keys     候选 key 列表（按优先级）
   */
  protected extractString(response: unknown, keys: string[]): string {
    if (!response || typeof response !== 'object') return '';
    const resp = response as Record<string, unknown>;

    for (const key of keys) {
      if (resp[key] !== undefined && resp[key] !== null) {
        return String(resp[key]);
      }
    }

    const dataObj = resp.data;
    if (dataObj && typeof dataObj === 'object') {
      const data = dataObj as Record<string, unknown>;
      for (const key of keys) {
        if (data[key] !== undefined && data[key] !== null) {
          return String(data[key]);
        }
      }
    }
    return '';
  }

  /**
   * 从详情响应中提取对象（兼容 { data: { items: [first] } } 等格式）
   * @param response    响应对象
   * @param idFallback  如果无法提取，返回包含此 ID 的占位对象
   * @param idKey       ID 字段名（默认 'id'）
   */
  protected extractDetailObject(
    response: unknown,
    idFallback?: string,
    idKey: string = 'id',
  ): Record<string, unknown> {
    if (!response || typeof response !== 'object') {
      return idFallback ? { [idKey]: idFallback } : {};
    }

    const resp = response as Record<string, unknown>;

    // data 字段内
    const dataObj = resp.data;
    if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
      const data = dataObj as Record<string, unknown>;
      if (Array.isArray(data.items) && data.items.length > 0) {
        return data.items[0] as Record<string, unknown>;
      }
      if (data[idKey] || data.note_id || data.video_id || data.channel_id) {
        return data;
      }
    }

    // items 数组的第一项
    const items = this.extractList(response);
    if (items.length > 0) return items[0] as Record<string, unknown>;

    // 直接返回 response
    return resp;
  }

  // ============================================================
  // 类型转换辅助方法
  // ============================================================

  /** 安全转数字（处理 undefined/null/NaN/字符串） */
  protected safeNumber(value: unknown): number {
    if (value === undefined || value === null) return 0;
    if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
    const num = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
    return Number.isNaN(num) ? 0 : num;
  }

  /** 安全转字符串（处理 undefined/null） */
  protected safeString(value: unknown, fallback: string = ''): string {
    if (value === undefined || value === null) return fallback;
    return String(value);
  }

  /** 标准化日期字符串为 ISO 格式 */
  protected normalizeDate(value: unknown): string {
    if (!value) return new Date().toISOString();
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
}
