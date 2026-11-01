# 全量代码评审报告 — claude-review-20261102

> **修复记录（2026-11-02 同日）**：61 条发现中 **50 条已修复**（A1–A4、B1–B9、C1–C18、D1–D5 全部；E 节 12 项：死代码 5/5、重复 #4/#5/#6、性能 #5/#7、层次 #2、规范 #1）。剩余 11 项为规划级重构（E-重复 #1/#2/#3/#7/#8、E-性能 #1/#2/#3/#4/#6、E-层次 #1），见 G 节第 5 档。
> 验证基线：client `tsc --noEmit` 0 错 + vitest 157/157（较基线少的 10 例为删除 tiles 死代码对应的测试）；server `tsc --noEmit` 0 错 + vitest 51/51（含按官方规范重写的 iflytek-auth golden 向量）；`next build` 通过；`align_server.py` 语法检查通过。

- **日期**: 2026-11-02
- **范围**: 全量产品代码（`client/` 全部 + `server/src` SOE 代理 + `server/*.py` + `start.sh`），排除 `node_modules`、`.venv`、`.next`、`page-prototype/`、`docs/`、`client/debug/`
- **方法**: max effort —— 10 个独立发现角度（5 正确性 + 复用/精简/性能/层次/规范）× 每角度 ≤8 候选 → 去重后逐条 1 票 3 态验证（CONFIRMED / PLAUSIBLE / REFUTED）→ 补漏扫描（sweep）→ 全量报告
- **基线**: `pnpm test` client 167/167、server 51/51 全过；双端 `tsc --noEmit` 0 错误。所有问题均为测试未覆盖的运行时/逻辑缺陷
- **候选统计**: 74 个原始候选 → 去重 ~50 → 58 项独立验证 → **61 条最终发现**（33 条正确性 CONFIRMED、5 条 PLAUSIBLE、23 条清理项全部 CONFIRMED；5 条候选被验证排除，见 F 节）

图例：🔴 P0 安全/数据丢失 · 🟠 P1 功能不可用 · 🟡 P2 数据错乱/体验 · ⚪ P3 清理改进

---

## A. P0 — 安全与数据丢失

### A1. settings.json 非原子写 + 损坏静默吞掉 + 首读回写 → 全部密钥被永久清空
`client/lib/server-settings.ts:69` — **CONFIRMED**
`writeRaw` 用裸 `writeFile`（无 tmp+rename），进程崩溃/断电即截断文件；`readRaw` 解析失败时静默返回 `{}`（61-63 行，仅 console.error），把"损坏"伪装成"空"；`readKokoroSettings`（285-288 行）在每次应用挂载（study-app.tsx:30 拉 `/api/settings/kokoro`）发现 kokoro 段缺失时执行 `raw.kokoro = defaults; writeRaw(raw)` —— 截断后的下一次启动会把 `{kokoro: 默认值}` 持久化，**llm / llmConfigs / soe / localServices 全部密钥与模型配置被永久抹掉**。另外 8 个 mutator 全是无锁的跨 await 读-改-写，两个并发请求（kokoro GET 回写 vs llm-configs POST；两标签页同时保存）交错后写者覆盖前写者整段。
**修复**: tmp 文件 + `rename` 原子替换；`readRaw` 解析失败时把损坏文件改名备份并报错而非返回 `{}`；mutator 串行化（模块级 promise 队列）。

### A2. HF 代理路径穿越 → 任意本地文件读取（含全部密钥）
`client/app/api/hf/[...path]/route.ts:56` — **CONFIRMED**
`parseHfPath` 只判空（44 行），不拒绝 `..`；Next.js 会把 `%2e%2e` 解码后送进 catch-all，`join(modelPath, ref.cacheKey, ref.file)` 归一化点段后逃逸。实测路径：`GET /api/hf/a/b/resolve/main/%2e%2e/%2e%2e/settings.json` → `~/.ping-eng/settings.json`，其中含 `soe.tencent.secretKey` / `azure.key` / `llm.apiKey`。GET 分支（98 行）直接流式返回，HEAD（68 行）是文件存在性探针。`next.config.mjs` 配了 `allowedDevOrigins: 192.168.110.*`（手机局域网访问），暴露面真实存在。
**修复**: `parseHfPath` 拒绝任何 `.`/`..`/绝对段；磁盘分支再校验 `resolve(localFile).startsWith(modelPath)`。

### A3. IndexedDB 一次瞬时错误 → 永久降级内存 → 之后所有写入静默丢失
`client/platform/storage/idb.ts:76` — **CONFIRMED**
`guarded()` 捕获任意一次事务失败即置模块级 `useMemory = true`（75-76 行），`onblocked` 同样（43 行）；`useMemory` 只会被置 true，无任何重置/重试路径，一个标志管辖全部三个 store。触发很日常：大媒体 blob `put` 撞 `QuotaExceededError`、事务 abort、另一标签页持旧版本连接。切换后：已有 IDB 数据"消失"（读到空 Map）、后续所有材料/进度/笔记写入只进内存、刷新全丢，全程无错误提示。
**修复**: 单 store 单操作失败只降级该次（重试或抛出）；只有 `open` 彻底不可用才切内存，并给 UI 提示；`onblocked` 走等待而非永久降级。

