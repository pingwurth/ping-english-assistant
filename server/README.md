# WhisperX Alignment Server

本地 Python 服务，使用 WhisperX 对已有转写文本进行 forced alignment，返回词级时间戳。

## 安装

```bash
cd server

# 创建虚拟环境（推荐）
python3 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 系统依赖：ffmpeg
# Ubuntu/Debian: sudo apt install ffmpeg
# macOS: brew install ffmpeg
```

## 启动

```bash
# CPU 模式（默认）
./start.sh

# GPU 模式（CUDA）
./start.sh --device cuda --compute-type float16

# 自定义端口
./start.sh --port 9000
```

首次运行会自动下载对齐模型（~1GB），之后缓存在本地。

## API

### `POST /align`

接收音频文件 + 转写文本，返回词级时间戳。

**请求**（multipart/form-data）：
- `audio` — 音频文件（wav, mp3, m4a 等）
- `text` — 转写文本
- `language` — 语言代码（默认 `en`）

**响应**：
```json
{
  "words": [
    {"word": "hello", "start": 0.0, "end": 0.5},
    {"word": "world", "start": 0.6, "end": 1.2}
  ],
  "segments": [
    {"start": 0.0, "end": 1.2, "text": "hello world", "words": [...]}
  ],
  "elapsed_seconds": 0.35
}
```

### `GET /health`

健康检查。

### `GET /models`

查看已加载和支持的对齐模型。

## 与主应用集成

主应用的 `/api/transcribe` route 会在 MiMo ASR 返回文本后，自动调用此服务进行时间戳对齐。

配置地址：`~/.ping-eng/settings.json` 中的 `whisperAlignUrl`（默认 `http://127.0.0.1:8765`）。

如果此服务未启动，系统会自动降级为"按单词数等比分配时间戳"方案。
