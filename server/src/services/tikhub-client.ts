/**
 * TikHub API 客户端
 * 封装 axios 请求，提供：
 * - 自动 Bearer token 认证
 * - 请求重试（最多 N 次，可配置）
 * - 超时控制（默认 30 秒）
 * - 错误处理与统一日志
 * - 内存缓存集成
 * - 成本估算与余额查询
 *
 * 从 social-radar 项目迁移，适配 content-ops-hub 的 config/logger/cache
 * 文件名遵循 content-ops-hub 的 kebab-case 约定
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  AxiosError,
} from 'axios';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';
import { cache } from '../utils/radar-cache';
import {
  TikhubApiError,
  type TikhubErrorResponse,
  type CostEstimate,
  type DailyUsage,
} from '../types/radar.types';

const logger = createServiceLogger('radar-tikhub');

export class TikhubClient {
  private client: AxiosInstance;
  private retries: number;
  private enabled: boolean;

  constructor() {
    const tikhubConfig = config.tikhub;
    this.enabled = tikhubConfig.apiKey.length > 0;
    this.retries = tikhubConfig.retries;

    this.client = axios.create({
      baseURL: tikhubConfig.baseUrl,
      timeout: tikhubConfig.timeout,
      headers: {
        Authorization: `Bearer ${tikhubConfig.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // 请求拦截器 - 记录请求
    this.client.interceptors.request.use(
      (axiosConfig) => {
        const method = (axiosConfig.method || 'GET').toUpperCase();
        const url = axiosConfig.url || '';
        logger.debug(`TikHub 请求: ${method} ${url}`, {
          params: axiosConfig.params,
        });
        return axiosConfig;
      },
      (error) => {
        logger.error('TikHub 请求拦截器错误', { error: error.message });
        return Promise.reject(error);
      },
    );

    // 响应拦截器 - 统一日志
    this.client.interceptors.response.use(
      (response) => {
        const method = (response.config.method || 'GET').toUpperCase();
        const url = response.config.url || '';
        const status = response.status;
        logger.debug(`TikHub 响应: ${method} ${url} → ${status}`);
        return response;
      },
      (error: AxiosError) => {
        if (error.response) {
          const status = error.response.status;
          const url = error.config?.url || '';
          logger.error(`TikHub API 错误: ${status} ${url}`, {
            status,
            data: error.response.data,
          });
        } else if (error.code === 'ECONNABORTED') {
          logger.error(`TikHub 请求超时: ${error.config?.url || ''}`);
        } else {
          logger.error('TikHub 网络错误', { error: error.message });
        }
        return Promise.reject(error);
      },
    );
  }

  /** 检查客户端是否已配置 API 密钥 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 执行 GET 请求（带重试和缓存）
   * @param endpoint API 路径（不含 baseURL）
   * @param params 查询参数
   * @param options 选项（useCache, cacheTtl）
   */
  async get<T = unknown>(
    endpoint: string,
    params?: Record<string, unknown>,
    options?: { useCache?: boolean; cacheTtl?: number },
  ): Promise<T> {
    const useCache = options?.useCache ?? true;
    const cacheKey = this.buildCacheKey('GET', endpoint, params);

    if (useCache) {
      const result = await cache.getOrSet(
        cacheKey,
        () => this.requestWithRetry<T>('GET', endpoint, { params }),
        options?.cacheTtl,
      );
      return result.value;
    }

    return this.requestWithRetry<T>('GET', endpoint, { params });
  }

  /**
   * 执行 POST 请求（带重试和缓存）
   * @param endpoint API 路径
   * @param data 请求体
   * @param params 查询参数
   * @param options 选项
   */
  async post<T = unknown>(
    endpoint: string,
    data?: unknown,
    params?: Record<string, unknown>,
    options?: { useCache?: boolean; cacheTtl?: number },
  ): Promise<T> {
    const useCache = options?.useCache ?? false;
    const cacheKey = this.buildCacheKey('POST', endpoint, { params, data });

    if (useCache) {
      const result = await cache.getOrSet(
        cacheKey,
        () => this.requestWithRetry<T>('POST', endpoint, { params, data }),
        options?.cacheTtl,
      );
      return result.value;
    }

    return this.requestWithRetry<T>('POST', endpoint, { params, data });
  }

  /**
   * 带重试的请求执行
   * @param method HTTP 方法
   * @param endpoint API 路径
   * @param config Axios 请求配置
   */
  private async requestWithRetry<T>(
    method: string,
    endpoint: string,
    axiosConfig: AxiosRequestConfig,
  ): Promise<T> {
    let lastError: Error | null = null;
    const maxAttempts = this.retries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response: AxiosResponse<T> = await this.client.request<T>({
          method,
          url: endpoint,
          ...axiosConfig,
        });

        // TikHub 返回的数据结构通常是 { code: 200, data: ..., ... } 或直接返回数据
        // 这里统一提取 data 层
        return this.extractData<T>(response.data);
      } catch (error) {
        lastError = error as Error;

        // 如果是 4xx 错误（客户端错误），不重试
        if (error instanceof AxiosError && error.response) {
          const status = error.response.status;
          if (status >= 400 && status < 500) {
            const errorBody = error.response.data as TikhubErrorResponse | undefined;
            const message = errorBody?.message || `TikHub API 返回 ${status} 错误`;
            throw new TikhubApiError(message, status, errorBody);
          }
        }

        // 如果还有重试机会，等待后重试
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 指数退避，最大 5 秒
          logger.warn(
            `请求失败，${delay}ms 后重试 (${attempt}/${this.retries}): ${method} ${endpoint}`,
            { error: (error as Error).message },
          );
          await this.sleep(delay);
        }
      }
    }

    // 所有重试都失败了
    if (lastError instanceof AxiosError && lastError.response) {
      const errorBody = lastError.response.data as TikhubErrorResponse | undefined;
      const message = errorBody?.message || `TikHub API 请求失败 (${lastError.response.status})`;
      throw new TikhubApiError(message, lastError.response.status, errorBody);
    }

    throw new TikhubApiError(
      `TikHub API 请求失败: ${lastError?.message || '未知错误'}`,
      502,
      { originalError: lastError?.message },
    );
  }

  /**
   * 从 TikHub 响应中提取数据
   * TikHub 响应格式可能是：
   * 1. { code: 200, data: {...}, ... } → 提取 data
   * 2. 直接返回数据对象 → 原样返回
   */
  private extractData<T>(responseData: unknown): T {
    if (responseData === null || responseData === undefined) {
      throw new TikhubApiError('TikHub 返回空响应', 502);
    }

    // 检查是否有 code/data 结构
    if (typeof responseData === 'object' && responseData !== null) {
      const obj = responseData as Record<string, unknown>;
      if ('code' in obj && 'data' in obj) {
        const code = obj.code;
        if (code !== 200 && code !== 0) {
          const message = (obj.message as string) || `TikHub API 业务错误: code=${code}`;
          throw new TikhubApiError(message, 502, obj);
        }
        return obj.data as T;
      }
    }

    return responseData as T;
  }

  /** 构建缓存键 */
  private buildCacheKey(
    method: string,
    endpoint: string,
    paramsOrData?: unknown,
  ): string {
    const paramsStr = paramsOrData ? JSON.stringify(paramsOrData) : '';
    return `tikhub:${method}:${endpoint}:${paramsStr}`;
  }

  /** 延时工具 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // 成本与用量相关
  // ============================================================

  /**
   * 估算指定端点的请求成本
   * GET /tikhub/user/calculate_price?endpoint={path}&request_per_day={n}
   */
  async estimateCost(endpoint: string, requestPerDay: number = 1): Promise<CostEstimate> {
    try {
      const result = await this.get<CostEstimate>(
        '/tikhub/user/calculate_price',
        { endpoint, request_per_day: requestPerDay },
        { useCache: true, cacheTtl: 600000 }, // 缓存 10 分钟
      );
      return result;
    } catch (error) {
      logger.warn('成本估算失败，返回默认值', { endpoint, error: (error as Error).message });
      return {
        endpoint,
        estimatedCost: 0,
        currency: 'USD',
      };
    }
  }

  /**
   * 查询用户每日用量与余额
   * GET /tikhub/user/get_user_daily_usage
   */
  async getDailyUsage(): Promise<DailyUsage> {
    try {
      const result = await this.get<DailyUsage>(
        '/tikhub/user/get_user_daily_usage',
        undefined,
        { useCache: true, cacheTtl: 60000 }, // 缓存 1 分钟
      );

      // 标准化 TikHub 返回的用量数据
      // TikHub 实际返回字段: balance, usage, free_credit_usage, balance_usage,
      //   total_request_per_day, paid_request_per_day, uri_counts, last_requests_time
      const normalized: DailyUsage = {
        // 保留原始数据（包含 uri_counts 等详细字段）
        ...result,
        // 标准化字段（覆盖原始数据中的同名字段）
        balance: this.safeNumber(result.balance ?? result.remaining ?? 0),
        usedToday: this.safeNumber(result.total_request_per_day ?? result.requests_today ?? result.requestsToday ?? 0),
        limit: this.safeNumber(result.limit ?? result.daily_limit ?? result.rate_limit ?? 0),
        email: (result.email || result.user_email || undefined) as string | undefined,
        costToday: this.safeNumber(result.usage ?? result.daily_usage ?? result.cost_today ?? 0),
        requestsToday: this.safeNumber(result.total_request_per_day ?? result.requests_today ?? 0),
      };

      logger.info('TikHub 用量查询成功', {
        balance: normalized.balance,
        usedToday: normalized.usedToday,
        limit: normalized.limit,
      });

      return normalized;
    } catch (error) {
      logger.warn('查询用量失败', { error: (error as Error).message });
      return {
        balance: 0,
        usedToday: 0,
        limit: 0,
      };
    }
  }

  /** 安全转数字 */
  private safeNumber(value: unknown): number {
    if (value === undefined || value === null) return 0;
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }
}

/** 全局 TikHub 客户端实例 */
export const tikhubClient = new TikhubClient();

export default tikhubClient;