### A4. GET /api/settings/llm-configs?id= 明文返回 API Key，无"仅限本地" enforcement
`client/app/api/settings/llm-configs/route.ts:49` — **CONFIRMED**
`?id=` 分支 `return NextResponse.json(config)` 全量返回明文 apiKey；43 行注释宣称"仅限本地请求"但无任何 origin/host/remote-addr 检查（全仓无 middleware.ts）。列表分支已做 `slice(0,8)+'***'` 掩码，说明意图存在但详情分支漏了。`soe/route.ts` GET 同样原样返回密钥。LAN 访问是本仓明确支持的用法。
**修复**: 详情分支同样掩码（编辑场景回填仅显示尾 4 位）；或至少校验 `host` 为 localhost/内网时才返回全量。

---

## B. P1 — 功能不可用（确认）

### B1. iFlytek 鉴权三处偏离官方规范 → 该 provider 永远 401
`server/src/services/soe/iflytek-auth.ts:30` — **CONFIRMED**
① 签名 `digest('hex')`，规范要求 **Base64**(HMAC-SHA256)（注释 22 行与测试 18 行 `[0-9a-f]{64}` 把错误实现自我钉死）；② query 里的 authorization 应为 `encodeURIComponent(Base64(authorizationOrigin))`，现传的是原始串直接 percent-encode（测试 41 行断言 `api_key%3D%22` 再次钉死错误）；③ 签名原文请求行 `GET ${path}` 缺 ` HTTP/1.1`。服务端重算永不匹配，`SOE_PROVIDER=iflytek` 每次请求 502。
**修复**: 按官方 WebAPI 文档改为 Base64 签名 + Base64 authorization + 完整请求行，重写 golden 测试。

### B2. iFlytek 按实时节奏发帧 + 10s 总超时 → >10s 录音必然 504
`server/src/services/soe/iflytek.provider.ts:208` — **CONFIRMED**
每 1280B 帧睡 40ms（恰好等于该帧音频时长，无追赶逻辑），而 `AbortSignal.timeout(SOE_TIMEOUT_MS=10_000)` 在 `new WebSocket` 之前创建、覆盖握手+上传+等结果全程。15s WAV = 375 帧 ≈ 14.96s 发送 > 10s 预算 → 必然 `UPSTREAM_TIMEOUT`，`isRetryable` 再来一次 → 约 20s 后 504。客户端录音上限 60s（recorder.ts:78）。唯一逃生门是手工设 `IFLYTEK_FRAME_INTERVAL_MS=0`。
**修复**: 超时只包"握手+首帧后等结果"，或上传阶段用独立的大超时/无帧间隔突发模式。

### B3. Kokoro worker 换 modelId / 出错后被终止 → 重建的 worker 永远收不到 init → 本地 TTS 全挂直到刷新
`client/platform/kokoro-tts.ts:193` — **CONFIRMED**
`setKokoroModelId`（141-143 行）`worker?.terminate(); worker = null` 但不排队 init；全仓唯一发 `init` 的是 `ensureModelLoaded()`，其唯一调用者 `preloadKokoroModel()` 只在挂载时跑一次（study-app.tsx:36）。`generateKokoroTts` 走 `ensureWorker()` 后直接 post `generate`；新 worker `modelId=''`（kokoro-worker.ts:53）→ 请求 `/api/hf//resolve/main/...` → 代理 400 "Invalid HF path"。设置页保存任意 Kokoro 模型 ID（model-config-list-dialog.tsx:573）或 worker 任意 `error` 事件即触发。
**修复**: `ensureWorker()` 创建 worker 后立即 `ensureModelLoaded()`（或 terminate 前记录待发 init）。

### B4. 默认 provider 'qwen' 的 ASR 落到无时间戳分支 → 转写成功但 SRT 为空
`client/lib/llm/asr-service.ts:60` — **CONFIRMED**
`normalizeProvider`（factory.ts:81）`provider || 'mimo'`，未把 `'qwen'` 别名到 `'dashscope'`（service-endpoints.ts 注释明确说 qwen 应作 dashscope 别名）。asr dispatch 只认 dashscope/mimo，qwen 走 default → `transcribeMimo`（segments 恒为 `[]`）；`getAsrProviderType` 对 qwen 返回 `'standard'` → 转写路由两个时间戳后处理分支（WhisperX 对齐 / 比例回填）都跳过 → 响应 `{text, segments: [], durationMs: 0}` → `segmentsToSrt([])` 空 SRT。**qwen 是配置对话框的默认 provider**（model-config-list-dialog.tsx:148），默认 asrModel 即 qwen-audio。
**修复**: `normalizeProvider` 增加 `qwen → dashscope` 映射；dispatch/type 两处同步。

