# 傻瓜式教程：本地 AI 转写服务从零到跑通

本教程手把手带你完成：下载 → 安装 → 配置 → 部署 → 测试 → API 调用 → 验证 → 使用。

---

## 目录

1. [环境准备](#1-环境准备)
2. [安装依赖](#2-安装依赖)
3. [启动服务](#3-启动服务)
4. [验证服务](#4-验证服务)
5. [API 调用示例](#5-api-调用示例)
6. [配置前端连接](#6-配置前端连接)
7. [完整使用流程](#7-完整使用流程)
8. [GPU 加速（可选）](#8-gpu-加速可选)
9. [故障排除](#9-故障排除)

---

## 1. 环境准备

### 1.1 检查 Python

```bash
python3 --version
# 需要 Python 3.9 或更高版本，推荐 3.11/3.12
```

如果没有 Python：
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install python3 python3-venv python3-pip

# macOS（Homebrew）
brew install python@3.12

# Arch Linux
sudo pacman -S python python-pip
```

### 1.2 检查 ffmpeg

```bash
ffmpeg -version
# 需要 ffmpeg 4.0+
```

如果没有 ffmpeg：
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

### 1.3 检查磁盘空间

- 仅对齐服务：约 2GB（模型按需下载）
- 转写服务 + large-v3 模型：约 5GB
- 转写服务 + small 模型：约 1GB

### 1.4 工具和模型默认安装目录

启动服务后，以下目录会被自动创建和使用。确认你有足够的磁盘空间，了解每个目录的用途方便后续清理。

| 目录 | 用途 | 大小参考 | 可否删除 |
|------|------|----------|----------|
| `server/.venv/` | Python 虚拟环境（依赖包） | ~7.5GB | ✅ 可删，下次启动自动重建 |
| `~/nltk_data/tokenizers/punkt_tab/` | NLTK 分词器（对齐服务） | ~11MB | ✅ 可删，启动时自动下载 |
| `~/.cache/huggingface/hub/` | HuggingFace 模型缓存 | 数 GB | ✅ 可删，下次请求重新下载 |
| `~/.cache/torch/hub/` | PyTorch 预训练模型缓存 | ~450MB | ⚠️ 谨慎，其他项目可能共用 |
| `~/.ping-eng/settings.json` | 前端配置文件（服务地址等） | <1KB | ❌ 不要删，删除后需重新配置 |

**具体说明：**

- **`server/.venv/`** — Python 虚拟环境，包含所有 pip 安装的包（torch、whisperx、fastapi 等）。占空间最大，但删除后 `./start.sh` 会自动重建。
- **`~/nltk_data/`** — NLTK 数据目录。对齐服务需要 `punkt_tab` 分词器。删除后启动时自动重新下载。
- **`~/.cache/huggingface/hub/`** — HuggingFace 模型缓存。对齐服务的多语言对齐模型、转写服务的 faster-whisper 模型都存在这里。格式为 `models--<org>--<model-name>/`。删除后下次请求对应模型时重新下载。
- **`~/.cache/torch/hub/`** — PyTorch Hub 缓存。英文对齐模型 `WAV2VEC2_ASR_BASE_960H` 的 checkpoint 存在这里。其他 PyTorch 项目也可能共用此目录。
- **`~/.ping-eng/settings.json`** — 前端读取的配置文件，包含 LLM API Key 和本地服务地址。**不要删除**，删除后需要在前端设置页面重新配置。

**清理磁盘空间：**
```bash
# 清理虚拟环境（下次启动自动重建）
rm -rf server/.venv/

# 清理 HuggingFace 模型缓存（下次请求重新下载）
rm -rf ~/.cache/huggingface/hub/

# 清理 NLTK 数据（下次启动自动下载）
rm -rf ~/nltk_data/

# 查看各目录实际占用
du -sh server/.venv/ ~/.cache/huggingface/hub/ ~/.cache/torch/ ~/nltk_data/
```

### 1.5（可选）检查 GPU

如果有 NVIDIA 显卡，确认驱动和 CUDA：
```bash
nvidia-smi
# 应该显示驱动版本和 CUDA 版本
```

---

## 2. 安装依赖

**你不需要手动安装任何东西。** `start.sh` 会自动完成所有安装。

但如果你想手动安装：

```bash
cd server/

# 创建虚拟环境
python3 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate

# 安装依赖
pip install --upgrade pip
pip install -r requirements.txt

# 下载 NLTK 数据（对齐服务需要）
python3 -c "import nltk; nltk.download('punkt_tab')"
```

### 依赖说明

| 包 | 用途 |
|---|------|
| `whisperx` | WhisperX 强制对齐（对齐服务） |
| `faster-whisper` | CTranslate2 Whisper 实现（转写服务） |
| `torch` | PyTorch，ML 计算后端 |
| `fastapi` | Web 框架 |
| `uvicorn` | ASGI 服务器 |
| `python-multipart` | 文件上传解析 |
| `numpy` | 数值计算 |

---

## 3. 启动服务

### 3.1 最简启动（推荐）

```bash
cd server/

# 启动对齐服务（默认，端口 8765）
./start.sh

# 或者启动转写服务（端口 8766）
./start.sh --server transcribe

# 或者同时启动两个服务
./start.sh --server both
```

首次启动会自动：
1. ✅ 创建 Python 虚拟环境
2. ✅ 安装所有 Python 依赖
3. ✅ 下载 NLTK 分词器数据
4. ✅ 启动服务

### 3.2 启动后的输出

对齐服务启动成功会显示：
```
[setup] Creating virtual environment...
[setup] Virtual environment created at /path/to/server/.venv
[setup] Installing Python dependencies...
[setup] Python dependencies installed.
[setup] Downloading NLTK punkt_tab tokenizer...
[setup] punkt_tab tokenizer ready.
[start] Launching align_server.py on port 8765...
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8765
```

转写服务启动成功会显示：
```
[start] Launching transcribe_server.py on port 8766...
INFO:     Started server process [12346]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8766
```

### 3.3 后台运行

如果想在后台运行（不占用终端）：

```bash
# 对齐服务后台运行
nohup ./start.sh --server align > align.log 2>&1 &

# 转写服务后台运行
nohup ./start.sh --server transcribe > transcribe.log 2>&1 &

# 查看日志
tail -f align.log
tail -f transcribe.log

# 停止服务
pkill -f align_server.py
pkill -f transcribe_server.py
```

---

## 4. 验证服务

### 4.1 健康检查

对齐服务：
```bash
curl http://127.0.0.1:8765/health
# 期望输出: {"status":"ok","device":"cpu","compute_type":"int8"}
```

转写服务：
```bash
curl http://127.0.0.1:8766/health
# 期望输出: {"status":"ok","device":"cpu","compute_type":"int8","model_size":"large-v3","model_loaded":false,"model_loading":false,"cuda_available":false}
```

### 4.2 查看支持的模型（对齐服务）

```bash
curl http://127.0.0.1:8765/models
# 输出已加载和支持的对齐模型语言列表
```

### 4.3 准备测试音频

如果没有现成的音频文件，用 ffmpeg 生成一个测试音频：

```bash
# 生成一段 3 秒的静音 WAV（16kHz 单声道，与服务兼容）
ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -ar 16000 -ac 1 test.wav
```

或者用手机录一段英文朗读，保存为 WAV/MP3/M4A 格式。

---

## 5. API 调用示例

### 5.1 对齐服务 — POST /align

**场景：** 你有一段音频和对应的文本，想获取每个词的精确时间戳。

```bash
# 基本调用
curl -X POST http://127.0.0.1:8765/align \
  -F "audio=@test.wav" \
  -F "text=Hello world, how are you today?" \
  -F "language=en"
```

**响应示例：**
```json
{
  "words": [
    {"word": "hello", "start": 0.0, "end": 0.48},
    {"word": "world", "start": 0.52, "end": 0.96},
    {"word": "how", "start": 1.2, "end": 1.44},
    {"word": "are", "start": 1.52, "end": 1.68},
    {"word": "you", "start": 1.76, "end": 1.92},
    {"word": "today", "start": 2.08, "end": 2.48}
  ],
  "segments": [
    {"start": 0.0, "end": 2.48, "text": "Hello world, how are you today?", "words": [...]}
  ],
  "elapsed_seconds": 0.85
}
```

**Python 调用示例：**
```python
import requests

response = requests.post(
    "http://127.0.0.1:8765/align",
    files={"audio": open("test.wav", "rb")},
    data={"text": "Hello world, how are you today?", "language": "en"},
)
result = response.json()

for word in result["words"]:
    print(f"{word['start']:.2f}s - {word['end']:.2f}s: {word['word']}")
```

**JavaScript/Node.js 调用示例：**
```javascript
const formData = new FormData()
formData.append('audio', fileBlob, 'test.wav')
formData.append('text', 'Hello world, how are you today?')
formData.append('language', 'en')

const response = await fetch('http://127.0.0.1:8765/align', {
  method: 'POST',
  body: formData,
})
const result = await response.json()
console.log(result.words)
```

### 5.2 转写服务 — POST /transcribe

**场景：** 你有一段音频，想把它转成文字。

```bash
# 基本调用
curl -X POST http://127.0.0.1:8766/transcribe \
  -F "audio=@test.wav" \
  -F "language=en"
```

**响应示例：**
```json
{
  "text": "Hello world, how are you today?",
  "durationMs": 2480,
  "segments": [
    {"startMs": 0, "endMs": 1200, "text": "Hello world,"},
    {"startMs": 1200, "endMs": 2480, "text": "how are you today?"}
  ]
}
```

**自动语言检测：**
```bash
curl -X POST http://127.0.0.1:8766/transcribe \
  -F "audio=@chinese_audio.wav" \
  -F "language=auto"
```

**Python 调用示例：**
```python
import requests

response = requests.post(
    "http://127.0.0.1:8766/transcribe",
    files={"audio": open("test.wav", "rb")},
    data={"language": "en"},
)
result = response.json()

print(f"转写结果: {result['text']}")
print(f"时长: {result['durationMs']}ms")
for seg in result["segments"]:
    print(f"  [{seg['startMs']}-{seg['endMs']}ms] {seg['text']}")
```

### 5.3 首次请求注意事项

⚠️ **首次请求会比较慢**，因为需要下载和加载模型：
- 对齐服务：首次请求某语言时下载对齐模型（英文约 100MB）
- 转写服务：首次请求时下载 Whisper 模型（large-v3 约 3GB）

后续请求会很快（模型已缓存）。

如果想启动时就预加载模型（转写服务）：
```bash
./start.sh --server transcribe --preload
```

---

## 6. 配置前端连接

### 6.1 配置文件位置

```
~/.ping-eng/settings.json
```

### 6.2 配置内容

```json
{
  "llm": {
    "provider": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "your-api-key-here",
    "model": "whisper-1",
    "whisperTranscribeUrl": "http://127.0.0.1:8766"
  }
}
```

**关键字段：**

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `whisperTranscribeUrl` | 本地转写服务地址 | `http://127.0.0.1:8766` |

如果服务运行在默认端口（8766），`whisperTranscribeUrl` 字段可以省略。

### 6.3 首次配置

如果配置文件不存在，前端设置页面会引导你创建。也可以手动创建：

```bash
mkdir -p ~/.ping-eng
cat > ~/.ping-eng/settings.json << 'EOF'
{
  "llm": {
    "provider": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "your-api-key-here",
    "whisperTranscribeUrl": "http://127.0.0.1:8766"
  }
}
EOF
```

---

## 7. 完整使用流程

### 7.1 完整流程（从零开始）

```bash
# 第 1 步：进入 server 目录
cd server/

# 第 2 步：启动两个服务
./start.sh --server both

# 第 3 步：（另一个终端）验证服务
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8766/health

# 第 4 步：测试转写
curl -X POST http://127.0.0.1:8766/transcribe \
  -F "audio=@your_audio.wav" \
  -F "language=en"

# 第 5 步：测试对齐
curl -X POST http://127.0.0.1:8765/align \
  -F "audio=@your_audio.wav" \
  -F "text=your transcription text here" \
  -F "language=en"

# 第 6 步：启动前端（另一个终端）
cd ../client/
pnpm dev

# 第 7 步：打开浏览器访问 http://localhost:3000
```

### 7.2 日常使用

```bash
# 启动服务
cd server/ && ./start.sh --server both

# 使用完毕后，Ctrl+C 停止服务
```

### 7.3 工作流说明

```
用户录音
   │
   ▼
前端发送音频到 POST /api/transcribe
   │
   └── Whisper 兼容模式（云端 API）
       │
       └── 音频 → Whisper API → 获取文本 + 段落时间戳

用户录音（本地模式）
   │
   ▼
前端发送音频到 POST /api/transcribe/local
   │
   └── 音频 → 本地 transcribe_server → 获取文本 + 段落时间戳
```

---

## 8. GPU 加速（可选）

### 8.1 前提条件

- NVIDIA 显卡（GTX 1060+ / RTX 系列）
- 已安装 NVIDIA 驱动
- 已安装 CUDA Toolkit（11.7+）

### 8.2 验证 GPU 可用

```bash
nvidia-smi
# 应该显示显卡信息和 CUDA 版本

python3 -c "import torch; print('CUDA:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')"
```

### 8.3 GPU 模式启动

```bash
# 自动检测 GPU（有则用 GPU，无则用 CPU）
./start.sh --server both --device auto

# 强制 GPU 模式
./start.sh --server both --device cuda

# GPU + float16 精度（推荐，速度快）
./start.sh --server both --device cuda --compute-type float16

# GPU + 小模型（显存 ≤4GB）
./start.sh --server transcribe --device cuda --model-size small
```

### 8.4 显存需求参考

| 模型 | 显存需求 | 推荐显卡 |
|------|----------|----------|
| tiny | ~1GB | 任意 NVIDIA |
| base | ~1GB | 任意 NVIDIA |
| small | ~2GB | GTX 1060+ |
| medium | ~3GB | GTX 1080+ |
| large-v3 | ~4GB | RTX 2060+ |

---

## 9. 故障排除

### 9.1 服务启动失败

**问题：`python3: command not found`**
```bash
# 安装 Python
sudo apt install python3 python3-venv python3-pip  # Ubuntu
brew install python@3.12                            # macOS
```

**问题：`pip install` 失败**
```bash
# 升级 pip
pip install --upgrade pip

# 使用国内镜像（如果网络慢）
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

**问题：端口已被占用**
```bash
# 查看占用端口的进程
lsof -i :8765
lsof -i :8766

# 杀掉占用进程
kill -9 <PID>

# 或者使用其他端口
./start.sh --server align --port 9765
./start.sh --server transcribe --port 9766
```

### 9.2 模型下载失败

**问题：HuggingFace 下载超时**
```bash
# 设置镜像（国内用户）
export HF_ENDPOINT=https://hf-mirror.com

# 然后重新启动服务
./start.sh --server transcribe
```

**问题：NLTK 数据下载失败**
```bash
# 手动下载
mkdir -p ~/nltk_data/tokenizers
curl -sL -o /tmp/punkt_tab.zip \
  "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/tokenizers/punkt_tab.zip"
unzip -qo /tmp/punkt_tab.zip -d ~/nltk_data/tokenizers
rm /tmp/punkt_tab.zip
```

### 9.3 运行时错误

**问题：转写结果为空**
- 检查音频文件是否有效（用 `ffplay test.wav` 试听）
- 确认音频有实际语音内容（不是纯静音）
- 尝试 `language=auto` 让服务自动检测语言

**问题：对齐返回错误**
- 确保 `text` 参数不为空
- 确保文本与音频内容匹配
- 检查语言代码是否正确（`en`、`zh` 等）

**问题：CUDA 相关错误**
```bash
# 检查 CUDA 是否可用
python3 -c "import torch; print(torch.cuda.is_available())"

# 如果 CUDA 不可用，使用 CPU 模式
./start.sh --server both --device cpu
```

### 9.4 性能问题

**问题：转写很慢**
- 使用 GPU：`--device cuda`
- 使用小模型：`--model-size small`
- 预加载模型：`--preload`
- 检查是否在用 CPU 跑大模型（会很慢）

**问题：内存不足**
- 使用小模型：`--model-size small` 或 `--model-size base`
- 使用 int8 精度：`--compute-type int8`
- 关闭其他占用内存的程序

### 9.5 前端连接问题

**问题：前端提示"faster-whisper 服务未启动"**
1. 确认服务正在运行：`curl http://127.0.0.1:8766/health`
2. 检查配置文件 `~/.ping-eng/settings.json` 中的 URL 是否正确
3. 确认没有防火墙阻止本地连接

**问题：前端提示"转写超时"**
- 音频文件可能太长，服务处理需要时间
- 检查服务日志是否有错误
- 尝试用更短的音频测试

---

## 快速命令参考

```bash
# ===== 启动 =====
./start.sh                                  # 对齐服务（默认）
./start.sh --server transcribe              # 转写服务
./start.sh --server both                    # 两个都启动
./start.sh --server both --device auto      # 自动检测 GPU

# ===== 验证 =====
curl http://127.0.0.1:8765/health           # 对齐服务健康检查
curl http://127.0.0.1:8766/health           # 转写服务健康检查
curl http://127.0.0.1:8765/models           # 查看支持的对齐模型

# ===== 测试 =====
curl -X POST http://127.0.0.1:8766/transcribe -F "audio=@test.wav" -F "language=en"
curl -X POST http://127.0.0.1:8765/align -F "audio=@test.wav" -F "text=Hello world" -F "language=en"

# ===== 停止 =====
pkill -f align_server.py
pkill -f transcribe_server.py
```
