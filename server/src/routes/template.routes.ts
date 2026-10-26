import { Router, Request, Response } from 'express';
import {
  getTemplates,
  getTemplateCategories,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  incrementTemplateUsage,
} from '../services/template.service';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('template-routes');
export const router = Router();

// GET /templates - 获取模板列表
router.get('/', (req: Request, res: Response) => {
  try {
    const { category, keyword, page, pageSize } = req.query;
    const result = getTemplates({
      category: category as string | undefined,
      keyword: keyword as string | undefined,
      page: page ? parseInt(String(page), 10) : 1,
      pageSize: pageSize ? parseInt(String(pageSize), 10) : 50,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /templates/categories - 获取分类列表
router.get('/categories', (_req: Request, res: Response) => {
  try {
    const categories = getTemplateCategories();
    return res.json({ success: true, data: categories });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// GET /templates/:id - 获取单个模板
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const tmpl = getTemplate(id);
    if (!tmpl) return res.status(404).json({ success: false, error: '模板不存在' });
    return res.json({ success: true, data: tmpl });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /templates - 创建模板
router.post('/', (req: Request, res: Response) => {
  try {
    const tmpl = createTemplate(req.body);
    return res.status(201).json({ success: true, data: tmpl });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// PUT /templates/:id - 更新模板
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const tmpl = updateTemplate(id, req.body);
    if (!tmpl) return res.status(404).json({ success: false, error: '模板不存在' });
    return res.json({ success: true, data: tmpl });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// DELETE /templates/:id - 删除模板
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = deleteTemplate(id);
    if (!deleted) return res.status(404).json({ success: false, error: '模板不存在或为内置模板，无法删除' });
    return res.json({ success: true, message: '模板已删除' });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// POST /templates/:id/use - 记录使用
router.post('/:id/use', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    incrementTemplateUsage(id);
    return res.json({ success: true, message: '已记录使用' });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
