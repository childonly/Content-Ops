import { describe, expect, it, vi } from 'vitest';
const detail = vi.hoisted(() => vi.fn());
vi.mock('../xhs-data.service', () => ({ xhsDataService: { getNoteDetail: detail } }));
import { fetchObservedAnalytics } from '../analytics-source.service';
describe('observed note metrics', () => {
  it('uses a canonical published note ID and marks unavailable views', async () => {
    detail.mockResolvedValue({ id: '0123456789abcdef01234567', metrics: { views: 0, likes: 12, comments: 0, shares: 2, collects: 6 }, raw: { interact_info: { liked_count: '12', comment_count: 0, shared_count: 2, collected_count: 6 } } });
    const result = await fetchObservedAnalytics({ publicationId: 1, contentId: 3, publicationUrl: 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567', platform: 'xiaohongshu' });
    expect(detail).toHaveBeenCalledWith('0123456789abcdef01234567');
    expect(result).toMatchObject({ sourceType: 'observed', provider: 'TikHub', likes: 12, comments: 0, isMockData: false });
    expect(result.availableMetrics).toEqual(['likes', 'comments', 'shares', 'collects']);
  });
  it('fails explicitly when data is unavailable, without generating random fallback', async () => {
    detail.mockResolvedValue(null);
    await expect(fetchObservedAnalytics({ publicationId: 1, contentId: 3, publicationUrl: 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567' })).rejects.toThrow('真实');
  });
  it('rejects arbitrary URLs and unpublished/short links', async () => {
    await expect(fetchObservedAnalytics({ publicationId: 1, contentId: 3, publicationUrl: 'http://127.0.0.1/private' })).rejects.toThrow('笔记 URL');
  });
});
