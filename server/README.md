# Server — 本地 AI 转写与对齐服务

本目录包含两个独立的 Python 微服务，为 ping-english-assistant 前端提供本地语音转写和时间戳对齐能力。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js Client (localhost:3000)                            │
│                                                             │
│  POST /api/transcribe ──→ Whisper API (云端) ──→ 文本+时间戳│
│                                                             │
│  POST /api/transcribe/local                                 │
│                              │                              │
│         ┌────────────────────┼────────────────────┐         │
│         ▼                    ▼                    ▼         │
│  align_server.py     transcribe_server.py    降级方案       │
│  (port 8765)          (port 8766)          (按比例分配)     │
│  WhisperX 对齐        faster-whisper 转写                   │
│  词级时间戳           文本 + 段落时间戳                     │
└─────────────────────────────────────────────────────────────┘
```

**两个服务的关系：**

| 服务 | 端口 | 功能 | 输入 | 输出 |
|------|------|------|------|------|
| `align_server.py` | 8765 | WhisperX 强制对齐 | 音频 + 已知文本 | 词级时间戳 |
| `transcribe_server.py` | 8766 | faster-whisper 转写 | 音频 | 文本 + 段落时间戳 |

- **对齐服务**不做语音识别，它假设你已有文本（来自 LLM 或其他 ASR），只负责给每个词打上精确时间戳。
- **转写服务**是完整的语音转文字管道，自带 VAD（语音活动检测）和词级时间戳。

## 系统要求

| 依赖 | 最低版本 | 说明 |
|------|----------|------|
| Python | 3.9+ | 推荐 3.11/3.12 |
| pip | 20+ | 随 Python 安装 |
| ffmpeg | 4.0+ | 音频解码（必须） |
| CUDA（可选） | 11.7+ | GPU 加速，NVIDIA 显卡 |
| RAM | 4GB+ | CPU 模式；GPU 模式需显存 ≥2GB |

## 工具和模型默认安装目录

| 目录 | 用途 | 大小参考 | 可否删除 |
|------|------|----------|----------|
| `server/.venv/` | Python 虚拟环境（依赖包） | ~7.5GB | ✅ 可删，下次启动自动重建 |
| `~/nltk_data/tokenizers/punkt_tab/` | NLTK 分词器（对齐服务） | ~11MB | ✅ 可删，启动时自动下载 |
| `~/.cache/huggingface/hub/` | HuggingFace 模型缓存 | 数 GB | ✅ 可删，下次请求重新下载 |
| `~/.cache/torch/hub/` | PyTorch 预训练模型缓存 | ~450MB | ⚠️ 谨慎，其他项目可能共用 |
| `~/.ping-eng/settings.json` | 前端配置文件（服务地址等） | <1KB | ❌ 不要删，删除后需重新配置 |

```bash
# 查看各目录实际占用
du -sh server/.venv/ ~/.cache/huggingface/hub/ ~/.cache/torch/ ~/nltk_data/
```

## 快速开始

```bash
cd server/

# 一键启动（自动创建 venv、安装依赖、下载 NLTK 数据）
./start.sh                            # 默认启动对齐服务 (port 8765)
./start.sh --server transcribe        # 启动转写服务 (port 8766)
./start.sh --server both              # 同时启动两个服务
```

首次运行会自动：
1. 创建 Python 虚拟环境 (`.venv/`)
2. 安装所有依赖
3. 下载 NLTK `punkt_tab` 分词器（对齐服务需要）

## 命令行参数

### align_server.py

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | 8765 | 服务端口 |
| `--host` | 127.0.0.1 | 绑定地址 |
| `--device` | cpu | 计算设备：`cpu` / `cuda` / `auto` |
| `--compute-type` | int8 | 计算精度：`int8` / `float16` / `float32` |

### transcribe_server.py

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | 8766 | 服务端口 |
| `--host` | 127.0.0.1 | 绑定地址 |
| `--device` | auto | 计算设备：`cpu` / `cuda` / `auto`（优先 GPU） |
| `--compute-type` | 自动 | CUDA 默认 `float16`，CPU 默认 `int8` |
| `--model-size` | large-v3 | Whisper 模型：`tiny` / `base` / `small` / `medium` / `large-v2` / `large-v3` |
| `--preload` | false | 启动时立即加载模型（默认首次请求时加载） |

### start.sh

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--server` | align | 服务模式：`align` / `transcribe` / `both` |

其他参数会透传给底层 Python 服务，例如：

```bash
./start.sh --server transcribe --device cuda --model-size small
```

## API 接口

### POST /align（对齐服务，端口 8765）

强制对齐：音频 + 已知文本 → 词级时间戳。

**请求：** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `audio` | file | ✓ | 音频文件（wav/mp3/m4a 等） |
| `text` | string | ✓ | 已知的转写文本 |
| `language` | string | | 语言代码，默认 `en` |

**响应：** `application/json`

```json
{
  "words": [
    {"word": "hello", "start": 0.0, "end": 0.5},
    {"word": "world", "start": 0.6, "end": 1.1}
  ],
  "segments": [
    {"start": 0.0, "end": 1.1, "text": "hello world", "words": [...]}
  ],
  "elapsed_seconds": 0.42
}
```

**支持的语言（30+）：**

英文使用 PyTorch 内置的 `WAV2VEC2_ASR_BASE_960H` 模型。其他语言使用 HuggingFace 上的 `jonatasgrosman/wav2vec2-large-xlsr-53-*` 系列模型。模型按需加载，首次请求某语言时自动下载并缓存。

<details>
<summary>完整语言列表</summary>

