/**
 * 对话服务 - 多轮对话式内容创作
 *
 * 支持两种对话模式:
 *   1. discuss  - 正常讨论模式，梳理内容创作思路
 *   2. keyword  - 关键词提取模式，提取关键词用于标签研究
 *
 * 核心流程:
 *   用户发消息 → 构建 system prompt + 历史消息 → 调用 LLM → 保存消息
 *   用户确认某轮 → 根据确认内容生成正式内容 → 跳转到编辑页面
 */

import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { callLLM } from './llm-service';
import { saveGeneratedContent } from './content-helpers';

const log = createServiceLogger('chat-service');

// ============================================================================
// 类型定义
// ============================================================================

export type ChatMode = 'discuss' | 'keyword';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Conversation {
  id: number;
  title: string;
  mode: ChatMode;
  status: 'active' | 'confirmed' | 'archived';
  confirmedMessageId?: number;
  generatedContentId?: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: MessageRole;
  content: string;
  mode?: ChatMode;
  extractedKeywords?: string[];
  confirmed: boolean;
  llmProvider?: string;
  durationMs?: number;
  createdAt: string;
}

export interface SendMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

// ============================================================================
// 数据库行映射
// ============================================================================

interface ConversationRow {
  id: number;
  title: string;
  mode: string;
  status: string;
  confirmed_message_id: number | null;
  generated_content_id: number | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  mode: string | null;
  extracted_keywords: string | null;
  confirmed: number;
  llm_provider: string | null;
  duration_ms: number | null;
  created_at: string;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode as ChatMode,
    status: row.status as Conversation['status'],
    confirmedMessageId: row.confirmed_message_id ?? undefined,
    generatedContentId: row.generated_content_id ?? undefined,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    mode: (row.mode ?? undefined) as ChatMode | undefined,
    extractedKeywords: row.extracted_keywords ? JSON.parse(row.extracted_keywords) : undefined,
    confirmed: row.confirmed === 1,
    llmProvider: row.llm_provider ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    createdAt: row.created_at,
  };
}

// ============================================================================
// 对话 CRUD
// ============================================================================

/** 创建新对话 */
export function createConversation(title?: string, mode: ChatMode = 'discuss'): Conversation {
  const db = getDb();
  const now = new Date().toISOString();
  const convTitle = title?.trim() || `新对话 ${new Date().toLocaleString('zh-CN')}`;

  const info = db.prepare(`
    INSERT INTO conversations (title, mode, status, message_count, created_at, updated_at)
    VALUES (?, ?, 'active', 0, ?, ?)
  `).run(convTitle, mode, now, now);

  const id = Number(info.lastInsertRowid);
  log.info('创建对话', { id, title: convTitle, mode });

  return getConversationById(id)!;
}

/** 获取对话列表（按更新时间倒序） */
export function getConversations(): Conversation[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM conversations ORDER BY updated_at DESC
  `).all() as ConversationRow[];
  return rows.map(mapConversation);
}

/** 根据 ID 获取对话 */
export function getConversationById(id: number): Conversation | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
  return row ? mapConversation(row) : null;
}

/** 重命名对话 */
export function renameConversation(id: number, title: string): Conversation | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id);
  log.info('重命名对话', { id, title });
  return getConversationById(id);
}

/** 删除对话（级联删除消息） */
export function deleteConversation(id: number): boolean {
  const db = getDb();
  // 先删除消息
  db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
  const info = db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  log.info('删除对话', { id, deleted: info.changes > 0 });
  return info.changes > 0;
}

// ============================================================================
// 消息管理
// ============================================================================

/** 获取对话的所有消息 */
export function getMessages(conversationId: number): ChatMessage[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC
  `).all(conversationId) as ChatMessageRow[];
  return rows.map(mapMessage);
}

/**
 * 发送消息并获取 LLM 回复
 *
 * @param conversationId 对话 ID
 * @param content 用户消息内容
 * @param mode 对话模式 ('discuss' | 'keyword')
 */
