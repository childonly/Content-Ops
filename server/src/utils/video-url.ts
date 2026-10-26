/** 从平台分享文案中提取第一个 http(s) URL。 */
export function extractVideoUrl(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s\u3000（）()【】《》“”‘’]+/i);
  return match?.[0] || trimmed;
}

/** 提取 URL 前的分享标题，供转录记录展示来源。 */
export function extractVideoSourceText(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s\u3000（）()【】《》“”‘’]+/i);
  if (!match || trimmed.indexOf(match[0]) <= 0) return '';
  return trimmed.slice(0, trimmed.indexOf(match[0])).trim();
}
