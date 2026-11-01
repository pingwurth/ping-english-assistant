## Review: repo

> **修复记录（2026-11-02 同日）**：榜单 20 条全部复核至当前 HEAD 并处理完毕。**11 条在当日更早的修复提交（aee2e2d / 05dcc0f / 762559d / d27d841 / 87c3a09 等）中已完成**：#1 密钥掩码+掩码哨兵（soe/llm-configs 全分支）、#2 hf 代理段级拒绝+resolve 前缀断言、#3 fetchModels 改走 /api/models 探测不落盘 + settings/llm POST 浅合并、#4/#5 idb 取消永久内存降级（wrapRead/wrapWrite 单次失败单次负责）、#6 讯飞鉴权按官方 open-ise 方案重写（golden 向量同步）、#7 readRaw 损坏先备份 + tmp+rename 原子写 + 串行队列、#12 transcribe 消费 localServices 段（legacy 回退）、#13 SSE currentEvent 跨块存活、#17 isSoeRetryable 共享模块（429/5xx/连接层重试，4xx/超时不重试）；#18 播放器装配已收敛为 useSentencePlayer（player.tsx 保留页面化装配为 hook 头注释记录的设计决策）。
> **本轮新修 7 项**：#8 idb `tx()`/`getAllEntries` 改为事务 `oncomplete`/`onabort` 收口（commit 期 abort 不再假成功）；#19 Recorder 新增 `'starting'` 态关掉权限弹窗期双开竞态（失败路径回 idle）；#20 STORE 条目 CRC 校验（readEntry + zip 导入写入前流式预检，杜绝损坏媒体静默入库）；#9 残余三处 N+1（training-center / settings 统计 / removeMaterial 级联）换 `getAllEntries` 单事务快照；#3 残余迁移清单补齐 mnemonic*/whisper* 两对；Summary 项 c069 讯飞 base64 分片累积后统一解码（跨片多字节字符不再咬坏）；c055 三条 multipart 入口（transcribe ×2 / soe evaluate）按 Content-Length 预检 413。
> **测试缺口补齐（#10/#11/#14/#15/#16）**：新增 8 个测试文件 75 例（160→235）——sentence-player 循环三档/±120ms 容差/漂移补偿边界（17）、html-player seek 校准状态机+AbortError 分类+节流（12）、recorder 竞态+权限映射（4）、parseHfPath 恶意段矩阵（16，抽为 `platform/hf-path.ts` 纯模块）、material-store 级联删除 m-1/m-10 边界+种子注入（5）、server-settings 损坏备份/原子写/迁移/掩码保护（9）、soe 路由掩码往返回归（6）、upload-limit（6）；vitest include 扩至 platform/lib/stores/app/api；删除 lib/machine-translate 空目录漂移。
> 验证基线：client `tsc --noEmit` 0 错 + vitest 235/235 + `next build` 通过；server `tsc --noEmit` 0 错 + vitest 51/51。
> 遗留（规划级）：#9 深层项（records 建 materialId 索引 / 统计聚合记录 / train: 保留策略）、#18 录音 effect 两份小拷贝（行为已分化，抽 hook 收益有限）；开放问题 ①讯飞真实凭据握手、③Azure PA >30s 实测仍待真实环境验证。

Brief: repo 模式深度审计:9 个角度 finder(A/C/E/F/H/I/J/K/T)对 client 六层 + server SOE 代理并行扫描,61 条新候选全部进入对抗验证(60 保留、1 驳回、11 条因 refuter 限流无票被引擎按规则丢弃)。最重的问题集中在三簇:存储层静默数据丢失(idb 内存回落 / 事务假成功 / settings.json 整文件重建)、BFF 安全面(密钥明文回显、hf 通配代理路径穿越、上传无上限)、以及会摧毁已保存配置的『获取模型列表』按钮。

Brief: repo 模式深度审计:9 个角度 finder(A/C/E/F/H/I/J/K/T)对 client 六层 + server SOE 代理并行扫描,61 条新候选全部进入对抗验证(60 保留、1 驳回、11 条因 refuter 限流无票被引擎按规则丢弃)。最重的问题集中在三簇:存储层静默数据丢失(idb 内存回落 / 事务假成功 / settings.json 整文件重建)、BFF 安全面(密钥明文回显、hf 通配代理路径穿越、上传无上限)、以及会摧毁已保存配置的『获取模型列表』按钮。

Run: carrier 1 — 主会话且 Workflow 工具可用:以 workflows/deep-review.js 调度 13 角度 finder + 逐候选对抗 refuter(载入 references/angles.md 全文 charter),随后以 submit --kind carrier1 回灌 ledger · rounds=1 · candidates=72 · dupDropped=11 · refuted=1 · capped-out=40
Coverage: deep-read R3 服务贯通层(app/api 14 条 BFF 路由 + services/ + lib/llm)与 R6 server/src(SOE 三 provider + 签名 + Python 两服务)· deep-read R1 core 热点(subtitle/backup/player)与 R2 platform 热点(storage/recorder/html-player)· sampled R4 stores 全部 5 文件、R5 components 热点(player、训练三页、model-config-list-dialog 等) · untouched(设计排除)docs/、page-prototype/、public/ · 角度缺口:B/D/G/L 四个 finder 因上游 429 限流未运行——D(语言陷阱)与 G(安全增量)仅由 T/A/C 部分覆盖,B 在 repo 模式本无删除基线;workflow 预算耗尽,仅执行 1 轮扫描、未跑 gap 轮

