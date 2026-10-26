#!/usr/bin/env python3
"""视频转录脚本

使用 yt-dlp 下载视频音频轨道,再用 faster-whisper 进行本地 ASR 转录。

流程:
  1. yt-dlp 下载音频 (bestaudio 格式,转为 m4a/wav)
  2. faster-whisper 加载模型 (默认 medium,支持 tiny/base/small/medium/large-v3)
  3. 执行 ASR 转录,获取带时间戳的片段
  4. 输出 JSON 结果到 stdout (最后一行)

支持平台:
  - 抖音 (douyin.com / iesdouyin.com)
  - 小红书 (xiaohongshu.com / xhslink.com)
  - YouTube (youtube.com / youtu.be)
  - TikTok (tiktok.com)
  - Bilibili (bilibili.com / b23.tv)
  - 其他 yt-dlp 支持的平台

依赖说明:
  使用 uv 内联依赖声明,可通过 `uv run transcribe.py` 直接执行,
  或通过 `python transcribe.py` 在已安装依赖的环境中执行。

使用方法:
  python transcribe.py --url "https://www.youtube.com/watch?v=xxx" --output-dir ./data/transcriptions
  python transcribe.py --url "https://www.douyin.com/video/xxx" --model small --language zh

输出格式 (stdout 最后一行 JSON):
  {
    "success": true,
    "audio_path": "/path/to/audio.m4a",
    "transcript": "完整转录文本",
    "segments": [{"start": 0.0, "end": 3.2, "text": "..."}],
    "language": "zh",
    "duration": 123.45
  }
"""
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "faster-whisper>=1.0.0",
#     "yt-dlp>=2024.0.0",
#     "opencc-python-reimplemented>=0.1.7",
# ]
# ///

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

# ============================================================
# CUDA 库路径自动配置
# ============================================================
# nvidia-cublas-cu12 等 CUDA 运行时库通过 pip 安装到 site-packages/nvidia/*/bin/
# 但这些路径不在系统 PATH 中，导致 ctranslate2 找不到 cublas64_12.dll
# 此处在脚本启动时自动将 NVIDIA 库路径加入 PATH
def _setup_cuda_paths():
    """将 pip 安装的 NVIDIA CUDA 库路径添加到 PATH。"""
    try:
        import site
        site_paths = site.getsitepackages()
    except Exception:
        site_paths = []

    # 也检查用户 site-packages
    try:
        user_site = site.getusersitepackages()
        if user_site:
            site_paths.append(user_site)
    except Exception:
        pass

    nvidia_dirs = [
        "cublas", "cuda_runtime", "cudnn", "cufft", "curand",
        "cusolver", "cusparse", "nccl", "nvtx", "cuda_nvrtc",
    ]

    for site_path in site_paths:
        nvidia_base = os.path.join(site_path, "nvidia")
        if not os.path.isdir(nvidia_base):
            continue
        for subdir in nvidia_dirs:
            bin_dir = os.path.join(nvidia_base, subdir, "bin")
            if os.path.isdir(bin_dir) and bin_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")

_setup_cuda_paths()

# ============================================================
# 视频时长限制
# ============================================================
# 硬限制：4 小时（14400 秒）
# 超过此时长不支持转录，因为 medium 模型在 CPU 上需 14+ 小时，
# 且音频文件可能占用过多磁盘空间
MAX_VIDEO_DURATION_SECONDS = 14400  # 4 小时

# 警告阈值：60 分钟（3600 秒）
# 超过此时长会记录警告，但继续转录
LONG_VIDEO_WARNING_SECONDS = 3600  # 60 分钟

# 各模型的 CPU 转录速度因子（实时倍率）
# medium 模型约 3.5x 实时速度（转录 1 分钟音频需 3.5 分钟）
MODEL_SPEED_FACTOR = {
    "tiny": 0.5, "base": 1.0, "small": 2.0,
    "medium": 3.5, "large": 6.0, "large-v2": 6.0, "large-v3": 7.0,
}

# 各模型的 GPU (CUDA float16) 转录速度因子（实时倍率）
# RTX 3060 实测：medium 模型约 0.1x 实时速度（转录 1 分钟音频仅需 6 秒）
# 即比 CPU int8 快约 35 倍
MODEL_SPEED_FACTOR_GPU = {
    "tiny": 0.02, "base": 0.03, "small": 0.05,
    "medium": 0.10, "large": 0.15, "large-v2": 0.15, "large-v3": 0.20,
}

# ============================================================
# GPU (CUDA) 自动检测
# ============================================================
_detected_device: str | None = None


