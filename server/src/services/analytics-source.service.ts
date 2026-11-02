import { xhsDataService } from './xhs-data.service';
import type { AnalyticsMetric, AnalyticsRecord } from '../types';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export async function fetchObservedAnalytics(input: {
  publicationId: number; contentId: number; publicationUrl?: string; platform?: string;
}): Promise<AnalyticsRecord> {
  if (input.platform && input.platform !== 'xiaohongshu') throw new Error('当前真实追踪仅支持小红书发布记录');
  const match = input.publicationUrl?.match(/^https:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-f0-9]{24})(?:[/?#]|$)/i);
  if (!match) throw new Error('请先补全已发布的小红书笔记 URL（含真实笔记 ID）');
  const note = await xhsDataService.getNoteDetail(match[1]);
  if (!note) throw new Error('未取得真实笔记指标，请检查 TikHub 权限、配额及笔记是否可访问');
  const raw = object(note.raw);
  const card = object(raw.note_card || raw.noteCard || raw.note || raw);
  const interact = object(card.interact_info || card.interaction || raw.interact_info);
  const fields: Record<Exclude<AnalyticsMetric, 'engagementRate'>, string[]> = {
    likes: ['liked_count'], comments: ['comment_count'], shares: ['shared_count'], collects: ['collected_count'], views: ['view_count', 'exposure'],
  };
  const availableMetrics: AnalyticsMetric[] = [];
  for (const [metric, keys] of Object.entries(fields)) {
    if (keys.some(key => interact[key] !== undefined && interact[key] !== null && interact[key] !== '')) availableMetrics.push(metric as AnalyticsMetric);
  }
  if (!availableMetrics.length) throw new Error('平台未返回可验证的真实指标，未生成替代数据');
  const { views, likes, comments, shares, collects } = note.metrics;
  const canCalculateRate = views > 0 && Object.keys(fields).every(key => availableMetrics.includes(key as AnalyticsMetric));
  if (canCalculateRate) availableMetrics.push('engagementRate');
  return {
    id: 0, publicationId: input.publicationId, contentId: input.contentId, views, likes, comments, shares, collects,
    engagementRate: canCalculateRate ? Number(((likes + comments + shares + collects) / views * 100).toFixed(2)) : 0,
    trackedAt: new Date().toISOString(), sourceType: 'observed', isMockData: false, provider: 'TikHub',
    sourceId: match[1], sourceUrl: `https://www.xiaohongshu.com/explore/${match[1]}`, availableMetrics,
  };
}
