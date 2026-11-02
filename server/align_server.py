"""
WhisperX Forced Alignment Server

A lightweight FastAPI service that takes audio + pre-existing transcription text
and returns word-level timestamps via WhisperX forced alignment.

Usage:
    pip install -r requirements.txt
    python align_server.py [--port 8765] [--device cpu] [--compute-type int8]

Endpoints:
    POST /align     — forced alignment: audio + text → word-level timestamps
    GET  /health    — health check
    GET  /models    — list loaded alignment models
"""

import argparse
import asyncio
import logging
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="WhisperX Alignment Server", version="1.0.0")

# 上传音频硬上限（字节）：默认 300MB，防止单请求把整段音频全量读进内存 OOM。
MAX_UPLOAD_BYTES = int(os.environ.get("ALIGN_MAX_BYTES", 300 * 1024 * 1024))
_CHUNK = 1 << 20  # 1 MiB


async def _stream_to_file(upload: UploadFile, dest) -> int:
    """分块流式落盘，累计超 MAX_UPLOAD_BYTES 立即中断并回 413（不信 Content-Length）。"""
    total = 0
    while True:
        chunk = await upload.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"audio exceeds {MAX_UPLOAD_BYTES} bytes limit",
            )
        dest.write(chunk)
    return total

# 同步推理线程池：whisperx.load_audio / load_align_model / align 全是密集同步调用
# （首语言还可能触发分钟级模型下载），直接跑在 async 端点里会把事件循环整个冻住，
# /health 与并发请求全部无响应（与 transcribe_server.py 的同款处理）
_align_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="align")

# ---------------------------------------------------------------------------
# Global state — alignment models cached by language
# ---------------------------------------------------------------------------

_alignment_models: dict[str, tuple] = {}
_device: str = "cpu"
_compute_type: str = "int8"

# Default alignment models per language (from WhisperX source)
DEFAULT_ALIGN_MODELS_HF = {
    "ja": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "zh": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    "nl": "jonatasgrosman/wav2vec2-large-xlsr-53-dutch",
    "uk": "jonatasgrosman/wav2vec2-large-xlsr-53-ukrainian",
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
    "ar": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
    "cs": "jonatasgrosman/wav2vec2-large-xlsr-53-czech",
    "ru": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
    "pl": "jonatasgrosman/wav2vec2-large-xlsr-53-polish",
    "hu": "jonatasgrosman/wav2vec2-large-xlsr-53-hungarian",
    "fi": "jonatasgrosman/wav2vec2-large-xlsr-53-finnish",
    "fa": "jonatasgrosman/wav2vec2-large-xlsr-53-persian",
    "el": "jonatasgrosman/wav2vec2-large-xlsr-53-greek",
    "tr": "jonatasgrosman/wav2vec2-large-xlsr-53-turkish",
    "da": "jonatasgrosman/wav2vec2-large-xlsr-53-danish",
    "he": "jonatasgrosman/wav2vec2-large-xlsr-53-hebrew",
    "vi": "jonatasgrosman/wav2vec2-large-xlsr-53-vietnamese",
    "ko": "jonatasgrosman/wav2vec2-large-xlsr-53-korean",
    "ur": "jonatasgrosman/wav2vec2-large-xlsr-53-urdu",
    "te": "jonatasgrosman/wav2vec2-large-xlsr-53-telugu",
    "hi": "jonatasgrosman/wav2vec2-large-xlsr-53-hindi",
    "ca": "jonatasgrosman/wav2vec2-large-xlsr-53-catalan",
    "ml": "jonatasgrosman/wav2vec2-large-xlsr-53-malayalam",
    "no": "jonatasgrosman/wav2vec2-large-xlsr-53-norwegian",
    "nn": "jonatasgrosman/wav2vec2-large-xlsr-53-norwegian",
    "sk": "jonatasgrosman/wav2vec2-large-xlsr-53-slovak",
    "sl": "jonatasgrosman/wav2vec2-large-xlsr-53-slovenian",
    "hr": "jonatasgrosman/wav2vec2-large-xlsr-53-croatian",
    "ro": "jonatasgrosman/wav2vec2-large-xlsr-53-romanian",
    "eu": "jonatasgrosman/wav2vec2-large-xlsr-53-basque",
    "gl": "jonatasgrosman/wav2vec2-large-xlsr-53-galician",
    "ka": "jonatasgrosman/wav2vec2-large-xlsr-53-georgian",
    "lv": "jonatasgrosman/wav2vec2-large-xlsr-53-latvian",
    "tl": "jonatasgrosman/wav2vec2-large-xlsr-53-filipino",
    "sv": "jonatasgrosman/wav2vec2-large-xlsr-53-swedish",
    "id": "jonatasgrosman/wav2vec2-large-xlsr-53-indonesian",
}

DEFAULT_ALIGN_MODELS_TORCH = {
    "en": "WAV2VEC2_ASR_BASE_960H",
}