### B5. 设置页"本地服务配置"是死设置：写入 localServices，转写路由只读 legacy llm
`client/app/api/transcribe/local/route.ts:17` — **CONFIRMED**
设置页 LocalServicesSection PUT `/api/settings/local-services` → `writeLocalServices` 存进 `localServices` 段，但全仓唯一读者是该 GET/PUT 自身；`transcribe/local/route.ts:17` 与 `transcribe/route.ts:214` 只读 `readLlmSettings().whisperTranscribeUrl/whisperAlignUrl`（默认 127.0.0.1）。用户把 faster-whisper 填成 `http://192.168.1.10:8766`、提示"已保存"，请求仍打 127.0.0.1 → ECONNREFUSED → 503 提示还引导用户去改那个被忽略的输入框。（唯一写 `llm.whisperTranscribeUrl` 的 UI 是死代码 llm-settings-dialog。）
**修复**: 路由改读 localServices（fallback 到 llm 段），或砍掉一处配置面。

### B6. buildServiceUrl 不做 /v1 归一化 → 本地 Ollama baseUrl 带 /v1 时聊天请求 404
`client/lib/service-endpoints.ts:116` — **CONFIRMED**
`${host}${ep}` 盲拼；provider 'local' 默认 endpoint `/v1/chat/completions`。模型列表路由有归一化（`if (!baseUrl.endsWith('/v1')) baseUrl += '/v1'`），聊天路径（chat-service.ts:61、mnemonic-service.ts:188/366 → `createChatModel`）没有 → baseUrl `http://127.0.0.1:11434/v1`（Ollama 官方文档写法、被模型列表接受）时翻译/助记全部请求 `…/v1/v1/chat/completions` → 404。
**修复**: `buildServiceUrl` 内做一次 `/v1` 去重归一化，两处共用。

### B7. 获取模型列表会清空 legacy llm 镜像里的模型字段
`client/app/api/settings/llm/route.ts:80` — **CONFIRMED**
POST 只用请求体字段新建 `LlmSettings`（`asrModel: asrModel || undefined`，translateModel/mnemonic* 甚至没解构），`writeLlmSettings` 整体替换 `existing.llm`。活触发路径：model-config-list-dialog `fetchModels`（"获取模型列表"按钮）只 POST `{provider, baseUrl, apiKey}` 喂 `/api/models` → llm 段被剥光；`readEffectiveLlmSettings` 在 baseUrl+apiKey 幸存期间让残缺 llm 压过完好的 llmConfigs 默认配置 → 无 configId 的 `/api/translate` 400"该配置未设置翻译模型"、`/api/tts`/`/api/transcribe` 静默落到默认模型、`transcribe/local` 丢自定义 whisper URL，直到重新保存默认配置。缓解：多数 UI 会自动带上 configId。
**修复**: POST 改为与现存 llm 浅合并；或 fetchModels 走独立端点不落盘。

### B8. "未分组（移出材料集）"在两层都是死路 — 单材料移出集合在 UI 不可达
`client/components/shared/player-parts.tsx:95` — **CONFIRMED**
该 option `value=""` 与"未选择"同值：76 行 `if (!choice …) return` 与 105 行 `disabled={!choice}` 都挡住它；即便放行，83 行把 `''` 原样传给 `assignMaterialCollection`，而 material-store.ts:157 的陈旧 ID 防护要求 **null** 才是移出，`''` 匹配不到任何集合 id → 静默 no-op。`assignMaterialCollection` 仅此对话框两处调用；唯一其它置 null 的是整集合删除。library.tsx 与 collection.tsx（其文案还承诺"支持移出"）都受影响。
**修复**: option 值改哨兵（如 `'__none__'`）并在 confirmMove 转 null。

### B9. 助记 SSE 解析器跨网络块丢事件名 → 流式卡片静默缺字段/挂起
`client/services/mock/mnemonic.ts:84` — **CONFIRMED**
`let currentEvent = ''` 声明在 `while(true)` 读循环内，每个网络块重置；只有 `buffer` 跨块存活。TCP 分段落在 `event:` 行与 `data:` 行之间（生产端 route.ts:160 每事件 `event:…\ndata:…\n\n`，代理/慢链路下常见）时 yield `{event:'', data}`，mnemonic.tsx:543-555 的 switch 三分支都不匹配 → done/field 事件被丢，卡片缺字段或流"挂住"（done 丢失仅被 partialCard 兜底部分挽救）。
**修复**: `currentEvent` 提到循环外，按 `\n\n` 分帧解析。

---

## C. P2 — 数据错乱与体验缺陷（确认）

