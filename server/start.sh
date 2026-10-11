#!/usr/bin/env bash
# 启动本地服务：WhisperX 对齐服务 / faster-whisper 转写服务 / SOE 评分代理
#
# 用法：
#   ./start.sh                            # 启动对齐服务（默认，向后兼容）
#   ./start.sh --server align             # 显式启动对齐服务
#   ./start.sh --server transcribe        # 启动转写服务
#   ./start.sh --server both              # 同时启动对齐 + 转写服务
#   ./start.sh --server soe               # 启动 SOE 评分代理（Node.js，端口 8788）
#   ./start.sh --server all               # 同时启动对齐 + 转写 + SOE 代理
#   ./start.sh --device cuda --compute-type float16   # GPU 模式（透传给 Python 服务）
#   ./start.sh --server transcribe --model-size small # 使用更小模型
#
# 说明：额外参数（--device 等）仅透传给 Python 服务；SOE 代理通过 server/.env 配置。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"

# ── 0. 解析 --server 参数并确定所需运行时 ──────────────────────────
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

# 校验 --server 取值
case "$SERVER_MODE" in
    align|transcribe|both|soe|all) ;;
    *)
        echo "错误：--server 必须是 'align'、'transcribe'、'both'、'soe' 或 'all'（当前为 '$SERVER_MODE'）"
        exit 1
        ;;
esac

# SOE 模式无需 Python 环境；Python 模式无需 Node
NEED_PYTHON="false"
NEED_NODE="false"
case "$SERVER_MODE" in
    align|transcribe|both) NEED_PYTHON="true" ;;
    soe)                   NEED_NODE="true" ;;
    all)                   NEED_PYTHON="true"; NEED_NODE="true" ;;
esac

if [[ "$NEED_PYTHON" == "true" ]]; then

# ── 1. 检查 Python ────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "错误：未找到 python3，请安装 Python 3.9+。"
    exit 1
fi

# ── 2. 创建虚拟环境（如缺失）──────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "[setup] 正在创建虚拟环境..."
    python3 -m venv "$VENV_DIR"
    echo "[setup] 虚拟环境已创建：$VENV_DIR"
fi

# 激活虚拟环境
source "$VENV_DIR/bin/activate"

# ── 3. 安装 Python 依赖 ───────────────────────────────────────────
if ! python3 -c "import whisperx, fastapi, uvicorn" &>/dev/null; then
    echo "[setup] 正在安装 Python 依赖..."
    pip install --upgrade pip -q
    pip install -r requirements.txt
    echo "[setup] Python 依赖安装完成。"
fi

# 按需检查 faster-whisper
if [[ "$SERVER_MODE" == "transcribe" || "$SERVER_MODE" == "both" || "$SERVER_MODE" == "all" ]]; then
    if ! python3 -c "import faster_whisper" &>/dev/null; then
        echo "[setup] 正在安装 faster-whisper..."
        pip install faster_whisper
        echo "[setup] faster-whisper 安装完成。"
    fi
fi

# ── 4. 下载 NLTK punkt_tab 分词器（仅对齐服务需要）────────────────
if [[ "$SERVER_MODE" == "align" || "$SERVER_MODE" == "both" || "$SERVER_MODE" == "all" ]]; then
    NLTK_DATA_DIR="$HOME/nltk_data"
    NLTK_PUNKT_DIR="$NLTK_DATA_DIR/tokenizers/punkt_tab"

    if [ ! -d "$NLTK_PUNKT_DIR/english" ]; then
        echo "[setup] 正在下载 NLTK punkt_tab 分词器..."

        # 优先用 NLTK 下载器
        if ! python3 -c "import nltk; nltk.download('punkt_tab')" 2>/dev/null; then
            # 兜底：从 GitHub 手动下载（应对 SSRF 拦截环境）
            echo "[setup] NLTK 下载器被拦截，改从 GitHub 手动下载..."
            TMP_ZIP=$(mktemp /tmp/punkt_tab.XXXXXX.zip)
            curl -sL -o "$TMP_ZIP" \
                "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/tokenizers/punkt_tab.zip"
            mkdir -p "$NLTK_DATA_DIR/tokenizers"
            unzip -qo "$TMP_ZIP" -d "$NLTK_DATA_DIR/tokenizers"
            rm -f "$TMP_ZIP"
        fi

        # 校验
        if [ -d "$NLTK_PUNKT_DIR/english" ]; then
            echo "[setup] punkt_tab 分词器就绪。"
        else
            echo "错误：punkt_tab 分词器安装失败。"
            exit 1
        fi
    fi
fi

# ── 5. 检查 ffmpeg ────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
    echo "警告：未找到 ffmpeg，部分音频格式可能解码失败。"
    echo "  安装方式：apt install ffmpeg 或 brew install ffmpeg"
fi

fi  # NEED_PYTHON

if [[ "$NEED_NODE" == "true" ]]; then

# ── 检查 Node.js / pnpm 并安装依赖（SOE 评分代理）─────────────────
if ! command -v node &>/dev/null; then
    echo "错误：未找到 node，请安装 Node.js 20+。"
    exit 1
fi
if ! command -v pnpm &>/dev/null; then
    echo "错误：未找到 pnpm，请先安装：npm install -g pnpm"
    exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
    echo "错误：SOE 代理需要 Node.js >= 20（当前 $(node -v)）。"
    exit 1
fi
if [ ! -d node_modules ]; then
    echo "[setup] 正在安装 SOE 代理依赖（pnpm install）..."
    pnpm install
    echo "[setup] SOE 代理依赖安装完成。"
fi

fi  # NEED_NODE

# ── 6. 启动服务 ────────────────────────────────────────────────────
start_align() {
    echo "[start] 启动 align_server.py（端口 8765）..."
    exec python3 align_server.py "${EXTRA_ARGS[@]}"
}

start_transcribe() {
    echo "[start] 启动 transcribe_server.py（端口 8766）..."
    exec python3 transcribe_server.py "${EXTRA_ARGS[@]}"
}

start_both() {
    echo "[start] 同时启动对齐 + 转写服务..."
    echo "[start]   align_server.py      → 端口 8765（后台）"
    echo "[start]   transcribe_server.py → 端口 8766（前台）"
    python3 align_server.py "${EXTRA_ARGS[@]}" &
    # 等待对齐服务绑定端口
    sleep 1
    exec python3 transcribe_server.py "${EXTRA_ARGS[@]}"
}

start_soe() {
    echo "[start] 启动 SOE 评分代理（端口 8788）..."
    exec pnpm start
}

start_all() {
    echo "[start] 同时启动对齐 + 转写 + SOE 代理..."
    echo "[start]   align_server.py      → 端口 8765（后台）"
    echo "[start]   transcribe_server.py → 端口 8766（后台）"
    echo "[start]   SOE 评分代理         → 端口 8788（前台）"
    python3 align_server.py "${EXTRA_ARGS[@]}" &
    sleep 1
    python3 transcribe_server.py "${EXTRA_ARGS[@]}" &
    sleep 1
    exec pnpm start
}

case "$SERVER_MODE" in
    align)      start_align ;;
    transcribe) start_transcribe ;;
    both)       start_both ;;
    soe)        start_soe ;;
    all)        start_all ;;
esac
