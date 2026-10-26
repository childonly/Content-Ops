/**
 * 视频转录服务
 *
 * 使用 Python faster-whisper 进行本地 ASR (自动语音识别) 转录。
 *
 * 流程:
 *   1. transcribeVideo(url, options)   - 主函数,编排完整流程
 *   2. downloadAudio(url)              - 通过 Python 子进程调用 yt-dlp 下载音频
 *   3. runASR(audioPath, model)        - 调用 faster-whisper 转录
 *   4. formatTranscript(segments)      - 格式化输出
 *
 * Python 脚本路径: server/scripts/python/transcribe.py (使用 uv 内联依赖)
 * Node.js 调用 Python 使用 execFile + promisify,参考 skill-bridge.ts
 *
 * 数据持久化: transcriptions 表
 */

import { config } from '../config';
import { getDb } from '../db';
import { createServiceLogger } from '../utils/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import { PYTHON_MAX_BUFFER, PYTHON_EXEC_TIMEOUT, PYTHON_EXEC_TIMEOUT_LARGE, PYTHON_EXEC_TIMEOUT_XLARGE, PYTHON_EXEC_TIMEOUT_MAX, MAX_VIDEO_DURATION_SECONDS, LONG_VIDEO_WARNING_SECONDS, MODEL_SPEED_FACTOR, MODEL_SPEED_FACTOR_GPU } from '../utils/constants';
import { callLLM } from './llm-service';

const execFileAsync = promisify(execFile);
const log = createServiceLogger('transcriber');

function buildPythonEnv(): NodeJS.ProcessEnv {
  const modelCacheRoot = process.env.CONTENT_OPS_MODEL_CACHE
    ? path.resolve(process.env.CONTENT_OPS_MODEL_CACHE)
    : path.resolve(config.pythonScriptsPath, '..', '..', 'data', 'model-cache');
  const hubCache = path.join(modelCacheRoot, 'huggingface', 'hub');
  fs.mkdirSync(hubCache, { recursive: true });
  return {
    ...process.env,
    HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
    HF_HOME: path.join(modelCacheRoot, 'huggingface'),
    HF_HUB_CACHE: hubCache,
    HUGGINGFACE_HUB_CACHE: hubCache,
    TRANSFORMERS_CACHE: path.join(modelCacheRoot, 'transformers'),
    XDG_CACHE_HOME: modelCacheRoot,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    HF_HUB_DISABLE_XET: '1',
    HF_HUB_DOWNLOAD_TIMEOUT: '120',
  };
}

// ============================================================================
// 视频时长预检查
// ============================================================================

/** 视频预检查结果 */
export interface VideoCheckResult {
  /** 视频时长（秒） */
  duration: number;
  /** 视频标题（如果可获取） */
  title: string;
  /** 是否超过最大支持时长 */
  exceedsLimit: boolean;
  /** 最大支持时长（秒） */
  maxDuration: number;
  /** 是否为长视频（需要警告） */
  isLongVideo: boolean;
  /** 预计转录用时（秒） */
  estimatedTranscriptionTime: number;
  /** 使用的模型 */
  model: string;
  /** 错误信息（如果检查失败） */
  error?: string;
}

/**
 * 预检查视频时长（不下载视频，仅获取元数据）。
 *
 * 使用 yt-dlp --dump-json 快速获取视频信息，
 * 检查时长是否超过限制，并估算转录用时。
 *
 * @param url       视频 URL
 * @param modelSize Whisper 模型大小
 * @returns 预检查结果
 */