| # | Location | Sev | Finding |
|---|----------|-----|---------|
| 1 | client/app/api/settings/soe/route.ts:26 | P1 | GET /api/settings/soe returns the soe config verbatim including all provider secrets (azure.key, tencent.secretId/secretKey, iflytek.apiKey/apiSecret), and PUT echoes them back (line 52); sibling GET /api/settings/llm-configs?id= (route.ts:49) likewise returns the raw apiKey for a single config. This contradicts the masking policy used by /api/settings/llm (apiKey.slice(0,8)+'***') and llm-configs list (line 14), so cloud keys are delivered to any same-origin script/network observer of the BFF. |
| 2 | client/app/api/hf/[...path]/route.ts:59 | P1 | hf/[...path] model proxy has no '..' confinement: parseHfPath joins arbitrary decoded segments into ref.file/cacheKey and localFileOf() does join(modelPath, cacheKey, file), so encoded %2E%2E segments escape the kokoro cache root — arbitrary local file read (GET cache hit) and arbitrary-path write of attacker-chosen HuggingFace content (cache miss). |
| 3 | client/components/shared/model-config-list-dialog.tsx:230 | P1 | fetchModels() saves an in-progress partial config by POSTing only {provider, baseUrl, apiKey} to /api/settings/llm; the route (app/api/settings/llm/route.ts:241-269) replaces the entire persisted `llm` object, wiping asrModel/asrEndpoint/ttsModel/ttsEndpoint/whisperAlignUrl/whisperTranscribeUrl — same destructive pattern in llm-settings-dialog.tsx:83. |
| 4 | client/platform/storage/idb.ts:75 | P1 | guarded() permanently switches the whole app to in-memory storage on ANY single IDB failure (including one transient QuotaExceededError put or an onblocked open) and then silently serves reads/writes from a Map — callers see false success and the UI shows an empty library while every new write is discarded. |
| 5 | client/platform/storage/idb.ts:93 | P1 | A single transient IndexedDB failure (e.g. QuotaExceededError on one put, or onblocked when another tab holds an old DB_VERSION connection) permanently flips useMemory=true; guarded() then routes all subsequent writes to an in-memory Map where put() resolves successfully, so progress/notes/materials/imports silently vanish on reload — a silent data-loss path in the app's only durable store. |
| 6 | server/src/services/soe/iflytek-auth.ts:29 | P1 | iFlytek WS auth URL construction deviates from the official ISE open-ise scheme on two points: the signature origin request-line is 'GET /v2/open-ise' without the required ' HTTP/1.1' suffix, and the authorization query parameter is the percent-encoded authorizationOrigin instead of base64(authorizationOrigin). The golden-vector test pins this wrong construction, so real-credential sessions will fail the handshake (401 → SOE_UPSTREAM_ERROR) with iflytek provider. |
| 7 | client/lib/server-settings.ts:63 | P1 | readRaw() swallows read/JSON-parse errors and returns {}, then every write* helper does read-modify-writeRaw of that {} — so a corrupt or transiently unreadable ~/.ping-eng/settings.json gets silently rewritten containing only the new section, wiping llm/llmConfigs/soe credentials; writeRaw is also a non-atomic writeFile that can itself truncate the file, making the wipe self-amplifying. |
| 8 | client/platform/storage/idb.ts:59 | P1 | tx() settles the promise on the individual IDBRequest's onsuccess/onerror only — transaction.onabort/oncomplete are never handled, so a transaction that aborts at commit after request success (quota in Firefox/Safari, versionchange-induced abort) resolves put() as success while nothing was persisted, and some abort paths leave the promise pending forever. |
| 9 | client/components/pages/training-center.tsx:53 | P2 | Single prefix-keyed records store has no indexes, so every read is a full getAllKeys() scan + per-key gets: listNotes (note-store.ts:21), listFavorites (favorite-store.ts:21), vocab refresh (vocab-store.ts:23-28), material refresh (material-store.ts:41-47). Worst: training-center.tsx:53-55 and settings.tsx:58-60 materialize ALL train: records to compute stats/latest for one material; read-aloud.tsx:177-190 writes one train: record per sentence, unpruned except material deletion. |
| 10 | client/core/player/sentence-player.ts:154 | P2 | SentencePlayer (218 lines) has zero tests despite its header explicitly claiming '纯 TS、零框架依赖，可在 node 直接单测（注入 fake PlayerController）'; its untested branches are exactly the risky ones: A-B loop ±120ms tolerance, open-ended-sentence loop guard, loopRemaining 0→1→3→∞ semantics, playRange/rangeEndMs interplay, and setSentences() — the method commit e54694f relies on for its claimed 'sync sentence list to assembled engine' fix. |
| 11 | client/platform/html-player.ts:179 | P2 | The entire client/platform/ layer (1633 lines) has zero tests, and the vitest include pattern ('core/**', 'services/**') structurally excludes it. Inside sits the AGENTS.md red-line logic: SEEK_DRIFT_THRESHOLD_MS=300ms seek calibration state machine (pendingSeekMs silence, seekDriftMs recording, 2s SEEK_CALIBRATE_TIMEOUT_MS fallback), plus the AbortError-swallow scope in play() and recorder.ts's OfflineAudioContext resample to the ADR-5 16kHz/mono contract. |
| 12 | client/app/api/transcribe/local/route.ts:18 | P2 | Whisper service URLs are a dead setting: the live Settings page (settings.tsx:168) PUTs them to /api/settings/local-services (settings.json 'localServices'), but readLocalServices() has zero consumers besides the GET feeding that form. Both real consumers — /api/transcribe/local (17-18) and /api/transcribe (route.ts:214) — read the legacy 'llm' section via readLlmSettings(), whose whisper fields are only written by llm-settings-dialog.tsx, which has zero importers (dead). |
| 13 | client/services/mock/mnemonic.ts:84 | P2 | MockMnemonicService.generateCardStream contains a hand-rolled SSE parser (line-split, event:/data: pairing, partial-buffer carry, silent JSON.parse catch) with zero tests — its sibling mock services soe.ts and tts.ts both have test files. The parser resets `let currentEvent = ''` inside the per-read loop, so an event: line and its data: line arriving in different network chunks yield an event with an empty name; malformed JSON lines are silently dropped by catch {}. |
| 14 | client/stores/material-store.ts:108 | P2 | All stores/ (568 lines) are untested; the riskiest untested logic is removeMaterial — the codebase's only cascading data-destruction path (material + blob + progress/fav:/note: prefixed records + per-record materialId-matched train: records). Its own comment flags the prefix-collision hazard ('m-1 与 m-10'). seedIfEmpty first-load injection (brief targeted check #5) is likewise untested. |
| 15 | client/app/api/hf/[...path]/route.ts:36 | P2 | The whole app/api/ BFF (1651 lines, 14 routes) has zero tests, including pure trivially-testable logic like parseHfPath whose output feeds join(modelPath, cacheKey, file) filesystem writes and upstream https://huggingface.co URL construction. Brief targeted checks #1 and #6 (key non-echo, wildcard-proxy path confinement, upload limits, SSE cleanup) have no automated guard at all. |
| 16 | client/lib/server-settings.ts:128 | P2 | client/lib/ (2706 lines) has zero tests while empty scaffolding dirs client/lib/__tests__/ and client/lib/machine-translate/__tests__/ sit in the tree — test intent was created then dropped (machine-translate's module no longer exists at all, so the dir is pure drift). Untested risky logic: readLlmConfigs auto-migrates and WRITES settings.json on a read; deleteLlmConfig reassigns defaults and syncs a legacy shadow copy; getTtsVoices in the route infers provider from endpoint substrings. |
| 17 | server/src/services/soe/azure.provider.ts:105 | P2 | isRetryable() treats every SOE_UPSTREAM_ERROR as retryable and UPSTREAM_RATE_LIMIT as non-retryable — the inverse of the documented policy ('仅网络错/408/429/5xx 重试'); identical wrong condition in tencent.provider.ts:186-189 and iflytek.provider.ts:229-232. |
| 18 | client/components/pages/player.tsx:181 | P2 | The 'load media blob → ObjectURL → HtmlPlayerController + SentencePlayer → load → destroy' assembly block and the 'createRecorder + volume/maxreach + abort + destroy' lifecycle are copy-pasted into player.tsx, training/read-aloud.tsx:103-131 and training/shadowing.tsx:138-175, and the copies have already diverged in deps and reconciliation. |
| 19 | client/platform/recorder.ts:110 | P2 | Recorder.start() guard checks this.state, but state only becomes 'recording' at line 148 AFTER the awaited getUserMedia (line 122) — a second start() during the permission-prompt window passes the guard, so two MediaStreams/AudioContexts are created and the loser's references are overwritten, leaking a live mic track and an open AudioContext. |
| 20 | client/platform/storage/backup.ts:234 | P2 | Zip import's primary STORE zero-copy path performs no integrity verification: importZipBackup slices file.slice(dataOffset, dataOffset+uncompressedSize) without checking the entry's crc32, and readEntry's STORE branch (core/backup/zip.ts:261-263) validates only length — CRC is checked exclusively on the deflate fallback — so a corrupted or truncated full-backup zip restores corrupt media blobs silently. |

### Details

**[P1] P1 · GET /api/settings/soe 明文回显全部云密钥,llm-configs 单条亦回原始 apiKey — `client/app/api/settings/soe/route.ts:26`**
- **Problem:** client/app/api/settings/soe/route.ts:26 GET 原样返回配置(azure.key、tencent.secretId/secretKey、iflytek.apiKey/apiSecret),:52 PUT 再回显;app/api/settings/llm-configs/route.ts:49 的 ?id= 单条分支返回原始 apiKey;同应用 /api/settings/llm(:30 slice(0,8)+'***')与 llm-configs 列表(:14 maskApiKey)却执行 mask——同一 BFF 内两套口径,文件头注释自认『单用户本机应用:GET 原样返回密钥』。
- **Failure scenario:** 任何同源脚本(字幕/HTML 内容渲染引入的 XSS、被投毒的 npm 依赖)fetch('/api/settings/soe') 即可读到腾讯 SecretKey 与讯飞 apiSecret 明文,响应还会流经本地代理/ devtools 日志;密钥进入浏览器内存后外传,用户毫无感知。密钥『仅存服务端』的红线在三个端点上被打破。
- **Evidence:** All four code claims verified verbatim. (1) soe/route.ts:23-26 GET: `const config = (await readSoeConfig()) ?? DEFAULT_CONFIG` then `return NextResponse.json(config)` — no masking. The config type holds real secrets, lib/server-settings.ts:306-308: `azure?: { key: string; region: string; host: string }`, `tencent?: { appId: string; secretId: string; secretKey: string }`, `iflytek?: { appId: string
- **Fix:** 统一 mask 策略:所有 GET/PUT 响应只回密钥尾 4 位或掩码;编辑场景前端保留未改密钥时传掩码哨兵值(如 '__KEEP__'),服务端遇哨兵保留旧值;PUT 响应不回显完整密钥。
- **Confidence:** 0.85 · **Verdict:** CONFIRMED

**[P1] P1 · hf/[...path] 通配代理无 '..' 收敛:%2E%2E 可逃逸缓存根,任意本地文件读 + 任意路径写 — `client/app/api/hf/[...path]/route.ts:59`**
- **Problem:** client/app/api/hf/[...path]/route.ts:59 起,parseHfPath 把解码后的任意 segment 拼进 ref.file/cacheKey,localFileOf() 再 join(modelPath, cacheKey, file);没有对 '..'(或编码变体 %2E%2E)的拒绝/归一化,join 结果也不做『仍以缓存根开头』断言。
- **Failure scenario:** 攻击者(或任何能让浏览器请求本机 3000 端口的页面,配合 DNS rebinding/局域网直达)GET /api/hf/models%2F..%2F..%2F..%2Fetc%2Fpasswd?…构造:解码后 segment 逃逸缓存目录 → 命中本地文件即原样返回(任意本地文件读);cache miss 时把 huggingface.co 上攻击者可控 repo 的内容写到 join 出的任意路径(任意路径写)。单机自用时暴露面=本机;一旦部署到局域网/公网即升 P0。
- **Evidence:** Mechanism verified by running the repo's own Next 16.3.0 matcher plus an exact copy of parseHfPath. (1) No confinement: route.ts L44 `if (!org || !repo || !revision || !file) return null` is the only validation; L56 `return join(modelPath, ref.cacheKey, ref.file)`; the whole 210-line file contains no '..' check, and no middleware.ts exists. (2) Decode confirmed: node_modules/next/dist/shared/lib/r
- **Fix:** parseHfPath 拒绝 '..'/绝对段并白名单字符集;localFileOf 对 resolve 后路径做 startsWith(缓存根) 断言;上游 URL 仅允许 https://huggingface.co/<repo>/<file> 白名单形态;补 c045 的恶意 segment 测试。
- **Confidence:** 0.8 · **Verdict:** PLAUSIBLE

**[P1] P1 · 『获取模型列表』辅助按钮整体覆写 legacy llm 配置,未保存先毁 — `client/components/shared/model-config-list-dialog.tsx:230`**
- **Problem:** model-config-list-dialog.tsx:230 的 fetchModels() 仅 POST {provider, baseUrl, apiKey} 到 /api/settings/llm;路由(route.ts:52-89)以这 3 字段重建整个 LlmSettings(asrModel 等均 undefined)并 writeLlmSettings 全量替换 existing.llm;llm-settings-dialog.tsx:83 同款模式。点的是『获取模型列表』刷新按钮(尚未保存,可随时取消),破坏却已落盘。
- **Failure scenario:** 用户已有可用配置(asrModel='qwen-audio-asr-flash'、自定义 whisperTranscribeUrl),打开对话框想加第二个配置,填完 Base URL/API Key 点『获取模型列表』→ legacy llm 被替换为 3 字段残件 → 用户取消对话框(不保存)但破坏已持久化:无 configId 的转写/TTS 静默回落默认模型,自定义 faster-whisper 地址重置回 127.0.0.1:8766;自动迁移字段清单还漏 whisper 两键,原值无处可寻。
- **Evidence:** All load-bearing claims verified; only the route's line range in the finding is wrong (handler is at app/api/settings/llm/route.ts:52-89, destructive build at 69-80 — file is 89 lines total; same code).

1) model-config-list-dialog.tsx:230-234: `await fetch('/api/settings/llm', { method: 'POST', ... body: JSON.stringify({ provider, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }) })` — only 3 fie
- **Fix:** fetchModels 改用不落盘的临时凭据通道(如 GET /api/models?provider=&baseUrl=&apiKey= 显式传参或专用 POST /api/models/probe);settings/llm POST 改为按字段 merge 而非整建替换;迁移清单补齐 whisper*/mnemonic*。
- **Confidence:** 0.8 · **Verdict:** CONFIRMED

**[P1] P1 · guarded():一次瞬时 IDB 失败即永久切换整应用到内存存储,静默丢弃之后所有写入 — `client/platform/storage/idb.ts:75`**
- **Problem:** client/platform/storage/idb.ts:75 的 guarded() 捕获任何一次 IndexedDB 失败(包括一次 QuotaExceededError 的 put、或 open 时 onblocked)就把整库降级为内存 Map,且不向上层抛错;此后 put/get 全走 Map,调用方拿到假成功。
- **Failure scenario:** 用户磁盘配额瞬时告警导致一次 put 失败 → useMemory=true 固化;用户继续学习,当次会话进度、笔记、导入材料全部写入内存 Map 且 UI 显示已保存;刷新页面后一切消失,库还显示为空——应用唯一持久层的写路径在无任何提示的情况下整体失效。
- **Evidence:** Confirmed by direct source read of client/platform/storage/idb.ts and all callers.

1) Permanent failover on ANY error — idb.ts:71-78: `async function guarded<T>(store, idb, memFn) { if (useMemory) return memFn(mem(store)); try { return await idb() } catch (e) { console.error(\`[IDB] guarded() catch on \"${store}\", permanently switching to memory:\`, e); useMemory = true; return memFn(mem(store))
- **Fix:** 降级决策至少要求:失败可重试/只影响单库、用户可见告警、并提供恢复探测(定期重试 open 真库);或仅对该次操作抛错让上层决定,绝不静默全局降级。
- **Confidence:** 0.75 · **Verdict:** CONFIRMED

**[P1] P1 · 单次瞬时 IndexedDB 失败永久翻转 useMemory,后续写入全部静默蒸发 — `client/platform/storage/idb.ts:93`**
- **Problem:** idb.ts:93:一次 QuotaExceededError 或另一 tab 持旧版本连接导致的 onblocked,就把 useMemory=true 永久固化;guarded() 随后把所有写路由到内存 Map 且 put() 正常 resolve——应用唯一持久层在无提示下整体失效(与 c009 同文件同一机制的两处独立票证:守卫函数与翻转点)。
- **Failure scenario:** 用户浏览器配额瞬时触顶一次 → 此后整会话的进度、笔记、材料导入全写内存且 UI 报成功 → 刷新全没;更糟的是用户可能继续大量录入,认为已保存。静默数据丢失踩 brief 最高红线。
- **Evidence:** Code says exactly what the finding claims; no guard exists elsewhere. (1) Permanent flip: idb.ts:73-77 `catch (e) { console.error('[IDB] guarded() catch on "${store}", permanently switching to memory:', e); useMemory = true; return memFn(mem(store)) }` — the code's own log says "permanently". useMemory is only ever set `= true` (lines 19/39/43/47/76); openDb line 28 `if (useMemory) return Promise.
- **Fix:** 与 c009/c010 一并修:瞬时可重试错误不降级(重试+用户可见告警);确需降级也须在恢复探测成功后自动切回真库并提示。
- **Confidence:** 0.7 · **Verdict:** CONFIRMED

**[P1] P1 · 讯飞 WS 鉴权构造偏离官方 open-ise 方案,真实凭据握手必失败 — `server/src/services/soe/iflytek-auth.ts:29`**
- **Problem:** server/src/services/soe/iflytek-auth.ts:29 的签名 origin request-line 为 'GET /v2/open-ise'(缺官方要求的 ' HTTP/1.1' 后缀),authorization 查询参数放的是 authorizationOrigin 的 percent-encoded(官方为 base64(authorizationOrigin));iflytek-auth.test.ts 的金向量把这套错误构造钉死为预期值。
- **Failure scenario:** 用户配置真实讯飞 appId/apiKey/apiSecret 发起评分:按官方 HMAC 规则校验的服务端拒绝握手(401 → SOE_UPSTREAM_ERROR),讯飞 provider 实际不可用;且测试全绿(钉死的是错值),维护者会误信『签名已验证正确』。
- **Evidence:** CONFIRMED against the live official xfyun ISE doc (https://www.xfyun.cn/doc/Ise/IseAPI.html, fetched). Repo lines quoted verbatim from server/src/services/soe/iflytek-auth.ts:

L29: `const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path}`` — request-line lacks " HTTP/1.1".
L32: `const url = `wss://${host}${path}?authorization=${encodeURIComponent(authorizationOrigin)}&date=...`` — auth
- **Fix:** 按官方 ISE 鉴权文档修正 request-line 与 authorization=base64(origin);同步重写金向量(用文档示例向量);接真实账号做一次握手回归。
- **Confidence:** 0.65 · **Verdict:** CONFIRMED

**[P1] P1 · readRaw() 吞错返回 {},后续写路径以空底重建 settings.json,密钥配置全清 — `client/lib/server-settings.ts:63`**
- **Problem:** lib/server-settings.ts:63 的 readRaw() 把读取/JSON.parse 失败一律吞掉返回 {},而所有 write* 都是 readRaw→改→writeRaw 全文件重写;损坏或瞬时不可读的 settings.json 会被只含新节的对象整体覆盖,writeRaw 本身又是非原子 writeFile,写坏后进一步自放大。
- **Failure scenario:** 进程崩溃/磁盘满留下半个 settings.json(或 EBUSY 瞬时读失败)→ 用户下次在设置页改任一项(SOE 配置、默认模型)→ writeRaw 以 {} 为底写入,仅含刚改的那节 → llm/llmConfigs/soe 三家密钥与全部模型配置一次性清空,且无法恢复。
- **Evidence:** All claims hold verbatim in client/lib/server-settings.ts. (1) readRaw swallows everything: lines 57-64 `async function readRaw() { try { const data = await readFile(SETTINGS_FILE, 'utf-8'); return JSON.parse(data) } catch (err) { console.error('[server-settings] Failed to read/parse settings file:', err); return {} } }` — one catch covers both readFile (missing/EACCES/transient) and JSON.parse (t
- **Fix:** readRaw 失败时:解析错 → 抛错或先把坏文件改名备份再重建;写路径改 temp+rename 原子写;绝不在吞错后以空底继续覆盖写。
- **Confidence:** 0.6 · **Verdict:** CONFIRMED

**[P1] P1 · tx():promise 只挂在 IDBRequest 上,事务 commit 期 abort 被当成成功 — `client/platform/storage/idb.ts:59`**
- **Problem:** idb.ts:59 的 tx() 仅在单个 IDBRequest 的 onsuccess/onerror 上 settle promise,从不处理 transaction.onabort/oncomplete;Firefox/Safari 配额场景下 request 成功但事务提交时 abort,put() 已 resolve 成功而数据并未落盘;部分 abort 路径还让 promise 永远 pending。
- **Failure scenario:** Safari 隐私模式或配额紧张时:用户保存句子笔记 → put() resolve 成功 → UI 勾选已保存 → 事务在 commit 阶段 abort → 刷新后笔记不存在;调用方无从得知,数据无声丢失(若 promise 永挂则 UI 卡在保存中)。
- **Evidence:** Code confirms the structure: idb.ts:57 `const req = fn(db.transaction(store, mode).objectStore(store))` creates the transaction inline and discards it; the promise settles only on `req.onsuccess = () => resolve(req.result as T)` (L58) and `req.onerror = ... reject(...)` (L59-62). Repo-wide grep: this is the only `db.transaction(` call site; no `onabort`/`oncomplete` anywhere in client. Guard analy
- **Fix:** tx() 改为以 transaction.oncomplete resolve、onabort/onerror reject,IDBRequest 仅用于收集结果/错误;并为 open 加 onblocked 处理。
- **Confidence:** 0.5 · **Verdict:** CONFIRMED

**[P2] P2 · 前缀键记录库无索引,每次读全键扫描,统计页全量物化 — `client/components/pages/training-center.tsx:53`**
- **Problem:** records store 无任何 index,全部读取走 getAllKeys() 全扫 + 逐键 get:listNotes(note-store.ts:21)、listFavorites(favorite-store.ts:21)、vocab refresh(vocab-store.ts:23-28)、material refresh(material-store.ts:41-47);最重是 training-center.tsx:53-55 与 settings.tsx:58-60 为算单个材料的统计/最新而物化全部 train: 记录;read-aloud.tsx:177-190 每句写一条 train: 记录且除删材料外无清理。
- **Failure scenario:** 重度用户积累数千条 train:/note:/fav: 记录后,每次进训练中心/设置页都全量反序列化全部记录(UI 卡顿秒级),且随使用线性恶化;浏览器存储查看器里 train: 记录无限增长。
- **Evidence:** Every claim verified verbatim. (1) No indexes: idb.ts:32-34 `for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)` — no createIndex anywhere (grep createIndex|IDBKeyRange over client/ = 0 hits); KvStore API (idb.ts:81-87) only offers get/put/delete/allKeys/clear. (2) Per-key separate tx: idb.ts:57 `const req = fn(db.transaction(store, mode).objectStore(store))` — e
- **Fix:** 给 records store 建 materialId/prefix 索引或按 store 拆分;统计类查询维护聚合记录;train: 记录加保留策略(如每材料保留最近 N 条)。
- **Confidence:** 0.85 · **Verdict:** CONFIRMED

**[P2] P2 · SentencePlayer 218 行零测试,头注释却宣称可直接单测 — `client/core/player/sentence-player.ts:154`**
- **Problem:** core/player/sentence-player.ts:154(整文件)无任何测试,而其头注释明言『纯 TS、零框架依赖,可在 node 直接单测(注入 fake PlayerController)』;未覆盖分支恰是最险的:A-B 循环 ±120ms 容差、开放句尾循环守卫、loopRemaining 0→1→3→∞ 语义、playRange/rangeEndMs 交互、以及 e54694f 依赖的 setSentences()。
- **Failure scenario:** 改动 loop 语义或 setSentences 无任何护栏:循环模式回归(如 loopRemaining=∞ 被误清)直接进训练流程,用户侧表现为循环朗读随机失效,无测试红灯拦截。
- **Evidence:** Every factual claim verified. (1) Header claim verbatim at sentence-player.ts:11 — "纯 TS、零框架依赖，可在 node 直接单测（注入 fake PlayerController）。"; file is exactly 218 lines (wc -l = 218). (2) Zero tests: core/player/ contains only index.ts, sentence-player.ts, types.ts — no __tests__/ dir; grep for SentencePlayer across all *.test.ts/*.spec.ts returns nothing. (3) All cited risky branches exist: line 23 "ex
- **Fix:** 按头注释的 fake PlayerController 方案补齐单测:循环三档、±120ms 容差边界、setSentences 保态/重置、末句开放区间。
- **Confidence:** 0.92 · **Verdict:** CONFIRMED

**[P2] P2 · platform/ 整层 1633 行零测试,vitest 结构性排除,红线逻辑裸奔 — `client/platform/html-player.ts:179`**
- **Problem:** client/platform/(html-player、recorder、kokoro、storage)全部无测试,include 模式只收 core/ 与 services/;层内恰有 AGENTS.md 红线逻辑:SEEK_DRIFT_THRESHOLD_MS=300ms 漂移补偿状态机(含 pendingSeekMs 静默期、SEEK_CALIBRATE_TIMEOUT_MS=2s 兜底)、play() 的 AbortError 吞噬范围、recorder 的 OfflineAudioContext 重采样至 ADR-5 的 16kHz/mono。
- **Failure scenario:** 重构 html-player 时误删/绕过漂移补偿(AGENTS.md 明示不得移除)没有任何测试报警;录音重采样错误(声道/采样率)破坏 ASR/SOE 兼容,只能靠线上评分全失败才发现。
- **Evidence:** Every factual claim checks out; nothing guards the mechanism elsewhere.

1) Red-line logic is exactly where cited — client/platform/html-player.ts:
- L20: `const SEEK_DRIFT_THRESHOLD_MS = 300`; L22: `const SEEK_CALIBRATE_TIMEOUT_MS = 2000`
- L179-190: `private onNativeTimeUpdate(): void {` … `this.seekDriftMs = actualMs - this.pendingSeekMs` (L183), `if (Math.abs(this.seekDriftMs) <= SEEK_DRIFT_TH
- **Fix:** vitest include 增 platform/**;优先为 seek 补偿状态机、AbortError 分类、16kHz 重采样(注入 AudioBuffer fake)补单测——三者都是可注入 fake 的纯时序逻辑。
- **Confidence:** 0.9 · **Verdict:** CONFIRMED

**[P2] P2 · Settings『本地服务配置』写入死配置节,永不生效 — `client/app/api/transcribe/local/route.ts:18`**
- **Problem:** settings.tsx:168 PUT /api/settings/local-services 持久化到 settings.json 的 localServices 节,但 readLocalServices() 除回显表单外零消费;真实消费方 /api/transcribe/local(:17-18)与 /api/transcribe(route.ts:214)读的是 legacy 'llm' 节的 whisper 字段,而该节唯一写者 llm-settings-dialog.tsx 又是零导入的死组件。
- **Failure scenario:** 用户把 faster-whisper/WhisperX 部署在另一台机器,在『设置>本地服务配置』填好地址保存(显示已保存)→ 下次转写仍打 127.0.0.1:8766 → 报『faster-whisper 服务未启动』回退云端(或失败);用户以为服务坏了,实际配置从未被读取,任何代码路径都无法让它生效。
- **Evidence:** All claims verified; no guard anywhere. 1) Live form writes dead section: settings.tsx:168 `await fetch('/api/settings/local-services', { method: 'PUT', ... body: JSON.stringify({ whisperAlignUrl..., whisperTranscribeUrl...` → route.ts:18-21 `await writeLocalServices({...})` → server-settings.ts:261 `raw.localServices = services`. Section is live (settings.tsx:580 `<LocalServicesSection />`). 2) r
- **Fix:** 让两处消费方改读 localServices 节(带 legacy 迁移);或砍掉死表单与 writeLocalServices;同步处理 c067(legacy llm 的 whisper 字段被覆盖问题)。
- **Confidence:** 0.9 · **Verdict:** CONFIRMED

**[P2] P2 · mock/mnemonic 手搓 SSE 解析器零测试,currentEvent 每读重置 — `client/services/mock/mnemonic.ts:84`**
- **Problem:** services/mock/mnemonic.ts:84 的 generateCardStream 自带手写 SSE 解析(逐行、event:/data: 配对、半包携带、JSON.parse 静默 catch)且无测试(同目录 soe/tts 均有);解析器在读循环内 `let currentEvent = ''`,跨网络分片的 event: 与 data: 行会产出空名事件,坏 JSON 行被 catch {} 静默丢弃。
- **Failure scenario:** mock 流式返回分片边界切在 event: 与 data: 之间:事件名丢失 → 前端按未命名 data 处理,卡片类型分派错乱;若 data 行 JSON 损坏则整行静默蒸发,UI 永远等不到该段,流看似正常结束但缺内容。
- **Evidence:** Code says exactly what the finding claims. mnemonic.ts:72-84 (verbatim): `73 let buffer = ''` / `76 while (true) {` / `77 const { done, value } = await reader.read()` / `80 buffer += decoder.decode(value, { stream: true })` / `81 const lines = buffer.split('\n')` / `82 buffer = lines.pop() ?? ''` / `84 let currentEvent = ''` — currentEvent is declared INSIDE the read loop, so only `buffer` survive
- **Fix:** currentEvent 生命周期移出读循环(每完整事件后复位);解析器抽为纯函数并补分片/坏行/半包单测。
- **Confidence:** 0.85 · **Verdict:** CONFIRMED

**[P2] P2 · stores/ 整层零测试,removeMaterial 级联删除无护栏 — `client/stores/material-store.ts:108`**
- **Problem:** stores/(568 行)全部无测试;最险的 removeMaterial(material-store.ts:108)是全库唯一级联删除路径:材料本体 + 媒体 blob + progress/fav:/note: 前缀记录 + 逐条 materialId 匹配的 train: 记录,其注释自标前缀碰撞隐患(『m-1 与 m-10』);seedIfEmpty 首载注入(brief 定向检查 #5)同样无测。
- **Failure scenario:** 删材料清理逻辑改动引入前缀误判(删 m-1 连带 m-10 的进度/笔记)或漏删/多删,无任何测试拦截;用户一键删除材料后其他材料的训练记录被级联抹掉,且不可恢复(IndexedDB 是唯一存储)。
- **Evidence:** Every claim verified against source. (1) Untested, 568 lines: `wc -l client/stores/*` = 568 total (favorite 41, material 162, mnemonic 69, note 71, store 33, vocab 192); no __tests__ dir under stores/, grep for 'stores/' in *.test.* = no hits. Gate run per brief (`cd client && pnpm test`): "Test Files 12 passed (12), Tests 167 passed (167)" — all 12 files are core/ (9) + services/ (3). Stronger th
- **Fix:** 为 removeMaterial 建前缀边界测试集(m-1 vs m-10、无关联记录、blob 缺失容错);seedIfEmpty 补『已有数据不覆盖』用例。
- **Confidence:** 0.85 · **Verdict:** CONFIRMED

**[P2] P2 · app/api BFF 1651 行零测试,文件系统写入入口无护栏 — `client/app/api/hf/[...path]/route.ts:36`**
- **Problem:** 14 条 BFF 路由全部无测试;其中 hf/[...path] 的 parseHfPath(:36)是纯函数,输出直接喂 join(modelPath, cacheKey, file) 的文件系统写与 https://huggingface.co URL 拼接;brief 定向检查 #1/#6(密钥不回显、通配代理路径收敛、上传上限、SSE 清理)全部无自动化守卫。
- **Failure scenario:** 重构 parseHfPath 或 settings mask 逻辑(如 c049/c051 的修复)时回归无红灯:路径收敛补丁被后续改动无声撤销,或 mask 被漏到某个响应分支,直到被利用/手测才暴露。
- **Evidence:** Every factual element verified against HEAD (fdae7f8).

(1) Scope/counts exact: `find client/app/api -type f` = 14 route files; `wc -l` across them = "1651 total". Zero test files under app/api. `client/vitest.config.ts`: `include: ['core/**/*.test.ts', 'services/**/*.test.ts']` — app/api is structurally outside the runner. Ran the brief's read-only gate `cd client && pnpm test`: "Test Files 12 pa
- **Fix:** 对 parseHfPath(恶意 segment 矩阵)、settings 各 GET/PUT 的响应形状(密钥必须 mask)、上传上限行为补 vitest 单测——BFF 路由处理器可直接 import 函数级测试。
- **Confidence:** 0.85 · **Verdict:** CONFIRMED

**[P2] P2 · lib/ 2706 行零测试,空 __tests__ 脚手架漂移;读路径自动迁移写盘 — `client/lib/server-settings.ts:128`**
- **Problem:** client/lib/ 无测试,而 lib/__tests__/ 与 lib/machine-translate/__tests__/ 空目录仍在(machine-translate 模块已不存在,纯漂移);未测的高险逻辑:readLlmConfigs 读路径自动迁移并写 settings.json、deleteLlmConfig 重排默认并回写 legacy 影子副本、getTtsVoices 靠 endpoint 子串推断 provider。
- **Failure scenario:** 自动迁移逻辑回归(如 c059 所述丢 whisper*/mnemonic* 字段)在用户首次打开设置页时就已写坏 settings.json,事后无法定位是哪次读取触发;空目录持续误导贡献者以为有覆盖。
- **Evidence:** Every factual sub-claim verified against HEAD; nothing refutes. (1) Write-on-read CONFIRMED: server-settings.ts:128 `readLlmConfigs()`, L129 `const raw = await readRaw()`, L134 `if (configs.length === 0 && raw.llm) {`, L153 `await writeRaw(raw)` — a write inside a read fn. readRaw/writeRaw use fs/promises (L59 `await readFile(SETTINGS_FILE, 'utf-8')`, L69 `await writeFile(...)`) — truly async, so 
- **Fix:** 删空目录;为 server-settings 的读迁移/删除重排/回写联动补单测(注入内存 fs 或抽出纯函数)。
- **Confidence:** 0.85 · **Verdict:** CONFIRMED

**[P2] P2 · isRetryable 把确定性上游失败当可重试、把 429 当不可重试,三 provider 同错 — `server/src/services/soe/azure.provider.ts:105`**
- **Problem:** azure.provider.ts:105(逐字同款:tencent.provider.ts:186-189、iflytek.provider.ts:229-232)isRetryable 只认 UPSTREAM_TIMEOUT 与 SOE_UPSTREAM_ERROR 可重试、UPSTREAM_RATE_LIMIT 不可——与各自头注释『仅网络错/408/429/5xx 重试』正好相反:401/400 类确定性失败都被裹进 SOE_UPSTREAM_ERROR 而可重试。
- **Failure scenario:** Azure key 失效(401):SOE_RETRY=1 默认下代理把整段音频重发一遍再失败——延迟翻倍(最坏 2×10s 超时)并白白多打一次确定失败的请求;反之时限流(429)注释明示应退避重试,却被一次抛死,学习者看到硬错误。三家 provider 与自家声明同步相反。
- **Evidence:** Every claim verified against source; no guard anywhere. (1) azure.provider.ts:103-106: `const isRetryable = (err: unknown): boolean => { if (!(err instanceof ApiError)) return false; return err.code === ERR.UPSTREAM_TIMEOUT.code || err.code === ERR.SOE_UPSTREAM_ERROR.code }` — SOE_UPSTREAM_ERROR (502, api-error.ts:25) retryable, UPSTREAM_RATE_LIMIT (429, api-error.ts:23) not. Byte-identical at ten
- **Fix:** provider 层把上游 HTTP 状态映射进错误(408/429/5xx→可重试,4xx 其余→不可),isRetryable 按码判断;或最小改:SOE_UPSTREAM_ERROR 不可重试、UPSTREAM_RATE_LIMIT 可重试;配 c047 矩阵单测。
- **Confidence:** 0.85 · **Verdict:** CONFIRMED

**[P2] P2 · 播放器装配块与录音生命周期在三个页面复制且已漂移 — `client/components/pages/player.tsx:181`**
- **Problem:** 『媒体 blob → ObjectURL → HtmlPlayerController + SentencePlayer → load → destroy』与『createRecorder + volume/maxreach + abort + destroy』两大块在 player.tsx:181、training/read-aloud.tsx:103-131、training/shadowing.tsx:138-175 三份复制,deps 与 reconciliation 已经不一致。
- **Failure scenario:** 修播放器资源泄漏/时序 bug(如 65a6358 AbortError 吞噬范围)只落在 player.tsx,训练页保留旧缺陷;三份 deps 漂移导致同 materialId 变化在训练页可能不重建引擎,播放旧字幕时间轴。
- **Evidence:** All core claims verified against source. (1) player.tsx:181-245 assembly block ends `}, [materialId, playable, mediaUrl])` (line 245); teardown lines 240-241 `sp.destroy(); controller.destroy()`. The e54694f patch exists at lines 250-252: `useEffect(() => { playerRef.current?.setSentences(record?.subtitleData?.sentences ?? []) }, [record?.subtitleData])` with comment (247-249) admitting "装配 effect
- **Fix:** 抽 useAssembledPlayer(materialId, record) 与 useRecorderSession 两个 hook,三处消费;与 c019/c027 一并收敛。
- **Confidence:** 0.8 · **Verdict:** CONFIRMED

**[P2] P2 · Recorder.start() 守卫窗口泄漏 MediaStream 与 AudioContext — `client/platform/recorder.ts:110`**
- **Problem:** platform/recorder.ts:110 的 start() 先检查 this.state,但 state 直到 :148(getUserMedia await 完成、流建立后)才置 'recording';权限弹窗期间(:122 await getUserMedia)第二次 start() 通过守卫,双份 MediaStream/AudioContext 建立后旧引用被覆盖。
- **Failure scenario:** 用户首次授权麦克风时快速双击录音按钮:两个 getUserMedia 相继 resolve,后者的 stream/context 覆盖前者 → 麦克风指示灯常亮(活 track 未 stop)、AudioContext 泄漏;第二次录音会话结束时只清理后建的资源,前一个 track 直到页面刷新才释放。
- **Evidence:** Core claim CONFIRMED by direct source read of recorder.ts + all three callers.

recorder.ts (client/platform/recorder.ts):
- L85: `type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'` — no intermediate 'starting' state exists anywhere.
- L110-112 (the guard): `if (this.state === 'recording' || this.state === 'paused') { throw new RecorderError('录音已在进行中，请先 stop/cancel') }` — during the
- **Fix:** 进入 start() 立即置 'starting' 态(或在 await 前登记 in-flight promise,重复调用复用同一 promise);失败路径确保 stop() 释放全部已建资源。
- **Confidence:** 0.8 · **Verdict:** CONFIRMED

**[P2] P2 · zip 导入 STORE 零拷贝主路径不校验 CRC,损坏媒体静默入库 — `client/platform/storage/backup.ts:234`**
- **Problem:** platform/storage/backup.ts:234 导入时 file.slice(dataOffset, dataOffset+uncompressedSize) 直接取字节,不查 entry crc32;core/backup/zip.ts:261-263 的 readEntry STORE 分支只验长度——CRC 校验仅存在于 deflate 回退分支,而含媒体的完整备份恰恰以 STORE 打包。
- **Failure scenario:** 备份 zip 传输/存储中局部损坏(坏块、截断的云盘同步):长度恰好未变而内容错位 → 导入『成功』,损坏 blob 进 IndexedDB 覆盖/混入媒体库;播放时才暴露(解码失败/花屏),且无法区分『导入坏的』还是『之后坏的』。
- **Evidence:** Every code claim verified verbatim. (1) backup.ts:234-238 STORE primary path: `const blob = info.method === 0 ? file.slice(info.dataOffset, info.dataOffset + info.uncompressedSize, mime) // STORE 零拷贝主路径... : new Blob([await readEntry(reader, info)], { type: mime }) // 外部工具重打包的 deflate 条目兜底` followed by `await blobsStore.put(e.key, blob); mediaWritten++` — raw slice, no CRC, counted as success. Exp
- **Fix:** STORE 分支同样执行 crc32 校验(索引已有 crc 字段,zip.ts 里也已有 crc 实现);校验失败报错拒绝该 entry 而非静默继续。
- **Confidence:** 0.8 · **Verdict:** CONFIRMED

(受 cap 20 截断, 另有 40 条已入台账未入榜 —— 见 out/ledger.json)

### Open questions / assumptions
① c050:讯飞签名构造与官方 open-ise 方案相悖且被金向量测试钉死,需真实凭据握手终判(本地无法验证)。② c049:hf 代理路径穿越的实际危害取决于部署形态——本机 dev 使用时受限于本机,若部署到局域网/公网应升 P0。③ c064:Azure PA 的 30s 上限出自其文档,>30s 音频的真实拒绝行为需实测。④ 11 条 refuter 限流无票候选被引擎丢弃(含 2 条 P1,如 dialog 时序、组件卸载写 state 类),未入榜,如需召回可对这批单独补验证。

### Summary
- 最重一簇是『静默丢数据』,三条独立路径全踩 brief 红线:idb.ts 单次瞬时失败即永久回落内存存储且后续 put 仍报成功(c009/c052)、事务 commit 后 abort 时 put() 假成功(c010)、settings.json 读错即以 {} 为底整文件重建并自放大(c011)。
- 安全面三条 P1/P2:BFF 明文回显腾讯/讯飞/Azure 全部密钥且与 llm 路由的 mask 政策自相矛盾(c051)、hf/[...path] 通配代理无 '..' 收敛可路径穿越读任意本地文件/写任意路径(c049)、multipart 上传无大小限制全量缓冲可 OOM 本地 BFF(c055)——单机自用是缓解不是修复。
- 『获取模型列表』这类只读辅助按钮会整体覆写 legacy llm 配置(c067),与 settings.json 无串行化读写竞态(c036)、永不生效的 whisper URL 死配置(c058)、各路由默认配置解析不一致(c059)同根:settings 读写层缺单一事实来源。
- mock 时代脚手架与真实 BFF 并存未清理:TTS 契约三端漂移成死契约(c056)、MockTtsService 生产零调用(c022)、工厂与 AGENTS.md『恒返 mock』声明双双失真(c001)。
- server 侧三个 provider 各有可独立验证的契约级 bug:讯飞签名构造与官方方案相悖(c050, P1)、isRetryable 把确定性失败当可重试/把 429 当不可重试与自家注释相反(c068)、结果 XML base64 分片逐段解码拼接会咬坏跨分片中文字符(c069)。