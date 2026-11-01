# AI服务层与BFF设计

> 覆盖 `client/services/`、`client/lib/llm/`、`client/app/api/*`、`client/lib/service-endpoints.ts`、`client/lib/server-settings.ts`。

## 1. 契约编号是全局语言

代码注释里的「契约②⑤⑥⑦⑧」直接引用 `docs/系统架构设计.md` §3.3 的 API 编号，跨层沟通都用它：

| 编号 | 端点 | 用途 | 当前落地 |
|------|------|------|----------|
| ① | `/asr/transcribe` | 录音转写 | **服务接口已移除**，改走 BFF `/api/transcribe*` |
| ② | `/soe/evaluate` | 发音评分 | BFF `/api/soe/evaluate` → Fastify 代理 → 供应商 |
| ③④ | `/reports/*` | 跟读/背诵 SSE 报告 | **已移除**，改由 BFF 直连 LLM + 页内呈现 |
| ⑤ | `/llm/explain` | 单词/句子讲解（SSE） | 类型保留（`types/api.ts`），V1.3 预置 |
| ⑥⑦ | `/tts/generate` `/tts/subtitle/:taskId` | 文字转语音 + 取字幕 | `TtsService` 契约 + mock；实际由前端 Kokoro / Qwen TTS 出音 |
| ⑧ | 架构侧指 TTS 相关；代码中 `types/api.ts` 把 **契约⑧ 用作 `/api/translate` 批量翻译（BFF）** | — | 注意与架构文档编号语义并不完全一致，以 `types/api.ts` 回链注释为准 |

改契约前先读 `services/contracts.ts` 与 `types/api.ts` 的文件头注释——两者都写明了哪些编号已废弃、为什么废弃。

## 2. 三层结构：contracts → mock → api(BFF)

- `services/contracts.ts` 是接口真源：`SoeService`、`TtsService`、`MnemonicService`，聚合为 `AppServices`。全部方法接受可选 `AbortSignal`，失败统一抛 `ApiError`（`code/message/detail?`，与 §3.3 统一错误格式同形）。
- `services/mock/*` 是确定性离线实现（零网络，可演示）；`services/api/*` 是走同源 BFF 的真实实现，目前只有 `soe.ts` 完成。
- `services/index.ts` 的 `getServices()` **当前恒返回 mock**，`NEXT_PUBLIC_SERVICE_MODE` 只在注释里预留。因此页面上看到的评分/助记默认来自 mock 或 BFF 直连，而不是 `AppServices` 切换——排查"为什么没打到真实服务"时先看这里。
- SSE 用 `AsyncGenerator<SseEvent>` 表达，事件序固定 `status → token → result → done`，错误走 `error` 事件后终止。

## 3. BFF：密钥不进浏览器

`client/app/api/` 下 15 条 Route Handler 是本项目的服务端：

```
settings/llm · settings/llm-configs · settings/soe · settings/kokoro · settings/local-services
soe/evaluate · soe/health · transcribe · transcribe/local · tts · translate · mnemonic · models · hf/[...path]
```

它们共同承担三件事：**读本机配置文件 → 注入密钥 → 转发上游并把状态码/JSON 原样回传**。

`/api/soe/evaluate` 是典型样板：
1. `readSoeConfig()` 取 provider 与 `proxyUrl`；`provider === 'mock'` 直接 400（演示模式无需代理）。
2. 把该 provider 的密钥段清洗成 `creds` JSON 字段，连同 `provider` 一起追加进 multipart。
3. **文本字段必须排在 `audio` 之前**——`@fastify/multipart` 的 `req.file()` 只保证文件之前的字段可见。这是真实踩坑点。
4. 上游不可达 → `502 { code: 'SOE_UPSTREAM_ERROR' }`。

`/api/mnemonic` 用 `{ action: 'card'|'card_stream'|'association'|'exercises'|'evaluate', word, context?, ... }` 单端点多动作，模型优先级 `mnemonicModel > translateModel`，未配置返回 `400 SETTINGS_NOT_CONFIGURED`，`LlmError.code` 映射到 HTTP 状态（缺失类 400、上游类 502、超时 504、客户端取消 499），并用 `X-Mnemonic-*` 响应头回传分段耗时。

## 4. 服务端配置存储：`~/.ping-eng/settings.json`

`lib/server-settings.ts` 用 `fs/promises` 直接读写用户主目录下的 JSON 文件，**没有数据库**。文件里的 section：

- `llm`（legacy 单配置）与 `llmConfigs[] + defaultLlmConfigId`（多模型配置）。读取顺序由 `readEffectiveLlmSettings()` 保证：legacy 优先，其次默认配置；首次访问时 legacy 会自动迁移成一条 `llmConfigs`，且设为默认时双向同步。
- `localServices`（WhisperX / faster-whisper 地址）、`kokoro`（模型 ID + 本地模型目录）、`soe`（provider / proxyUrl / 三家密钥段）。

对外 API 的取舍：列表接口对 `apiKey` 做 `slice(0,8) + '***'` 脱敏，但 **`?id=` 单条查询返回明文密钥（仅限本机请求）**——这是有意为之的本地优先设计，别当成漏洞去掉。

## 5. LLM 接入层（`lib/llm/`）

- `factory.ts` 统一用 LangChain `ChatOpenAI` 构造模型：mimo 本身 OpenAI-compatible，DashScope 的 chat completions 也兼容；只有 DashScope 原生 ASR/TTS 走各自 provider 封装。DashScope 流式需额外 `X-DashScope-SSE: enable` 头；`basePath` 要剥掉 `/chat/completions` 后缀（ChatOpenAI 内部会拼）。超时 120s、`maxRetries: 1`。
- 缺配置抛 `LlmError`：`API_KEY_MISSING` / `BASE_URL_MISSING` / `MODEL_NOT_CONFIGURED`。
- `asr-service.ts` 按 provider 分发 `dashscope-asr` / `mimo-asr`；`getAsrProviderType()` 返回 `'multimodal' | 'standard'`——multimodal 模型不保证词级时间戳，需要 WhisperX 强制对齐补齐，standard 已自带。
- 依赖里同时存在 `ai`/`@ai-sdk/openai` 与 `@langchain/*`，**实际走的是 LangChain**（见 `factory.ts` / `chat-service.ts` / `mnemonic-service.ts`）。

## 6. 端点常量集中在 `lib/service-endpoints.ts`

设计原则写在文件头：**代码中不得硬编码 baseUrl 或 endpoint 路径**。

- `PROVIDER_ENDPOINTS` 按 provider（`dashscope`/`qwen`/`mimo`/`local`）× service（`tts`/`asr`/`translate`/`mnemonic`）给出默认路径；DashScope 的 TTS 是 `/services/audio/tts/SpeechSynthesizer`、ASR 是 `/services/aigc/multimodal-generation/generation`，其余走 `/chat/completions`。
- 默认模型：TTS `qwen-audio-3.0-tts-flash`，ASR `qwen-audio-3.0-asr-flash` / `mimo-v2.5-asr`，翻译与助记 `qwen-turbo` / `mimo-v2.5`。
- 默认地址常量：对齐 `:8765`、转写 `:8766`、本地模型 `:11434`、SOE 代理 `:8788`。
- 新增 provider 时只改这一个文件，调用侧统一用 `resolveServiceUrl(baseUrl, endpoint, provider, service)`。