export async function checkVideoDuration(
  url: string,
  modelSize: string = 'medium',
): Promise<VideoCheckResult> {
  const pythonBin = config.xhsPipelinePythonPath || 'python';
  const scriptPath = getTranscribeScriptPath();

  log.info(`预检查视频时长: url=${url.substring(0, 80)}, model=${modelSize}`);

  try {
    // 使用 yt-dlp --dump-json 获取视频信息（不下载）
    // 通过 Python 脚本的 --check-only 模式实现
    const result = await execFileAsync(
      pythonBin,
      [scriptPath, '--url', url, '--output-dir', getDefaultAudioDir(), '--model', modelSize, '--check-only'],
      {
        cwd: process.cwd(),
        timeout: 60_000, // 预检查最多 60 秒
        maxBuffer: PYTHON_MAX_BUFFER,
        windowsHide: true,
        env: buildPythonEnv(),
      },
    );

    // 解析输出
    const lines = result.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{'));
    const jsonLine = lines.pop();

    if (jsonLine) {
      const parsed = JSON.parse(jsonLine) as {
        success: boolean;
        duration?: number;
        title?: string;
        error?: string;
      };

      if (parsed.success && parsed.duration !== undefined) {
        const duration = parsed.duration;
        const speedFactor = MODEL_SPEED_FACTOR[modelSize] || 3.5;
        const estimatedTime = duration * speedFactor;

        return {
          duration,
          title: parsed.title || '',
          exceedsLimit: duration > MAX_VIDEO_DURATION_SECONDS,
          maxDuration: MAX_VIDEO_DURATION_SECONDS,
          isLongVideo: duration > LONG_VIDEO_WARNING_SECONDS,
          estimatedTranscriptionTime: estimatedTime,
          model: modelSize,
        };
      }

      return {
        duration: 0,
        title: '',
        exceedsLimit: false,
        maxDuration: MAX_VIDEO_DURATION_SECONDS,
        isLongVideo: false,
        estimatedTranscriptionTime: 0,
        model: modelSize,
        error: parsed.error || '无法获取视频时长',
      };
    }

    return {
      duration: 0,
      title: '',
      exceedsLimit: false,
      maxDuration: MAX_VIDEO_DURATION_SECONDS,
      isLongVideo: false,
      estimatedTranscriptionTime: 0,
      model: modelSize,
      error: '预检查未返回有效结果',
    };
  } catch (e) {
    const err = e as Error;
    log.warn(`预检查视频时长失败: ${err.message.substring(0, 200)}`);
    return {
      duration: 0,
      title: '',
      exceedsLimit: false,
      maxDuration: MAX_VIDEO_DURATION_SECONDS,
      isLongVideo: false,
      estimatedTranscriptionTime: 0,
      model: modelSize,
      error: `预检查失败: ${err.message.substring(0, 100)}`,
    };
  }
}

// ============================================================================
// 进度文件管理
// ============================================================================

/** 将 URL 转换为短哈希（与 Python 脚本的 url_to_hash 保持一致） */
export function urlToHash(url: string): string {
  return createHash('md5').update(url, 'utf8').digest('hex').substring(0, 12);
}

/** 获取进度文件路径 */
export function getProgressFilePath(url: string): string {
  const hash = urlToHash(url);
  const progressDir = path.resolve(process.cwd(), 'data', 'transcriptions');
  return path.join(progressDir, `progress_${hash}.json`);
}

/** 获取检查点文件路径（用于中断后恢复转录） */
export function getCheckpointFilePath(url: string): string {
  const hash = urlToHash(url);
  const checkpointDir = path.resolve(process.cwd(), 'data', 'transcriptions');
  return path.join(checkpointDir, `checkpoint_${hash}.json`);
}

/** 进度数据结构 */
export interface TranscriptionProgress {
  stage: string;
  percentage: number;
  elapsed_seconds: number;
  estimated_total_seconds: number | null;
  remaining_seconds: number | null;
  current_position: number;
  total_duration: number;
  segment_count: number;
  model: string;
  last_log: string;
  timestamp: string;
}

/** 读取进度文件 */
export function readProgressFile(url: string): TranscriptionProgress | null {
  const progressPath = getProgressFilePath(url);
  try {
    if (!fs.existsSync(progressPath)) {
      return null;
    }
    const content = fs.readFileSync(progressPath, 'utf-8');
    return JSON.parse(content) as TranscriptionProgress;
  } catch {
    return null;
  }
}

/** 清理进度文件 */
export function cleanProgressFile(url: string): void {
  const progressPath = getProgressFilePath(url);
  try {
    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath);
    }
  } catch {
    // 忽略删除失败
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/** 转录结果 */
export interface TranscribeResult {
  id: number;
  url: string;
  /** 原始链接名（用户输入的原始文本，如B站分享文本） */
  sourceText: string;
  audioPath: string;
  transcript: string;
  segments: { start: number; end: number; text: string }[];
  /** 全文稿：去除时间戳的纯文本拼接 */
  fullText: string;
  /** 总结稿：AI LLM 生成的内容摘要 */
  summary: string;
  /** 使用的 Whisper 模型 */
  model: string;
  language: string;
  duration: number;
  status: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/** 转录选项 */
export interface TranscribeOptions {
  /** Whisper 模型大小 (tiny/base/small/medium/large-v3),默认 medium */
  model?: string;
  /** 音频输出目录 (默认 data/transcriptions) */
  outputDir?: string;
  /** 语言提示 (如 'zh'、'en'),不指定则自动检测 */
  language?: string;
  /** 原始链接名（用户输入的原始文本，如B站分享文本） */
  sourceText?: string;
}

/** Python 脚本输出的 JSON 结构 */
interface PythonTranscribeOutput {
  success: boolean;
  audio_path: string;
  transcript: string;
  segments: { start: number; end: number; text: string }[];
  language: string;
  duration: number;
  error?: string;
}

// ============================================================================
// 数据库行映射
// ============================================================================

interface TranscriptionRow {
  id: number;
  url: string;
  source_text: string | null;
  audio_path: string | null;
  transcript: string | null;
  segments: string | null;
  full_text: string | null;
  summary: string | null;
  model: string | null;
  language: string | null;
  duration: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TranscriptionRow): TranscribeResult {
  let segments: { start: number; end: number; text: string }[] = [];
  if (row.segments) {
    try {
      const parsed = JSON.parse(row.segments);
      if (Array.isArray(parsed)) {
        segments = parsed.map((s: any) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
          text: String(s.text ?? ''),
        }));
      }
    } catch {
      // 忽略解析失败
    }
  }

  return {
    id: row.id,
    url: row.url,
    sourceText: row.source_text ?? '',
    audioPath: row.audio_path ?? '',
    transcript: row.transcript ?? '',
    segments,
    fullText: row.full_text ?? '',
    summary: row.summary ?? '',
    model: row.model ?? '',
    language: row.language ?? '',
    duration: row.duration ?? 0,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Python 脚本调用
// ============================================================================

/**
 * 获取 transcribe.py 脚本的绝对路径。
 *
 * 脚本位置: {config.pythonScriptsPath}/transcribe.py
 * 默认: server/scripts/python/transcribe.py
 *
 * 注意: 必须返回绝对路径，否则当 execFile 的 cwd 设为脚本目录时，
 * 相对路径会被 Python 解释器再次基于 cwd 解析，导致路径重复。
 */
function getTranscribeScriptPath(): string {
  return path.resolve(config.pythonScriptsPath, 'transcribe.py');
}

/**
 * 获取音频输出目录。
 *
 * 默认: {process.cwd()}/data/transcriptions
 */
function getDefaultAudioDir(): string {
  const audioDir = path.resolve(process.cwd(), 'data', 'transcriptions');
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }
  return audioDir;
}

/**
 * 调用 Python 脚本执行"仅下载音频"操作。
 *
 * 分离下载阶段，避免下载+转录合计超时。
 * 下载成功后音频会被缓存，后续 ASR 调用可直接使用缓存。
 *
 * @param url       视频 URL
 * @param outputDir 音频输出目录
 * @returns 音频文件路径
 */
async function preDownloadAudio(
  url: string,
  outputDir: string,
): Promise<string> {
  const scriptPath = getTranscribeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Python 转录脚本不存在: ${scriptPath}`);
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const pythonBin = config.xhsPipelinePythonPath || 'python';

  // 始终使用 Python 直接执行（依赖已通过 pip 安装）
  // 注意：不使用 uv run 回退，因 uv 在 Windows 上存在缓存目录权限问题
  // （错误: Failed to initialize cache at C:\Users\wml1027\AppData\Local\uv\cache）
  const runnerBin = pythonBin;
  const runnerArgs: string[] = [scriptPath, '--url', url, '--output-dir', outputDir, '--model', 'tiny', '--download-only'];

  log.info(`预下载音频: url=${url.substring(0, 80)}`);

  const pythonEnv = buildPythonEnv();

  try {
    const result = await execFileAsync(runnerBin, runnerArgs, {
      cwd: process.cwd(),
      timeout: PYTHON_EXEC_TIMEOUT, // 下载阶段使用 10 分钟超时
      maxBuffer: PYTHON_MAX_BUFFER,
      windowsHide: true,
      env: pythonEnv,
    });

    // 解析输出
    const lines = result.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{'));
    const jsonLine = lines.pop();
    if (jsonLine) {
      const parsed = JSON.parse(jsonLine) as PythonTranscribeOutput;
      if (parsed.success && parsed.audio_path) {
        log.info(`预下载音频完成: ${parsed.audio_path}`);
        return parsed.audio_path;
      }
    }
    log.warn('预下载音频未返回有效路径，将直接进入完整转录流程');
  } catch (e) {
    const err = e as Error;
    log.warn(`预下载音频失败（将继续尝试完整流程）: ${err.message.substring(0, 200)}`);
  }

  // 预下载失败不阻断流程，返回空字符串让后续完整流程处理
  return '';
}

/**
 * 调用 Python 脚本执行完整的"下载 + 转录"流程。
 *
 * Python 脚本使用 uv 内联依赖声明(faster-whisper + yt-dlp),
 * 由 config.xhsPipelinePythonPath 指定的 Python 解释器执行。
 *
 * @param url       视频 URL
 * @param outputDir 音频输出目录
 * @param modelSize Whisper 模型大小
 * @param language  语言提示(可选)
 * @returns Python 脚本的 JSON 输出
 */
async function runPythonTranscribe(
  url: string,
  outputDir: string,
  modelSize: string,
  language?: string,
): Promise<PythonTranscribeOutput> {
  const scriptPath = getTranscribeScriptPath();

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Python 转录脚本不存在: ${scriptPath}`);
  }

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 执行策略:
  // 当前环境: 使用 TRAE 内置 Python 解释器（依赖已通过 pip 安装）
  const pythonBin = config.xhsPipelinePythonPath || 'python';

  // 检查本地模型缓存（避免每次都从 HuggingFace 下载）
  // faster-whisper 将模型缓存在 HuggingFace Hub 目录:
  //   ~/.cache/huggingface/hub/models--Systran--faster-whisper-{modelSize}/snapshots/{hash}/model.bin
  // 旧版缓存路径: ~/.cache/whisper/models/{modelSize}/model.bin (向后兼容)
  // 国内网络无法直接访问 huggingface.co，因此优先使用本地缓存的模型
  // 若请求的模型未缓存，自动回退到 tiny 模型（唯一保证本地可用的模型）
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const hfCacheDir = path.join(homeDir, '.cache', 'huggingface', 'hub');
  const hfModelPrefix = `models--Systran--faster-whisper-${modelSize}`;

  // 检查 HuggingFace Hub 缓存
  let useLocalModel = false;
  let effectiveModel = modelSize;
  if (fs.existsSync(hfCacheDir)) {
    const modelDirs = fs.readdirSync(hfCacheDir).filter(
      (d) => d.toLowerCase() === hfModelPrefix.toLowerCase()
    );
    if (modelDirs.length > 0) {
      const snapshotsDir = path.join(hfCacheDir, modelDirs[0], 'snapshots');
      if (fs.existsSync(snapshotsDir)) {
        const snapshots = fs.readdirSync(snapshotsDir);
        for (const snap of snapshots) {
          const modelBin = path.join(snapshotsDir, snap, 'model.bin');
          if (fs.existsSync(modelBin)) {
            useLocalModel = true;
            effectiveModel = modelSize; // 使用模型名称，faster-whisper 会自动从缓存加载
            log.info(`模型 '${modelSize}' 已在 HF Hub 缓存中找到: ${modelBin}`);
            break;
          }
        }
      }
    }
  }

  // 也检查旧版缓存路径（向后兼容）
  if (!useLocalModel) {
    const oldCacheDir = path.join(homeDir, '.cache', 'whisper', 'models', modelSize);
    const oldModelBin = path.join(oldCacheDir, 'model.bin');
    if (fs.existsSync(oldModelBin)) {
      useLocalModel = true;
      effectiveModel = oldCacheDir;
      log.info(`模型 '${modelSize}' 在旧版缓存路径中找到: ${oldModelBin}`);
    }
  }

  // 模型回退机制：如果请求的模型没有本地缓存，回退到 tiny 模型
  // 因为国内网络无法可靠地从 HuggingFace 下载模型
  if (!useLocalModel && modelSize !== 'tiny') {
    // 检查 tiny 模型的 HF Hub 缓存
    const tinyHfPrefix = 'models--Systran--faster-whisper-tiny';
    const tinyHfDir = path.join(hfCacheDir, tinyHfPrefix);
    let tinyFound = false;
    if (fs.existsSync(tinyHfDir)) {
      const tinySnapshots = path.join(tinyHfDir, 'snapshots');
      if (fs.existsSync(tinySnapshots)) {
        for (const snap of fs.readdirSync(tinySnapshots)) {
          if (fs.existsSync(path.join(tinySnapshots, snap, 'model.bin'))) {
            tinyFound = true;
            break;
          }
        }
      }
    }
    // 也检查旧版缓存
    if (!tinyFound) {
      const tinyOldBin = path.join(homeDir, '.cache', 'whisper', 'models', 'tiny', 'model.bin');
      if (fs.existsSync(tinyOldBin)) tinyFound = true;
    }
    if (tinyFound) {
      log.warn(`请求的模型 '${modelSize}' 未在本地缓存，回退到 'tiny' 模型（避免 HF 下载超时）`);
      effectiveModel = 'tiny';
      useLocalModel = true;
    }
  }

  // 始终使用 Python 直接执行（依赖已通过 pip 安装）
  // 注意：不使用 uv run 回退，因 uv 在 Windows 上存在缓存目录权限问题
  const runnerBin = pythonBin;
  const runnerArgs: string[] = [
    scriptPath,
    '--url', url,
    '--output-dir', outputDir,
    '--model', effectiveModel,
  ];

  if (language) {
    runnerArgs.push('--language', language);
  }

  // 添加进度文件参数，让 Python 脚本写入实时进度
  const progressFilePath = getProgressFilePath(url);
  runnerArgs.push('--progress-file', progressFilePath);

  // 添加检查点文件参数，支持中断后恢复
  const checkpointFilePath = getCheckpointFilePath(url);
  runnerArgs.push('--checkpoint-file', checkpointFilePath);

  // 根据模型大小和音频文件大小动态选择超时时间
  // 使用 MODEL_SPEED_FACTOR 进行精确估算
  // medium 模型在 CPU 上约 3.5x 实时速度（转录1分钟音频需3.5分钟）
  const LARGE_MODELS = ['medium', 'large', 'large-v2', 'large-v3'];
  let execTimeout = LARGE_MODELS.includes(modelSize) ? PYTHON_EXEC_TIMEOUT_LARGE : PYTHON_EXEC_TIMEOUT;

  // 如果音频缓存已存在（预下载阶段已下载），根据文件大小估算时长，动态增加超时
  const urlHash = urlToHash(url);
  const cachePrefix = `audio_${urlHash}_`;
  try {
    const files = fs.readdirSync(outputDir).filter(f => f.startsWith(cachePrefix));
    if (files.length > 0) {
      const stat = fs.statSync(path.join(outputDir, files[0]));
      const fileSizeMB = stat.size / (1024 * 1024);
      // m4a 音频约 1.3 MB/分钟 → 估算时长(秒)
      const estimatedDurationSec = (fileSizeMB / 1.3) * 60;
      // 使用 MODEL_SPEED_FACTOR 精确估算超时
      const speedFactor = MODEL_SPEED_FACTOR[effectiveModel] || MODEL_SPEED_FACTOR[modelSize] || 3.5;
      // 超时 = 时长 * 速度因子 * 1.5（预留余量）
      const estimatedTimeout = Math.round(estimatedDurationSec * speedFactor * 1.5 * 1000);
      // 保守下限 45 分钟，绝对上限 24 小时（PYTHON_EXEC_TIMEOUT_MAX）
      const dynamicTimeout = Math.max(
        PYTHON_EXEC_TIMEOUT_LARGE,
        Math.min(PYTHON_EXEC_TIMEOUT_MAX, estimatedTimeout),
      );
      if (dynamicTimeout > execTimeout) {
        execTimeout = dynamicTimeout;
        log.info(
          `根据音频文件大小 (${fileSizeMB.toFixed(1)}MB, 估算时长 ${Math.round(estimatedDurationSec / 60)}分钟, ` +
          `速度因子 ${speedFactor}x) 动态调整超时为 ${Math.round(execTimeout / 60000)} 分钟`
        );
      }
    }
  } catch {
    // 文件大小检测失败不影响流程，使用默认超时
  }

  log.info(`调用 Python 转录脚本`, {
    runner: runnerBin,
    script: scriptPath,
    model: effectiveModel,
    language: language || 'auto',
    useLocalModel,
    timeoutMs: execTimeout,
  });

  let stdout: string;
  let stderr: string;
  try {
    // 设置 Hugging Face 镜像端点（解决国内网络无法访问 huggingface.co 的问题）
    // faster-whisper 需要从 HF Hub 下载模型，使用 hf-mirror.com 镜像加速
    // HF_HUB_DISABLE_XET=1 禁用 Xet 协议（避免 401 Unauthorized 错误）
    const pythonEnv = buildPythonEnv();
    const result = await execFileAsync(runnerBin, runnerArgs, {
      cwd: process.cwd(), // 使用服务进程的 cwd，避免相对路径重复
      timeout: execTimeout,
      maxBuffer: PYTHON_MAX_BUFFER,
      windowsHide: false,
      env: pythonEnv,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (e) {
    const err = e as Error & { stderr?: string; code?: string; signal?: string };
    const stderrText = err.stderr || '';
    log.error('Python 转录脚本执行失败', {
      error: err.message,
      signal: err.signal,
      code: err.code,
      stderr: stderrText.substring(0, 500),
    });

    // 1. 检测超时（execFile 超时后会发送 SIGTERM）
    if (err.signal === 'SIGTERM' || err.message.includes('maxBuffer')) {
      // 从 stderr 中提取最后的进度日志
      const progressLines = stderrText
        .split('\n')
        .filter((l) => l.includes('转录进度') || l.includes('检测到语言'))
        .map((l) => l.trim());
      const lastProgress = progressLines.length > 0 ? progressLines[progressLines.length - 1] : '';

      if (err.message.includes('maxBuffer')) {
        throw new Error(
          `转录失败: 输出缓冲区溢出。视频可能过长，建议使用更小的模型（如 small 或 base）或缩短视频时长。`,
        );
      }

      throw new Error(
        `转录超时: medium 模型在 CPU 上转录该视频超过了 ${Math.round(execTimeout / 60_000)} 分钟限制。` +
        (lastProgress ? `最后进度: ${lastProgress}` : '') +
        `。建议: 1) 使用更小的模型（tiny/base/small）; 2) 缩短视频时长; 3) 增加系统可用内存。`,
      );
    }

    // 2. 检测 OOM（Out of Memory）
    if (stderrText.includes('MemoryError') || stderrText.includes('OutOfMemory') ||
        err.message.includes('heap out of memory')) {
      throw new Error(
        `转录失败: 内存不足。medium 模型需要约 2GB 内存，请关闭其他程序后重试，或使用更小的模型（tiny/base/small）。`,
      );
    }

    // 3. 从 stderr 中提取关键错误信息（跳过 [transcribe] 日志行和 Deprecated 警告）
    const errorLines = stderrText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('[transcribe]') && !l.startsWith('Deprecated Feature'));

    // 优先提取包含 ERROR: 或 错误/失败/timeout 的行
    const keyError = errorLines.find((l) =>
      /ERROR:|错误|失败|timeout|ConnectTimeout|WinError|ModuleNotFoundError|ImportError/i.test(l)
    );

    if (keyError) {
      throw new Error(`转录失败: ${keyError.substring(0, 300)}`);
    }

    // 4. 如果 stderr 有 [transcribe] 日志但无明确错误，说明进程被异常终止
    const hasTranscribeLogs = stderrText.includes('[transcribe]');
    if (hasTranscribeLogs && !err.message.includes('Command failed')) {
      // 提取最后的日志行作为上下文
      const lastLogLines = stderrText
        .split('\n')
        .filter((l) => l.startsWith('[transcribe]'))
        .slice(-3)
        .map((l) => l.trim());
      throw new Error(
        `转录异常终止。最后日志: ${lastLogLines.join(' | ')}。可能原因: 进程被终止或内存不足。`,
      );
    }

    // 5. 回退: 使用最后几行非空 stderr
    const lastLines = errorLines.slice(-3).join(' ');
    throw new Error(`转录失败: ${lastLines.substring(0, 300) || err.message.substring(0, 200)}`);
  }

  // 解析 stdout 的最后一行 JSON
  const trimmed = stdout.trim();
  if (!trimmed) {
    log.error('Python 转录脚本无 stdout 输出', { stderr: stderr.substring(0, 500) });
    throw new Error('Python 转录脚本无输出');
  }

  // 找到最后一行 JSON
  const lines = trimmed.split('\n').filter((l) => l.trim().startsWith('{'));
  const jsonLine = lines.pop();

  if (!jsonLine) {
    log.error('Python 转录脚本未输出 JSON', {
      stdout: trimmed.substring(0, 500),
      stderr: stderr.substring(0, 500),
    });
    throw new Error('Python 转录脚本未输出 JSON 结果');
  }

  try {
    const result = JSON.parse(jsonLine) as PythonTranscribeOutput;
    if (!result.success) {
      throw new Error(result.error || 'Python 转录脚本返回失败');
    }
    return result;
  } catch (e) {
    log.error('解析 Python 脚本输出失败', {
      error: (e as Error).message,
      jsonLine: jsonLine.substring(0, 300),
    });
    throw new Error(`解析转录结果失败: ${(e as Error).message}`);
  }
}

// ============================================================================
// 主流程: downloadAudio (通过 Python 子进程)
// ============================================================================

/**
 * 下载视频音频轨道。
 *
 * 本函数委托给 Python 脚本中的 yt-dlp 执行实际下载。
 * 单独保留此函数是为了未来可能的扩展(如直接使用 Node.js 下载)。
 *
 * @returns 音频文件的绝对路径
 */
export async function downloadAudio(
  url: string,
  outputDir?: string,
): Promise<string> {
  const audioDir = outputDir || getDefaultAudioDir();
  log.info(`下载音频: url=${url.substring(0, 80)}, dir=${audioDir}`);

  // 复用 Python 脚本的下载能力(只下载不转录)
  // 通过设置 model=none 让 Python 脚本只执行下载步骤
  // 这里采用简化方案: 直接调用完整脚本并返回 audio_path
  // 实际下载由 runASR 内部统一处理
  // 此函数作为 API 暴露,内部由 transcribeVideo 编排
  return audioDir;
}

// ============================================================================
// 主流程: runASR
// ============================================================================

/**
 * 调用 faster-whisper 执行 ASR 转录。
 *
 * 实际工作由 Python 脚本完成,本函数负责:
 *   - 准备参数
 *   - 调用 Python 子进程
 *   - 解析 JSON 输出
 *   - 错误处理
 *
 * @param url       视频 URL (Python 脚本会先下载再转录)
 * @param modelSize Whisper 模型大小
 * @param outputDir 音频输出目录
 * @param language  语言提示(可选)
 * @returns 转录结果
 */
export async function runASR(
  url: string,
  modelSize: string = 'medium',
  outputDir?: string,
  language?: string,
): Promise<PythonTranscribeOutput> {
  const audioDir = outputDir || getDefaultAudioDir();
  log.info(`执行 ASR: model=${modelSize}, language=${language || 'auto'}`);

  return await runPythonTranscribe(url, audioDir, modelSize, language);
}

// ============================================================================
// 主流程: formatTranscript
// ============================================================================

/**
 * 格式化转录片段为可读文本。
 *
 * 输出格式:
 *   [00:00:03] 第一句话
 *   [00:00:08] 第二句话
 *
 * @param segments 转录片段数组
 * @returns 格式化的文本
 */
export function formatTranscript(
  segments: { start: number; end: number; text: string }[],
): string {
  if (!segments || segments.length === 0) {
    return '';
  }

  return segments
    .map((seg) => {
      const start = formatTimestamp(seg.start);
      const text = seg.text.trim();
      return text ? `[${start}] ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** 将秒数格式化为 HH:MM:SS */
function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

// ============================================================================
// 主流程: transcribeVideo
// ============================================================================

/**
 * 视频转录主函数。
 *
 * 完整流程:
 *   1. 创建数据库转录记录(status=pending)
 *   2. 调用 Python 脚本(yt-dlp + faster-whisper)执行下载和转录
 *   3. 格式化转录结果
 *   4. 更新数据库记录(status=completed)
 *   5. 失败时记录错误信息(status=failed)
 *
 * @param url     视频 URL (支持抖音/小红书/YouTube/TikTok/Bilibili)
 * @param options 转录选项
 * @returns 转录结果
 */
export async function transcribeVideo(
  url: string,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const requestedModel = options.model || 'medium';
  const outputDir = options.outputDir || getDefaultAudioDir();
  const language = options.language;
  const sourceText = options.sourceText || '';

  log.info(`开始转录视频: url=${url.substring(0, 80)}, model=${requestedModel}, language=${language || 'auto'}, sourceText=${sourceText.substring(0, 50)}`);

  // 1. 创建转录记录（含模型和原始链接名）
  const recordId = createTranscriptionRecord(url, requestedModel, sourceText);
  log.info(`已创建转录记录: id=${recordId}`);

  // 模型回退链：medium → small → tiny
  // medium 模型在 CPU 上转录长视频可能因内存不足崩溃，自动回退到更小模型
  const MODEL_FALLBACK_CHAIN: Record<string, string[]> = {
    'medium': ['medium', 'small', 'tiny'],
    'large': ['large', 'medium', 'small', 'tiny'],
    'large-v2': ['large-v2', 'medium', 'small', 'tiny'],
    'large-v3': ['large-v3', 'medium', 'small', 'tiny'],
    'small': ['small', 'tiny'],
    'base': ['base', 'tiny'],
    'tiny': ['tiny'],
  };
  const fallbackChain = MODEL_FALLBACK_CHAIN[requestedModel] || [requestedModel, 'tiny'];

  let lastError: Error | null = null;
  let usedModel = requestedModel;

  try {
    updateTranscriptionStatus(recordId, 'downloading');
    log.info(`转录记录 ${recordId}: 开始下载音频`);

    // 预下载阶段：先单独下载音频（避免下载+ASR合计超时）
    // 下载成功后音频会被缓存，后续 ASR 调用直接使用缓存
    await preDownloadAudio(url, outputDir);
    log.info(`转录记录 ${recordId}: 预下载阶段完成，开始 ASR 转录`);

    // 2. 尝试模型回退链中的每个模型
    for (let i = 0; i < fallbackChain.length; i++) {
      const tryModel = fallbackChain[i];
      updateTranscriptionStatus(recordId, 'transcribing');

      if (i > 0) {
        log.warn(`转录记录 ${recordId}: ${fallbackChain[i - 1]} 模型失败，自动回退到 ${tryModel} 模型`);
        // 更新数据库中的模型字段
        updateTranscriptionModel(recordId, tryModel);
      }
      usedModel = tryModel;

      try {
        log.info(`转录记录 ${recordId}: 尝试 ${tryModel} 模型转录`);
        const pyResult = await runASR(url, tryModel, outputDir, language);
        log.info(`转录记录 ${recordId}: ASR 完成 (model=${tryModel}, language=${pyResult.language}, duration=${pyResult.duration}s, segments=${pyResult.segments.length})`);

        // 3. 格式化并保存结果
        const formattedTranscript = formatTranscript(pyResult.segments);
        const fullTranscript = formattedTranscript || pyResult.transcript;

        saveTranscriptionResult(recordId, {
          audioPath: pyResult.audio_path,
          transcript: fullTranscript,
          segments: pyResult.segments,
          language: pyResult.language,
          duration: pyResult.duration,
        });

        // 4. 完成
        updateTranscriptionStatus(recordId, 'completed');
        if (i > 0) {
          log.info(`转录记录 ${recordId}: 转录完成（使用回退模型 ${tryModel}）`);
        } else {
          log.info(`转录记录 ${recordId}: 转录完成`);
        }

        const result = getTranscription(recordId);
        if (!result) {
          throw new Error(`转录记录 ${recordId} 在完成后消失`);
        }
        return result;
      } catch (e) {
        const err = e as Error;
        lastError = err;
        log.warn(`转录记录 ${recordId}: ${tryModel} 模型转录失败: ${err.message.substring(0, 200)}`);

        // 如果是最后一个模型，不再重试
        if (i === fallbackChain.length - 1) {
          break;
        }

        // 检查是否是值得回退的错误（超时/内存不足/进程崩溃）
        const errMsg = err.message.toLowerCase();
        const shouldFallback =
          errMsg.includes('超时') ||
          errMsg.includes('timeout') ||
          errMsg.includes('内存') ||
          errMsg.includes('memory') ||
          errMsg.includes('command failed') ||
          errMsg.includes('进程') ||
          errMsg.includes('sigterm') ||
          errMsg.includes('maxbuffer');

        if (!shouldFallback) {
          // 非硬件/超时类错误（如URL无效），不回退
          break;
        }
      }
    }

    // 所有模型都失败
    const errorMsg = lastError
      ? `转录失败（已尝试模型: ${fallbackChain.join(' → ')}）: ${lastError.message.substring(0, 300)}`
      : '转录失败: 未知原因';
    log.error(`转录记录 ${recordId}: ${errorMsg}`);
    updateTranscriptionStatus(recordId, 'failed', errorMsg);

    const result = getTranscription(recordId);
    if (!result) {
      throw new Error(`转录记录 ${recordId} 在失败后消失: ${errorMsg}`);
    }
    return result;
  } catch (e) {
    const err = e as Error;
    log.error(`转录记录 ${recordId} 异常: ${err.message}`);
    updateTranscriptionStatus(recordId, 'failed', err.message);

    const result = getTranscription(recordId);
    if (!result) {
      throw new Error(`转录记录 ${recordId} 在失败后消失: ${err.message}`);
    }
    return result;
  }
}

// ============================================================================
// 数据库操作
// ============================================================================

/** 创建转录记录,返回新记录 ID */
function createTranscriptionRecord(url: string, model: string = 'medium', sourceText: string = ''): number {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO transcriptions (url, model, source_text, status)
    VALUES (?, ?, ?, 'pending')
  `).run(url, model, sourceText || null);
  return Number(info.lastInsertRowid);
}

/** 更新转录状态 */
function updateTranscriptionStatus(recordId: number, status: string, errorMessage?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (errorMessage !== undefined) {
    db.prepare(`
      UPDATE transcriptions
      SET status = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(status, errorMessage, now, recordId);
  } else {
    db.prepare(`
      UPDATE transcriptions
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, recordId);
  }
}

/** 更新转录记录使用的模型（用于模型回退时更新） */
function updateTranscriptionModel(recordId: number, model: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE transcriptions
    SET model = ?, updated_at = ?
    WHERE id = ?
  `).run(model, now, recordId);
}

// ============================================================================
// 全文稿生成（带标点断句）
// ============================================================================

/**
 * 根据分段间隔和文本内容自动添加标点符号，生成可读性更好的全文稿。
 *
 * 策略（双维度断句）:
 *
 * 1. 时间间隔分析 (gap = next.start - current.end):
 *    - gap ≥ 1.5s: 长停顿 → 句号 + 段落换行
 *    - 0.5s ≤ gap < 1.5s: 中等停顿 → 句号
 *    - 0.15s ≤ gap < 0.5s: 短停顿 → 逗号
 *    - gap < 0.15s: 极短停顿 → 根据文本内容判断
 *
 * 2. 文本内容分析 (CJK):
 *    - 疑问句尾词: 吗/呢/吧/怎么/什么/为什么 → ？
 *    - 陈述句尾词: 了/的/是/在/有/好/行/对/会/能 → 。
 *    - 连接词分割: 但是/所以/因为/如果/虽然/然后 → 在连接词前断句
 *    - 长段落分割: >40字的分段在自然断点处分割
 *
 * CJK 语言（中文/日文）:
 *   - 不使用空格分隔词语
 *   - 标点直接附加在文字后
 *
 * 非 CJK 语言（英文等）:
 *   - 词与词之间保留空格
 *   - 标点前不加空格，标点后加空格
 *
 * 已有标点的处理:
 *   - 如果分段文本已以标点结尾（。！？.!?等），不再重复添加
 *
 * @param segments 转录分段数组
 * @param isCJK 是否为 CJK 语言（中文/日文）
 * @returns 带标点符号的全文稿
 */
function generateFullTextWithPunctuation(
  segments: { start: number; end: number; text: string; chapter_start?: boolean }[],
  isCJK: boolean,
): string {
  if (!segments || segments.length === 0) {
    return '';
  }

  // 已有的结尾标点（不需要再添加）
  const existingEndPunctuation = /[。！？.!?;；、~…\n]$/;
  // 问句结尾词（中文）
  const questionEndings = /(吗|呢|吧|啊|呀|哇|哦|哟|么)$/;
  // 更全面的问句模式
  const questionPatterns = /(吗|呢|吧|啊|呀|哇|哦|哟|么|是不是|能不能|会不会|有没有|怎么|什么|为什么|为何|哪里|哪个|谁|几|多少)$/;
  // 陈述句尾词（常出现在句末，表明句子结束）
  const statementEndings = /(了|的|是|在|有|好|行|对|会|能|就|还|都|也|又|才|却|已|将|被|把|让|给|向|为|从|到|过|着|地|得)$/;
  // 连接词（在这些词前面通常应该断句）
  const conjunctions = /(但是|所以|因此|因为|如果|虽然|而且|然后|接着|不过|其实|实际上|事实上|总的来说|总之|另外|此外|同时|与此同时)$/;

  const parts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let text = seg.text.trim();
    if (!text) continue;

    // === 长分段处理：对超长 CJK 分段进行内部断句 ===
    if (isCJK && text.length > 40) {
      text = splitLongCJKSegment(text);
    }

    // 章节起始 → 在前一段后加空行
    if ((seg as any).chapter_start && parts.length > 0) {
      const last = parts[parts.length - 1];
      if (!existingEndPunctuation.test(last)) {
        // 确保前一段有句号
        if (isCJK && questionPatterns.test(last)) {
          parts[parts.length - 1] = last + '？';
        } else {
          parts[parts.length - 1] = last + (isCJK ? '。' : '.');
        }
      }
      parts[parts.length - 1] = parts[parts.length - 1] + '\n\n';
      parts.push(text);
      continue;
    }

    // 如果不是第一个分段，根据与前一个分段的间隔添加标点
    if (i > 0 && parts.length > 0) {
      const prevSeg = segments[i - 1];
      const gap = seg.start - prevSeg.end;

      // 检查前一段文本是否已有结尾标点
      const prevText = parts[parts.length - 1];
      const prevAlreadyHasPunctuation = existingEndPunctuation.test(prevText);

      if (!prevAlreadyHasPunctuation) {
        if (gap >= 1.5) {
          // 长停顿：句号 + 段落换行
          parts[parts.length - 1] = prevText + (isCJK ? '。' : '.') + '\n\n';
        } else if (gap >= 0.5) {
          // 中等停顿：句号
          parts[parts.length - 1] = prevText + (isCJK ? '。' : '. ');
        } else if (gap >= 0.15) {
          // 短停顿：逗号
          parts[parts.length - 1] = prevText + (isCJK ? '，' : ', ');
        } else {
          // 极短停顿：根据文本内容判断
          if (isCJK) {
            // 检查前一段是否像句子结尾
            if (questionPatterns.test(prevText)) {
              parts[parts.length - 1] = prevText + '？';
            } else if (statementEndings.test(prevText) && prevText.length > 8) {
              // 较长的文本 + 句尾词 → 句号
              parts[parts.length - 1] = prevText + '。';
            } else {
              // 默认加逗号
              parts[parts.length - 1] = prevText + '，';
            }
          } else {
            parts[parts.length - 1] = prevText + ', ';
          }
        }
      }
    }

    parts.push(text);
  }

  // 最后一个分段也确保有结尾标点
  if (parts.length > 0) {
    const last = parts[parts.length - 1];
    if (!existingEndPunctuation.test(last)) {
      if (isCJK && questionPatterns.test(last)) {
        parts[parts.length - 1] = last + '？';
      } else {
        parts[parts.length - 1] = last + (isCJK ? '。' : '.');
      }
    }
  }

  // 清理多余的连续换行
  if (isCJK) {
    const raw = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
    // 智能段落分隔：对没有段落分隔或段落过长的文本进行智能分段
    return addSmartParagraphBreaks(raw);
  } else {
    const result = parts.join(' ').replace(/ \n /g, '\n').replace(/\n /g, '\n').replace(/ \n/g, '\n');
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }
}

/**
 * 对 CJK 文本进行智能段落分隔。
 *
 * 当 ASR 返回的 segments 时间间隔很小（< 1.5s）时，generateFullTextWithPunctuation
 * 不会添加段落分隔（\n\n），导致整篇文本作为一个段落显示。
 *
 * 本函数在已有标点的基础上，按照以下规则进行段落分隔：
 * 1. 已有的段落分隔（\n\n）保持不变
 * 2. 对没有段落分隔的长段落（>80字），按照句号/问号/感叹号进行分段
 * 3. 每个段落保持在 80-180 字左右（3-5 个句子）
 * 4. 在连接词前面优先分段
 *
 * @param text 已添加标点但可能缺少段落分隔的 CJK 文本
 * @returns 带有段落分隔的可读文本
 */
function addSmartParagraphBreaks(text: string): string {
  if (!text || text.length < 80) {
    return text;
  }

  // 先按已有段落分隔分割
  const existingParagraphs = text.split(/\n{2,}/);

  const result: string[] = [];

  // 连接词列表（在这些词前面优先分段）
  const conjunctionPattern = /^(但是|所以|因此|因为|如果|虽然|而且|然后|接着|不过|其实|实际上|事实上|总的来说|总之|另外|此外|同时|与此同时|首先|其次|最后|比如说|例如|比如|也就是|也就是说|换句话说)/;

  for (const para of existingParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // 如果段落较短（< 80 字），直接保留
    if (trimmed.length < 80) {
      result.push(trimmed);
      continue;
    }

    // 长段落：按照句号/问号/感叹号分割成句子
    const sentences: string[] = [];
    let current = '';
    for (const char of trimmed) {
      current += char;
      if (/[。！？]/.test(char)) {
        // 句子结束
        sentences.push(current);
        current = '';
      }
    }
    // 处理最后未以标点结尾的部分
    if (current.trim()) {
      sentences.push(current);
    }

    // 如果只有一个句子或没有句子，直接保留
    if (sentences.length <= 1) {
      result.push(trimmed);
      continue;
    }

    // 将句子分组为段落
    let currentParagraph = '';
    let sentenceCount = 0;

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;

      // 检查句子是否以连接词开头
      const startsWithConjunction = conjunctionPattern.test(trimmedSentence);

      // 在连接词前分段（仅当当前段落已有一定长度）
      if (startsWithConjunction && currentParagraph.length >= 60) {
        result.push(currentParagraph.trim());
        currentParagraph = trimmedSentence;
        sentenceCount = 1;
      } else {
        currentParagraph += trimmedSentence;
        sentenceCount++;

        // 当段落达到 4 个句子或 150 字时，分段
        if (currentParagraph.length >= 150 || sentenceCount >= 4) {
          result.push(currentParagraph.trim());
          currentParagraph = '';
          sentenceCount = 0;
        }
      }
    }

    // 处理剩余的句子
    if (currentParagraph.trim()) {
      result.push(currentParagraph.trim());
    }
  }

  return result.join('\n\n');
}

/**
 * 对超长的 CJK 文本分段进行内部断句。
 *
 * 在连接词前、句尾词后插入断点，将长分段拆分为多个短句。
 *
 * @param text 原始长文本（>40 字符）
 * @returns 添加了内部标点的文本
 */
function splitLongCJKSegment(text: string): string {
  // 连接词列表（在前面断句）
  const breakBefore = [
    '但是', '所以', '因此', '因为', '如果', '虽然', '而且', '然后',
    '接着', '不过', '其实', '实际上', '事实上', '总的来说', '总之',
    '另外', '此外', '同时', '与此同时', '首先', '其次', '最后',
    '比如说', '例如', '比如', '也就是', '也就是说', '换句话说',
  ];

  let result = text;

  // 在连接词前插入句号（如果前面没有标点）
  for (const conj of breakBefore) {
    // 避免重复替换，使用占位符
    const placeholder = `\x00${conj}\x00`;
    result = result.replace(new RegExp(conj, 'g'), placeholder);
  }

  // 将占位符替换为 "。连接词"（如果前面不是标点）
  result = result.replace(/\x00([^\x00]+)\x00/g, (match, conj) => {
    return conj; // 先恢复
  });

  // 更精确的方法：遍历文本，在连接词前插入断句
  const segments: string[] = [];
  let currentPos = 0;
  const lowerText = text;

  // 找到所有连接词的位置
  const breakPoints: number[] = [];
  for (const conj of breakBefore) {
    let pos = 0;
    while ((pos = lowerText.indexOf(conj, pos)) !== -1) {
      // 只在连接词不在开头时断句
      if (pos > 5) {
        breakPoints.push(pos);
      }
      pos += conj.length;
    }
  }

  // 去重并排序
  breakPoints.sort((a, b) => a - b);
  const uniqueBreakPoints = [...new Set(breakPoints)];

  if (uniqueBreakPoints.length === 0) {
    return text;
  }

  // 按断点分割
  for (let i = 0; i <= uniqueBreakPoints.length; i++) {
    const start = i === 0 ? 0 : uniqueBreakPoints[i - 1];
    const end = i === uniqueBreakPoints.length ? text.length : uniqueBreakPoints[i];
    const segment = text.substring(start, end).trim();
    if (segment) {
      // 如果不是最后一段，且没有结尾标点，添加句号
      if (i < uniqueBreakPoints.length && !/[。！？.!?;；、~…\n]$/.test(segment)) {
        // 检查是否是问句
        if (/(吗|呢|吧|怎么|什么|为什么)$/.test(segment)) {
          segments.push(segment + '？');
        } else {
          segments.push(segment + '。');
        }
      } else {
        segments.push(segment);
      }
    }
  }

  return segments.join('');
}

/** 保存转录结果 */
function saveTranscriptionResult(
  recordId: number,
  data: {
    audioPath: string;
    transcript: string;
    segments: { start: number; end: number; text: string }[];
    language: string;
    duration: number;
  },
): void {
  const db = getDb();
  const now = new Date().toISOString();

  // 生成全文稿：将所有分段文本拼接为纯文本（去除时间戳）
  // 中文文本不需要空格分隔，英文/其他语言用空格分隔
  // 增加标点符号断句：根据分段间隔添加逗号/句号，提升可读性
  const lang = data.language || '';
  const isCJK = lang.startsWith('zh') || lang.startsWith('ja');
  const fullText = generateFullTextWithPunctuation(data.segments, isCJK);

  db.prepare(`
    UPDATE transcriptions
    SET audio_path = ?, transcript = ?, segments = ?, full_text = ?, language = ?, duration = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.audioPath,
    data.transcript,
    JSON.stringify(data.segments),
    fullText,
    data.language,
    data.duration,
    now,
    recordId,
  );

  log.info(`转录记录 ${recordId}: 全文稿已生成 (${fullText.length} 字符)`);
}

// ============================================================================
// 公共 API: 查询接口
// ============================================================================

/** 获取转录记录列表(分页) */
export function getTranscriptions(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
): { data: TranscribeResult[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM transcriptions';
  const params: Array<string | number> = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';

  const rows = db.prepare(query).all(...params, pageSize, offset) as TranscriptionRow[];
  const data = rows.map(mapRow);

  let countQuery = 'SELECT COUNT(*) AS count FROM transcriptions';
  const countParams: Array<string | number> = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;

  return { data, total };
}

/** 获取单条转录记录 */
export function getTranscription(id: number): TranscribeResult | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM transcriptions WHERE id = ?')
    .get(id) as TranscriptionRow | undefined;
  return row ? mapRow(row) : null;
}

/** 删除转录记录 */
export function deleteTranscription(id: number): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM transcriptions WHERE id = ?').run(id);
  if (info.changes > 0) {
    log.info(`删除转录记录: id=${id}`);
  }
  return info.changes > 0;
}

