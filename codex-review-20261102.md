# 全量代码评审报告（2026-11-02）

## 1. 评审范围与方法

- 评审对象：工作区当前 `main`，HEAD `3e0a13f1571e2be09754975af95baf751ccca4ca`。
- 应用代码范围：
  - `client/`：150 个 TS/TSX/配置源码文件；
  - `server/`：28 个 TS/Python/Shell 源码文件；
  - `page-prototype/`：15 个 TS/TSX/配置源码文件；
  - 合计约 25,109 行应用源码。
- 评审方式：
  - 先用 CodeGraph 建图和识别热点，再人工审查 BFF、LLM/ASR/TTS 链路、IndexedDB/备份/播放器/训练流、Fastify SOE 代理、Python 转写/对齐服务；
  - 对安全敏感路径做了模式扫描与关键请求路径验证；
  - 执行现有单测、构建、TypeScript 检查和 Python 语法编译。
- 未纳入运行时实现审查：`.claude/`、`.qoder/` 中随仓库携带的代理/技能工具代码与生成的 repowiki；这些不是本应用运行时代码。`page-prototype/` 按项目约定仅作为独立设计沙箱审查。

## 2. 总体结论

代码分层清晰，`core/` 的字幕解析、训练状态机、音频编码和备份格式有较好的单测覆盖；Fastify SOE 代理的错误 envelope、multipart 顺序、provider mapper 也基本遵守了架构约定。

但当前存在 **2 个 P1 安全/资源风险**、**9 个 P2 功能或数据一致性问题**、**3 个 P3 维护性问题**。最需要优先处理的是：BFF 变更/计费接口缺少跨站请求防护，以及 HuggingFace 代理允许下载并缓存任意仓库文件。

## 3. 问题清单

### P1-1 BFF 的非 GET 接口缺少 Origin/CSRF 防护

- 位置：`client/app/api/settings/llm/route.ts:52`、`client/app/api/settings/llm-configs/route.ts:64`、`client/app/api/tts/route.ts:23`、`client/app/api/transcribe/route.ts:180`、`client/app/api/mnemonic/route.ts:44` 等。
- 问题：这些 Route Handler 会修改 `~/.ping-eng/settings.json` 或触发付费上游调用，但没有统一校验请求来源。由于服务端使用 `request.json()`，即使请求以简单请求的 `Content-Type: text/plain` 发送，JSON 仍会被解析；本地实测带 `Origin: https://example.com` 的跨站 POST 能进入业务校验。CORS 只能阻止读取响应，不能阻止浏览器发出 simple request。
- 影响：恶意页面或局域网页面可在用户不知情时覆盖 LLM 配置、重复触发 TTS/ASR/助记/SOE 请求，造成配置破坏、费用消耗或本地服务资源占用。项目明确支持局域网 H5（`AGENTS.md:126`），因此不能把它视为仅 localhost 应用。
- 建议：为所有非 GET BFF 路由增加统一 Origin/Host 校验或 CSRF token；允许同源与配置的局域网来源，拒绝其他 Origin。不要依赖 `Content-Type: application/json` 或 CORS 响应头作为请求防护。

### P1-2 HuggingFace 代理可下载并持久化任意仓库文件

- 位置：`client/app/api/hf/[...path]/route.ts:35-56`、`client/app/api/hf/[...path]/route.ts:112-139`。
- 问题：`parseHfPath()` 接受任意 `{org}/{repo}`，`localFileOf()` 直接把路径拼到 `kokoro.modelPath` 下，GET 未命中即从 HuggingFace 下载并写入磁盘；没有校验请求 repo 是否等于当前配置的 `modelId`，也没有文件 allowlist、大小上限或缓存根路径 containment 检查。
- 影响：任何能访问该 BFF 的请求者都可以让 Node 进程拉取并持久化任意 HF 仓库对象，可污染模型缓存、填满 `~/.ping-eng` 磁盘，也让 `modelPath`/路径拼接成为高风险输入面。
- 建议：读取配置后只允许配置的 `modelId`；限制为 Kokoro 实际需要的文件（模型、tokenizer/config、已配置音色）；对请求路径解码后拒绝 `.`/`..`/反斜杠等路径片段，并用 `path.resolve + relative` 确认落盘路径仍在缓存根内；增加大小上限并采用临时文件 + rename。

### P2-1 「本地服务配置」保存后不会被转写/对齐链路使用

- 位置：`client/components/pages/settings.tsx:153-180` 写入 `localServices`；`client/app/api/transcribe/local/route.ts:15-22` 读取 `llm.whisperTranscribeUrl`；`client/app/api/transcribe/route.ts:190-215` 读取 `llm.whisperAlignUrl`。
- 影响：设置页显示“已保存”，但自定义 faster-whisper / WhisperX 地址不会生效，仍访问默认地址或旧的单配置字段；服务换端口或地址时用户会得到错误连接目标。
- 建议：抽一个统一的本地服务解析函数，优先读取 `readLocalServices()`，必要时仅将 legacy `llm.*` 作为迁移 fallback；两条转写路径共用该函数。

