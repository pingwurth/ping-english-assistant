#!/usr/bin/env bash
# Start the WhisperX Alignment Server
#
# Usage:
#   ./start.sh              # CPU mode (default)
#   ./start.sh --device cuda --compute-type float16   # GPU mode

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"

# ── 1. Check Python ──────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "Error: python3 not found. Please install Python 3.9+."
    exit 1
fi

# ── 2. Create venv if missing ────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "[setup] Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "[setup] Virtual environment created at $VENV_DIR"
fi

# Activate venv
source "$VENV_DIR/bin/activate"

# ── 3. Install Python dependencies ───────────────────────────────
if ! python3 -c "import whisperx, fastapi, uvicorn" &>/dev/null; then
    echo "[setup] Installing Python dependencies..."
    pip install --upgrade pip -q
    pip install -r requirements.txt
    echo "[setup] Python dependencies installed."
fi

# ── 4. Download NLTK punkt_tab tokenizer ─────────────────────────
NLTK_DATA_DIR="$HOME/nltk_data"
NLTK_PUNKT_DIR="$NLTK_DATA_DIR/tokenizers/punkt_tab"

if [ ! -d "$NLTK_PUNKT_DIR/english" ]; then
    echo "[setup] Downloading NLTK punkt_tab tokenizer..."

    # Try NLTK downloader first
    if ! python3 -c "import nltk; nltk.download('punkt_tab')" 2>/dev/null; then
        # Fallback: manual download from GitHub (handles SSRF-blocked environments)
        echo "[setup] NLTK downloader blocked, downloading manually from GitHub..."
        TMP_ZIP=$(mktemp /tmp/punkt_tab.XXXXXX.zip)
        curl -sL -o "$TMP_ZIP" \
            "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/tokenizers/punkt_tab.zip"
        mkdir -p "$NLTK_DATA_DIR/tokenizers"
        unzip -qo "$TMP_ZIP" -d "$NLTK_DATA_DIR/tokenizers"
        rm -f "$TMP_ZIP"
    fi

    # Verify
    if [ -d "$NLTK_PUNKT_DIR/english" ]; then
        echo "[setup] punkt_tab tokenizer ready."
    else
        echo "Error: Failed to install punkt_tab tokenizer."
        exit 1
    fi
fi

# ── 5. Check ffmpeg ──────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
    echo "Warning: ffmpeg not found. Audio decoding may fail for some formats."
    echo "  Install with: apt install ffmpeg  or  brew install ffmpeg"
fi

# ── 6. Start server ──────────────────────────────────────────────
echo "[start] Launching align_server.py..."
exec python3 align_server.py "$@"
