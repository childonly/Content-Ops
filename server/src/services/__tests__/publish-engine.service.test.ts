import { describe, expect, it } from 'vitest';
import { parsePublishEngineOutput } from '../publish-engine.service';

describe('parsePublishEngineOutput', () => {
  it('accepts an explicit published result', () => {
    expect(parsePublishEngineOutput(
      'log line\n{"status":"published","url":"https://example.com/note"}',
      'xhs-skill',
    )).toMatchObject({
      success: true,
      url: 'https://example.com/note',
      engine: 'xhs-skill',
    });
  });

  it('rejects non-JSON output instead of reporting a false success', () => {
    expect(parsePublishEngineOutput('browser closed unexpectedly', 'xhs-skill'))
      .toMatchObject({
        success: false,
        error: '发布引擎未返回可解析的 JSON 结果',
      });
  });

  it('rejects malformed JSON and ready-only states', () => {
    expect(parsePublishEngineOutput('{not-json}', 'xhs-skill').success).toBe(false);
    expect(parsePublishEngineOutput('{"status":"ready"}', 'xhs-skill').success).toBe(false);
  });

  it('rejects a success result that has no published note URL', () => {
    expect(parsePublishEngineOutput('{"success":true}', 'xhs-skill')).toMatchObject({
      success: false,
      error: '发布结果缺少笔记 URL',
      engine: 'xhs-skill',
    });
  });

  it('keeps an explicit engine failure message', () => {
    expect(parsePublishEngineOutput(
      '{"success":false,"error":"login expired"}',
      'xhs-skill',
    )).toMatchObject({
      success: false,
      error: 'login expired',
      engine: 'xhs-skill',
    });
  });
});
