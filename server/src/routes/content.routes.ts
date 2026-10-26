/**
 * 内容路由 - /api/contents
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import * as contentService from '../services/content.service';
import { toggleFavorite, optimizeContent } from '../services/content.service';
import { ApiResponse, PaginatedResponse, Content, ContentGenerationParams, UnifiedContent } from '../types';
import { generateImagesForDraft } from '../services/image-generation.service';
import { updateContentImageList } from '../services/content-helpers';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('content-routes');
export const router = Router();

// GET / - 获取内容列表
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const status = req.query.status ? String(req.query.status) : undefined;
    const favoritedRaw = req.query.favorited ? String(req.query.favorited) : undefined;
    const favorited = favoritedRaw === 'true' || favoritedRaw === '1';

    const { data, total } = contentService.getContents(page, pageSize, status, favorited);
    const response: PaginatedResponse<Content> = {
      success: true,
      data,
      total,
      page,
      pageSize,
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// GET /unified/stats - 获取统一内容统计
// 注意: 必须在 /:id 路由之前定义,否则 "unified" 会被当作 id 参数
router.get('/unified/stats', (_req: Request, res: Response) => {
  try {
    const stats = contentService.getUnifiedStats();
    res.json({ success: true, data: stats } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// GET /unified - 获取统一内容列表（合并 contents 和 drafts）
router.get('/unified', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const status = req.query.status ? String(req.query.status) : undefined;
    const favoritedRaw = req.query.favorited ? String(req.query.favorited) : undefined;
    const favorited = favoritedRaw === 'true' || favoritedRaw === '1';
    const source = req.query.source ? String(req.query.source) : '';
    const groupName = req.query.groupName ? String(req.query.groupName) : undefined;

    const { data, total } = contentService.getUnifiedContents(page, pageSize, status, favorited, source, groupName);
    const response: PaginatedResponse<UnifiedContent> = {
      success: true,
      data,
      total,
      page,
      pageSize,
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// GET /groups - 获取所有分组列表
router.get('/groups', (_req: Request, res: Response) => {
  try {
    const groups = contentService.getGroups();
    res.json({ success: true, data: groups } as ApiResponse<string[]>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// PUT /reorder - 批量更新排序
// 注意: 必须在 /:id 路由之前定义
router.put('/reorder', (req: Request, res: Response) => {
  try {
    const { items } = req.body as { items: Array<{ id: number; sort_order: number }> };
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 items 参数或参数为空' } as ApiResponse);
    }

    contentService.reorderContents(items);
    res.json({ success: true, message: `已更新 ${items.length} 条排序` } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /batch-delete - 批量删除内容
router.post('/batch-delete', (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids: number[] };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 ids 参数或参数为空' } as ApiResponse);
    }

    const deleted = contentService.batchDeleteContents(ids);
    res.json({ success: true, data: { deleted }, message: `已删除 ${deleted} 条内容` } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// GET /:id - 获取内容详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const content = contentService.getContentById(id);
    if (!content) {
      return res.status(404).json({ success: false, error: '内容不存在' } as ApiResponse);
    }

    res.json({ success: true, data: content } as ApiResponse<Content>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /generate - 生成内容
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const params = req.body as ContentGenerationParams;
    const content = await contentService.generateContent(params);
    res.status(201).json({
      success: true,
      data: content,
      message: '内容已生成',
    } as ApiResponse<Content>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /generate-enhanced - 增强版内容生成 (融合 brainstorming + Memory + gpt-image-2)
router.post('/generate-enhanced', async (req: Request, res: Response) => {
  try {
    const params = req.body as contentService.EnhancedContentRequest;

    // 参数校验
    if (!params.keywords || !Array.isArray(params.keywords) || params.keywords.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: 'keywords 不能为空且必须为数组' } as ApiResponse);
    }

    const result = await contentService.generateEnhancedContent(params);

    res.status(201).json({
      success: true,
      data: result,
      message: '增强版内容已生成',
    } as ApiResponse<contentService.EnhancedContentResult>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// PATCH /:id/status - 更新内容状态
router.patch('/:id/status', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const { status } = req.body as { status?: string };
    if (!status) {
      return res.status(400).json({ success: false, error: '缺少 status 参数' } as ApiResponse);
    }

    const content = contentService.updateContentStatus(id, status as Content['status']);
    if (!content) {
      return res.status(404).json({ success: false, error: '内容不存在' } as ApiResponse);
    }

    res.json({ success: true, data: content, message: '状态已更新' } as ApiResponse<Content>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// PATCH /:id/group - 更新内容的分组
router.patch('/:id/group', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const { group_name } = req.body as { group_name?: string };
    const content = contentService.updateGroupName(id, group_name || '');
    if (!content) {
      return res.status(404).json({ success: false, error: '内容不存在' } as ApiResponse);
    }

    res.json({ success: true, data: content, message: '分组已更新' } as ApiResponse<Content>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

/** POST /:id/favorite - 切换收藏状态 */
router.post('/:id/favorite', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }
    const content = toggleFavorite(id);
    if (!content) {
      return res.status(404).json({ success: false, error: '内容不存在' });
    }
    return res.json({ success: true, data: content, message: content.isFavorited ? '已收藏' : '已取消收藏' });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// DELETE /:id - 删除内容
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const deleted = contentService.deleteContent(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '内容不存在' } as ApiResponse);
    }

    res.json({ success: true, message: '内容已删除' } as ApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// PUT /:id - 更新内容（标题、正文、标签、图片）
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const { title, body, tags, images } = req.body as {
      title?: string;
      body?: string;
      tags?: string[];
      images?: string[];
    };

    const content = contentService.updateContent(id, { title, body, tags });
    if (!content) {
      return res.status(404).json({ success: false, error: '内容不存在' } as ApiResponse);
    }

    // 更新图片列表
    if (images !== undefined) {
      updateContentImageList(id, images);
    }

    const updated = contentService.getContentById(id);
    res.json({ success: true, data: updated, message: '内容已更新' } as ApiResponse<Content>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /:id/generate-images - 为内容生成配图
router.post('/:id/generate-images', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse);
    }

    const content = contentService.getContentById(id);
    if (!content) {
      return res.status(404).json({ success: false, error: '内容不存在' } as ApiResponse);
    }

    log.info('生成配图', { contentId: id, title: content.title });

    const result = await generateImagesForDraft(content.title, content.body, id);
    const newImages = result.paths ? result.paths.split(',').filter(Boolean) : [];

    // 合并已有图片和新图片
    const allImages = [...content.images, ...newImages];
    updateContentImageList(id, allImages);

    // 如果未生成图片且存在错误,返回错误信息
    if (newImages.length === 0 && result.error) {
      res.json({
        success: false,
        error: result.error,
        data: { images: allImages, newImages: [] },
        message: `图片生成失败: ${result.error}`,
      });
      return;
    }

    res.json({
      success: true,
      data: { images: allImages, newImages },
      message: result.provider === 'pollinations'
        ? `已通过免费服务生成 ${newImages.length} 张图片`
        : `已生成 ${newImages.length} 张图片`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('生成配图失败', { error: message });
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// POST /upload-image - 上传图片 (base64 格式)
router.post('/upload-image', (req: Request, res: Response) => {
  try {
    const { base64, filename } = req.body as { base64: string; filename?: string };

    if (!base64?.trim()) {
      return res.status(400).json({ success: false, error: '缺少 base64 图片数据' } as ApiResponse);
    }

    // 解析 base64 数据 URL
    const match = base64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, error: '无效的 base64 图片格式' } as ApiResponse);
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    // 确保输出目录存在
    const outputDir = path.resolve(config.image.outputDir || 'data/generated_images');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 生成文件名
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const fileName = filename || `upload_${timestamp}_${random}.${ext}`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, buffer);

    // 返回相对路径（用于 URL 访问）
    const relativePath = `/api/contents/images/${fileName}`;
    log.info('图片已上传', { fileName, size: buffer.length });

    res.json({
      success: true,
      data: { path: relativePath, fileName, size: buffer.length },
      message: '图片上传成功',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('图片上传失败', { error: message });
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

// DELETE /:id/images/:index - 删除内容的某张图片
router.delete('/:id/images/:index', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const index = parseInt(req.params.index, 10);

    const content = contentService.getContentById(id);
    if (!content) {
      return res.status(404).json({ success: false, error: '内容不存在' } as ApiResponse);
    }

    if (index < 0 || index >= content.images.length) {
      return res.status(400).json({ success: false, error: '无效的图片索引' } as ApiResponse);
    }

    // 删除图片文件（如果是本地文件）
    const imagePath = content.images[index];
    if (imagePath && imagePath.includes('/api/contents/images/')) {
      const fileName = imagePath.split('/').pop();
      if (fileName) {
        const fullPath = path.resolve(config.image.outputDir || 'data/generated_images', fileName);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    }

    // 从数组中移除
    const newImages = content.images.filter((_, i) => i !== index);
    updateContentImageList(id, newImages);

    res.json({ success: true, data: { images: newImages }, message: '图片已删除' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message } as ApiResponse);
  }
});

/** POST /api/contents/optimize - AI内容优化 */
router.post('/optimize', async (req: Request, res: Response) => {
  try {
    const { title, body, templateId } = req.body as { title?: string; body?: string; templateId?: number };
    if (!title || !body) {
      return res.status(400).json({ success: false, error: '缺少 title 或 body 参数' });
    }
    const result = await optimizeContent({ title, body, templateId: templateId ? Number(templateId) : undefined });
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