### C1. 删句后：被删句笔记成幽灵、收藏/进度错位、防抖竞态写错键（同流程三联）
- `client/stores/note-store.ts:61` — **CONFIRMED** `shiftNotesAfterDeletion` 的 next/stale 两个数组都排除 `sentenceIndex === deletedIndex`，被删句自己的 `note:{m}:{i}` 永不删除（docstring 声称会删）；重载后 listNotes 返回幽灵笔记，附到"原第 3 句"头上，且随备份导出。
- `client/components/pages/player.tsx:417` — **CONFIRMED** 删句重建句子 index 并平移 note 键，但收藏键 `fav:{m}:{i}` 与 `progress.playedSentenceIndexes` 不平移：k>删除位的收藏静默指向旧 k+1 文本、被删句上的收藏永久残留、进度统计虚高（favorites.tsx:146 越界时显示占位，不至崩）。
- `client/components/pages/player.tsx:313` — **CONFIRMED** 删句不 flush/取消 `pendingNotesRef` 的 400ms 防抖（handleNoteDelete:323 会清，删句路径不清）：t=0 在第 5 句打字、t=200ms 删第 3 句、t=400ms 定时器带着位移前索引落盘 → 笔记写到旧第 6 句的键上，或在被删句槽位复活笔记。
**修复**: 删除入口统一"先 flush 防抖 → 再 splice + 平移 note/fav/progress + 删除本句键"。

### C2. 生词频次无条件累加：重跑 AI 转写/重导入字幕一次就翻一倍
`client/stores/vocab-store.ts:183` — **CONFIRMED**
`frequency: entry.frequency + count` 纯累加，无按材料记账；`applySubtitleToRecord`（player.tsx:383）在每次 `handleImportSubtitle`（重导入 SRT）与 `handleAiSubtitleGenerated`（重跑 AI 转写）都执行。出现 10 次的词在两次重导后"出现 30 次"，频次排序与弱词信号永久失真，无任何路径可回落。
**修复**: 频次按 materialId 记账（重应用先减旧材料贡献），或改为 set 语义去重后重算。

### C3. mnemonic streamCard 闭包过期 → 无 done 事件时整张已流出的卡片丢失
`client/components/pages/mnemonic.tsx:560` — **CONFIRMED**
`useCallback([])` 闭包读 `partialCard` 状态变量（560 行 `const fallback = partialCard`），永远是初值 `{}`；stream 发出若干 `field` 后以 error/中断收场（无 done）时 fallback.core_meaning undefined → 卡片既不展示也不保存，streaming=false 后 displayCard=null，刷新还要再花一次 LLM 调用。全文件无 ref。
**修复**: fallback 走 `setPartialCard` 的函数式读值，或用 ref 镜像。

### C4. useTranslateConfigs：取消丢弃成功响应却不复位 loadedRef → 翻译配置永久"未配置"
`client/lib/use-translate-configs.ts:31` — **CONFIRMED**
31 行同步置 `loadedRef=true` 在 fetch resolve 之前；37 行 `if (cancelled) return` 丢弃成功响应且不复位（只有 catch 复位）。宿主 TranslateDrawer/SubtitleEditDialog 在 player 页常驻挂载（open 切换不卸载）：dev 首次编译 0.5-3s 或局域网/手机延迟下"打开即关"即中招，之后每次打开都命中 30 行 early return，configs 恒 `[]`，按钮禁用直到离开播放器页。
**修复**: cancelled 分支同样 `loadedRef.current = false`。

### C5. 首次保存 ASR 配置后自动重试 start() 读到旧闭包 → 配置对话框"关了又开"，转写永不启动
`client/components/shared/transcribe-shared.tsx:299` — **CONFIRMED**
对话框 handleSave 同步跑 `onOpenChange(false); onSave(); onSaved?.()`；`onConfigsChanged`（=loadAsrConfigs）未被 await，其 fetch 尚在途；`handleModelConfigSaved` 同 tick 调 `start(file)`，`asrConfigs` 闭包仍是 `[]` → 命中空配置守卫 `setPendingFile; setShowModelConfig(true)` → 刚关的 ModelConfigListDialog 立即重开，executeTranscribe 不执行。该守卫恰为首配场景而设，必然触发。
**修复**: start 改为等配置刷新（onSaved 传入最新 configs 或 start 内部现查）。

### C6. Shadowing 页无节流订阅 timeupdate → 录音全程整页 ~60 次/秒重渲染
`client/components/pages/training/shadowing.tsx:150` — **CONFIRMED**（根因在 `client/platform/html-player.ts:230`）
rAF tick 每帧 emit（60-120Hz），SentencePlayer 逐次透传+二分查找；player.tsx:209-216 已节流到 100ms 并注释了完全相同的卡死（"返回按钮无响应"），shadowing 未抄。长材料录音时每秒数万次 DOM diff 与 MediaRecorder 并行，主线程饱和。
**修复（更深一层）**: 在 HtmlPlayerController.pushTime 内加 ~10Hz 发射门控（边界判定仍逐帧内部进行），所有订阅者一并受益；组件层节流可留作冗余。