def detect_device() -> str:
    """自动检测最佳计算设备。

    优先使用 CUDA GPU（如果 ctranslate2 支持），否则回退到 CPU。

    返回: "cuda" 或 "cpu"
    """
    global _detected_device
    if _detected_device is not None:
        return _detected_device

    try:
        import ctranslate2
        supported = ctranslate2.get_supported_compute_types("cuda")
        if "float16" in supported or "int8_float16" in supported:
            log("检测到 CUDA GPU 支持，将使用 GPU 加速转录")
            _detected_device = "cuda"
            return "cuda"
    except Exception as e:
        log(f"CUDA 检测失败，回退到 CPU: {e}")

    _detected_device = "cpu"
    return "cpu"


# ============================================================
# 繁体转简体转换器（延迟初始化）
# ============================================================
# faster-whisper 的中文 ASR 经常输出繁体字（如「時」「來」「說」），
# 使用 OpenCC 将所有转录文本统一转为简体，提升可读性。
_t2s_converter = None

def get_t2s_converter():
    """延迟初始化繁→简转换器，避免非中文场景下的无用加载。"""
    global _t2s_converter
    if _t2s_converter is None:
        try:
            from opencc import OpenCC
            _t2s_converter = OpenCC('t2s')
        except ImportError:
            log("opencc 未安装，跳过繁简转换")
            _t2s_converter = False  # 标记为不可用
    return _t2s_converter if _t2s_converter is not False else None

def convert_to_simplified(text: str) -> str:
    """将文本从繁体转为简体。若 opencc 不可用则原样返回。"""
    converter = get_t2s_converter()
    if converter and text:
        return converter.convert(text)
    return text


# ============================================================
# 说话人检测（角色区分）
# ============================================================

# 对话提示词 —— 段落中出现这些词汇，表明可能存在明显的问/答角色切换
DIALOGUE_CUE_WORDS = [
    # 提问类
    "请问", "我想问", "我问你", "那你说", "你怎么看", "你说呢",
    "你觉得", "你认为", "你同意", "你理解", "会不会",
    # 回答类
    "回答", "这个问题", "我的理解", "我认为", "我觉得",
    # 转述类
    "他说", "她说", "我问", "你说", "你问", "我回答", "你回答",
    "你说的", "我跟你讲", "听我说", "你听我说",
    # 对话转接
    "那你呢", "接下来", "轮到你了", "你也说说",
    "我问你", "跟你讲", "告诉你们", "跟大家说",
    "各位", "大家好", "欢迎", "感谢各位",
]