/** 批量删除转录记录 */
export function deleteTranscriptions(ids: number[]): number {
  if (!ids.length) return 0;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM transcriptions WHERE id IN (${placeholders})`).run(...ids);
  log.info(`批量删除转录记录: ${info.changes}/${ids.length} 条`);
  return info.changes;
}

// ============================================================================
// AI 总结稿生成
// ============================================================================

/**
 * 总结稿 Prompt 模板。
 *
 * 将转录全文送入 LLM，生成结构化的内容摘要。
 * 包含：核心主题、关键观点、要点清单、内容摘要。
 */
const SUMMARY_PROMPT_TEMPLATE = `你是一个专业的内容分析师。请根据以下视频转录文本，生成一份结构化的内容摘要。

## 要求

请按以下格式输出总结：

### 核心主题
（一句话概括视频的核心主题）

### 关键观点
（列出 3-5 个关键观点，每个观点 1-2 句话）

### 内容要点
（用要点列表形式列出视频中的重点信息）

### 总结
（100-200 字的总体摘要）

## 转录文本

{transcript}

## 注意
- 如果文本是中文，请用简体中文输出
- 保持客观，不要添加原文中没有的信息
- 提取关键数据和案例
- 语言简洁有力，避免冗余`;

/**
 * 为转录记录生成 AI 总结稿。
 *
 * 调用 LLM 服务（智谱 GLM → DeepSeek → Ollama 自动链），
 * 将全文稿送入 LLM 生成结构化摘要，保存到 summary 字段。
 *
 * @param id 转录记录 ID
 * @returns 更新后的转录记录
 * @throws 转录记录不存在或全文稿为空时抛出错误
 */
export async function summarizeTranscription(id: number): Promise<TranscribeResult> {
  const record = getTranscription(id);
  if (!record) {
    throw new Error(`转录记录 ${id} 不存在`);
  }

  if (record.status !== 'completed') {
    throw new Error(`转录记录 ${id} 状态为 '${record.status}'，只有已完成的转录才能生成总结`);
  }

  // 优先使用全文稿，回退到逐字稿
  const textToSummarize = record.fullText || record.transcript;
  if (!textToSummarize || textToSummarize.trim().length < 10) {
    throw new Error(`转录记录 ${id} 的文本内容过短，无法生成有意义的总结`);
  }

  log.info(`开始生成总结稿: id=${id}, 文本长度=${textToSummarize.length}`);

  // 构建 Prompt
  // 如果文本过长（超过 12000 字符），截取前 12000 字符以避免超出 LLM 上下文限制
  const truncatedText = textToSummarize.length > 12000
    ? textToSummarize.substring(0, 12000) + '\n...(内容过长，已截断)'
    : textToSummarize;

  const prompt = SUMMARY_PROMPT_TEMPLATE.replace('{transcript}', truncatedText);

  // 调用 LLM
  const llmResult = await callLLM(prompt);

  if (!llmResult.text || !llmResult.text.trim()) {
    throw new Error('LLM 返回空内容，无法生成总结稿。请检查 LLM 服务配置（智谱/DeepSeek/Ollama）');
  }

  const summary = llmResult.text.trim();

  // 保存到数据库
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE transcriptions
    SET summary = ?, updated_at = ?
    WHERE id = ?
  `).run(summary, now, id);

  log.info(`总结稿已生成: id=${id}, 提供商=${llmResult.provider}, 耗时=${llmResult.durationMs}ms, 长度=${summary.length}`);

  const updated = getTranscription(id);
  if (!updated) {
    throw new Error(`转录记录 ${id} 在更新总结后消失`);
  }
  return updated;
}