### C7. 全部翻译中途取消会被当成错误（body 读取期 abort 被 json().catch 吞掉）
`client/lib/translate.ts:47` — **CONFIRMED**
原 sweep 候选（37 行 between-chunks 检查）被验证为不可达（同步续体内 click 无法插入）；但验证发现真缺陷：abort 落在 body 读取中时 `(await res.json().catch(() => null))` 吞掉 AbortError → null → 57 行抛 `'翻译服务响应格式异常，请重试'` → translate-drawer.tsx:164 只静默 `name==='AbortError'` → 用户主动取消却看到红色错误条。tts.tsx:303 / transcribe-shared.tsx:209 都先查 `signal.aborted`，此文件没有。
**修复**: 抛错前先查 `signal?.aborted`，abort 路径抛 AbortError 或静默返回。

### C8. 用户删光材料后刷新 → 4 个种子材料复活
`client/stores/material-store.ts:64` — **CONFIRMED**（严重度低）
`seedIfEmpty` 只看"store 为空"，无持久化 seeded 标记；逐个删除全部材料后 reload 即重注入 mock-001/ted/bbc/movie。设置页"清空全部数据"承诺恢复示例内容是有意的，逐个删除路径无此承诺。
**修复**: records 里存 `meta:seeded` 标记；清空全部时显式重置该标记。

### C9. 词泡 2s 清除定时器不取消 → 旧定时器提前杀掉新词泡
`client/components/shared/word-bubble.tsx:159` — **CONFIRMED**
`setTimeout(() => clearBubble(), 2000)` 句柄被丢弃；2s 内选新词（processSelection 置新 bubble、重置 addedBookName）后旧定时器照样触发 clearBubble，新气泡在"第一次添加"后 2 秒被误清。全组件唯一定时器 ref 是 rafRef。
**修复**: 存 ref，processSelection 与卸载时 clearTimeout。

### C10. LRC 相邻同时间戳行 → 零长句 → 训练页"试听"播到媒体末尾
`client/core/subtitle/index.ts:65` — **CONFIRMED**
endMs 回填用下一 block 的 startMs，无相等守卫；重复时间戳（机器生成/卡拉OK LRC 常见，或同一行两个相同 tag 被 lrc.ts:24 展开成两个 block）排序后相邻 → `endMs == startMs`；sentence-player.ts:109 把 `endMs<=startMs` 当 open-ended（本意只服务末句），dictation/puzzle/read-aloud 的单句试听一路播到文件尾。测试只覆盖末句退化。
**修复**: 回填时 `endMs = Math.max(next.startMs, startMs + 1)` 或相等时合并/偏移。

### C11. SRT 解析错误行号报块首而非出错行
`client/core/subtitle/srt.ts:44` — **CONFIRMED**
`throw new SubtitleParseError('时间戳前出现无法识别的内容', firstLine)` 恒报块首行号；兄弟分支 41 行用 `firstLine + timingIdx` 展示了本意。纸面推演：L5 索引、L6 杂行、L7 时间戳 → 报"第 5 行"而真凶是第 6 行。现有测试把杂行放第 1 行（恰等于 firstLine）且不断言行号。
**修复**: 报 `firstLine + before.findIndex(非索引行)`。

### C12. HF 磁盘缓存非原子写 → 半截模型文件被永久当 HIT 服务
`client/app/api/hf/[...path]/route.ts:131` — **CONFIRMED**
`await writeFile(localFile, buffer)` 单发无原子性；`detectBadPayload` 只校验下载 buffer，不校验落盘结果；无并发锁（同文件两个未命中并发 GET 双写、第三个中途读到半截）。~90MB ONNX 下载途中崩溃/OOM/重启 → 截断文件；此后 HEAD stat 成功 → GET 永远 HIT 返回坏字节；路由只有 HEAD/GET，无 DELETE，kokoro-worker 失败处理只重置内存再走同一代理 → 除手工删文件外无自愈。
**修复**: tmp+rename 写入；命中分支校验 Content-Length/ETag（可用下载时存的 sidecar）；加并发 in-flight 去重。

### C13. SOE 设置拉取瞬时失败 → 静默换成 mock 伪评分并写入训练记录
`client/services/index.ts:55` — **CONFIRMED**
`fetch('/api/settings/soe').then(r=>r.ok?…:null).catch(()=>null)`，`!cfg` 即回 mock：无日志无标记。mock 分数 = `70 + hash(refText+duration)%26`，与发音无关；read-aloud.tsx:171 拿到的 service 不透明，同 ScorePanel 渲染并把伪分写进训练记录。设计内的回落仅覆盖"未配置"；代理不可达在 evaluate 时会大声报错；唯"设置读取失败"分支（settings.json 损坏、dev 抖动）静默。设置 UI 把 mock 标为"演示模式"，选 tencent 即承诺真评分。
**修复**: 回退 mock 时至少 console.warn + 结果对象带 `mock: true` 让 UI 标注。

