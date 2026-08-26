#!/usr/bin/env bash
# Start WhisperX Alignment Server and/or faster-whisper Transcription Server
#
# Usage:
#   ./start.sh                            # Start align server (default, backward compatible)
#   ./start.sh --server align             # Start align server explicitly
#   ./start.sh --server transcribe        # Start transcription server
#   ./start.sh --server both              # Start both servers
#   ./start.sh --device cuda --compute-type float16   # GPU mode (passed to server)
#   ./start.sh --server transcribe --model-size small # Use smaller model

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"

# ── 0. Parse --server flag ────────────────────────────────────────
SERVER_MODE="align"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)
            SERVER_MODE="$2"
            shift 2
            ;;
        *)
            EXTRA_ARGS+=("$1")
            shift
            ;;
    esac
done

# Validate --server value
case "$SERVER_MODE" in
    align|transcribe|both) ;;
    *)
        echo "Error: --server must be 'align', 'transcribe', or 'both' (got '$SERVER_MODE')"
        exit 1
        ;;
esac

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

# Check faster-whisper if needed
if [[ "$SERVER_MODE" == "transcribe" || "$SERVER_MODE" == "both" ]]; then
    if ! python3 -c "import faster_whisper" &>/dev/null; then
        echo "[setup] Installing faster-whisper..."
        pip install faster-whisper
        echo "[setup] faster-whisper installed."
    fi
fi

# ── 4. Download NLTK punkt_tab tokenizer ─────────────────────────
# Only needed for alignment server
if [[ "$SERVER_MODE" == "align" || "$SERVER_MODE" == "both" ]]; then
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
fi

# ── 5. Check ffmpeg ──────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
    echo "Warning: ffmpeg not found. Audio decoding may fail for some formats."
    echo "  Install with: apt install ffmpeg  or  brew install ffmpeg"
fi

# ── 6. Start server(s) ──────────────────────────────────────────
start_align() {
    echo "[start] Launching align_server.py on port 8765..."
    exec python3 align_server.py "${EXTRA_ARGS[@]}"
}

start_transcribe() {
    echo "[start] Launching transcribe_server.py on port 8766..."
    exec python3 transcribe_server.py "${EXTRA_ARGS[@]}"
}

start_both() {
    echo "[start] Launching both servers..."
    echo "[start]   align_server.py      → port 8765 (background)"
    echo "[start]   transcribe_server.py  → port 8766 (foreground)"
    python3 align_server.py "${EXTRA_ARGS[@]}" &
    ALIGN_PID=$!
    # Give align server a moment to bind its port
    sleep 1
    exec python3 transcribe_server.py "${EXTRA_ARGS[@]}"
}

case "$SERVER_MODE" in
    align)      start_align ;;
    transcribe) start_transcribe ;;
    both)       start_both ;;
esac