// ============================================================================
// 全文稿重新生成（基于已存储的分段数据，无需重新 ASR）
// ============================================================================

/**
 * LLM 标点修复 Prompt 模板。
 *
 * 将无标点的原始转录文本送入 LLM，添加正确的标点符号和段落分隔。
 */
const PUNCTUATE_PROMPT_TEMPLATE = `你是一个专业的文字编辑。请为以下语音转录文本添加标点符号和段落分隔，使其成为可读性良好的文章。

## 要求

1. 添加正确的中文标点符号（，。！？；：""''等）
2. 根据语义进行段落分隔，每个段落表达一个完整的意思
3. 识别疑问句并添加问号
4. 识别感叹句并添加感叹号
5. 不要添加或删除任何文字内容，只添加标点和分段
6. 保持原文的语序和用词不变
7. 如果原文是繁体中文，转为简体中文

## 输出格式

直接输出添加标点后的文本，不要添加任何说明或注释。

## 转录文本

{transcript}`;

/**
 * 使用 LLM 为转录文本添加标点符号和段落分隔。
 *
 * 调用 LLM 服务，将无标点的原始文本转为带标点的可读文本。
 * 适用于规则断句效果不理想的场景。
 *
 * @param rawText 原始无标点文本
 * @returns 带标点和段落的文本
 */
