import path from 'path';
import { describe, expect, it, vi } from 'vitest';
const renderCards = vi.hoisted(() => vi.fn());
vi.mock('../card-render/card-render.service', () => ({ renderCards,
  getAvailableThemes: () => [{ name: 'sketch' }, { name: 'terminal' }] }));
vi.mock('../../utils/logger', () => ({ createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { renderAutoRedbookCards } from '../image-studio.service';
describe('dedicated card endpoint', () => {
  it('renders one group and preserves subtitle, emoji and all image references', async () => {
    renderCards.mockResolvedValue({ cover: path.resolve('cover.png'), cards: [path.resolve('card_1.png')], allImages: [path.resolve('cover.png'), path.resolve('card_1.png')], cardCount: 2 });
    const result = await renderAutoRedbookCards({ title: '标题', subtitle: '副标题', emoji: '🌿', content: '# 正文', theme: 'terminal', mode: 'separator' });
    expect(renderCards).toHaveBeenCalledTimes(1);
    expect(renderCards).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ subtitle: '副标题', emoji: '🌿', theme: 'terminal', mode: 'separator' }));
    expect(result.allImages).toEqual(['/api/contents/images/cover.png', '/api/contents/images/card_1.png']);
  });
});