export async function sendMessage(
  conversationId: number,
  content: string,
  mode: ChatMode = 'discuss',
): Promise<SendMessageResult> {
  const db = getDb();
  const now = new Date().toISOString();
  const conv = getConversationById(conversationId);
  if (!conv) {
    throw new Error('对话不存在');
  }

  // 1. 保存用户消息
  const userMsgInfo = db.prepare(`
    INSERT INTO chat_messages (conversation_id, role, content, mode, confirmed, created_at)
    VALUES (?, 'user', ?, ?, 0, ?)
  `).run(conversationId, content, mode, now);

  const userMessage: ChatMessage = {
    id: Number(userMsgInfo.lastInsertRowid),
    conversationId,
    role: 'user',
    content,
    mode,
    confirmed: false,
    createdAt: now,
  };

  // 2. 获取历史消息构建上下文
  const history = getMessages(conversationId);
  const systemPrompt = buildSystemPrompt(mode);
  const llmPrompt = buildLLMPrompt(history, systemPrompt, mode);

  // 3. 调用 LLM
  log.info('调用 LLM 对话', { conversationId, mode, historyLength: history.length });
  const { text: llmResponse, provider, durationMs } = await callLLM(llmPrompt);

  // 检查 LLM 响应是否为空（所有提供商均失败的情况）
  if (!llmResponse.trim()) {
    log.error('LLM 返回空响应', { conversationId, mode, provider });
    // 保存一条错误提示作为助手消息，让用户知道发生了什么
    const errorMsg = '⚠️ AI 服务暂时不可用，请检查 LLM 配置（智谱/DeepSeek/Ollama）或稍后重试。\n\n'
      + `错误详情：所有 LLM 提供商均返回空响应 (provider: ${provider})。\n`
      + '请在「系统管理 → 提示词与模型」中检查 API Key 配置。';

    const errorNow = new Date().toISOString();
    db.prepare(`
      INSERT INTO chat_messages (conversation_id, role, content, mode, confirmed, llm_provider, duration_ms, created_at)
      VALUES (?, 'assistant', ?, ?, 0, ?, ?, ?)
    `).run(conversationId, errorMsg, mode, provider, durationMs, errorNow);

    // 更新对话的 message_count
    const newCount = history.length + 2;
    db.prepare('UPDATE conversations SET message_count = ?, updated_at = ? WHERE id = ?')
      .run(newCount, errorNow, conversationId);

    const errorRow = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
    const errorAssistantMessage: ChatMessage = {
      id: errorRow.id,
      conversationId,
      role: 'assistant',
      content: errorMsg,
      mode,
      confirmed: false,
      llmProvider: provider,
      durationMs,
      createdAt: errorNow,
    };
    return {
      userMessage,
      assistantMessage: errorAssistantMessage,
    };
  }

  // 4. 处理 LLM 响应
  let assistantContent = llmResponse;
  let extractedKeywords: string[] | undefined;

  if (mode === 'keyword') {
    // 关键词模式：提取关键词
    extractedKeywords = extractKeywordsFromResponse(llmResponse);
  }

  // 5. 保存助手消息
  const assistantNow = new Date().toISOString();
  db.prepare(`
    INSERT INTO chat_messages (conversation_id, role, content, mode, extracted_keywords, confirmed, llm_provider, duration_ms, created_at)
    VALUES (?, 'assistant', ?, ?, ?, 0, ?, ?, ?)
  `).run(
    conversationId,
    assistantContent,
    mode,
    extractedKeywords ? JSON.stringify(extractedKeywords) : null,
    provider,
    durationMs,
    assistantNow,
  );

  const assistantMessage: ChatMessage = {
    id: 0, // 将在下方获取
    conversationId,
    role: 'assistant',
    content: assistantContent,
    mode,
    extractedKeywords,
    confirmed: false,
    llmProvider: provider,
    durationMs,
    createdAt: assistantNow,
  };

  // 获取实际插入的 ID
  const lastRow = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
  assistantMessage.id = lastRow.id;

  // 6. 更新对话的 message_count 和 updated_at
  const newCount = history.length + 2; // 原有消息 + 用户消息 + 助手消息
  db.prepare('UPDATE conversations SET message_count = ?, updated_at = ? WHERE id = ?')
    .run(newCount, assistantNow, conversationId);

  // 7. 如果是第一条消息，自动用内容摘要更新标题
  if (history.length === 0) {
    const autoTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
    renameConversation(conversationId, autoTitle);
  }

  log.info('对话消息已保存', {
    conversationId,
    userMsgId: userMessage.id,
    assistantMsgId: assistantMessage.id,
    provider,
    durationMs,
  });

  return { userMessage, assistantMessage };
}