### C14. play() 播放被拦截后重抛 → 全仓 unhandled rejection
`client/platform/html-player.ts:95` — **CONFIRMED**
非 AbortError 分支 emitError(PLAY_BLOCKED) 后 `throw e`；全部调用点都是 `void …play()`（sentence-player.ts:92/111、player.tsx:283/340、shadowing.tsx:204/215），无一处 catch，也无全局 unhandledrejection 处理。iOS Safari 自动播放策略 NotAllowedError 即中招——恰是 AbortError 注释想避免的形态。
**修复**: PLAY_BLOCKED 后不再重抛（错误已走事件通道），或返回 rejected-but-marked promise。

### C15. 转写中导航离开不 abort → 上传继续跑完、费用照付
`client/components/shared/transcribe-shared.tsx:124` — **CONFIRMED**
三个 useEffect 均无 cleanup；abort 仅在 start/cancel/reset。路由切走后大文件 multipart 上传照常完成并 setState（React 18 无警告，浪费的是 API 费用与电量）。对话框关闭路径调用了 cancel，但播放器页导航卸载 AiTranscribeDialog 不会。
**修复**: 挂载 effect 返回 `() => abortRef.current?.abort()`。

### C16. SOE 三 provider 的 isRetryable 与自家注释相反：重试注定失败的、放过该重试的
`server/src/services/soe/azure.provider.ts:105`（tencent:186、iflytek:229 同文） — **CONFIRMED**
注释（47 行）"超时/客户端断开不重试；网络错与 5xx/429 重试"，实现 `return err.code === UPSTREAM_TIMEOUT || err.code === SOE_UPSTREAM_ERROR`：401/403/400 等确定性失败映射的 SOE_UPSTREAM_ERROR 被重试（错 key 时双倍请求+双倍时延），真 429（UPSTREAM_RATE_LIMIT）反而不重试，超时被重试使 504 等待翻倍。
**修复**: 按状态码分类：429/5xx/网络错重试；400/401/403/超时不重试。

### C17. align_server 全部推理同步跑在事件循环上 → 首次对齐期间 /health 与并发请求全挂
`server/align_server.py:132` — **CONFIRMED**
`async def align` 直接调 `whisperx.load_audio`（162）、`load_align_model`（104，首语言触发的模型下载可达分钟级）、`whisperx.align`（174），全文件无 executor/to_thread；transcribe_server.py 有对照组（ThreadPoolExecutor）。客户端 120s abort 超时后静默降级比例时间戳——并发首个对齐请求期间服务器"看似死了"。
**修复**: 照 transcribe_server 加 ThreadPoolExecutor 包住加载与对齐。

### C18. mnemonic callApi 违反统一错误契约（潜在）
`client/services/mock/mnemonic.ts:27` — **CONFIRMED**（当前无用户可见影响）
抛普通 `Error`（BFF 的 `{error}` 体）且 abort 以原始 DOMException 透传，违反 contracts.ts:8"失败统一抛 ApiError（含中止 code==='ABORTED'）"；同侪 soe/tts 均守约。唯一调用方只 catch 后 setError，未读 err.code，故暂为潜在。
**修复**: 用 `toApiError()` 归一。

---

## D. P2/PLAUSIBLE — 机制成立、触发条件受限

### D1. `next()` 在未播放时跳过第 0 句
`client/core/player/sentence-player.ts:97` — PLAUSIBLE
`Math.max(0, lastIndex)+1` 把 -1 映射成 1；打开播放器直接按 →（player.tsx:287）会从第 2 句开始。UI 的 active 初始为 0、屏幕按钮行为一致（0→1），第 0 句仍可点/prev 到达，故危害弱——但 setSentences 重置后同样状态复现。
**修复**: `Math.max(0, lastIndex < 0 ? -1 : lastIndex) + 1`。

### D2. 大 zip 下载同步 revokeObjectURL
`client/platform/storage/backup.ts:130` — PLAUSIBLE
`a.click()` 同 tick revoke；数百 MB 完整备份在 Safari/Firefox 上可能取消/截断下载（Chrome 通常在 click 时快照 blob，故为浏览器/时序相关）。tts.tsx 的 saveToDevice 走常驻 gen.url（卸载才 revoke）不受影响。
**修复**: `setTimeout(revoke, 60_000)` 或 anchor 事件后延迟。

### D3. TTS provider 返回 `Buffer.from(b64).buffer` 存在池化别名风险
`client/lib/llm/providers/dashscope-tts.ts:74`（mimo-tts.ts:63 同） — PLAUSIBLE
解码 ≤4KB 时 Node 走 8KB 共享池，`.buffer` 是整个池、route.ts:78 `Buffer.from(audioBuffer)` 连池垃圾一起编码。但 provider 请求 24kHz 16bit WAV（~48KB/s），真实语音 ≥ 数十 KB 不入池——仅退化/截断 payload 触发。
**修复**: 返回 `Uint8Array` 或 `buffer.slice(byteOffset, byteOffset+length)` 精确视图。

