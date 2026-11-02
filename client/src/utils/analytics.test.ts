import { describe, expect, it } from 'vitest'
import { analyticsCsv, metricText, observedRecords } from './analytics'
import type { AnalyticsRecord } from '@/types'
const record: AnalyticsRecord = { id:1, publicationId:1, contentId:1, views:0, likes:12, comments:0, shares:0, collects:0, engagementRate:0, trackedAt:'2026-11-01', sourceType:'observed', availableMetrics:['likes'] }
describe('analytics presentation', () => {
  it('shows unavailable views as missing rather than a measured zero', () => {
    expect(metricText(record,'views')).toBe('—'); expect(metricText(record,'likes')).toBe('12')
  })
  it('keeps unknown and simulated rows out of charts and totals', () => {
    expect(observedRecords([record,{...record,sourceType:'unknown'},{...record,sourceType:'simulated'}])).toEqual([record])
  })
  it('exports provenance and quotes untrusted strings without formula execution', () => {
    const csv = analyticsCsv([{...record,provider:'=formula',sourceId:'id"quoted',sourceUrl:'https://example.test/note'}])
    expect(csv).toContain('实测'); expect(csv).toContain("'=formula"); expect(csv).toContain('id""quoted'); expect(csv.startsWith('\uFEFF')).toBe(true)
  })
})