def detect_speakers(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """后处理检测说话人切换，为分段添加 speaker 标签。

    策略（多维度检测）:
      1. 间隔分析：相邻分段间隔 > 1.5s → 可能切换
      2. 对话提示词：含"问/答/说/讲/觉得"等词汇 → 对话场景
      3. 句末标点：问号（？、吗、呢）常为提问者，句号为陈述者
      4. 段长模式：连续短句（<15字）+ 长句（>30字）交替 → 对话特征

    返回: 添加了 'speaker' 字段的分段列表。
    """
    if len(segments) <= 1:
        for seg in segments:
            seg["speaker"] = "主讲人"
        return segments

    speaker_index = 0
    # 扩展说话人标签，支持多人场景
    speaker_labels = ["主讲人", "提问者", "嘉宾", "主持人"]

    # ---------- 第一遍：扫描统计对话特征 ----------
    total_gaps: list[float] = []
    dialogue_score = 0
    question_count = 0

    for i in range(1, len(segments)):
        gap = segments[i]["start"] - segments[i - 1]["end"]
        if gap > 0:
            total_gaps.append(gap)

        text = segments[i].get("text", "").strip()
        prev_text = segments[i - 1].get("text", "").strip()

        # 统计问句比例
        if text.endswith("？") or text.endswith("?") or text.endswith("吗") or text.endswith("呢"):
            question_count += 1

        # 对话提示词检测
        for cue in DIALOGUE_CUE_WORDS:
            if cue in text or cue in prev_text:
                dialogue_score += 1
                break

    # 计算中位间隔（用于动态阈值）
    median_gap = 0.0
    if total_gaps:
        sorted_gaps = sorted(total_gaps)
        n = len(sorted_gaps)
        median_gap = sorted_gaps[n // 2] if n > 0 else 2.0

    # 动态阈值：基于视频的实际节奏
    # 中位间隔越小说明对话越密集，阈值也应相应降低
    dynamic_change_gap = max(1.2, min(2.0, median_gap * 2.0))
    potential_gap = max(0.8, median_gap)

    # 判断是否有对话特征（多条件综合）
    total_segs = len(segments)
    question_ratio = question_count / total_segs if total_segs > 0 else 0
    # 问句比例 > 10%、对话提示词 > 2 个、或中位间隔 < 1.5s → 确认对话场景
    has_dialogue = (
        question_ratio > 0.10
        or dialogue_score > 2
        or (median_gap < 1.5 and len(total_gaps) > 5)
    )

    # 如果检测到的问句表明对话很活跃，用更多标签
    if question_ratio > 0.20:
        speaker_labels = ["主持人", "嘉宾A", "嘉宾B", "提问者"]
    elif question_ratio > 0.10:
        speaker_labels = ["主讲人", "提问者", "嘉宾"]

    # ---------- 第二遍：标注说话人 ----------
    segments[0]["speaker"] = speaker_labels[0]
    switch_count = 0

    for i in range(1, len(segments)):
        gap = segments[i]["start"] - segments[i - 1]["end"]
        text = segments[i].get("text", "").strip()
        prev_text = segments[i - 1].get("text", "").strip()

        # 切换条件 1：间隔超过动态阈值
        force_switch = gap > dynamic_change_gap

        # 切换条件 2：对话提示词
        cue_switch = False
        if gap > potential_gap:
            for cue in DIALOGUE_CUE_WORDS:
                if cue in text or cue in prev_text:
                    cue_switch = True
                    break

        # 切换条件 3：句末标点模式变化（问号→陈述，陈述→问号）
        prev_is_question = prev_text.endswith("？") or prev_text.endswith("?") or prev_text.endswith("吗") or prev_text.endswith("呢")
        curr_is_question = text.endswith("？") or text.endswith("?") or text.endswith("吗") or text.endswith("呢")
        pattern_switch = prev_is_question != curr_is_question and gap > potential_gap

        should_switch = force_switch or (has_dialogue and (cue_switch or pattern_switch))

        if should_switch:
            switch_count += 1
            speaker_index = (speaker_index + 1) % len(speaker_labels)

        segments[i]["speaker"] = speaker_labels[speaker_index]

    # 如果全程未检测到切换，统一标注
    if switch_count == 0 and not has_dialogue:
        for seg in segments:
            seg["speaker"] = "主讲人"

    return segments


# ============================================================
# 章节检测（用于全文稿分段）
# ============================================================

# 长停顿阈值（秒）：超过此值视为章节分隔
# 降低阈值从 5.0 → 3.0，使章节标记更频繁触发，改善全文稿分段
CHAPTER_GAP = 3.0


def detect_chapters(
    segments: list[dict[str, Any]],
) -> list[int]:
    """检测章节分隔点。

    在分段间隔 > CHAPTER_GAP (3秒) 的位置标记为章节边界。
    返回章节起始分段索引列表（包含第 0 个分段）。
    """
    chapters = [0]  # 第一章从第一个分段开始
    for i in range(1, len(segments)):
        gap = segments[i]["start"] - segments[i - 1]["end"]
        if gap > CHAPTER_GAP:
            chapters.append(i)
    return chapters


# 进度文件路径（由 --progress-file 参数设置）
_progress_file_path: str | None = None

# 检查点文件路径（由 --checkpoint-file 参数设置）
# 检查点文件保存已转录的片段，支持中断后恢复
_checkpoint_file_path: str | None = None


def log(msg: str) -> None:
    """日志输出到 stderr (stdout 留给 JSON 结果)。"""
    print(f"[transcribe] {msg}", file=sys.stderr, flush=True)


def write_progress(progress_data: dict[str, Any]) -> None:
    """将进度信息写入 JSON 文件，供后端轮询读取。

    进度文件格式:
    {
        "stage": "downloading|loading_model|transcribing|post_processing|completed|failed",
        "percentage": 0-100,
        "elapsed_seconds": float,
        "estimated_total_seconds": float | null,
        "remaining_seconds": float | null,
        "current_position": float,  // 当前转录位置（秒）
        "total_duration": float,    // 音频总时长（秒）
        "segment_count": int,
        "model": str,
        "last_log": str,
        "timestamp": str  // ISO 时间戳
    }
    """
    if not _progress_file_path:
        return
    try:
        progress_data["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
        with open(_progress_file_path, "w", encoding="utf-8") as f:
            json.dump(progress_data, f, ensure_ascii=False)
    except Exception:
        pass  # 进度文件写入失败不影响转录流程


def load_checkpoint() -> list[dict[str, Any]]:
    """加载检查点文件中已转录的片段。
    
    如果检查点文件存在且包含有效片段，返回片段列表；
    否则返回空列表。
    """
    if not _checkpoint_file_path:
        return []
    try:
        if not os.path.exists(_checkpoint_file_path):
            return []
        with open(_checkpoint_file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        segments = data.get("segments", [])
        if segments and isinstance(segments, list):
            log(f"从检查点恢复: 已有 {len(segments)} 个片段")
            return segments
    except Exception as e:
        log(f"加载检查点失败(将从头开始转录): {e}")
    return []


def save_checkpoint(segments: list[dict[str, Any]]) -> None:
    """保存已转录的片段到检查点文件。
    
    每次调用会覆写整个文件，确保断点安全。
    """
    if not _checkpoint_file_path:
        return
    try:
        checkpoint_data = {
            "segments": segments,
            "segment_count": len(segments),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
        }
        with open(_checkpoint_file_path, "w", encoding="utf-8") as f:
            json.dump(checkpoint_data, f, ensure_ascii=False)
    except Exception:
        pass  # 检查点写入失败不影响转录流程


def clear_checkpoint() -> None:
    """转录成功完成后清理检查点文件。"""
    if not _checkpoint_file_path:
        return
    try:
        if os.path.exists(_checkpoint_file_path):
            os.remove(_checkpoint_file_path)
            log("检查点文件已清理（转录完成）")
    except Exception:
        pass


def detect_platform(url: str) -> str:
    """识别视频 URL 所属平台。"""
    lower = url.lower()
    if "douyin.com" in lower or "iesdouyin.com" in lower:
        return "douyin"
    if "xiaohongshu.com" in lower or "xhslink.com" in lower:
        return "xiaohongshu"
    if "youtube.com" in lower or "youtu.be" in lower:
        return "youtube"
    if "tiktok.com" in lower:
        return "tiktok"
    if "bilibili.com" in lower or "b23.tv" in lower:
        return "bilibili"
    return "unknown"


def get_platform_ytldp_options(platform: str) -> dict[str, Any]:
    """根据平台返回 yt-dlp 特定选项。

    某些平台需要特殊 headers 或 extractor args 才能正常下载。
    """
    opts: dict[str, Any] = {}

    if platform == "douyin":
        # 抖音可能需要 User-Agent
        opts["http_headers"] = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        }
    elif platform == "xiaohongshu":
        # 小红书视频下载
        opts["http_headers"] = {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                "Version/16.0 Mobile/15E148 Safari/604.1"
            ),
        }

    return opts


def sanitize_filename(name: str) -> str:
    """将字符串转换为安全的文件名。"""
    # 只保留字母数字和中文
    safe = re.sub(r"[^\w\u4e00-\u9fa5\-]", "_", name)
    return safe[:50] if len(safe) > 50 else safe


def url_to_hash(url: str) -> str:
    """将 URL 转换为短哈希，用于音频缓存文件名。"""
    import hashlib
    return hashlib.md5(url.encode('utf-8')).hexdigest()[:12]


def download_audio(url: str, output_dir: str, platform: str, force_download: bool = False, model_size: str = "medium") -> tuple[str, float]:
    """使用 yt-dlp 下载视频的音频轨道。

    支持音频缓存：基于 URL 哈希生成文件名，如果已存在同名文件则跳过下载。
    这在模型回退场景下尤为重要——避免每次尝试新模型都重新下载音频。

    返回: (音频文件绝对路径, 视频时长秒数)
    """
    try:
        import yt_dlp
    except ImportError as e:
        raise RuntimeError(f"yt-dlp 未安装: {e}")

    # 确保输出目录存在
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # 基于 URL 哈希生成文件名，实现音频缓存
    url_hash = url_to_hash(url)
    cache_prefix = f"audio_{url_hash}_{sanitize_filename(platform)}"

    # 检查缓存：扫描目录中是否有以 cache_prefix 开头的音频文件
    if not force_download:
        possible_extensions = [".m4a", ".webm", ".mp3", ".opus", ".ogg", ".wav", ".mp4", ".aac"]
        for ext in possible_extensions:
            candidate = Path(output_dir) / f"{cache_prefix}{ext}"
            if candidate.exists():
                audio_path = str(candidate.resolve())
                log(f"命中音频缓存，跳过下载: {audio_path}")
                # 尝试获取时长（从缓存文件无法直接获取，返回 0 让 ASR 补充）
                return audio_path, 0.0

    # 输出文件名模板: 使用 URL 哈希（而非时间戳），实现缓存复用
    output_template = str(Path(output_dir) / f"{cache_prefix}.%(ext)s")

    ydl_opts: dict[str, Any] = {
        # 只下载音频,选择最佳质量
        "format": "bestaudio/best",
        "outtmpl": output_template,
        # 不下载字幕、缩略图等
        "writesubtitles": False,
        "writeautomaticsub": False,
        "writethumbnail": False,
        # 不写入元数据文件
        "writedescription": False,
        "writeinfojson": False,
        # 静默模式 (日志通过回调输出)
        "quiet": True,
        "no_warnings": True,
        # 进度条禁用
        "noprogress": True,
    }

    # 合并平台特定选项
    ydl_opts.update(get_platform_ytldp_options(platform))

    log(f"开始下载音频: platform={platform}, url={url[:80]}")
    write_progress({
        "stage": "downloading",
        "percentage": 2,
        "elapsed_seconds": 0,
        "estimated_total_seconds": None,
        "remaining_seconds": None,
        "current_position": 0,
        "total_duration": 0,
        "segment_count": 0,
        "model": "",
        "last_log": f"正在下载音频 ({platform})",
    })

    audio_path = ""
    duration = 0.0

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        # 先提取 info 获取时长
        try:
            info = ydl.extract_info(url, download=False)
            if info:
                duration = float(info.get("duration", 0) or 0)
                log(f"视频时长: {duration:.1f}s ({duration/60:.1f}分钟)")

                # === 视频时长限制检查 ===
                if duration > MAX_VIDEO_DURATION_SECONDS:
                    error_msg = (
                        f"视频时长 {duration/60:.0f} 分钟超过最大支持时长 "
                        f"({MAX_VIDEO_DURATION_SECONDS/60:.0f} 分钟)，不支持转录。"
                        f"请选择较短的视频，或裁剪后重试。"
                    )
                    log(f"[错误] {error_msg}")
                    write_progress({
                        "stage": "failed",
                        "percentage": 0,
                        "elapsed_seconds": 0,
                        "estimated_total_seconds": None,
                        "remaining_seconds": None,
                        "current_position": 0,
                        "total_duration": duration,
                        "segment_count": 0,
                        "model": "",
                        "last_log": error_msg,
                    })
                    raise RuntimeError(error_msg)

                # 长视频警告
                if duration > LONG_VIDEO_WARNING_SECONDS:
                    speed_factor = MODEL_SPEED_FACTOR.get(model_size, 3.5)
                    estimated_time = duration * speed_factor
                    log(
                        f"[警告] 长视频检测: {duration/60:.0f} 分钟, "
                        f"预计转录用时约 {estimated_time/60:.0f} 分钟"
                    )

                write_progress({
                    "stage": "downloading",
                    "percentage": 5,
                    "elapsed_seconds": 0,
                    "estimated_total_seconds": None,
                    "remaining_seconds": None,
                    "current_position": 0,
                    "total_duration": duration,
                    "segment_count": 0,
                    "model": "",
                    "last_log": f"视频时长: {duration:.1f}s, 正在下载音频",
                })
        except Exception as e:
            log(f"提取视频信息失败(将继续尝试下载): {e}")

        # 执行下载
        ydl.download([url])

    # 查找实际下载的音频文件
    # yt-dlp 会根据 format 自动添加扩展名
    possible_extensions = [".m4a", ".webm", ".mp3", ".opus", ".ogg", ".wav", ".mp4", ".aac"]
    base_path = output_template.replace("%(ext)s", "").rstrip(".")
    if base_path.endswith("."):
        base_path = base_path[:-1]

    for ext in possible_extensions:
        candidate = base_path + ext
        if os.path.exists(candidate):
            audio_path = os.path.abspath(candidate)
            break

    # 如果精确路径未找到,扫描目录中最新匹配的文件
    if not audio_path:
        glob_pattern = f"{cache_prefix}*"
        candidates = list(Path(output_dir).glob(glob_pattern))
        if candidates:
            # 取最新的
            audio_path = str(candidates[0].resolve())

    if not audio_path:
        raise RuntimeError(f"音频下载完成但未找到文件,目录: {output_dir}")

    log(f"音频下载完成: {audio_path}")
    return audio_path, duration


def run_asr(
    audio_path: str,
    model_size: str,
    language: str | None = None,
) -> tuple[str, list[dict[str, Any]], str, float]:
    """使用 faster-whisper 执行 ASR 转录。

    返回: (完整转录文本, 片段列表, 检测到的语言, 音频时长)
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise RuntimeError(f"faster-whisper 未安装: {e}")

    log(f"加载 Whisper 模型: {model_size}")
    write_progress({
        "stage": "loading_model",
        "percentage": 10,
        "elapsed_seconds": 0,
        "estimated_total_seconds": None,
        "remaining_seconds": None,
        "current_position": 0,
        "total_duration": 0,
        "segment_count": 0,
        "model": model_size,
        "last_log": f"正在加载 Whisper 模型: {model_size}",
    })

    # 记录模型加载开始时间
    model_load_start = time.time()

    # 自动检测最佳设备（GPU 优先）
    device = detect_device()

    if device == "cuda":
        # GPU 模式：使用 float16 精度，速度最快
        # RTX 3060 (12GB VRAM) 足以运行 large-v3 模型
        # float16 比 int8 在 GPU 上快 2-3 倍，且精度更高
        try:
            model = WhisperModel(model_size, device="cuda", compute_type="float16")
            log(f"使用 GPU (CUDA float16) 加载模型: {model_size}")
        except Exception as e:
            log(f"GPU float16 加载失败，尝试 int8_float16: {e}")
            try:
                model = WhisperModel(model_size, device="cuda", compute_type="int8_float16")
                log(f"使用 GPU (CUDA int8_float16) 加载模型: {model_size}")
            except Exception as e2:
                log(f"GPU 加载完全失败，回退到 CPU: {e2}")
                model = WhisperModel(model_size, device="cpu", compute_type="int8")
                device = "cpu"  # 更新设备标记，影响速度估算
    else:
        # CPU 模式：使用 int8 量化，比 float32 快 2-3 倍
        try:
            model = WhisperModel(model_size, device="cpu", compute_type="int8")
        except Exception as e:
            log(f"加载模型失败 (尝试 fallback 到 float32): {e}")
            model = WhisperModel(model_size, device="cpu", compute_type="float32")

    model_load_time = time.time() - model_load_start
    log(f"模型加载完成 (耗时 {model_load_time:.1f}s)")

    log(f"开始转录: language={language or 'auto'}")

    # 执行转录
    # beam_size=5 是 faster-whisper 的默认值,平衡速度和精度
    # vad_filter=True 启用 VAD 过滤静音段,提升转录质量
    segments_iter, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    detected_language = info.language if info else (language or "unknown")
    audio_duration = float(info.duration) if info else 0.0
    log(f"检测到语言: {detected_language}, 音频时长: {audio_duration:.1f}s")

    # 根据设备类型选择速度因子（GPU 比 CPU 快 30-50 倍）
    if device == "cuda":
        speed_factor = MODEL_SPEED_FACTOR_GPU.get(model_size, 0.15)
    else:
        speed_factor = MODEL_SPEED_FACTOR.get(model_size, 3.5)
    estimated_total = audio_duration * speed_factor if audio_duration > 0 else None

    write_progress({
        "stage": "transcribing",
        "percentage": 12,
        "elapsed_seconds": 0,
        "estimated_total_seconds": estimated_total,
        "remaining_seconds": estimated_total,
        "current_position": 0,
        "total_duration": audio_duration,
        "segment_count": 0,
        "model": model_size,
        "last_log": f"开始转录[{device.upper()}]: 语言={detected_language}, 时长={audio_duration:.1f}s, 预计耗时={estimated_total:.0f}s" if estimated_total else f"开始转录[{device.upper()}]: 语言={detected_language}",
    })

    segments: list[dict[str, Any]] = []
    transcript_parts: list[str] = []

    # 加载检查点（支持中断后恢复）
    checkpoint_segments = load_checkpoint()
    if checkpoint_segments:
        segments = checkpoint_segments
        for seg in segments:
            if seg.get("text"):
                transcript_parts.append(seg["text"])
        seg_count = len(segments)
        log(f"从检查点恢复: 已有 {seg_count} 个片段，将继续转录剩余部分")
    else:
        seg_count = 0

    # 中文 ASR 经常输出繁体字，使用 OpenCC 转为简体
    is_chinese = detected_language.startswith('zh')

    # 进度日志：每处理 10 个片段输出一次进度
    # 避免长时间无输出导致父进程误判超时
    last_progress_time = time.time()
    progress_interval = 5  # 每 5 秒输出一次进度（缩短间隔让前端更新更及时）
    transcription_start = time.time()

    # 如果有检查点片段，跳过已处理的片段
    skip_count = seg_count
    current_count = 0

    for seg in segments_iter:
        current_count += 1
        # 跳过检查点中已有的片段
        if current_count <= skip_count:
            continue

        text = seg.text.strip()
        if text:
            # 繁体转简体（仅对中文文本生效）
            if is_chinese:
                text = convert_to_simplified(text)
            segments.append({
                "start": float(seg.start),
                "end": float(seg.end),
                "text": text,
            })
            transcript_parts.append(text)

        seg_count += 1
        # 定期输出进度日志（防止父进程误判超时）
        now = time.time()
        if now - last_progress_time >= progress_interval:
            elapsed = now - transcription_start
            progress_pct = (seg.end / audio_duration * 100) if audio_duration > 0 else 0
            # 整体进度：12%（开始）~ 88%（转录完成），共 76% 的区间
            overall_pct = 12 + (progress_pct / 100) * 76
            remaining = None
            if estimated_total and elapsed > 5 and progress_pct > 0:
                # 根据当前进度重新估算剩余时间
                remaining = max(0, estimated_total - elapsed)
            log_msg = f"转录进度: 已处理 {seg_count} 个片段, 当前位置 {seg.end:.1f}s/{audio_duration:.1f}s ({progress_pct:.0f}%), 已耗时 {elapsed:.0f}s"
            log(log_msg)
            write_progress({
                "stage": "transcribing",
                "percentage": round(overall_pct, 1),
                "elapsed_seconds": round(elapsed, 1),
                "estimated_total_seconds": round(estimated_total, 1) if estimated_total else None,
                "remaining_seconds": round(remaining, 1) if remaining else None,
                "current_position": round(seg.end, 1),
                "total_duration": audio_duration,
                "segment_count": seg_count,
                "model": model_size,
                "last_log": log_msg,
            })
            # 保存检查点（每 5 秒写入一次）
            save_checkpoint(segments)
            last_progress_time = now

    transcript = "".join(transcript_parts)
    log(f"转录完成: {len(segments)} 个片段, {len(transcript)} 字符" + (" (已转简体)" if is_chinese else ""))

    # 转录完成，清理检查点文件
    clear_checkpoint()

    # 写入后处理进度
    write_progress({
        "stage": "post_processing",
        "percentage": 90,
        "elapsed_seconds": round(time.time() - transcription_start, 1),
        "estimated_total_seconds": round(estimated_total, 1) if estimated_total else None,
        "remaining_seconds": 0,
        "current_position": audio_duration,
        "total_duration": audio_duration,
        "segment_count": len(segments),
        "model": model_size,
        "last_log": f"转录完成: {len(segments)} 个片段, 正在后处理（说话人检测+章节分析）",
    })

    # 3. 后处理：说话人检测（角色区分）
    try:
        segments = detect_speakers(segments)
        speaker_count = len(set(s["speaker"] for s in segments))
        log(f"说话人检测完成: {speaker_count} 个角色")
    except Exception as e:
        log(f"说话人检测失败(不影响转录结果): {e}")

    # 4. 后处理：章节检测
    try:
        chapters = detect_chapters(segments)
        if len(chapters) > 1:
            log(f"章节检测完成: {len(chapters)} 个章节")
        # 将章节信息附加到 segments（第一个分段带章节标记）
        for i, seg in enumerate(segments):
            if i in chapters:
                seg["chapter_start"] = True
    except Exception as e:
        log(f"章节检测失败(不影响转录结果): {e}")

    return transcript, segments, detected_language, audio_duration


def main() -> int:
    """主入口函数。

    返回值: 0 表示成功,非 0 表示失败。
    """
    parser = argparse.ArgumentParser(
        description="视频转录脚本: yt-dlp 下载 + faster-whisper ASR",
    )
    parser.add_argument(
        "--url",
        required=True,
        help="视频 URL (支持抖音/小红书/YouTube/TikTok/Bilibili)",
    )
    parser.add_argument(
        "--output-dir",
        default="./data/transcriptions",
        help="音频输出目录 (默认: ./data/transcriptions)",
    )
    parser.add_argument(
        "--model",
        default="medium",
        help="Whisper 模型大小 (tiny/base/small/medium/large-v2/large-v3) 或本地模型目录路径 (默认: medium)",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="语言提示 (如 zh/en/ja,不指定则自动检测)",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        default=False,
        help="强制重新下载音频，忽略缓存（默认: 使用缓存）",
    )
    parser.add_argument(
        "--download-only",
        action="store_true",
        default=False,
        help="仅下载音频，不执行 ASR 转录（用于预下载阶段，避免下载+转录超时）",
    )
    parser.add_argument(
        "--progress-file",
        default=None,
        help="进度文件路径（写入 JSON 进度信息供后端轮询读取）",
    )
    parser.add_argument(
        "--checkpoint-file",
        default=None,
        help="检查点文件路径（保存已转录片段，支持中断后恢复）",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        default=False,
        help="仅检查视频时长和元数据，不下载不转录（用于预检查）",
    )

    args = parser.parse_args()

    url = args.url.strip()
    output_dir = args.output_dir
    model_size = args.model
    language = args.language
    force_download = args.force_download
    download_only = args.download_only
    check_only = args.check_only

    # 设置进度文件路径（全局变量）
    global _progress_file_path
    _progress_file_path = args.progress_file

    # 设置检查点文件路径（全局变量）
    global _checkpoint_file_path
    _checkpoint_file_path = args.checkpoint_file

    log(f"参数: url={url[:80]}, output_dir={output_dir}, model={model_size}, language={language or 'auto'}, force_download={force_download}, download_only={download_only}, check_only={check_only}")

    # 识别平台
    platform = detect_platform(url)
    log(f"识别平台: {platform}")

    # === 预检查模式：仅获取视频元数据，不下载不转录 ===
    if check_only:
        try:
            import yt_dlp
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
                "skip_download": True,
            }
            ydl_opts.update(get_platform_ytldp_options(platform))
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if info:
                    duration = float(info.get("duration", 0) or 0)
                    title = info.get("title", "")
                    log(f"预检查结果: 时长={duration:.1f}s ({duration/60:.1f}分钟), 标题={title[:50]}")

                    check_result = {
                        "success": True,
                        "duration": duration,
                        "title": title,
                        "exceeds_limit": duration > MAX_VIDEO_DURATION_SECONDS,
                        "max_duration": MAX_VIDEO_DURATION_SECONDS,
                        "is_long_video": duration > LONG_VIDEO_WARNING_SECONDS,
                    }
                    if duration > MAX_VIDEO_DURATION_SECONDS:
                        check_result["error"] = (
                            f"视频时长 {duration/60:.0f} 分钟超过最大支持时长 "
                            f"({MAX_VIDEO_DURATION_SECONDS/60:.0f} 分钟)"
                        )
                    print(json.dumps(check_result, ensure_ascii=False))
                    return 0
                else:
                    error_result = {"success": False, "duration": 0, "error": "无法获取视频信息"}
                    print(json.dumps(error_result, ensure_ascii=False))
                    return 1
        except Exception as e:
            error_result = {"success": False, "duration": 0, "error": str(e)}
            print(json.dumps(error_result, ensure_ascii=False))
            return 1

    try:
        # 1. 下载音频（支持缓存）
        audio_path, video_duration = download_audio(url, output_dir, platform, force_download=force_download, model_size=model_size)

        # 如果仅下载模式，输出音频路径后退出
        if download_only:
            result = {
                "success": True,
                "audio_path": audio_path,
                "transcript": "",
                "segments": [],
                "language": "",
                "duration": video_duration,
            }
            print(json.dumps(result, ensure_ascii=False))
            log(f"仅下载模式完成: {audio_path}")
            return 0

        # 2. 执行 ASR 转录
        transcript, segments, detected_language, audio_duration = run_asr(
            audio_path, model_size, language
        )

        # 优先使用 ASR 检测的时长,其次使用 yt-dlp 获取的时长
        final_duration = audio_duration if audio_duration > 0 else video_duration

        # 3. 输出 JSON 结果到 stdout
        result = {
            "success": True,
            "audio_path": audio_path,
            "transcript": transcript,
            "segments": segments,
            "language": detected_language,
            "duration": final_duration,
        }

        # 输出 JSON (最后一行)
        print(json.dumps(result, ensure_ascii=False))
        log("转录流程完成")

        # 写入完成进度
        write_progress({
            "stage": "completed",
            "percentage": 100,
            "elapsed_seconds": 0,
            "estimated_total_seconds": 0,
            "remaining_seconds": 0,
            "current_position": final_duration,
            "total_duration": final_duration,
            "segment_count": len(segments),
            "model": model_size,
            "last_log": f"转录流程完成: {len(segments)} 个片段, 时长 {final_duration:.1f}s",
        })

        return 0

    except Exception as e:
        log(f"转录失败: {e}")
        # 输出失败 JSON
        error_result = {
            "success": False,
            "audio_path": "",
            "transcript": "",
            "segments": [],
            "language": "",
            "duration": 0,
            "error": str(e),
        }
        print(json.dumps(error_result, ensure_ascii=False))

        # 写入失败进度
        write_progress({
            "stage": "failed",
            "percentage": 0,
            "elapsed_seconds": 0,
            "estimated_total_seconds": None,
            "remaining_seconds": None,
            "current_position": 0,
            "total_duration": 0,
            "segment_count": 0,
            "model": model_size,
            "last_log": f"转录失败: {e}",
        })

        return 1


if __name__ == "__main__":
    sys.exit(main())