| 代码 | 语言 | 代码 | 语言 |
|------|------|------|------|
| en | English | zh | Chinese |
| ja | Japanese | ko | Korean |
| nl | Dutch | pt | Portuguese |
| ar | Arabic | cs | Czech |
| ru | Russian | pl | Polish |
| hu | Hungarian | fi | Finnish |
| fa | Persian | el | Greek |
| tr | Turkish | da | Danish |
| he | Hebrew | vi | Vietnamese |
| uk | Ukrainian | ur | Urdu |
| te | Telugu | hi | Hindi |
| ca | Catalan | ml | Malayalam |
| no | Norwegian | nn | Norwegian (Nynorsk) |
| sk | Slovak | sl | Slovenian |
| hr | Croatian | ro | Romanian |
| eu | Basque | gl | Galician |
| ka | Georgian | lv | Latvian |
| tl | Filipino | sv | Swedish |
| id | Indonesian | |

</details>

### POST /transcribe（转写服务，端口 8766）

语音转文字，返回文本和段落级时间戳。

**请求：** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `audio` | file | ✓ | 音频文件（wav/mp3/m4a 等） |
| `language` | string | | 语言代码，默认 `en`；`auto` 自动检测 |

**响应：** `application/json`

```json
{
  "text": "hello world how are you",
  "durationMs": 2500,
  "segments": [
    {"startMs": 0, "endMs": 1200, "text": "hello world"},
    {"startMs": 1200, "endMs": 2500, "text": "how are you"}
  ]
}
```

**转写配置：**
- `beam_size=5`（束搜索宽度）
- `word_timestamps=True`（启用词级时间戳）
- `vad_filter=True`（启用 VAD，跳过静音段）

### GET /health（两个服务都有）

健康检查。

**对齐服务响应：**
```json
{"status": "ok", "device": "cpu", "compute_type": "int8"}
```

**转写服务响应：**
```json
{
  "status": "ok",
  "device": "cuda",
  "compute_type": "float16",
  "model_size": "large-v3",
  "model_loaded": true,
  "model_loading": false,
  "cuda_available": true
}
```

### GET /models（仅对齐服务）

列出已加载和支持的对齐模型。

```json
{
  "loaded": ["en"],
  "supported": ["en", "zh", "ja", "ko", ...]
}
```

## 设备选择策略

| 场景 | 推荐命令 | 说明 |
|------|----------|------|
| 无 NVIDIA 显卡 | `./start.sh` | 自动 CPU + int8 |
| 有 NVIDIA 显卡 | `./start.sh --server both --device auto` | 自动检测 CUDA |
| 显存不足 (≤4GB) | `--model-size small` | 小模型，约 500MB |
| 显存充足 (≥8GB) | `--model-size large-v3` | 最佳质量，约 3GB |
| 首次请求慢 | `--preload` | 启动时预加载模型 |

## 模型大小参考

| 模型 | 参数量 | 磁盘 | 显存需求 | 速度 | 质量 |
|------|--------|------|----------|------|------|
| tiny | 39M | ~75MB | ~1GB | ★★★★★ | ★★ |
| base | 74M | ~150MB | ~1GB | ★★★★ | ★★★ |
| small | 244M | ~500MB | ~2GB | ★★★ | ★★★★ |
| medium | 769M | ~1.5GB | ~3GB | ★★ | ★★★★ |
| large-v2 | 1550M | ~3GB | ~4GB | ★ | ★★★★★ |
| large-v3 | 1550M | ~3GB | ~4GB | ★ | ★★★★★ |

## 与前端集成

前端通过 Next.js API 路由代理请求到这两个服务。服务地址在 `~/.ping-eng/settings.json` 中配置：

```json
{
  "llm": {
    "provider": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "your-api-key",
    "whisperTranscribeUrl": "http://127.0.0.1:8766"
  }
}
```

**前端调用链路：**

1. 用户录音 → 前端发送音频到 `POST /api/transcribe`
2. Next.js API 路由调用 Whisper 兼容的 `/audio/transcriptions` 接口获取文本+时间戳
3. 对齐服务可用于为转写结果补充词级时间戳（可选）

**本地转写模式：** 前端也可以直接调用 `POST /api/transcribe/local`，绕过云端，完全使用本地 faster-whisper 服务。

## 常见问题

### Q: 首次请求很慢？

模型按需加载。对齐服务首次请求某语言时下载模型；转写服务首次请求时下载 Whisper 模型。使用 `--preload` 可在启动时预加载。

### Q: CUDA 不可用？

检查：
```bash
# 确认 NVIDIA 驱动
nvidia-smi

# 确认 PyTorch CUDA 支持
python3 -c "import torch; print(torch.cuda.is_available())"
```

### Q: ffmpeg 相关错误？

安装 ffmpeg：
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

### Q: NLTK 数据下载失败？

手动下载：
```bash
mkdir -p ~/nltk_data/tokenizers
curl -sL -o /tmp/punkt_tab.zip \
  "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/tokenizers/punkt_tab.zip"
unzip -qo /tmp/punkt_tab.zip -d ~/nltk_data/tokenizers
rm /tmp/punkt_tab.zip
```

### Q: 端口被占用？

```bash
# 查看占用端口的进程
lsof -i :8765
lsof -i :8766

# 使用其他端口
./start.sh --server align --port 9765
./start.sh --server transcribe --port 9766
```

## 文件结构

```
server/
├── align_server.py      # WhisperX 强制对齐服务 (FastAPI)
├── transcribe_server.py # faster-whisper 转写服务 (FastAPI)
├── start.sh             # 一键启动脚本（venv + 依赖 + NLTK + 启动）
├── requirements.txt     # Python 依赖
├── README.md            # 本文件
└── .venv/               # Python 虚拟环境（自动创建，已 gitignore）
```
