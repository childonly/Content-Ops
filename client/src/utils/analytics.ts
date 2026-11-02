import type { AnalyticsRecord } from '@/types';

export const sourceLabels: Record<NonNullable<AnalyticsRecord['sourceType']>, string> = {
  observed: '实测', estimated: '估算', simulated: '模拟', unknown: '来源待确认',
};

export function observedRecords(records: AnalyticsRecord[]): AnalyticsRecord[] {
  return records.filter(record => record.sourceType === 'observed');
}

export function metricText(record: AnalyticsRecord, key: 'views' | 'likes' | 'comments' | 'shares' | 'collects' | 'engagementRate'): string {
  if (!record.availableMetrics?.includes(key)) return '—';
  return key === 'engagementRate' ? `${record[key].toFixed(2)}%` : record[key].toLocaleString();
}

function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function analyticsCsv(records: AnalyticsRecord[]): string {
  const headers = ['ID', '内容ID', '发布ID', '浏览量', '点赞', '评论', '分享', '收藏', '互动率', '追踪时间', '来源类型', '提供商', '来源URL', '来源ID'];
  const rows = records.map(record => [record.id, record.contentId, record.publicationId,
    ...(['views', 'likes', 'comments', 'shares', 'collects', 'engagementRate'] as const).map(key => metricText(record, key)),
    record.trackedAt, sourceLabels[record.sourceType || 'unknown'], record.provider, record.sourceUrl, record.sourceId]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}