def _get_align_model(language: str):
    """Load and cache the alignment model for a given language."""
    if language in _alignment_models:
        return _alignment_models[language]

    import whisperx

    logger.info("Loading alignment model for language=%s device=%s ...", language, _device)

    model_name = DEFAULT_ALIGN_MODELS_TORCH.get(language) or DEFAULT_ALIGN_MODELS_HF.get(language)
    if model_name is None:
        raise ValueError(
            f"No default alignment model for language '{language}'. "
            f"Supported: {sorted(set(DEFAULT_ALIGN_MODELS_TORCH) | set(DEFAULT_ALIGN_MODELS_HF))}"
        )

    model, metadata = whisperx.load_align_model(
        language_code=language,
        device=_device,
        model_name=model_name,
    )
    _alignment_models[language] = (model, metadata)
    logger.info("Alignment model loaded for language=%s", language)
    return model, metadata


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "device": _device, "compute_type": _compute_type}


@app.get("/models")
async def list_models():
    return {
        "loaded": list(_alignment_models.keys()),
        "supported": sorted(set(DEFAULT_ALIGN_MODELS_TORCH) | set(DEFAULT_ALIGN_MODELS_HF)),
    }


def _align_sync(tmp_path: str, text: str, language: str) -> tuple[list, list]:
    """同步推理（跑在 _align_executor 线程里）：加载音频/模型 + 强制对齐。"""
    import whisperx

    # Load audio
    audio_data = whisperx.load_audio(tmp_path)

    # Build segments in WhisperX format from the input text
    # WhisperX expects: list of dicts with "text", "start", "end" keys
    # We provide the full text as one segment spanning the entire audio
    audio_duration = len(audio_data) / 16000  # whisperx loads at 16kHz
    raw_segments = [{"text": text, "start": 0.0, "end": audio_duration}]

    # Load alignment model
    model, metadata = _get_align_model(language)

    # Run forced alignment
    result = whisperx.align(
        raw_segments,
        model,
        metadata,
        audio_data,
        _device,
        return_char_alignments=False,
    )

    aligned_segments = result.get("segments", [])
    # WhisperX 对强制对齐失败的词会返回 start/end 键存在但值为 None；
    # w.get("start", 0) 的默认值对 None 不生效 → JSON null 直入客户端时间轴被静默归零。
    # 这里把 None/非数值收敛为上一个词的 end（再缺则句 start / 0），保证回传都是有限数值。
    words = []
    last_end = 0.0
    for seg in aligned_segments:
        seg_start = seg.get("start")
        seg_cursor = seg_start if isinstance(seg_start, (int, float)) else last_end
        for w in seg.get("words", []):
            start = w.get("start")
            end = w.get("end")
            start = start if isinstance(start, (int, float)) else seg_cursor
            end = end if isinstance(end, (int, float)) and end >= start else start
            words.append({"word": w.get("word", ""), "start": start, "end": end})
            seg_cursor = last_end = end
    return words, aligned_segments


@app.post("/align")
async def align(
    audio: UploadFile = File(..., description="Audio file (wav, mp3, m4a, etc.)"),
    text: str = Form(..., description="Pre-existing transcription text"),
    language: str = Form(default="en", description="Language code (en, zh, ja, etc.)"),
):
    """
    Forced alignment: take audio + text, return word-level timestamps.

    Returns JSON:
    {
        "words": [{"word": "hello", "start": 0.0, "end": 0.5}, ...],
        "segments": [{"start": 0.0, "end": 1.5, "text": "hello world"}, ...]
    }
    """
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    start_time = time.time()

    # Save uploaded audio to a temp file (WhisperX needs a file path).
    # 分块流式落盘 + 累计上限，不把整段音频一次性读进内存。
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    try:
        await _stream_to_file(audio, tmp)
        tmp.close()
        # 推理放线程池：不让同步模型加载/对齐冻住事件循环（期间 /health 仍可响应）
        loop = asyncio.get_running_loop()
        words, aligned_segments = await loop.run_in_executor(
            _align_executor, _align_sync, tmp_path, text.strip(), language
        )

        elapsed = time.time() - start_time
        logger.info("Alignment done: %d words in %.2fs", len(words), elapsed)

        return JSONResponse(content={
            "words": words,
            "segments": aligned_segments,
            "elapsed_seconds": round(elapsed, 2),
        })

    except HTTPException:
        raise
    except Exception as e:
        # 详情只写日志，不外泄给客户端（可能含临时路径/模型缓存目录/CUDA 报错细节）
        logger.exception("Alignment failed")
        raise HTTPException(status_code=500, detail="alignment failed")
    finally:
        tmp.close()
        Path(tmp_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="WhisperX Alignment Server")
    parser.add_argument("--port", type=int, default=8765, help="Server port (default: 8765)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument(
        "--device",
        default="cpu",
        choices=["cpu", "cuda", "auto"],
        help="Compute device (default: cpu)",
    )
    parser.add_argument(
        "--compute-type",
        default="int8",
        choices=["int8", "float16", "float32"],
        help="Compute type (default: int8)",
    )
    args = parser.parse_args()

    global _device, _compute_type
    _device = args.device
    _compute_type = args.compute_type

    if _device == "auto":
        _device = "cuda" if torch.cuda.is_available() else "cpu"

    logger.info("Starting WhisperX Alignment Server on %s:%d (device=%s, compute=%s)",
                args.host, args.port, _device, _compute_type)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