### P2-2 未知 provider 的 ASR/TTS fallback 行为违反架构约定且互相不一致

- 位置：
  - `client/lib/llm/tts-service.ts:37-47`：未知 provider 回退 DashScope 原生接口；
  - `client/lib/llm/asr-service.ts:34-44`：未知 provider 回退 MiMo/OpenAI-compatible；
  - `client/lib/llm/asr-service.ts:55-61`：未知 provider 被标为 `standard`。
- 规则依据：`AGENTS.md:90` 明确“unknown providers fall back to OpenAI-compatible”。
- 影响：
  - 未知 provider 的 TTS 会走 DashScope 原生 API，通常直接失败；
  - 未知 provider 的 ASR 实际由 MiMo 路径返回纯文本（无 segments），但路由认为它是 standard，不进入 WhisperX 对齐，最终得到 `segments: []`、`durationMs: 0`。
- 建议：TTS 未知 provider 改走 OpenAI-compatible 实现；ASR 的 provider 类型判定与实际 dispatcher 保持同一矩阵，未知 provider 若复用 MiMo 则应进入 multimodal/对齐路径，或实现真正 standard ASR endpoint。

### P2-3 获取模型列表会覆盖全局默认 LLM 配置

- 位置：`client/components/shared/model-config-list-dialog.tsx:221-244`、`client/app/api/models/route.ts:16-55`。
- 问题：为了取模型列表，前端先把弹窗中尚未保存的 `provider/baseUrl/apiKey` POST 到 `/api/settings/llm`，再 GET `/api/models`。该 legacy `llm` 配置被 `readEffectiveLlmSettings()` 优先使用，且第一次 POST 的响应没有检查。
- 影响：编辑一个非默认配置或试探一个新配置时，会悄悄替换当前默认配置；若临时保存失败，还会拿旧配置的模型列表误导用户。
- 建议：把 `/api/models` 改为无副作用的 POST（或 GET 支持查询已保存 `configId`），请求体携带临时连接信息；前端检查保存/探测每一步的响应，不再用持久化设置当临时状态。

### P2-4 删除字幕后收藏、进度与材料句数没有跟随 index 重排

- 位置：`client/components/pages/player.tsx:416-438`、`client/stores/note-store.ts:61-70`。
- 问题：删句后句子 `index` 被重排，笔记专门平移，但 `fav:{materialId}:{index}`、`progress.playedSentenceIndexes` 没有 remap，`material.subtitle.sentenceCount` 也没有更新。
- 影响：后续句子的收藏指向错误文本；收藏训练范围和进度百分比失真；材料库/存储管理仍显示旧句数。`AGENTS.md:124` 特别强调 records store 的 key 前缀和精确删除风险，这类索引级联需要同等谨慎。
- 建议：将收藏、进度、训练记录中依赖句序的数据与笔记一起平移；被删句记录按策略删除；同步 `sentenceCount`。最好封装成 `shiftSentenceIndexesAfterDeletion(materialId, deletedIndex)` 并补浏览器存储层测试。

### P2-5 修改英文文本后 `words` 缓存保持旧值

- 位置：`client/components/pages/player.tsx:440-456`；`client/components/shared/translate-drawer.tsx:170-179`。
- 问题：单句纠错直接替换 `textEn` 但保留 `updated.words`；批量 `zh2en` 翻译也只替换 `textEn`，不重算 `words`。`mergeBilingualSrt()` 在类似场景已经调用 `splitWords()`，说明该字段是训练用派生数据。
- 影响：九宫格选词、听写目标词、生词频率匹配继续使用旧英文句子，训练结果与播放器展示不一致。
- 建议：在任何 `textEn` 变更处统一执行 `words: splitWords(newTextEn)`；更稳妥的做法是提供 `updateEnglishText(sentence, text)` 单一 helper。

### P2-6 删除句子时笔记平移的并发写法可能丢失笔记

- 位置：`client/stores/note-store.ts:61-70`。
- 问题：`shiftNotesAfterDeletion()` 在同一个 `Promise.all()` 中删除旧 key 并写入新 key。每个操作都是独立 IndexedDB transaction；连续序号平移时，某个新 key 会与另一个旧 key 相同（例如 1、2 都右移），delete 与 put 的提交顺序不确定。
- 影响：若 delete 后提交，刚平移的笔记会被删除；这是本地数据丢失问题。
- 建议：先完成旧 key 删除，再按目标 key 从高到低写入；或扩展 IDB wrapper 支持单事务多操作。为连续序号平移增加回归测试。

