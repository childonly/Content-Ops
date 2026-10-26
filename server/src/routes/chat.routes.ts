/**
 * 对话路由 - 多轮对话式内容创作 API
 *
 * 端点:
 *   GET    /api/chat/conversations              获取对话列表
 *   POST   /api/chat/conversations              创建新对话
 *   GET    /api/chat/conversations/:id          获取对话详情
 *   PUT    /api/chat/conversations/:id          重命名对话
 *   DELETE /api/chat/conversations/:id          删除对话
 *   GET    /api/chat/conversations/:id/messages 获取对话消息
 *   POST   /api/chat/conversations/:id/messages 发送消息
 *   POST   /api/chat/conversations/:id/confirm  确认某轮对话
 *   POST   /api/chat/conversations/:id/generate 从对话生成内容
 *   GET    /api/chat/llm-status                 获取 LLM 配置状态
 */

import { Router, Request, Response } from 'express';
import {
  createConversation,
  getConversations,
  getConversationById,
  renameConversation,
  deleteConversation,
  getMessages,
  sendMessage,
  confirmMessage,
  regenerateMessage,
  generateContentFromConversation,
  type ChatMode,
} from '../services/chat.service';
import { config } from '../config';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('chat-routes');
export const router = Router();

// ============================================================================
// 对话 CRUD
// ============================================================================

/** GET /api/chat/conversations - 获取对话列表 */
router.get('/conversations', (_req: Request, res: Response) => {
  try {
    const conversations = getConversations();
    res.json({ success: true, data: conversations });
  } catch (e) {
    log.error('获取对话列表失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '获取对话列表失败' });
  }
});

/** POST /api/chat/conversations - 创建新对话 */
router.post('/conversations', (req: Request, res: Response) => {
  try {
    const { title, mode } = req.body as { title?: string; mode?: ChatMode };
    const conversation = createConversation(title, mode || 'discuss');
    res.json({ success: true, data: conversation });
  } catch (e) {
    log.error('创建对话失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '创建对话失败' });
  }
});

/** GET /api/chat/conversations/:id - 获取对话详情 */
router.get('/conversations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const conversation = getConversationById(id);
    if (!conversation) {
      res.status(404).json({ success: false, error: '对话不存在' });
      return;
    }
    res.json({ success: true, data: conversation });
  } catch (e) {
    log.error('获取对话详情失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '获取对话详情失败' });
  }
});

/** PUT /api/chat/conversations/:id - 重命名对话 */
router.put('/conversations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { title } = req.body as { title: string };
    if (!title?.trim()) {
      res.status(400).json({ success: false, error: '标题不能为空' });
      return;
    }
    const conversation = renameConversation(id, title.trim());
    if (!conversation) {
      res.status(404).json({ success: false, error: '对话不存在' });
      return;
    }
    res.json({ success: true, data: conversation });
  } catch (e) {
    log.error('重命名对话失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '重命名对话失败' });
  }
});

/** DELETE /api/chat/conversations/:id - 删除对话 */
router.delete('/conversations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = deleteConversation(id);
    if (!deleted) {
      res.status(404).json({ success: false, error: '对话不存在' });
      return;
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    log.error('删除对话失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '删除对话失败' });
  }
});

// ============================================================================
// 消息管理
// ============================================================================

/** GET /api/chat/conversations/:id/messages - 获取对话消息 */
router.get('/conversations/:id/messages', (req: Request, res: Response) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    const messages = getMessages(conversationId);
    res.json({ success: true, data: messages });
  } catch (e) {
    log.error('获取消息失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '获取消息失败' });
  }
});

/** POST /api/chat/conversations/:id/messages - 发送消息 */
router.post('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    const { content, mode } = req.body as { content: string; mode?: ChatMode };

    if (!content?.trim()) {
      res.status(400).json({ success: false, error: '消息内容不能为空' });
      return;
    }

    log.info('发送消息', { conversationId, contentLength: content.length, mode });

    const result = await sendMessage(conversationId, content.trim(), mode || 'discuss');
    res.json({ success: true, data: result });
  } catch (e) {
    log.error('发送消息失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: (e as Error).message || '发送消息失败' });
  }
});

// ============================================================================
// 确认和生成
// ============================================================================

/** POST /api/chat/conversations/:id/confirm - 确认某轮对话 */
router.post('/conversations/:id/confirm', (req: Request, res: Response) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    const { messageId } = req.body as { messageId: number };

    if (!messageId) {
      res.status(400).json({ success: false, error: '缺少 messageId' });
      return;
    }

    const conversation = confirmMessage(conversationId, messageId);
    if (!conversation) {
      res.status(404).json({ success: false, error: '对话不存在' });
      return;
    }
    res.json({ success: true, data: conversation });
  } catch (e) {
    log.error('确认对话失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '确认对话失败' });
  }
});

/** POST /api/chat/conversations/:id/generate - 从对话生成内容 */
router.post('/conversations/:id/generate', async (req: Request, res: Response) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    log.info('从对话生成内容', { conversationId });

    const result = await generateContentFromConversation(conversationId);
    res.json({ success: true, data: result });
  } catch (e) {
    log.error('从对话生成内容失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: (e as Error).message || '生成内容失败' });
  }
});

/** POST /api/chat/conversations/:id/regenerate - 重新生成助手消息 */
router.post('/conversations/:id/regenerate', async (req: Request, res: Response) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    const { messageId } = req.body as { messageId: number };

    if (!messageId) {
      res.status(400).json({ success: false, error: '缺少 messageId' });
      return;
    }

    log.info('重新生成消息', { conversationId, messageId });

    const result = await regenerateMessage(conversationId, messageId);
    res.json({ success: true, data: result });
  } catch (e) {
    log.error('重新生成消息失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: (e as Error).message || '重新生成失败' });
  }
});

// ============================================================================
// LLM 配置状态
// ============================================================================

/** GET /api/chat/llm-status - 获取 LLM 配置状态 */
router.get('/llm-status', (_req: Request, res: Response) => {
  try {
    const provider = config.llm.provider || 'auto';
    const hasZhipu = !!config.llm.zhipuApiKey;
    const hasDeepseek = !!config.llm.deepseekApiKey;
    const hasOllama = !!config.ollamaBaseUrl;

    const availableProviders: string[] = [];
    if (hasZhipu) availableProviders.push('智谱 GLM');
    if (hasDeepseek) availableProviders.push('DeepSeek');
    if (hasOllama) availableProviders.push('Ollama (本地)');

    res.json({
      success: true,
      data: {
        provider,
        availableProviders,
        hasZhipu,
        hasDeepseek,
        hasOllama,
        zhipuModel: config.llm.zhipuModel,
        deepseekModel: config.llm.deepseekModel,
        ollamaModel: config.ollamaModel,
      },
    });
  } catch (e) {
    log.error('获取 LLM 状态失败', { error: (e as Error).message });
    res.status(500).json({ success: false, error: '获取 LLM 状态失败' });
  }
});