/**
 * 确认某轮对话
 *
 * 确认后，该消息标记为已确认，对话状态变为 confirmed
 */
export function confirmMessage(conversationId: number, messageId: number): Conversation | null {
  const db = getDb();
  const now = new Date().toISOString();

  // 标记消息为已确认
  db.prepare('UPDATE chat_messages SET confirmed = 1 WHERE id = ? AND conversation_id = ?')
    .run(messageId, conversationId);

  // 更新对话状态
  db.prepare(`
    UPDATE conversations SET confirmed_message_id = ?, status = 'confirmed', updated_at = ? WHERE id = ?
  `).run(messageId, now, conversationId);

  log.info('确认对话消息', { conversationId, messageId });
  return getConversationById(conversationId);
}

/**
 * 重新生成助手消息
 *
 * 删除指定的助手消息，基于同一轮的用户消息重新调用 LLM 生成回复
 *
 * @param conversationId 对话 ID
 * @param messageId 要重新生成的助手消息 ID
 */
export async function regenerateMessage(
  conversationId: number,
  messageId: number,
): Promise<{ assistantMessage: ChatMessage }> {
  const db = getDb();
  const conv = getConversationById(conversationId);
  if (!conv) {
    throw new Error('对话不存在');
  }

  // 1. 获取指定消息，确认是助手消息
  const targetMsg = db.prepare(`
    SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?
  `).get(messageId, conversationId) as ChatMessageRow | undefined;

  if (!targetMsg) {
    throw new Error('消息不存在');
  }
  if (targetMsg.role !== 'assistant') {
    throw new Error('只能重新生成助手消息');
  }

  // 2. 获取对话中所有消息（按时间排序），找到前一条用户消息
  const allMessages = getMessages(conversationId);
  const targetIdx = allMessages.findIndex(m => m.id === messageId);
  if (targetIdx < 0) {
    throw new Error('消息不在当前对话中');
  }

  // 找到前一条用户消息
  let userMessage: ChatMessage | undefined;
  for (let i = targetIdx - 1; i >= 0; i--) {
    if (allMessages[i].role === 'user') {
      userMessage = allMessages[i];
      break;
    }
  }
  if (!userMessage) {
    throw new Error('找不到对应的用户消息');
  }

  const mode = (targetMsg.mode || userMessage.mode || 'discuss') as ChatMode;

  // 3. 删除旧的助手消息
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(messageId);
  log.info('已删除旧助手消息', { conversationId, deletedMsgId: messageId });

  // 4. 获取历史消息（此时已不含被删除的助手消息，但包含用户消息）
  const history = getMessages(conversationId);
  const systemPrompt = buildSystemPrompt(mode);
  const llmPrompt = buildLLMPrompt(history, systemPrompt, mode);

  // 5. 重新调用 LLM
  log.info('重新生成助手消息', { conversationId, mode, historyLength: history.length });
  const { text: llmResponse, provider, durationMs } = await callLLM(llmPrompt);

  // 6. 处理响应
  let assistantContent = llmResponse;
  let extractedKeywords: string[] | undefined;

  if (mode === 'keyword') {
    extractedKeywords = extractKeywordsFromResponse(llmResponse);
  }

  // 7. 保存新的助手消息
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO chat_messages (conversation_id, role, content, mode, extracted_keywords, confirmed, llm_provider, duration_ms, created_at)
    VALUES (?, 'assistant', ?, ?, ?, 0, ?, ?, ?)
  `).run(
    conversationId,
    assistantContent,
    mode,
    extractedKeywords ? JSON.stringify(extractedKeywords) : null,
    provider,
    durationMs,
    now,
  );

  const lastRow = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };

  const assistantMessage: ChatMessage = {
    id: lastRow.id,
    conversationId,
    role: 'assistant',
    content: assistantContent,
    mode,
    extractedKeywords,
    confirmed: false,
    llmProvider: provider,
    durationMs,
    createdAt: now,
  };

  // 8. 更新对话时间戳
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);

  log.info('助手消息已重新生成', {
    conversationId,
    oldMsgId: messageId,
    newMsgId: assistantMessage.id,
    provider,
    durationMs,
  });

  return { assistantMessage };
}

/**
 * 从确认的对话内容生成正式内容
 *
 * 将对话中确认的消息内容转化为结构化的小红书笔记内容
 */
export async function generateContentFromConversation(
  conversationId: number,
): Promise<{ contentId: number; title: string; body: string; tags: string[] }> {
  const db = getDb();
  const conv = getConversationById(conversationId);
  if (!conv) {
    throw new Error('对话不存在');
  }

  // 获取确认的消息或最后一条助手消息
  const messages = getMessages(conversationId);
  let confirmedMsg: ChatMessage | undefined;

  if (conv.confirmedMessageId) {
    confirmedMsg = messages.find(m => m.id === conv.confirmedMessageId);
  }
  if (!confirmedMsg) {
    // 回退到最后一条助手消息
    confirmedMsg = [...messages].reverse().find(m => m.role === 'assistant');
  }
  if (!confirmedMsg) {
    throw new Error('没有可用的确认内容');
  }

  // 构建内容生成 prompt
  const conversationContext = messages
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n\n');

  const generatePrompt = `你是一个专业的小红书内容创作者。以下是一段内容创作的对话讨论记录，请基于讨论内容，生成一篇完整的小红书笔记。

## 对话记录

${conversationContext}

## 确认的最终内容

${confirmedMsg.content}

## 要求

请基于以上讨论和确认的内容，生成一篇结构完整、适合小红书发布的笔记。要求：
1. 标题吸睛，纯文字不带 emoji，15-25字
2. 正文 800-1500字，分段清晰
3. 结尾带 3-5 个相关话题标签
4. 使用小红书原生语言风格

请严格按照以下格式输出：

## 笔记: [标题]

[正文内容]

标签: [标签1, 标签2, 标签3]`;

  log.info('从对话生成内容', { conversationId, confirmedMsgId: confirmedMsg.id });
  const { text: llmResponse, provider } = await callLLM(generatePrompt);

  // 解析生成的内容
  const titleMatch = llmResponse.match(/##\s*笔记\s*[:：]\s*(.+)/);
  const title = titleMatch ? titleMatch[1].trim() : '新内容';

  let tags: string[] = [];
  const tagsMatch = llmResponse.match(/(?:标签|tags|Tags)\s*[:：]\s*(.+)/i);
  if (tagsMatch) {
    tags = tagsMatch[1].split(/[,，\s]+/).map(t => t.replace(/^#/, '').trim()).filter(t => t.length > 0);
  }

  let body = llmResponse;
  if (titleMatch) {
    const idx = llmResponse.indexOf(titleMatch[0]);
    body = llmResponse.substring(idx + titleMatch[0].length);
  }
  if (tagsMatch) {
    const tagsIdx = body.lastIndexOf(tagsMatch[0]);
    if (tagsIdx >= 0) body = body.substring(0, tagsIdx);
  }
  body = body.trim();

  if (tags.length === 0) {
    tags = ['分享', '小红书'];
  }

  // 保存到 contents 表
  const contentId = saveGeneratedContent({ title, body, tags });

  // 更新对话的 generated_content_id
  db.prepare('UPDATE conversations SET generated_content_id = ?, updated_at = ? WHERE id = ?')
    .run(contentId, new Date().toISOString(), conversationId);

  log.info('内容已从对话生成', { conversationId, contentId, title, provider });

  return { contentId, title, body, tags };
}

// ============================================================================
// 辅助函数
// ============================================================================

/** 构建系统提示词 */
function buildSystemPrompt(mode: ChatMode): string {
  if (mode === 'keyword') {
    return `你是一个小红书内容关键词分析专家。用户会给你一段内容或主题描述，你需要：

1. 从中提取 3-8 个核心关键词和长尾关键词
2. 分析每个关键词的搜索潜力和竞争度
3. 推荐适合小红书的热门标签组合

请用以下格式回复：

## 关键词分析

### 核心关键词
- 关键词1: 简要说明
- 关键词2: 简要说明
...

### 长尾关键词
- 长尾词1
- 长尾词2
...

### 推荐标签
#标签1 #标签2 #标签3 #标签4 #标签5

### 建议
针对这些关键词的内容创作建议（1-2句话）`;
  }

  return `你是一个资深小红书内容创作顾问，拥有百万粉丝运营经验。你正在与用户进行一对一的内容创作讨论。

你的职责：
1. 帮助用户梳理创作思路，找到好的内容角度
2. 提供标题建议、内容结构建议、标签推荐
3. 根据用户的需求和反馈，迭代优化内容方向
4. 在讨论充分后，帮助用户整理出完整的内容大纲

对话风格：
- 亲切自然，像朋友间的讨论
- 多用具体的例子和数据支撑建议
- 主动提问，引导用户思考
- 每次回复控制在 300-500 字，避免过长
- 如果用户的要求不够明确，主动追问细节`;
}

/** 构建 LLM Prompt（包含历史对话） */
function buildLLMPrompt(history: ChatMessage[], systemPrompt: string, mode: ChatMode): string {
  const parts: string[] = [systemPrompt, ''];

  // 添加历史对话（跳过第一条系统消息）
  const conversationHistory = history.slice(-10); // 最多保留最近 10 条
  for (const msg of conversationHistory) {
    const role = msg.role === 'user' ? '用户' : '助手';
    parts.push(`${role}: ${msg.content}`);
  }

  parts.push('');
  parts.push('请根据以上对话内容，给出你的回复。');

  return parts.join('\n');
}

/** 从 LLM 响应中提取关键词 */
function extractKeywordsFromResponse(response: string): string[] {
  const keywords: string[] = [];

  // 提取核心关键词
  const coreMatch = response.match(/###\s*核心关键词[\s\S]*?(?=###|$)/i);
  if (coreMatch) {
    const lines = coreMatch[0].split('\n');
    for (const line of lines) {
      const match = line.match(/^-\s*(.+?)(?::|：|$)/);
      if (match) {
        const kw = match[1].trim().replace(/[#＃]/g, '');
        if (kw && kw.length > 0) keywords.push(kw);
      }
    }
  }

  // 提取长尾关键词
  const longTailMatch = response.match(/###\s*长尾关键词[\s\S]*?(?=###|$)/i);
  if (longTailMatch) {
    const lines = longTailMatch[0].split('\n');
    for (const line of lines) {
      const match = line.match(/^-\s*(.+)/);
      if (match) {
        const kw = match[1].trim().replace(/[#＃]/g, '');
        if (kw && kw.length > 0) keywords.push(kw);
      }
    }
  }

  // 提取推荐标签
  const tagMatch = response.match(/###\s*推荐标签[\s\S]*?(?=###|$)/i);
  if (tagMatch) {
    const tags = tagMatch[0].match(/[#＃](\S+)/g);
    if (tags) {
      for (const tag of tags) {
        const cleanTag = tag.replace(/[#＃]/g, '').trim();
        if (cleanTag && !keywords.includes(cleanTag)) keywords.push(cleanTag);
      }
    }
  }

  return keywords.slice(0, 10);
}
