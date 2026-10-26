/**
 * 业务流线路由 - /api/business-flows
 *
 * 端点列表:
 * - POST /            - 创建业务流线
 *   body: CreateBusinessFlowInput { name, description?, nodes, edges }
 * - GET  /            - 获取业务流线列表(分页)
 *   查询参数: page, pageSize, status
 * - GET  /:id         - 获取单个业务流线
 * - PUT  /:id         - 更新业务流线
 *   body: UpdateBusinessFlowInput
 * - DELETE /:id       - 删除业务流线
 * - POST /:id/execute - 执行业务流线
 *   body: { inputData? }
 * - POST /analyze     - LLM 分析编排方案
 *   body: { name, description, nodes, edges, requirementDoc? }
 * - POST /orchestrate-chat - 与 LLM 对话讨论编排方案
 *   body: { name, description, nodes, edges, history, message }
 *
 * 成功返回: { success: true, data: result }
 * 失败返回: { success: false, error: message }
 */

import { Router, type Request, type Response } from 'express';
import {
  createFlow,
  getFlows,
  getFlow,
  updateFlow,
  deleteFlow,
  executeFlow,
  getFlowRuns,
  getFlowRun,
} from '../services/business-flow.service';
import { callLLM } from '../services/llm-service';
import { createServiceLogger } from '../utils/logger';
import type { CreateBusinessFlowInput, UpdateBusinessFlowInput } from '../types/business-flow.types';

const log = createServiceLogger('business-flow-routes');
export const router = Router();

