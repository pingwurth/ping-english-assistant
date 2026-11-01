---
kind: external_dependency
name: Kokoro TTS 本地语音合成
slug: kokoro-js
category: external_dependency
category_hints:
    - vendor_identity
    - framework_behavior
scope:
    - '**'
source_files:
    - client/platform/kokoro-tts.ts
    - client/platform/kokoro-worker.ts
    - client/platform/kokoro-protocol.ts
    - client/package.json
---

### 身份与角色
- Kokoro 是一个可在浏览器端运行的 TTS 引擎，通过 npm 包 `kokoro-js` 引入，项目内封装了 Worker 通信与自定义二进制协议。

### 集成点
- 主线程：`client/platform/kokoro-tts.ts` 暴露 TTS 接口。
- Worker：`client/platform/kokoro-worker.ts` 加载模型并在 Web Worker 中执行。
- 协议：`client/platform/kokoro-protocol.ts` 定义与 Worker 之间的消息格式。

### 行为约束
- 首次加载需拉取模型权重，后续受浏览器缓存影响；音频输出为 PCM/WAV 流，供播放器消费。