### D4. 文件 input 不重置 value → 同名文件重选不触发 onChange
`client/components/pages/transcribe.tsx:100`（`import.tsx:113` 同病；player-parts.tsx:166、settings.tsx:365 是正例） — PLAUSIBLE
影响比候选描述窄：file 状态从未清空、按钮不死；真实危害是"同名文件在磁盘上被改过再重选"时静默用旧 File 转写。
**修复**: onChange 里 `e.target.value = ''`。

### D5. 各 API 路由 LLM 设置读取器不一致
`client/app/api/tts/route.ts:51`（transcribe:192、models:18 用 legacy-only；mnemonic:97/translate:69 用 readEffectiveLlmSettings） — PLAUSIBLE
仅手工编辑 settings.json 造出"只有 llmConfigs 没有 llm"状态时，翻译/助记正常而 TTS/转写/模型列表报"未配置"。对话框全部写路径都会同步 legacy 镜像（addLlmConfig/updateLlmConfig/setDefaultLlmConfig/deleteLlmConfig），故 UI 正常用法不触发。
**修复**: 统一走一个 resolver（见 E-alt）。

---

## E. P3 — 清理与改进（全部 CONFIRMED）

### E-死代码（5 项）
| # | 位置 | 内容 |
|---|------|------|
| 1 | `client/components/shared/llm-settings-dialog.tsx` | 整文件 372 行零引用（被 model-config-list-dialog 取代）；自带已漂移的 PROVIDERS/fetchModels/ModelSelect 拷贝。删除 |
| 2 | `client/stores/mnemonic-store.ts:18` | store 零订阅者；`getMnemonicFromMemory` 被 mnemonic.tsx import 但从不调用。降级为纯 async CRUD |
| 3 | `client/components/pages/settings.tsx:53` | LearningStatsSection 解构 `records` 却从不使用（统计来自 recordsStore.allKeys），白白全量重渲染。删该行 |
| 4 | `client/components/shared/transcribe-shared.tsx:72` | `checkLlmConfigured` 全仓唯一定义处，无调用。删除 |
| 5 | `client/core/training/puzzle.ts:65/73` | `buildTiles`/`checkAnswer` 仅测试引用，生产 puzzle 页用 grid 模式另一套。删除或注明测试专用 |

### E-重复（8 项）
| # | 重复物 | 副本 | 已漂移点 |
|---|--------|------|----------|
| 1 | 媒体 blob→ObjectURL + HtmlPlayerController/SentencePlayer 装配 effect | dictation.tsx:49、puzzle.tsx:54、shadowing.tsx:111、read-aloud.tsx:90、player.tsx:181（5 份生命周期敏感拷贝） | shadowing 有 duration 兜底、player 有 rate/loop 偏好，其余没有；应抽 `useSentencePlayer(materialId)`（recording-review.tsx 已有同类先例 useRecordingReplayUrl） |
| 2 | JSON 提取/清洗栈 | chat-service.ts:200-317 vs mnemonic-service.ts:136-166 | 注释自称"复用策略"实为拷贝；「」处理已漂移 |
| 3 | SRT 序列化 | transcribe-shared.tsx:14、core/subtile exportSrt、mock/tts.ts:97（3 份） | 只有 tts 版钳位负数；解析-导出回环测试只保护 core 版 |
| 4 | mm:ss 格式化 | favorites:43、translate-drawer:325、recitation:38、shadowing:44、read-aloud:36、player-parts:27、scoring:54（7 份） | 钳位/舍入/十分位各异，同一时长两屏显示可不同 |
| 5 | blob 下载 | transcribe-shared:28 `(blob,name)` vs backup.ts:124 `(name,blob)`（同名反参！）、tts.tsx:341、player.tsx:467 内联 | tts 版 append+不 revoke（URL 泄漏），backup 版同步 revoke |
| 6 | WaveBars 可视化 | recitation.tsx:46 与 read-aloud.tsx:45 逐字节相同 | 二者已共用 record-button，组件应同去 shared |
| 7 | 转写控制块 | transcribe.tsx:105-156 vs ai-transcribe-dialog.tsx:74-123 | 页面版持久化翻译开关、对话框版不持久化——同一开关两种行为 |
| 8 | llm-config 拉取+默认选择 | transcribe-shared:139、use-translate-configs:35、tts.tsx:127（全模式三份；model-config-list-dialog:933 部分） | 有缓存+重试 / 无缓存无重试 各行其是 |