// POST / - 创建业务流线
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, description, nodes, edges } = req.body || {};

    if (!name) {
      return res.status(400).json({ success: false, error: 'name 参数必填' });
    }
    if (!Array.isArray(nodes)) {
      return res.status(400).json({ success: false, error: 'nodes 必须是数组' });
    }
    if (!Array.isArray(edges)) {
      return res.status(400).json({ success: false, error: 'edges 必须是数组' });
    }

    const input: CreateBusinessFlowInput = { name, description, nodes, edges };
    const result = createFlow(input);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET / - 获取业务流线列表
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const status = req.query.status ? String(req.query.status) : undefined;

    const result = getFlows(page, pageSize, status);
    res.json({ success: true, data: result.data, total: result.total, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// ============================================================================
// 编排分析端点（必须在 /:id 之前定义，避免被 :id 参数匹配）
// ============================================================================

// POST /analyze - LLM 分析编排方案
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { name, description, nodes, edges, requirementDoc, llmProvider, llmModel } = req.body || {};

    if (!Array.isArray(nodes)) {
      return res.status(400).json({ success: false, error: 'nodes 必须是数组' });
    }

    log.info('编排分析请求', { name, nodeCount: nodes.length, edgeCount: edges?.length || 0 });

    // 构建分析 prompt
    const nodeSummary = nodes.map((n: any, i: number) => {
      const label = n.label || n.data?.label || n.id || `节点${i + 1}`;
      const desc = n.data?.description || '';
      return `${i + 1}. ${label}${desc ? ' - ' + desc : ''}`;
    }).join('\n');

    const edgeSummary = Array.isArray(edges) ? edges.map((e: any, i: number) => {
      const sourceLabel = nodes.find((n: any) => n.id === e.source)?.label || e.source;
      const targetLabel = nodes.find((n: any) => n.id === e.target)?.label || e.target;
      return `${i + 1}. ${sourceLabel} → ${targetLabel}${e.label ? ' (' + e.label + ')' : ''}`;
    }).join('\n') : '';

    const analyzePrompt = `你是一个资深的内容运营架构师和流程编排专家。请对以下业务流程编排方案进行专业分析。

## 编排方案信息

- 编排名称：${name || '未命名编排'}
- 编排描述：${description || '无描述'}

## 流程节点（共 ${nodes.length} 个）

${nodeSummary}

## 流程连线（共 ${edges?.length || 0} 条）

${edgeSummary || '无连线'}

## 需求文档

${requirementDoc || '无'}

## 分析要求

请从以下几个维度进行分析：

1. **合理性评估**：流程编排是否合理，节点之间的数据流向是否正确
2. **存在问题**：是否有冗余节点、缺失环节、循环依赖等问题
3. **优化建议**：如何改进流程，提升效率

请严格按照以下 JSON 格式输出（不要输出其他内容）：

{
  "reasonable": true/false,
  "analysis": "详细分析文本",
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}`;

    const { text: llmResponse, provider, model, durationMs, attemptedProviders } = await callLLM(analyzePrompt, {
      provider: typeof llmProvider === 'string' ? llmProvider : undefined,
      model: typeof llmModel === 'string' ? llmModel : undefined,
    });

    if (!llmResponse) {
      // LLM 不可用时返回基本分析
      return res.json({
        success: true,
        data: {
          reasonable: true,
          analysis: `编排方案包含 ${nodes.length} 个节点和 ${edges?.length || 0} 条连线。LLM 暂不可用，无法进行深度分析，请检查 LLM 配置。`,
          issues: [],
          suggestions: ['建议配置 LLM 以获得更深入的分析'],
          provider: 'none',
          model: '',
          durationMs,
          attemptedProviders,
        },
      });
    }

    // 尝试解析 JSON 响应
    let analysisResult;
    try {
      // 提取 JSON 部分（LLM 可能会在 JSON 前后添加额外文本）
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('未找到 JSON 格式响应');
      }
    } catch {
      // JSON 解析失败，将原始文本作为分析结果
      analysisResult = {
        reasonable: true,
        analysis: llmResponse,
        issues: [],
        suggestions: [],
      };
    }

    log.info('编排分析完成', { name, provider, reasonable: analysisResult.reasonable });

    res.json({
      success: true,
      data: {
        reasonable: analysisResult.reasonable ?? true,
        analysis: analysisResult.analysis || '',
        issues: analysisResult.issues || [],
        suggestions: analysisResult.suggestions || [],
        provider,
        model,
        durationMs,
        attemptedProviders,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('编排分析失败', { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// POST /orchestrate-chat - 与 LLM 对话讨论编排方案
router.post('/orchestrate-chat', async (req: Request, res: Response) => {
  try {
    const { name, description, nodes, edges, history, message, llmProvider, llmModel } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'message 不能为空' });
    }

    log.info('编排对话请求', { name, messageLength: message.length, historyCount: history?.length || 0 });

    // 构建节点摘要
    const nodeSummary = Array.isArray(nodes) ? nodes.map((n: any, i: number) => {
      const label = n.label || n.data?.label || n.id || `节点${i + 1}`;
      return `${i + 1}. ${label}`;
    }).join('\n') : '无节点';

    const edgeSummary = Array.isArray(edges) ? edges.map((e: any, i: number) => {
      const sourceLabel = nodes?.find((n: any) => n.id === e.source)?.label || e.source;
      const targetLabel = nodes?.find((n: any) => n.id === e.target)?.label || e.target;
      return `${i + 1}. ${sourceLabel} → ${targetLabel}`;
    }).join('\n') : '无连线';

    // 构建对话历史
    const historyText = Array.isArray(history) && history.length > 0
      ? history.map((m: any) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n\n')
      : '（无历史对话）';

    const chatPrompt = `你是一个资深的内容运营架构师和流程编排专家。用户正在与你讨论一个业务流程编排方案。

## 编排方案

- 编排名称：${name || '未命名编排'}
- 编排描述：${description || '无描述'}

## 流程节点（共 ${nodes?.length || 0} 个）

${nodeSummary}

## 流程连线（共 ${edges?.length || 0} 条）

${edgeSummary}

## 对话历史

${historyText}

## 用户最新消息

${message}

## 要求

请基于以上编排方案和对话历史，针对用户的问题给出专业、具体的回复。
回复要点：
1. 直接回答用户的问题
2. 结合当前编排方案的具体节点和连线进行分析
3. 给出可操作的建议
4. 保持对话风格，简洁明了`;

    const { text: llmResponse, provider, model, durationMs, attemptedProviders } = await callLLM(chatPrompt, {
      provider: typeof llmProvider === 'string' ? llmProvider : undefined,
      model: typeof llmModel === 'string' ? llmModel : undefined,
    });

    if (!llmResponse) {
      return res.json({
        success: true,
        data: {
          reply: 'LLM 暂不可用，请检查 LLM 配置后重试。',
          provider: 'none',
          model: '',
          durationMs,
          attemptedProviders,
        },
      });
    }

    log.info('编排对话完成', { name, provider, replyLength: llmResponse.length });

    res.json({
      success: true,
      data: {
        reply: llmResponse,
        provider,
        model,
        durationMs,
        attemptedProviders,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('编排对话失败', { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// GET /:id/runs - 获取业务流线运行历史
router.get('/:id/runs', (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json({ success: false, error: '无效的 ID' });
    const limit = parseInt(String(req.query.limit ?? '20'), 10) || 20;
    res.json({ success: true, data: getFlowRuns(id, limit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /runs/:runId - 获取单次运行详情
router.get('/runs/:runId', (req: Request, res: Response) => {
  try {
    const runId = parseInt(String(req.params.runId), 10);
    if (!runId) return res.status(400).json({ success: false, error: '无效的运行 ID' });
    const result = getFlowRun(runId);
    if (!result) return res.status(404).json({ success: false, error: '运行记录不存在' });
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /:id - 获取单个业务流线
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const result = getFlow(id);
    if (!result) {
      return res.status(404).json({ success: false, error: '业务流线不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// PUT /:id - 更新业务流线
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const { name, description, nodes, edges, status } = req.body || {};
    const input: UpdateBusinessFlowInput = {};
    if (name !== undefined) input.name = name;
    if (description !== undefined) input.description = description;
    if (nodes !== undefined) input.nodes = nodes;
    if (edges !== undefined) input.edges = edges;
    if (status !== undefined) input.status = status;

    const result = updateFlow(id, input);
    if (!result) {
      return res.status(404).json({ success: false, error: '业务流线不存在' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// DELETE /:id - 删除业务流线
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const result = deleteFlow(id);
    if (!result) {
      return res.status(404).json({ success: false, error: '业务流线不存在' });
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// POST /:id/execute - 执行业务流线
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }

    const { inputData } = req.body || {};
    const result = await executeFlow(id, inputData);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