### P2-7 导入失败回滚会留下无媒体的材料元数据

- 位置：`client/components/pages/import.tsx:241-268`。
- 问题：成功写入 `putMaterialRecord(record)` 后，`updateFrequencies()`、`consumeTtsExport()` 或 `consumeTranscribeExport()` 失败会进入 catch；catch 只删除 blob 和新建 collection，不删除已写入的 material record。
- 影响：材料列表出现指向不存在媒体的孤儿材料，后续打开播放器必然加载失败。
- 建议：记录 `materialWritten` 阶段并在 catch 中删除 material record（可复用 `removeMaterial` 或精确删除 material key）；所有临时导出清理失败不应导致已成功导入的材料被判定为失败。

### P2-8 首次新增 ASR 配置后的自动重试会再次打开配置弹窗

- 位置：`client/components/shared/transcribe-shared.tsx:293-301`，配合 `client/components/shared/model-config-list-dialog.tsx:981-984`。
- 问题：初始 `asrConfigs` 为空时，用户保存第一个配置后，`onConfigsChanged` 异步刷新尚未完成，`onSaved` 立即用旧闭包调用 `start(file)`；`start` 仍看到 `asrConfigs.length === 0`，于是再次 `setShowModelConfig(true)`。
- 影响：用户保存成功后不是继续转写，而是配置弹窗再次弹出；随后即使配置加载完成也不会自动恢复任务。
- 建议：让保存回调等待配置刷新完成后再重试，或让保存流程直接返回新配置 id 并临时传入 `start(file, newConfigId)`。

### P2-9 播放进度只写入不恢复

- 位置：`client/components/pages/player.tsx:158-161`、`client/components/pages/player.tsx:254-270`。
- 问题：代码每次都持久化 `lastPositionMs`，注释写“恢复上次播放位置”，但加载 progress 时只恢复 `playedSentenceIndexes`，播放器 load 完成后只处理 `?s=N`，没有 seek 到 `progress.lastPositionMs`。
- 影响：用户重新打开材料总是从头开始，已保存的进度字段成为死数据。
- 建议：读取 progress 后保存目标位置；`controller.load()` 成功后若没有 `?s=N` 跳转，则 seek 到 `lastPositionMs` 并初始化进度条。

### P3-1 SSE 解析器不能跨 chunk 保留 event name

- 位置：`client/services/mock/mnemonic.ts:72-97`。
- 问题：`currentEvent` 在每次 `reader.read()` 后重新初始化。HTTP reader 允许在 `event: xxx` 与对应 `data: ...` 之间切分，此时 data 会以空事件名 yield。
- 影响：前端流式助记卡依赖 event name 区分 `field/done/error`，网络分包边界不同可能导致 UI 不更新或错误分类。
- 建议：将 `currentEvent` 提升到循环外；按空行组装完整 SSE event，再统一解析 event/data。

### P3-2 本地服务 endpoint 路径散落硬编码，违反项目唯一出口约定

- 位置：`client/app/api/transcribe/local/route.ts:45,101`、`client/app/api/transcribe/route.ts:42,214`、`client/app/api/soe/health/route.ts:15`。
- 规则依据：`AGENTS.md:89-91` 要求 `lib/service-endpoints.ts` 是 endpoint path / default URL 的唯一维护位置。
- 影响：本地服务路由调整时需要多处同步修改，也容易出现 P2-1 这类“配置来源不一致”问题。
- 建议：在 `service-endpoints.ts` 增加 align/transcribe/healthz/SOE evaluate 的 endpoint 常量，并统一通过 `buildServiceUrl()` 拼接。

### P3-3 训练记录的 scope 恒为全文

- 位置：`client/components/pages/puzzle.tsx:115-124`、`client/components/pages/dictation.tsx:99-112`、`client/components/pages/training/read-aloud.tsx:176-190`。
- 问题：会话实际用 `scope` 创建（可能是收藏句范围），但写入 `TrainingRecord.scope` 时全部硬编码 `{ type: 'all' }`。
- 影响：历史数据无法区分全文训练与收藏句训练，后续报表、薄弱句统计或训练记录回放会得出错误口径。
- 建议：直接记录当前 `scope`；如果历史记录确实要保留旧口径，也应在 schema/version 中显式说明。

## 4. 验证结果

在当前 HEAD 执行：

```bash
# client/
pnpm test                 # 12 个测试文件、167 个测试全部通过
npx tsc --noEmit          # 通过
pnpm build                # 通过（Next.js 16.3.0）

# server/
pnpm test                 # 8 个测试文件、51 个测试全部通过
npx tsc --noEmit          # 通过

# server Python
python3 -m compileall -q server
python3 -m py_compile server/*.py   # 通过

# page-prototype/
pnpm install
pnpm build                # 通过
npx tsc --noEmit          # 通过
```

