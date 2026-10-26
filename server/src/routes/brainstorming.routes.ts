/**
 * 创意规划路由 - /api/brainstorming
 *
 * 提供创意头脑风暴能力 (brainstorming 技能方法论)。
 */

import { Router, Request, Response } from 'express';
import { generateCreativeDirections, BrainstormResult } from '../services/brainstorming.service';
import { ApiResponse } from '../types';

export const router = Router();

// POST /generate - 生成创意方向
//
// 请求体:
//   {
//     "keyword": "关键词",
//     "trends": ["趋势1", "趋势2"],       // 可选
//     "hashtags": ["标签1", "标签2"]       // 可选
//   }
//
// 响应:
//   {
//     "success": true,
//     "data": BrainstormResult,
//     "message": "生成 N 个创意方向"
//   }
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { keyword, trends, hashtags } = req.body as {
      keyword?: string;
      trends?: string[];
      hashtags?: string[];
    };

    if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'keyword 不能为空' } as ApiResponse);
    }

    const result: BrainstormResult = await generateCreativeDirections(
      keyword.trim(),
      Array.isArray(trends) ? trends : undefined,
      Array.isArray(hashtags) ? hashtags : undefined,
    );

    res.status(200).json({
      success: true,
      data: result,
      message: `生成 ${result.directions.length} 个创意方向`,
    } as ApiResponse<BrainstormResult>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

export default router;
