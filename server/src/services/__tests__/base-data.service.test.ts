/**
 * BaseDataService 单元测试
 *
 * 测试从 XhsDataService 和 YoutubeDataService 提取的共享方法：
 * - extractList:       列表数据提取（多种 TikHub 响应格式）
 * - extractBool:       布尔值提取（多 key 回退）
 * - extractString:     字符串提取（多 key 回退）
 * - extractDetailObject: 详情对象提取
 * - safeNumber:        安全数字转换
 * - safeString:        安全字符串转换
 * - normalizeDate:     日期标准化
 * - tikhubGet:         TikHub API GET 请求代理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tikhub-client 模块
vi.mock('../tikhub-client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isEnabled: vi.fn(() => true),
  },
}));

// Mock logger 模块（避免 winston 文件写入问题）
vi.mock('../../utils/logger', () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { BaseDataService } from '../base-data.service';

// 创建具体子类用于测试受保护的成员
class TestableBaseDataService extends BaseDataService {
  constructor() {
    super('test-service');
  }

  // 暴露受保护的方法供测试
  public testExtractList(response: unknown) {
    return this.extractList(response);
  }

  public testExtractBool(response: unknown, keys: string[]) {
    return this.extractBool(response, keys);
  }

  public testExtractString(response: unknown, keys: string[]) {
    return this.extractString(response, keys);
  }

  public testExtractDetailObject(
    response: unknown,
    idFallback?: string,
    idKey?: string,
  ) {
    return this.extractDetailObject(response, idFallback, idKey);
  }

  public testSafeNumber(value: unknown) {
    return this.safeNumber(value);
  }

  public testSafeString(value: unknown, fallback?: string) {
    return this.safeString(value, fallback);
  }

  public testNormalizeDate(value: unknown) {
    return this.normalizeDate(value);
  }

  public async testTikhubGet<T>(
    endpoint: string,
    params: Record<string, string | number | boolean>,
    options?: { useCache?: boolean; cacheTtl?: number },
  ): Promise<T> {
    return this.tikhubGet<T>(endpoint, params, options);
  }
}

describe('BaseDataService', () => {
  let service: TestableBaseDataService;

  beforeEach(() => {
    service = new TestableBaseDataService();
  });

  // ============================================================
  // extractList
  // ============================================================
  describe('extractList', () => {
    it('直接数组 → 原样返回', () => {
      const data = [{ id: 1 }, { id: 2 }];
      expect(service.testExtractList(data)).toEqual(data);
    });

    it('{ items: [...] } → 返回 items', () => {
      const response = { items: [{ id: 1 }], total: 1 };
      expect(service.testExtractList(response)).toEqual([{ id: 1 }]);
    });

    it('{ data: { items: [...] } } → 返回嵌套 items', () => {
      const response = { data: { items: [{ id: 1 }] } };
      expect(service.testExtractList(response)).toEqual([{ id: 1 }]);
    });

    it('{ data: [...] } → 返回 data 数组', () => {
      const response = { data: [{ id: 1 }], code: 200 };
      expect(service.testExtractList(response)).toEqual([{ id: 1 }]);
    });

    it('{ notes: [...] } → 返回 notes', () => {
      const response = { notes: [{ note_id: 'abc' }], has_more: false };
      expect(service.testExtractList(response)).toEqual([{ note_id: 'abc' }]);
    });

    it('{ videos: [...] } → 返回 videos', () => {
      const response = { videos: [{ video_id: 'xyz' }] };
      expect(service.testExtractList(response)).toEqual([{ video_id: 'xyz' }]);
    });

    it('null → 返回空数组', () => {
      expect(service.testExtractList(null)).toEqual([]);
    });

    it('undefined → 返回空数组', () => {
      expect(service.testExtractList(undefined)).toEqual([]);
    });

    it('空对象 → 返回空数组', () => {
      expect(service.testExtractList({})).toEqual([]);
    });

    it('非对象 → 返回空数组', () => {
      expect(service.testExtractList('hello')).toEqual([]);
    });

    it('回退到第一个非空数组字段', () => {
      const response = { custom_list: [{ x: 1 }], name: 'test' };
      expect(service.testExtractList(response)).toEqual([{ x: 1 }]);
    });
  });

  // ============================================================
  // extractBool
  // ============================================================
  describe('extractBool', () => {
    it('直接布尔值 true', () => {
      expect(service.testExtractBool({ has_more: true }, ['has_more', 'hasMore'])).toBe(true);
    });

    it('直接布尔值 false', () => {
      expect(service.testExtractBool({ has_more: false }, ['has_more', 'hasMore'])).toBe(false);
    });

    it('字符串非空 → true', () => {
      expect(service.testExtractBool({ cursor: 'abc123' }, ['cursor'])).toBe(true);
    });

    it('字符串空 → false', () => {
      expect(service.testExtractBool({ cursor: '' }, ['cursor'])).toBe(false);
    });

    it('多 key 回退: 第一个不存在时用第二个', () => {
      expect(
        service.testExtractBool({ hasMore: true }, ['has_more', 'hasMore']),
      ).toBe(true);
    });

    it('嵌套在 data 中', () => {
      expect(
        service.testExtractBool({ data: { has_more: true } }, ['has_more']),
      ).toBe(true);
    });

    it('null → false', () => {
      expect(service.testExtractBool(null, ['has_more'])).toBe(false);
    });

    it('所有 key 都不存在 → false', () => {
      expect(service.testExtractBool({ other: 1 }, ['has_more', 'hasMore'])).toBe(false);
    });
  });

  // ============================================================
  // extractString
  // ============================================================
  describe('extractString', () => {
    it('直接字符串', () => {
      expect(
        service.testExtractString({ cursor: 'abc123' }, ['cursor', 'next_cursor']),
      ).toBe('abc123');
    });

    it('多 key 回退', () => {
      expect(
        service.testExtractString({ next_cursor: 'xyz' }, ['cursor', 'next_cursor']),
      ).toBe('xyz');
    });

    it('数字转字符串', () => {
      expect(
        service.testExtractString({ count: 42 }, ['count']),
      ).toBe('42');
    });

    it('嵌套在 data 中', () => {
      expect(
        service.testExtractString({ data: { cursor: 'nested' } }, ['cursor']),
      ).toBe('nested');
    });

    it('null → 空字符串', () => {
      expect(service.testExtractString(null, ['cursor'])).toBe('');
    });

    it('所有 key 不存在 → 空字符串', () => {
      expect(service.testExtractString({ other: 1 }, ['cursor'])).toBe('');
    });
  });

  // ============================================================
  // extractDetailObject
  // ============================================================
  describe('extractDetailObject', () => {
    it('{ data: { items: [first] } } → 返回第一项', () => {
      const response = { data: { items: [{ id: '123', title: 'test' }] } };
      const result = service.testExtractDetailObject(response);
      expect(result).toEqual({ id: '123', title: 'test' });
    });

    it('{ data: { note_id: "abc" } } → 返回 data 对象', () => {
      const response = { data: { note_id: 'abc', title: 'hello' } };
      const result = service.testExtractDetailObject(response, '', 'note_id');
      expect(result).toEqual({ note_id: 'abc', title: 'hello' });
    });

    it('{ items: [first] } → 返回第一项', () => {
      const response = { items: [{ id: '1' }] };
      const result = service.testExtractDetailObject(response);
      expect(result).toEqual({ id: '1' });
    });

    it('直接对象 → 原样返回', () => {
      const response = { id: '123', name: 'test' };
      const result = service.testExtractDetailObject(response);
      expect(result).toEqual(response);
    });

    it('null + idFallback → 返回占位对象', () => {
      const result = service.testExtractDetailObject(null, 'fallback-id');
      expect(result).toEqual({ id: 'fallback-id' });
    });

    it('null + 无 idFallback → 返回空对象', () => {
      const result = service.testExtractDetailObject(null);
      expect(result).toEqual({});
    });

    it('自定义 idKey', () => {
      const result = service.testExtractDetailObject(null, 'vid123', 'video_id');
      expect(result).toEqual({ video_id: 'vid123' });
    });
  });

  // ============================================================
  // safeNumber
  // ============================================================
  describe('safeNumber', () => {
    it('数字 → 原样返回', () => {
      expect(service.testSafeNumber(42)).toBe(42);
    });

    it('数字字符串 → 解析为数字', () => {
      expect(service.testSafeNumber('123')).toBe(123);
    });

    it('带非数字字符的字符串 → 提取数字', () => {
      expect(service.testSafeNumber('1,234 views')).toBe(1234);
    });

    it('undefined → 0', () => {
      expect(service.testSafeNumber(undefined)).toBe(0);
    });

    it('null → 0', () => {
      expect(service.testSafeNumber(null)).toBe(0);
    });

    it('NaN → 0', () => {
      expect(service.testSafeNumber(NaN)).toBe(0);
    });

    it('非数字字符串 → 0', () => {
      expect(service.testSafeNumber('abc')).toBe(0);
    });

    it('负数字符串', () => {
      expect(service.testSafeNumber('-50')).toBe(-50);
    });

    it('浮点数字符串 → 去掉小数点后取整', () => {
      // safeNumber 使用 replace(/[^\d-]/g, '') 去掉非数字字符，包括小数点
      expect(service.testSafeNumber('3.14')).toBe(314);
    });
  });

  // ============================================================
  // safeString
  // ============================================================
  describe('safeString', () => {
    it('字符串 → 原样返回', () => {
      expect(service.testSafeString('hello')).toBe('hello');
    });

    it('数字 → 转为字符串', () => {
      expect(service.testSafeString(42)).toBe('42');
    });

    it('undefined → 返回默认 fallback', () => {
      expect(service.testSafeString(undefined)).toBe('');
    });

    it('null → 返回默认 fallback', () => {
      expect(service.testSafeString(null)).toBe('');
    });

    it('undefined + 自定义 fallback', () => {
      expect(service.testSafeString(undefined, 'default')).toBe('default');
    });

    it('null + 自定义 fallback', () => {
      expect(service.testSafeString(null, 'N/A')).toBe('N/A');
    });

    it('布尔值 → 转为字符串', () => {
      expect(service.testSafeString(true)).toBe('true');
    });
  });

  // ============================================================
  // normalizeDate
  // ============================================================
  describe('normalizeDate', () => {
    it('有效 ISO 日期字符串 → ISO 格式', () => {
      const input = '2024-01-15T10:30:00Z';
      const result = service.testNormalizeDate(input);
      expect(result).toBe('2024-01-15T10:30:00.000Z');
    });

    it('时间戳数字 → 不支持数字时间戳，回退到当前时间', () => {
      // normalizeDate 使用 new Date(String(value))，数字时间戳转为字符串后无法解析
      const ts = 1705312200000;
      const result = service.testNormalizeDate(ts);
      const now = new Date();
      expect(result).toContain(now.getFullYear().toString());
    });

    it('null → 当前时间 ISO 格式', () => {
      const result = service.testNormalizeDate(null);
      const now = new Date();
      expect(result).toContain(now.getFullYear().toString());
    });

    it('undefined → 当前时间 ISO 格式', () => {
      const result = service.testNormalizeDate(undefined);
      const now = new Date();
      expect(result).toContain(now.getFullYear().toString());
    });

    it('空字符串 → 当前时间 ISO 格式', () => {
      const result = service.testNormalizeDate('');
      const now = new Date();
      expect(result).toContain(now.getFullYear().toString());
    });

    it('无效日期字符串 → 当前时间 ISO 格式', () => {
      const result = service.testNormalizeDate('invalid-date');
      const now = new Date();
      expect(result).toContain(now.getFullYear().toString());
    });
  });

  // ============================================================
  // tikhubGet
  // ============================================================
  describe('tikhubGet', () => {
    it('代理调用 tikhubClient.get 并返回结果', async () => {
      const mockData = { items: [{ id: 1 }] };
      const tikhubClient = (await import('../tikhub-client')).default;
      vi.mocked(tikhubClient.get).mockResolvedValue(mockData as never);

      const result = await service.testTikhubGet('/test/endpoint', { param: 'value' });
      expect(tikhubClient.get).toHaveBeenCalledWith('/test/endpoint', { param: 'value' }, undefined);
      expect(result).toEqual(mockData);
    });

    it('传递缓存选项', async () => {
      const mockData = { result: true };
      const tikhubClient = (await import('../tikhub-client')).default;
      vi.mocked(tikhubClient.get).mockResolvedValue(mockData as never);

      await service.testTikhubGet('/test/cached', { q: 'test' }, { useCache: true, cacheTtl: 60000 });
      expect(tikhubClient.get).toHaveBeenCalledWith(
        '/test/cached',
        { q: 'test' },
        { useCache: true, cacheTtl: 60000 },
      );
    });

    it('tikhubClient 抛出错误时透传', async () => {
      const tikhubClient = (await import('../tikhub-client')).default;
      const error = new Error('API Error');
      vi.mocked(tikhubClient.get).mockRejectedValue(error);

      await expect(
        service.testTikhubGet('/test/error', { param: 'value' }),
      ).rejects.toThrow('API Error');
    });
  });
});