async function addPunctuationWithLLM(rawText: string): Promise<string> {
  if (!rawText || rawText.trim().length < 10) {
    return rawText;
  }

  // 如果文本过长（超过 10000 字符），分段处理
  const MAX_CHUNK_SIZE = 8000;
  if (rawText.length > MAX_CHUNK_SIZE) {
    const chunks: string[] = [];
    for (let i = 0; i < rawText.length; i += MAX_CHUNK_SIZE) {
      const chunk = rawText.substring(i, i + MAX_CHUNK_SIZE);
      const prompt = PUNCTUATE_PROMPT_TEMPLATE.replace('{transcript}', chunk);
      const result = await callLLM(prompt);
      chunks.push(result.text?.trim() || chunk);
    }
    return chunks.join('\n\n');
  }

  const prompt = PUNCTUATE_PROMPT_TEMPLATE.replace('{transcript}', rawText);
  const llmResult = await callLLM(prompt);

  if (!llmResult.text || !llmResult.text.trim()) {
    log.warn('LLM 标点修复返回空内容，使用原始文本');
    return rawText;
  }

  return llmResult.text.trim();
}

/**
 * 重新生成全文稿（基于已存储的分段数据，无需重新 ASR）。
 *
 * 支持两种模式:
 *   1. 规则断句（useLLM=false）: 使用改进的 generateFullTextWithPunctuation 函数
 *   2. LLM 断句（useLLM=true）: 调用 LLM 添加标点和段落
 *
 * @param id 转录记录 ID
 * @param useLLM 是否使用 LLM 进行标点修复（更准确但更慢）
 * @returns 更新后的转录记录
 * @throws 转录记录不存在或无分段数据时抛出错误
 */