补充：

- 依赖漏洞审计未完成：当前 npm registry 指向 `registry.npmmirror.com`，该镜像没有 pnpm audit endpoint；强制切到 `registry.npmjs.org` 后又因 `ECONNRESET` 失败。这不代表无漏洞，仅表示本次环境无法取得审计结果。
- 本机 shell 没有全局 `pnpm`，测试/构建通过 `npm exec pnpm@10.17.1 --` 执行。

## 5. 覆盖说明与后续建议

- 相对现有测试，最缺的是浏览器存储层和页面级集成测试。建议优先补：
  1. 删除句子后收藏/进度/笔记/句数一致性；
  2. `textEn` 修改后的 `words` 重算；
  3. 本地服务配置 → BFF 转发 URL；
  4. 未知 provider 的 ASR/TTS fallback；
  5. BFF 非 GET Origin 防护；
  6. HF 代理 repo/file allowlist 与路径 containment。
- Python 服务当前缺少 HTTP 层测试；建议至少覆盖上传为空、非法 language、模型加载失败和临时文件清理。
- `page-prototype/` 构建和类型检查通过，且项目文档明确它是无测试设计沙箱，本次未发现需要阻塞应用主流程的问题。

## 6. 修复记录（2026-11-02）

以上 14 项评审问题已全部处理：

1. **BFF Origin/CSRF**：新增 `client/proxy.ts`，对所有 `/api/*` 非 GET/HEAD/OPTIONS 请求校验 Origin；实测跨站 `text/plain` POST 返回 403，无 Origin 的本机调用仍可达业务校验。
2. **HF 代理收敛**：只允许 `settings.kokoro.modelId`、`main` revision、Kokoro 必需模型文件与内置音色；保留路径 containment、原子缓存与并发去重，并增加 128 MiB 文件上限。实测任意 repo、非 allowlist 文件均 403。
3. **本地服务配置**：faster-whisper 与 WhisperX 均优先读取 `localServices`，legacy `llm.*` 仅作 fallback；端点路径统一由 `service-endpoints.ts` 提供。
4. **Provider fallback**：未知 TTS provider 回退 MiMo/OpenAI-compatible；未知 ASR provider 分类为 multimodal，与 MiMo 纯文本 fallback 保持一致并触发 WhisperX 对齐。
5. **模型列表探测**：`/api/models` 支持无副作用 POST，配置弹窗不再先覆盖全局设置。
6. **删句一致性**：句子数、收藏、进度、笔记、Dictation 训练记录、生词来源索引与词频全部随删除重排；受影响 key 先删后写，避免独立 IDB 事务乱序丢数据。
7. **英文变更派生词**：单句纠错、批量 `zh2en` 翻译都会重算 `words`。
8. **导入回滚**：导入后置失败会回滚完整 material/blob/collection；临时产物清理失败不再误判导入失败。
9. **首次 ASR 配置自动重试**：转写显式使用刷新后的默认 ASR 配置 ID，不再重复弹配置框。
10. **播放位置恢复**：媒体 metadata 就绪后恢复 `lastPositionMs`；`?s=N` 收藏句跳转仍优先，无效 `s` 也会释放恢复流程。
11. **SSE 分帧**：事件名跨 network chunk 保留，按 event/data 与空行分帧。
12. **训练 scope**：Puzzle/Dictation/ReadAloud 记录实际全文/收藏句范围。
13. **endpoint 统一**：Whisper align/transcribe/health、SOE evaluate/health、OpenAI models endpoint 全部移入 `service-endpoints.ts`。
14. **Next 16 约定**：请求入口使用新版 `proxy.ts` 而非已弃用的 `middleware.ts`。

修复后验证：

```bash
# client
npx tsc --noEmit                 # 通过
pnpm test                        # 12 个测试文件、159 个测试全部通过
pnpm build                       # 通过

# server
pnpm test                        # 8 个测试文件、51 个测试全部通过
npx tsc --noEmit                 # 通过

# page-prototype
npx tsc --noEmit                 # 通过
pnpm build                       # 通过

# Python
python3 -m compileall -q server  # 通过
python3 -m py_compile server/*.py # 通过
```

手动安全验证：

- `POST /api/settings/llm` + `Origin: https://example.com` + `Content-Type: text/plain` → 403；
- 同请求无 Origin → 进入业务参数校验（400）；
- 已配置 Kokoro repo 的 allowlist 文件 HEAD → 200；
- 任意其他 HF repo HEAD → 403；
- 已配置 repo 的非 allowlist 文件 HEAD → 403。
