import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// 使用 override: true 强制 .env 文件覆盖系统环境变量
// 注意: 系统 TRAE 环境变量中已有 DB_PATH，必须覆盖
dotenv.config({ override: true });

function resolveXhsSkillPath(): string {
  const configuredPath = process.env.XHS_SKILL_PATH?.trim() || '';
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    configuredPath,
    userProfile ? path.join(userProfile, '.agents', 'skills', 'xiaohongshu-skill') : '',
    userProfile ? path.join(userProfile, '.trae-cn', 'skills', 'xiaohongshu-skill') : '',
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || configuredPath;
}

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // 数据库 (使用项目本地路径，不使用系统环境变量)
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'content-ops-hub.db'),

  // 前端 (CORS)
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5180',

  // Skill Bridge 模式: 'mock' | 'trae'
  skillBridgeMode: (process.env.SKILL_BRIDGE_MODE || 'mock') as 'mock' | 'trae',

  // TikHub API (真实调用趋势/标签/分析技能时需要)
  // 注意: 中国大陆使用 api.tikhub.dev, 海外使用 api.tikhub.io
  // 顶层字段（向后兼容 skill-bridge.ts 的引用）
  tikhubApiKey: process.env.TIKHUB_API_KEY || '',
  tikhubBaseUrl: process.env.TIKHUB_BASE_URL || 'https://api.tikhub.dev/api/v1',

  // TikHub 嵌套配置（供迁移自 social-radar 的 TikhubClient 使用）
  tikhub: {
    apiKey: process.env.TIKHUB_API_KEY || '',
    baseUrl: process.env.TIKHUB_BASE_URL || 'https://api.tikhub.dev/api/v1',
    timeout: parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
    retries: parseInt(process.env.REQUEST_RETRIES || '2', 10),
  },

  // Radar 缓存 TTL（毫秒，默认 5 分钟）- 供迁移自 social-radar 的 MemoryCache 使用
  cacheTtl: parseInt(process.env.CACHE_TTL || '300000', 10),

  // Radar 成本预警阈值（美元）- 供迁移自 social-radar 的成本控制使用
  costThreshold: parseFloat(process.env.COST_THRESHOLD || '0.50'),

  // 小红书 Skill 安装路径
  xhsSkillPath: resolveXhsSkillPath(),

  // xhs-auto-pipeline 路径（已合并，仅保留用于查找历史 cookie 文件）
  xhsPipelinePath: process.env.XHS_PIPELINE_PATH || '',

  // xhs-auto-pipeline Python 解释器路径
  xhsPipelinePythonPath: process.env.XHS_PIPELINE_PYTHON_PATH || 'python',

  // Python 脚本本地路径（从 xhs-auto-pipeline 迁移到本项目内部统一管理）
  // 包含: xhs-search-edge.py（Playwright 搜索回退）、custom_publish.py（长文发布）、transcribe.py（视频转录）
  // 注意: 必须解析为绝对路径，避免相对路径与 cwd 拼接后产生路径重复
  pythonScriptsPath: process.env.PYTHON_SCRIPTS_PATH
    ? path.resolve(process.env.PYTHON_SCRIPTS_PATH)
    : path.join(process.cwd(), 'scripts', 'python'),

  // uv 可执行文件路径（用于运行带 PEP 723 内联依赖的 Python 脚本，如 transcribe.py）
  // uv 会自动安装脚本声明的依赖到隔离环境中，无需手动 pip install
  uvPath: process.env.UV_PATH || 'uv',

  // Ollama 本地模型 (内容生成 - 作为 LLM 链的兜底)
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5-coder:14b',

  // ============================================================
  // LLM 多提供商链 (从 xhs-auto-pipeline content_service.py 移植)
  // auto 模式顺序: 智谱(免费云端) → DeepSeek(低成本云端) → Ollama(本地兜底) → 模板
  // ============================================================
  llm: {
    provider: process.env.LLM_PROVIDER || 'auto', // 'auto' | 'zhipu' | 'deepseek' | 'ollama'
    timeout: parseInt(process.env.LLM_TIMEOUT || '120000', 10), // 单次调用超时(ms)
    // 智谱 GLM(免费,128K 上下文,4K 输出,2 并发)
    zhipuApiKey: process.env.ZHIPU_API_KEY || process.env.LLM_ZHIPU_API_KEY || '',
    zhipuModel: process.env.ZHIPU_MODEL || process.env.LLM_ZHIPU_MODEL || 'glm-4.7-flash',
    zhipuEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    // DeepSeek(极低成本,$0.14/1M input)
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || process.env.LLM_DEEPSEEK_API_KEY || '',
    deepseekModel: process.env.DEEPSEEK_MODEL || process.env.LLM_DEEPSEEK_MODEL || 'deepseek-v4-flash',
    deepseekEndpoint: process.env.DEEPSEEK_BASE_URL || process.env.LLM_DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions',
    // Ollama 复用顶层 ollamaBaseUrl/ollamaModel
  },

  // ============================================================
  // 图片生成 (从 xhs-auto-pipeline image_service.py 移植)
  // 使用智谱 CogView-3-Flash(与 GLM 共享 API Key)
  // ============================================================
  image: {
    enabled: process.env.IMAGE_GENERATION_ENABLED !== 'false', // 默认开启
    provider: process.env.IMAGE_PROVIDER || 'cogview', // 'cogview' | 'none'
    model: process.env.IMAGE_MODEL || 'cogview-3-flash',
    count: parseInt(process.env.IMAGE_COUNT || '1', 10), // 每篇草稿生成图片数(1-4)
    size: '1024x1024',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
    timeout: parseInt(process.env.IMAGE_TIMEOUT || '120000', 10),
    // 图片存储目录(相对于 server 工作目录)
    outputDir: process.env.IMAGE_OUTPUT_DIR || 'data/generated_images',
  },

  // ============================================================
  // 定时任务调度 (从 xhs-auto-pipeline scheduler.py 移植)
  // 使用 node-cron 替代 APScheduler
  // ============================================================
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== 'false', // 默认开启
    timezone: process.env.SCHEDULER_TIMEZONE || 'Asia/Shanghai',
    // 流水线默认参数
    defaultSearchLimit: parseInt(process.env.DEFAULT_SEARCH_LIMIT || '20', 10),
    maxDrafts: parseInt(process.env.MAX_DRAFTS || '3', 10),
  },

  // xhs-content 技能路径(用于加载 prompt.md 模板)
  xhsContentPath: process.env.XHS_CONTENT_PATH || '',

  // Pipeline 配置
  pipeline: {
    autoAdvance: process.env.PIPELINE_AUTO_ADVANCE === 'true',
    stageTimeout: parseInt(process.env.PIPELINE_STAGE_TIMEOUT || '300000', 10), // 5 分钟
  },
} as const;

export type Config = typeof config;
