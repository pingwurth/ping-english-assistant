# ping-english-assistant

英语精听/跟读训练助手：**PC Web / 移动 H5 / 微信小程序** 三端一套代码（uni-app + Vue 3），配 Fastify 无状态后端（ASR / SOE / LLM / Kokoro-82M TTS 统一出口）。

设计文档见 [docs/](docs/)：技术选型报告 · 原型设计（P0-P11）· 系统架构设计。

## 目录结构

```
├── client/   # uni-app 前端（三端产物）
│   ├── src/core/       # 平台无关纯 TS：字幕解析 / SentencePlayer / 训练引擎（node 直接单测）
│   ├── src/platform/   # 条件编译适配层：player / recorder / saver / storage
│   ├── src/pages/      # P0-P11 页面（材料库 / 导入 / 播放器 / 训练 / TTS / 设置）
│   ├── src/stores/     # Pinia（material / player / training / settings）
│   └── tests/          # core 层 vitest 单测（39 例）
└── server/   # Fastify 后端（密钥保管 / 代理 / Prompt 管理 / Kokoro TTS 本地推理）
    └── src/routes/     # asr / soe / tts / reports(SSE) / explain
```

## 快速开始

### 前端

```bash
cd client
npm install
npm run test            # core 层单测（字幕解析 / 训练引擎 / SentencePlayer）
npm run dev:h5          # H5 开发（PC Web / 移动 H5 同一产物）
npm run dev:mp-weixin   # 微信小程序开发（dist/dev/mp-weixin 导入微信开发者工具）
npm run typecheck       # vue-tsc 类型检查
```

### 后端

```bash
cd server
npm install
cp .env.example .env    # 填入 OPENAI_API_KEY / TENCENT_SOE_SECRET_* 等密钥
npm run dev             # tsx watch 启动（默认 :3000）
npm run typecheck       # tsc 类型检查
```

Kokoro-82M 模型（ONNX q8，约 90MB）首次启动时自动下载到 `KOKORO_MODEL_CACHE_DIR` 并常驻内存预热。

### Docker 部署后端

```bash
cd server
docker build -t ping-english-assistant-server .
docker run -p 3000:3000 --env-file .env ping-english-assistant-server
```

## 关键架构决策（详见 docs/系统架构设计.md）

- **ADR-1** PlayerController / RecorderController / FileSaver / Storage 全部抽象为 TS 接口 + 条件编译三端实现
- **ADR-2** 自研 SRT/LRC 双语字幕解析器（零依赖纯 TS，含行号容错报错）
- **ADR-4** 本地优先：材料/进度/收藏/训练记录全部端内存储，后端无状态无库
- **ADR-7** TTS 后端本地推理 Kokoro-82M，分句合成天然获得精确句级时间轴
