/**
 * 共享常量定义
 *
 * 提取散落在各服务文件中的魔法数字，统一管理。
 */

// ============================================================================
// Python 子进程执行常量
// ============================================================================

/** Python 子进程最大输出缓冲区（10MB），用于 execFile/exec 的 maxBuffer 参数 */
export const PYTHON_MAX_BUFFER: number = 10 * 1024 * 1024;

/** Python 脚本执行默认超时（10 分钟），单位毫秒 */
export const PYTHON_EXEC_TIMEOUT: number = 600_000;

/** Python 脚本执行超时（大模型，45 分钟），用于 medium/large-v2/large-v3 模型
 * medium 模型在 CPU 上转录 10 分钟视频约需 20-30 分钟，预留充足时间避免超时 */
export const PYTHON_EXEC_TIMEOUT_LARGE: number = 2_700_000;

/** Python 脚本执行超时（超长视频保护，120 分钟），用于 medium/large 模型 + 20分钟以上视频
 * medium 在 CPU 上转录 30 分钟视频约需 60-90 分钟 */
export const PYTHON_EXEC_TIMEOUT_XLARGE: number = 7_200_000;

/** Python 脚本执行最大超时（24 小时），用于超长视频（如 3-4 小时视频）
 * medium 模型在 CPU 上转录 4 小时视频约需 14 小时，预留 24 小时上限 */
export const PYTHON_EXEC_TIMEOUT_MAX: number = 86_400_000;

// ============================================================================
// 视频时长限制
// ============================================================================

/** 视频最大支持时长（秒）：4 小时
 * 超过此时长不支持转录（GPU 模式下 medium 模型约需 24 分钟） */
export const MAX_VIDEO_DURATION_SECONDS: number = 14400;

/** 长视频警告阈值（秒）：60 分钟
 * 超过此时长会提示用户预计用时较长 */
export const LONG_VIDEO_WARNING_SECONDS: number = 3600;

/** 各模型 CPU 转录速度因子（实时倍率） */
export const MODEL_SPEED_FACTOR: Record<string, number> = {
  tiny: 0.5,
  base: 1.0,
  small: 2.0,
  medium: 3.5,
  large: 6.0,
  'large-v2': 6.0,
  'large-v3': 7.0,
};

/** 各模型 GPU (CUDA float16) 转录速度因子（实时倍率）
 * RTX 3060 实测：比 CPU int8 快 30-50 倍 */
export const MODEL_SPEED_FACTOR_GPU: Record<string, number> = {
  tiny: 0.02,
  base: 0.03,
  small: 0.05,
  medium: 0.10,
  large: 0.15,
  'large-v2': 0.15,
  'large-v3': 0.20,
};

/** 登录检查超时（1 分钟），单位毫秒 */
export const LOGIN_CHECK_TIMEOUT: number = 60_000;

// ============================================================================
// 参与度计算权重
// ============================================================================

/** 社媒参与度计算权重（用于 research.service.ts 的 engagement_score 计算） */
export const ENGAGEMENT_WEIGHTS = {
  like: 1,
  comment: 2,
  favorite: 1.5,
  share: 3,
} as const;

// ============================================================================
// 文件操作常量
// ============================================================================

/** 图片下载超时（1 分钟），单位毫秒 */
export const IMAGE_DOWNLOAD_TIMEOUT: number = 60_000;

/** API 请求间隔（避免 rate limit），单位毫秒 */
export const API_RATE_LIMIT_INTERVAL: number = 2_000;

/** 健康检查超时，单位毫秒 */
export const HEALTH_CHECK_TIMEOUT: number = 3_000;