### E-性能（7 项）
| # | 位置 | 浪费 | 更优解 |
|---|------|------|--------|
| 1 | player.tsx:531 | 10Hz setCurrentMs 整页重渲染，未 memo 的 SubtitleList 千句材料每 tick 万级 diff | currentMs 下沉到 PlayerControlBar 内部订阅；SubtitleList memo + 稳定回调 |
| 2 | material-store.ts:40 | 每次变更（含每次打开材料的 touchMaterial）全量重读所有材料记录（内嵌完整 subtitleData）+全部 records 键 | 单记录补丁 + 通知 |
| 3 | platform/storage/backup.ts:117 | 每个媒体 blob 整体 `new Uint8Array(await arrayBuffer())`，峰值 ≈ 最大单文件 + 32MB sink | blob.stream() 分块喂 sink、增量 CRC（zip.ts add 需扩展流式写入口） |
| 4 | chat-service.ts:65 | ≤15 句 chunk 严格串行（lib/translate.ts:36 同样串行 50 句批），500 句 = 34 次串行 LLM 往返（2-5 分钟） | 并发 2-4（本地 baseUrl 保持串行）；分块大小的既有理由只关乎大小不关乎串行 |
| 5 | html-player.ts:230 | rAF 每帧 emit timeupdate（60-120Hz），SentencePlayer 每帧二分+再 emit | tick 内 ~50-100ms 门控（同时根治 C6） |
| 6 | note-store.ts:21（vocab-store:22 同） | allKeys 全扫 + 每条笔记一个独立 IDB 事务（N+1） | KvStore 加 getAll()；或 materialId 索引 |
| 7 | services/index.ts:51 | getSoeService 每句评分 fetch /api/settings/soe，服务端每次重读+parse settings.json | 写时失效的缓存（PUT 是唯一写者） |

### E-架构层次（2 项）
| # | 问题 | 深层修法 |
|---|------|----------|
| 1 | html-player.ts:135 `getSeekDriftMs()` 零调用、不在 PlayerController 契约（core/player/types.ts）里；SentencePlayer 用死常数 LOOP_TOLERANCE_MS=120。漂移 >120ms 的媒体（视频关键帧 seek）循环/区间停点会误判 | 把 getSeekDriftMs 提进契约，SentencePlayer 用 容差修正（这正是架构 §5.1 写明却未接线的机制） |
| 2 | 记录键前缀字面量散落 5+ 处：training-center.tsx:54/62、settings.tsx:59/65、material-store.ts:114-115、favorite-store.ts:12、note-store.ts:12，schema.ts RECORD_KEYS 只提供构造函数 | schema 导出前缀常量（或提供 latestTrainingByMode()/countFavorites() 查询），键格式知识收敛一处 |

### E-规范（1 项）
| # | 违反 | 依据 |
|---|------|------|
| 1 | `client/app/api/hf/[...path]/route.ts:18` 硬编码 `HF_BASE='https://huggingface.co'`，无任何配置项 | 根 AGENTS.md:91（client/CLAUDE.md 经 @AGENTS.md 引用并自述"see AGENTS.md"）："lib/service-endpoints.ts — the only place allowed to hold endpoint paths / default models / default service URLs; never hardcode a baseUrl elsewhere"；service-endpoints.ts:5"代码中不得硬编码任何 baseUrl"。它是全仓唯一不可配置的服务 URL——HF 不可达需换 hf-mirror 时只能改代码 |

---

## F. 已验证排除的候选（REFUTED，留档避免复查）

| 候选 | 排除证据 |
|------|----------|
| puzzle 2 词句 25% 初始即解 | buildTiles/checkAnswer 是死代码（见 E-死代码#5）；grid 模式逐词判定与乱序无关 |
| 播放器切材料时进度跨材料合并 | 结构存在但交错不可赢：flushProgress(A) 的 getProgress(A) 先于 B 装载链 ≥4 个串行 IDB await 发出，IndexedDB 按发起序激活 |
| align_server 传出 start:null 词 | 实装 whisperx 3.8.6 word dict 省略键而非置 None（alignment.py:354-357），`.get('start',0)` 拿到 0；客户端另有 `?? 0` 双保险 |
| transcribe_server durationMs 取末段 endMs | 无任何客户端消费该字段（材料时长来自 probeMediaDuration 的 audio 元数据） |
| translate.ts:37 between-chunks 取消误报 | 同步续体内 click 无法插入（真实缺陷在其隔壁，见 C7） |

---

## G. 修复优先级建议

1. **立刻（数据/密钥安全）**: A1 原子写+损坏备份、A2 路径穿越、A4 密钥掩码、A3 IDB 降级策略
2. **本周（功能不可用）**: B4 qwen 别名（默认 provider！）、B3 kokoro reinit、B8 未分组、B1/B2 iFlytek、B6 /v1 归一、B9 SSE 解析
3. **下个迭代（数据一致性）**: C1 删句三联、C2 频次累加、C5 配置重开、B7 llm clobber、B5 死设置、C12 缓存原子性
4. **随手**: C3-C4、C6-C11、C13-C18、E-死代码全部（纯删除）
5. **规划**: E-重复#1（useSentencePlayer 抽取）、E-性能#2/#5、E-层次#1、E-规范#1

---

*评审方法与全部验证证据由 10 个发现角度 + 42 个验证任务 + 1 个补漏扫描产生；每条 CONFIRMED 均有代码行级证据，PLAUSIBLE 均注明触发条件与确认方法。*
