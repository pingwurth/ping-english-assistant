# 全量代码评审报告

**正面结论**：全量扫描未发现 `dangerouslySetInnerHTML` / `innerHTML` / `eval`（无 XSS 注入面），无 TODO/FIXME 占位残留；`core/` 层确认无 DOM 依赖；recorder 16kHz 单声道输出、player seek 300ms 漂移补偿均符合架构约定。

## 严重问题（必须修复）

### 1. BFF 接口向任意可达主机回传明文 API Key
📍 [client/app/api/settings/llm-configs/route.ts#L44-L50](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/app/api/settings/llm-configs/route.ts#L44-L50)、同样问题见 [client/app/api/settings/soe/route.ts#L23-L30](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/app/api/settings/soe/route.ts#L23-L30)
**问题**：列表接口用 `maskApiKey()` 脱敏，但 `GET ?id=xxx` 分支直接返回**完整明文 apiKey**，无鉴权、无 Origin 校验。`next.config.mjs` 的 `allowedDevOrigins: ['192.168.110.*']` 表明服务监听局域网；还可被 DNS rebinding / 任意网页 CSRF-GET 探测。
**修复**：单条读取也返回脱敏值；需要原值时改为显式 `?reveal=1` + 本机 Origin 白名单；对所有 `/api/settings/*` 加 Host/Origin 校验；默认绑定 `127.0.0.1`，局域网访问改为显式开关。

### 2. HF 模型代理存在路径穿越 → 任意文件读 + 任意路径写盘
📍 [client/app/api/hf/\[...path\]/route.ts#L36-L57](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/app/api/hf/%5B...path%5D/route.ts#L36-L57)
**问题**：`parseHfPath` 拼接 `file` 时未过滤 `..`，构造 `/api/hf/../../resolve/x/../../../etc/passwd` 可读取 `modelPath` 之外任意文件；缓存未命中分支的 `writeFile(localFile, buffer)` 写路径同样可穿越（任意文件覆盖）。
**修复**：
```ts
const norm = normalize(join(modelPath, ref.cacheKey, ref.file))
if (!norm.startsWith(resolve(modelPath) + sep)) throw new Error('invalid path')
```
并对 `org/repo/revision/file` 做 `^[A-Za-z0-9._\-/]+$` 白名单校验。

### 3. IndexedDB 任一事务失败即"永久静默降级内存"→ 用户数据必然丢失
📍 [client/platform/storage/idb.ts#L70-L78](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/platform/storage/idb.ts#L70-L78)
**问题**：`guarded()` 的 catch 不区分错误类型——配额超限（存音频 Blob 极易触发）、事务中断、版本被其他标签页占用，都会把 `useMemory = true` 永久置位。此后所有写入只进内存，界面无任何提示，刷新即丢失全部材料/进度/收藏，直接违背"本地优先落 IDB"的核心承诺。
**修复**：仅对"数据库不可用"类错误降级；`QuotaExceededError` 上抛并触发 UI 提示；把降级状态暴露为 store 字段，在 Shell 顶部常驻"当前未持久化"警告条。

### 4. 删除字幕句后，收藏与学习进度 index 不平移（永久污染落盘数据）
📍 [client/components/pages/player.tsx#L416-L438](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/pages/player.tsx#L416-L438)
**问题**：删句后重排全部 `index`，但只平移了笔记 key；`fav:{materialId}:{idx}` 与 `progress.playedSentenceIndexes` 完全未平移，被删句之后的所有收藏★与"已学过"标记整体前移一句，且立即 `putMaterialRecord` 落盘造成**永久污染**，进度百分比同时算错。
**修复**：抽统一的 `shiftIndexesAfterDeletion(materialId, index)`，同步平移 favorites、`playedSentenceIndexes`、`lastPositionMs` 归属，并重算 `favSet`。

### 5. 对齐服务在 asyncio 事件循环内做重阻塞计算
📍 [server/align_server.py#L158-L181](file:///home/ping/gitProjects/my/ai/ping-english-assistant/server/align_server.py#L158-L181)
**问题**：`async def align()` 内直接同步调用 `whisperx.load_audio()`、首次加载 wav2vec2 大模型（数十秒）、`whisperx.align()`——对齐期间 `GET /health` 挂起、其它请求全部排队，客户端超时/重试会误判服务不可用。对照 `transcribe_server.py` 已正确使用 `ThreadPoolExecutor` + `run_in_executor`，这是遗漏而非设计。
**修复**：
```python
loop = asyncio.get_event_loop()
audio_data = await loop.run_in_executor(_executor, whisperx.load_audio, tmp_path)
result = await loop.run_in_executor(_executor, _align_sync, text, language, audio_data)
```

### 6. CJK 引号清洗正则缺左引号 `“` `‘`，导致整条译文静默丢失
📍 [client/lib/llm/chat-service.ts#L319-L327](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/lib/llm/chat-service.ts#L319-L327)
**问题**：`CJK_QUOTE_RE = /[「」””’’]/g` 中 `”`(U+201D) 写了两次，`“`(U+201C) 与 `‘`(U+2018) 完全缺失——而 `parseCjkArray` 却把 `“` 当合法开引号处理。模型返回 `[1] “hello”` 时清洗后仍是非法 JSON → 该条解析失败 → 静默用英文原文回填中文位，用户看到未翻译内容且无提示。中/日文模型大量使用全角弯引号，命中概率高。
**修复**：`const CJK_QUOTE_RE = /[「」『』“”‘’]/g`，补单测覆盖 `"“…”"` 形态；降级回填时在响应中携带 `partial: true` 让 UI 明确提示。

## 警告（应当修复）

### 7. 字幕解析/AI 转写失败被静默吞掉
📍 [client/components/pages/player.tsx#L405-L414](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/pages/player.tsx#L405-L414)
**问题**：`catch { /* 解析失败静默处理 */ }` 丢弃了 `core/subtitle` 专门设计的带行号 `SubtitleParseError`；转字幕失败仍算"生成完成"。
**修复**：`setError(e instanceof SubtitleParseError ? \`字幕第 ${e.line} 行解析失败\` : '字幕解析失败')` 并 toast。

### 8. 离开页面时续播位置丢失
📍 [client/components/pages/player.tsx#L254-L271](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/pages/player.tsx#L254-L271)
**问题**：`flushProgress` 首行 `if (!p.dirty) return`——用户 seek 后直接返回（未产生新 played 句）时 `lastPositionMs` 不落盘，下次进入从旧位置开始。
**修复**：位置写入与 played 集合解耦，`!dirty` 时只要 `lastMs != null` 也合并写回。

### 9. useTranscribe 无卸载清理 + cancel 未复位编辑态
📍 [client/components/shared/transcribe-shared.tsx#L295-L322](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/shared/transcribe-shared.tsx#L295-L322)
**问题**：hook 持有 `abortRef` 但没有 unmount 时调用 `abort()`：转写中关闭对话框/切页后 fetch 与 setState 继续运行；`cancel()` 未 `setEditing(false)`。
**修复**：`useEffect(() => () => abortRef.current?.abort(), [])`；`cancel()` 补齐 `setEditing(false)`。

### 10. 嵌套 Dialog 互相覆盖 body 滚动锁 & 一次 Esc 关两层
📍 [client/components/ui/dialog.tsx#L21-L34](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/ui/dialog.tsx#L21-L34)、触发场景见 [ai-transcribe-dialog.tsx#L155-L160](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/shared/ai-transcribe-dialog.tsx#L155-L160)
**问题**：每个 Dialog 独立注册 Escape 并把 `body.style.overflow` 置空恢复；`AiTranscribeDialog` 内嵌 `ModelConfigListDialog` 时，内层卸载会解锁外层滚动、一次 Esc 同关两层（丢失正在配置的表单）。
**修复**：维护 open 计数栈，只在栈顶处理 Esc / 最外层卸载时恢复 `overflow`；或改为一层 Dialog 内条件渲染配置面板。

### 11. `URL.revokeObjectURL` 同步紧跟 `click()` → 下载可能被取消
📍 [transcribe-shared.tsx#L28-L35](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/shared/transcribe-shared.tsx#L28-L35)、[player.tsx#L468-L473](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/pages/player.tsx#L468-L473)
**修复**：`setTimeout(() => URL.revokeObjectURL(url), 0)` 或延迟释放。

### 12. recorder 契约字段被静默忽略（契约漂移）
📍 [client/platform/recorder.ts#L110-L120](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/platform/recorder.ts#L110-L120)
**问题**：`RecordOptions{ format, sampleRate, channels }` 被接收但 `process()` 恒用 16kHz 单声道（ADR-5 正确行为），契约却允许传 `{sampleRate: 44100, format: 'mp3'}` 且无任何报错。
**修复**：收窄契约（选项移除或改为只读常量元数据），或非法值显式 throw。

### 13. 服务工厂 `mode` 参数与 mock 字幕缓存构成"未接线分支"
📍 [client/services/index.ts#L40-L50](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/services/index.ts#L40-L50)、[client/services/mock/tts.ts#L130-L145](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/services/mock/tts.ts#L130-L145)
**问题**：`getServices(_mode)` 恒返回 mock，`NEXT_PUBLIC_SERVICE_MODE` 无实现路径；mock 的 `subtitleCache` 与真实 `/api/tts` 链路脱节，契约⑦ `getSubtitle()` 在真实链路永远 miss。
**修复**：实现 mode 分流或删掉该参数与缓存字段，在 contracts.ts 明确字幕归属转写流程。

### 14. start.sh 把同一份参数无脑透传给两个 Python 服务
📍 [server/start.sh#L166-L191](file:///home/ping/gitProjects/my/ai/ping-english-assistant/server/start.sh#L166-L191)
**问题**：`--model-size`/`--preload` 只有 transcribe 定义，`align_server.py` 的 argparse 无此选项 → 后台进程 argparse 报错退出但 `set -euo pipefail` 捕获不到，**对齐服务静默不存在**，前端只能等到超时。
**修复**：按服务分别过滤参数，或后台进程用 `wait -n`/显式端口探活失败即退出。注意：评审子代理提示该脚本中段读取时输出乱码，动手前建议先人工复核 L93-L130 实际内容。

### 15. 转写 BFF 无取消、无超时兜底，异常路径漏清定时器
📍 [client/app/api/transcribe/route.ts#L36-L52](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/app/api/transcribe/route.ts#L36-L52)
**问题**：`alignWithWhisperX` 的 120s 定时器在 fetch 抛错分支未 `clearTimeout`；未透传 `request.signal`，客户端关闭后上游 Python 仍跑完整段音频；整段音频 base64 在内存展开，长视频并发有内存峰值风险。
**修复**：`try/finally { clearTimeout(timer) }`，`request.signal` 一路透传。

## 建议（可以考虑）

16. **SRT 时间戳格式化对负数/NaN 无防御** — [client/core/subtitle/timestamp.ts#L38-L45](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/core/subtitle/timestamp.ts#L38-L45)：异常时间戳会输出 `"NaN:NaN:NaN,NaN"` 写入导出文件。入口做 `Number.isFinite(ms) && ms >= 0` 归零或抛错。
17. **seed 演示数据渗入生产共享组件** — [client/components/shared/player-parts.tsx#L17-L26](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/shared/player-parts.tsx#L17-L26)：`seedSentences` 作默认 props、硬编码 65%/30% 假进度作回落，真实材料 `progress` 缺失时显示别人的假进度。改为必填 props + 零值回落。
18. **长字幕列表无虚拟化 + ref Map 按位置存** — [player-parts.tsx#L184-L227](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/components/shared/player-parts.tsx#L184-L227)：数百句全量渲染；ref Map key 用位置 `i` 而 React key 用 `s.index`，删句后残留 stale ref。ref key 改用 `s.index`，大列表窗口化或 `content-visibility: auto`。
19. **provider 回退方向不一致 + 同算法两份实现** — [tts-service.ts#L40-L50](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/lib/llm/tts-service.ts#L40-L50) vs [asr-service.ts#L36-L46](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/lib/llm/asr-service.ts#L36-L46)：未知 provider 应统一 throw；`groupWordsToSegments` 提到 `core/` 单一实现。
20. **服务端日志打印全量待译文本** — [chat-service.ts#L80-L125](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/lib/llm/chat-service.ts#L80-L125)：隐私/噪声风险，改记条数 + 截断摘要或 DEBUG 门控。
21. **HF 本地模型文件全量读入内存** — [hf route#L94-L131](file:///home/ping/gitProjects/my/ai/ping-english-assistant/client/app/api/hf/%5B...path%5D/route.ts#L94-L131)：数百 MB 权重直接进堆，改 `createReadStream` + 流式 Response。
22. **死代码 / 空目录 / 可读性债务** — `html-player.ts` 的 `ownsElement` 只写不读、`transcribe_server.py` 的 `_load_model()` 无调用点、`lib/__tests__/` 与 `machine-translate/` 为空、多处整页 JSX 单行压缩（player.tsx L531、shell.tsx、player-parts.tsx）、dialog.tsx 缺 `role="dialog"`/焦点陷阱。

## 变更总结

- **安全风险集中在 Next BFF 层**：`/api/settings/*` 明文回传密钥与 `/api/hf/[...path]` 路径穿越是最高优先级修复项；前端无 XSS 注入面，值得肯定。
- **两处会静默、永久损坏用户数据的路径**：IDB 异常即永久降级内存、删句后收藏/进度序号不平移即落盘——本地优先应用应把"存储失败必须可见"作为硬纪律。
- **契约漂移是系统性风险**：recorder options、`getServices(mode)`、mock subtitleCache、provider 回退不一致等，形式上符合"以 contracts.ts 为准"但实质未接线；建议对契约字段做一次"是否真有实现消费"的清点。
- **组件生命周期/资源释放是最密集的中危区**：卸载无 abort、嵌套 Dialog 冲突、revokeObjectURL 过早释放、clearTimeout 漏在异常分支——逐条加清理即可，无需重构。
- **Python 服务侧质量不均**：transcribe 的线程池隔离规范，align 却把重计算压在事件循环上，叠加 start.sh 参数透传问题，"多任务并发"路径实际不可用。

⚠️ **覆盖度说明**：本轮深入走查了 `core/`、`platform/`、`services/`、`stores/`、`lib/`（含全部 BFF 路由）、`types/` 及 player/dialog 相关组件与 `server/*.py`；**未逐行审阅** `server/src/**`（SOE Node 代理）、部分 pages/training 组件、`services/mock/{soe,mnemonic}`、`core/{backup,markdown}` 等。如需对某个模块做专项深挖，告诉我即可。