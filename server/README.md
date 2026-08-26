# Server

本地 Python 服务集群，提供音频转写和时间戳对齐能力。

- **`transcribe_server.py`** — faster-whisper 语音转文字（GPU 优先，CPU 自动回退）
- **`align_server.py`** — WhisperX forced alignment，返回词级时间戳

两个服务独立运行，可单独启动或同时启动。

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

---

## faster-whisper 转写服务

使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 进行本地语音转文字推理。优先使用 GPU (CUDA)，自动回退 CPU。

### 启动

```bash
# 启动转写服务（自动检测 GPU）
./start.sh --server transcribe

# 指定 GPU 模式
./start.sh --server transcribe --device cuda

# 使用较小模型（首次下载更快）
./start.sh --server transcribe --model-size medium

# 启动时预加载模型
./start.sh --server transcribe --preload
```

### 设备选择逻辑

| 参数 | 行为 |
|------|------|
| `--device auto`（默认） | 检测 CUDA，可用则用 GPU，否则 CPU |
| `--device cuda` | 强制 GPU，不可用则报错 |
| `--device cpu` | 强制 CPU |

GPU 使用 `float16`，CPU 使用 `int8`（可通过 `--compute-type` 覆盖）。

### API

#### `POST /transcribe`

音频转文字，返回 `AsrTranscribeResponse` 格式。

**请求**（multipart/form-data）：
- `audio` — 音频文件（wav, mp3, m4a 等）
- `language` — 语言代码（默认 `en`，设为 `auto` 自动检测）

**响应**：
```json
{
  "text": "hello world how are you",
  "durationMs": 3200,
  "segments": [
    {"startMs": 0, "endMs": 1500, "text": "hello world"},
    {"startMs": 1500, "endMs": 3200, "text": "how are you"}
  ]
}
```

#### `GET /health`

健康检查，返回设备和模型信息。

```json
{
  "status": "ok",
  "device": "cuda",
  "compute_type": "float16",
  "model_size": "large-v3",
  "model_loaded": true,
  "cuda_available": true
}
```

### 模型大小

| 模型 | 大小 | 速度 | 精度 |
|------|------|------|------|
| `tiny` | ~75MB | 最快 | 较低 |
| `base` | ~150MB | 快 | 一般 |
| `small` | ~500MB | 中等 | 较好 |
| `medium` | ~1.5GB | 较慢 | 好 |
| `large-v3`（默认） | ~3GB | 慢 | 最佳 |

首次运行会自动下载模型，之后缓存在本地。

---

## WhisperX 对齐服务

## WhisperX 对齐服务启动

```bash
# CPU 模式（默认）
./start.sh

# GPU 模式（CUDA）
./start.sh --device cuda --compute-type float16

# 自定义端口
./start.sh --port 9000
```

首次运行会自动下载对齐模型（~1GB），之后缓存在本地。

## 对齐服务 API

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

## 同时启动两个服务

```bash
# 同时启动对齐服务（后台）和转写服务（前台）
./start.sh --server both
```

## 与主应用集成

### 转写服务（faster-whisper）

主应用的 "faster-whisper" 转写方法通过 `/api/transcribe/local` route 调用此服务。

配置地址：`~/.ping-eng/settings.json` 中的 `whisperTranscribeUrl`（默认 `http://127.0.0.1:8766`）。

### 对齐服务（WhisperX）

主应用的 "调用大模型" 方法会在 MiMo ASR 返回文本后，自动调用此服务进行时间戳对齐。

配置地址：`~/.ping-eng/settings.json` 中的 `whisperAlignUrl`（默认 `http://127.0.0.1:8765`）。

如果对齐服务未启动，系统会自动降级为"按单词数等比分配时间戳"方案。