export async function regenerateFullText(
  id: number,
  useLLM: boolean = false,
): Promise<TranscribeResult> {
  const record = getTranscription(id);
  if (!record) {
    throw new Error(`转录记录 ${id} 不存在`);
  }

  if (!record.segments || record.segments.length === 0) {
    throw new Error(`转录记录 ${id} 没有分段数据，无法重新生成全文稿`);
  }

  const lang = record.language || '';
  const isCJK = lang.startsWith('zh') || lang.startsWith('ja');

  let fullText: string;

  if (useLLM) {
    // 使用 LLM 进行标点修复
    log.info(`开始 LLM 标点修复: id=${id}, 文本长度=${record.transcript.length}`);
    const rawText = record.segments.map(s => s.text).join('');
    fullText = await addPunctuationWithLLM(rawText);
    log.info(`LLM 标点修复完成: id=${id}, 结果长度=${fullText.length}`);
  } else {
    // 使用改进的规则断句
    log.info(`开始规则断句重新生成全文稿: id=${id}, 分段数=${record.segments.length}`);
    fullText = generateFullTextWithPunctuation(record.segments, isCJK);
    log.info(`规则断句完成: id=${id}, 结果长度=${fullText.length}`);
  }

  // 更新数据库
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE transcriptions
    SET full_text = ?, updated_at = ?
    WHERE id = ?
  `).run(fullText, now, id);

  const updated = getTranscription(id);
  if (!updated) {
    throw new Error(`转录记录 ${id} 在更新全文稿后消失`);
  }
  return updated;
}
