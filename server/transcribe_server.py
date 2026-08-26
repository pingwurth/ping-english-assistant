"""
faster-whisper Local Transcription Server

A lightweight FastAPI service that performs speech-to-text using faster-whisper
with automatic GPU-first / CPU-fallback device selection.

Usage:
    pip install -r requirements.txt
    python transcribe_server.py [--port 8766] [--device auto] [--model-size large-v3]

Endpoints:
    POST /transcribe — audio file → text + segment-level timestamps
    GET  /health     — health check (includes device & model info)
"""

import argparse
import asyncio
import logging
import tempfile
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="faster-whisper Transcription Server", version="1.0.0")

# ---------------------------------------------------------------------------
# Global state — model cached after first load
# ---------------------------------------------------------------------------

_model = None  # faster-whisper WhisperModel instance
_model_loading = False  # True while model is being loaded
_device: str = "cpu"
_compute_type: str = "int8"
_model_size: str = "large-v3"

# Thread pool for blocking operations (model load + transcription)
_executor = ThreadPoolExecutor(max_workers=1)


def _load_model_sync():
    """Load and cache the faster-whisper model (blocking, runs in thread pool)."""
    global _model, _model_loading
    if _model is not None:
        return _model

    _model_loading = True
    from faster_whisper import WhisperModel

    logger.info(
        "Loading faster-whisper model=%s device=%s compute_type=%s ...",
        _model_size,
        _device,
        _compute_type,
    )

    try:
        _model = WhisperModel(
            _model_size,
            device=_device,
            compute_type=_compute_type,
        )
    except Exception as e:
        _model_loading = False
        logger.error("Failed to load model: %s", e)
        raise

    _model_loading = False
    logger.info("Model loaded: %s on %s (%s)", _model_size, _device, _compute_type)
    return _model


async def _load_model():
    """Load model in thread pool to avoid blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _load_model_sync)


def _transcribe_sync(audio_path: str, language: str):
    """Run transcription (blocking, runs in thread pool)."""
    model = _load_model_sync()

    lang_arg = None if language == "auto" else language
    segments_iter, info = model.transcribe(
        audio_path,
        language=lang_arg,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
    )

    segments = []
    full_text_parts = []
    for seg in segments_iter:
        start_ms = round(seg.start * 1000)
        end_ms = round(seg.end * 1000)
        text = seg.text.strip()
        if text:
            segments.append({
                "startMs": start_ms,
                "endMs": end_ms,
                "text": text,
            })
            full_text_parts.append(text)

    full_text = " ".join(full_text_parts)
    detected_lang = info.language if hasattr(info, "language") else language

    return full_text, segments, detected_lang


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "device": _device,
        "compute_type": _compute_type,
        "model_size": _model_size,
        "model_loaded": _model is not None,
        "model_loading": _model_loading,
        "cuda_available": torch.cuda.is_available(),
    }


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(..., description="Audio file (wav, mp3, m4a, etc.)"),
    language: str = Form(default="en", description="Language code (en, zh, etc.) or 'auto'"),
):
    """
    Transcribe audio using faster-whisper.

    Returns JSON matching AsrTranscribeResponse:
    {
        "text": "full transcription text",
        "durationMs": 12345,
        "segments": [{"startMs": 0, "endMs": 1500, "text": "hello world"}, ...]
    }
    """
    start_time = time.time()

    # Save uploaded audio to a temp file (faster-whisper needs a file path)
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Run blocking transcription in thread pool
        loop = asyncio.get_event_loop()
        full_text, segments, detected_lang = await loop.run_in_executor(
            _executor, _transcribe_sync, tmp_path, language
        )

        duration_ms = segments[-1]["endMs"] if segments else 0

        elapsed = time.time() - start_time
        logger.info(
            "Transcription done: lang=%s %d segments, %d chars in %.2fs",
            detected_lang,
            len(segments),
            len(full_text),
            elapsed,
        )

        return JSONResponse(content={
            "text": full_text,
            "durationMs": duration_ms,
            "segments": segments,
        })

    except Exception as e:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global _device, _compute_type, _model_size

    parser = argparse.ArgumentParser(description="faster-whisper Transcription Server")
    parser.add_argument("--port", type=int, default=8766, help="Server port (default: 8766)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument(
        "--device",
        default="auto",
        choices=["cpu", "cuda", "auto"],
        help="Compute device (default: auto — prefers CUDA)",
    )
    parser.add_argument(
        "--compute-type",
        default=None,
        choices=["int8", "float16", "float32"],
        help="Compute type (default: float16 for CUDA, int8 for CPU)",
    )
    parser.add_argument(
        "--model-size",
        default="large-v3",
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
        help="Whisper model size (default: large-v3)",
    )
    parser.add_argument(
        "--preload",
        action="store_true",
        help="Load model at startup instead of on first request",
    )
    args = parser.parse_args()

    # Resolve device
    if args.device == "auto":
        _device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        _device = args.device

    # Resolve compute type: default depends on device
    if args.compute_type is not None:
        _compute_type = args.compute_type
    else:
        _compute_type = "float16" if _device == "cuda" else "int8"

    _model_size = args.model_size

    logger.info(
        "Starting faster-whisper Transcription Server on %s:%d "
        "(device=%s, compute=%s, model=%s)",
        args.host, args.port, _device, _compute_type, _model_size,
    )

    if _device == "cuda" and not torch.cuda.is_available():
        logger.warning("CUDA requested but not available! Falling back to CPU.")
        _device = "cpu"
        if args.compute_type is None:
            _compute_type = "int8"

    if args.preload:
        _load_model_sync()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
