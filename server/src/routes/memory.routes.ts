/**
 * 记忆增强路由 - /api/memory
 *
 * 提供历史内容记忆提取和提示词增强能力 (Memory-Assistant 技能方法论)。
 */

import { Router, Request, Response } from 'express';
import {
  extractMemoryFromHistory,
  buildMemoryContext,
  enhancePrompt,
  ContentMemory,
} from '../services/memory-enhancer.service';
import { ApiResponse } from '../types';

export const router = Router();

// GET /history - 获取历史内容记忆
//
// 查询参数:
//   ?limit=20  提取的历史内容条数 (默认 20,最大 100)
//
// 响应:
//   {
//     "success": true,
//     "data": ContentMemory,
//     "message": "提取到 N 条历史记忆"
//   }
router.get('/history', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit
      ? parseInt(String(req.query.limit), 10)
      : 20;

    if (Number.isNaN(limit) || limit < 1) {
      return res
        .status(400)
        .json({ success: false, error: 'limit 必须是正整数' } as ApiResponse);
    }

    const memory: ContentMemory = extractMemoryFromHistory(limit);

    const hasData =
      memory.topTitles.length > 0 ||
      memory.popularTags.length > 0 ||
      memory.successfulAngles.length > 0;

    res.status(200).json({
      success: true,
      data: memory,
      message: hasData ? '记忆提取成功' : '数据库暂无历史数据',
    } as ApiResponse<ContentMemory>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /enhance - 增强提示词
//
// 请求体:
//   {
//     "prompt": "原始 LLM 提示词",
//     "limit": 20                              // 可选,提取历史记忆的条数
//     "memory": ContentMemory                  // 可选,直接传入记忆对象 (优先于 limit)
//   }
//
// 响应:
//   {
//     "success": true,
//     "data": {
//       "originalPrompt": "...",
//       "enhancedPrompt": "...",
//       "memory": ContentMemory,
//       "memoryContext": "..."
//     }
//   }
router.post('/enhance', (req: Request, res: Response) => {
  try {
    const { prompt, limit, memory: providedMemory } = req.body as {
      prompt?: string;
      limit?: number;
      memory?: ContentMemory;
    };

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'prompt 不能为空' } as ApiResponse);
    }

    // 获取记忆: 优先使用传入的 memory,否则从数据库提取
    let memory: ContentMemory;
    if (providedMemory) {
      memory = providedMemory;
    } else {
      const historyLimit = typeof limit === 'number' && limit > 0 ? limit : 20;
      memory = extractMemoryFromHistory(historyLimit);
    }

    const memoryContext = buildMemoryContext(memory);
    const enhancedPrompt = enhancePrompt(prompt, memory);

    res.status(200).json({
      success: true,
      data: {
        originalPrompt: prompt,
        enhancedPrompt,
        memory,
        memoryContext,
      },
      message: '提示词已增强',
    } as ApiResponse<{
      originalPrompt: string;
      enhancedPrompt: string;
      memory: ContentMemory;
      memoryContext: string;
    }>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
