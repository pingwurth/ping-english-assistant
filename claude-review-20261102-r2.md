# Claude 全仓代码评审报告（第 2 轮 · max）

- 日期：2026-11-02 · `/code-review max 全面审查本仓库所有代码`（--max-findings all）
- 流程：10 个审查角度 → 72 候选 → 去重 → 逐条 1 票对抗验证 → 补漏扫描 +8 → **62 条存活 / 9 条驳回**
- 基线：已提交 HEAD `df69e53` 本身干净（244/244 测试过、`tsc` 0 错）。标【工作区】的发现针对**当前未提交状态**（审查时 15 个未提交文件，`api-guard.ts` 按 md5 `076cb3a6` 钉住），行号为报告时刻实况，**修复前先复核现状**
- 审查期间有并行编辑会话持续推进，2 条候选（`reportSavedRef` 编译断裂、`ALLOWED_HOSTS` 端口放宽）已被当场修掉剔除
- 构成：27 条正确性（含 3 条 P1）+ 3 条 PLAUSIBLE + 32 条清理（复用/精简/效率/层次/规范）

## 修复记录

<!-- 修复时在此登记：日期 + 条目编号 + 处理方式（fixed / skipped / 判不成立+理由） -->

**2026-11-02 批次 1（优先级批：门禁 + P1）**
- #1 fixed：`isPrivateIPv6` 前置 `isIpv6Literal` 结构校验（仅 hex+冒号、≥2 冒号），ULA 判定改为首 hextet `& 0xfe00 === 0xfc00`；`fd.evil.com`/`fc.evil.com` 不再被信任，`[fc00::1]`/`[fd12:…]`/`[fe80::…]` 仍放行；api-guard.test.ts 补回归断言
- #2 fixed：AssociationCard autoLoad 改 `autoTriedRef` 只自动发起一次，失败进 error 态（UI 显示 + 手动重试），消除无限重试风暴与 unhandled rejection
- #3 fixed：streamCard 每轮独立 AbortController（契约本就有 signal 参数，mock 已透传 fetch），切词条/卸载/新一轮即 abort；循环内失效检查、done/error 即 break；错误态重试按钮 `streaming` 期禁用防双流
- #4 fixed：models-route.test.ts:11 类型导入改 `@/app/api/models/route`
- #5 fixed：`isSameOriginRequest` Host 头缺失时回落 `request.url` 的 host（`_selfUrl` 参数启用），undici 测试 Request 不带 Host 的场景转绿
- #12 fixed（并行会话所修，本会话复核确认）：新增 `parseConfiguredHost`，`PING_ENG_ALLOWED_HOSTS` 支持 `https://` 前缀，无效项 console.warn
- 门禁：tsc 0 错；24 文件 255/255 测试通过

**2026-11-02 批次 2（第三节工作区发现复核）**
- #6 fixed（并行会话，复核确认）：onblocked 保持待决不降级内存 + `subscribeIdbBlocked` UI 通知（study-app.tsx 消费）+ 测试
- #7 fixed（并行会话，复核确认）：onversionchange 关连接后 `dbPromise = null` + 自动 reload
- #8 fixed（并行会话，复核确认）：shadowing/recitation 两处 `runTranscribe` 均加 `text.trim()` 守卫
- #9 fixed（并行会话，复核确认）：prefs 先写 + `stagePrefs` 恢复点，IDB 失败回滚
- #10 fixed（并行会话，复核确认）：`!info` 分支 `continue` 不再重复计数
- #11 fixed（并行会话，复核确认）：fetchModelList 加 `AbortSignal.timeout(15_000)`
- #13 fixed（并行会话，复核确认）：`reportDetailFromText` 单次调用；另加 store 层空 transcript 守卫
- #31 skipped：有意取舍——单事务原子导入要求全部 Blob 先构造；自导 zip 恒 STORE 零拷贝不受影响，仅外部重打包 deflate 有内存峰值。如需有界内存须放弃原子性，留待决策

**2026-11-02 批次 3（第四节已提交 HEAD 正确性 + 第五节 PLAUSIBLE，本会话）**
- #14 fixed：recorder `start()` 加代际号，`cancel()/destroy()` 递增；getUserMedia 在作废后 resolve 即归还 track、不续建录音栈；recorder.test.ts 补回归
- #15 fixed：exportSrt 过滤空行（`textZh ?? ''` null 安全），双方全空的句子跳过；补往返无损测试
- #16 fixed：LRC A2 逐词标签 `<mm:ss.xx>` 剥离并收敛为一个空格，不污染词表
- #17 fixed：SRT 块间缺失空行时按「文本区再现时间轴/序号+时间轴」切分后续块，不再静默吞块；错误路径与防御性测试口径不变
- #18 fixed：LRC 只剥离行首标签串与行内时间形态标签，行中 `[my:note]`/`[Chorus: 2]` 等括注保留为歌词内容
- #19 fixed：removeMaterial 级联调用 `updateFrequencies([], id)` 撤账；material-store.test.ts 补 frequency/materialCounts 回收用例
- #20 fixed：removeEntry/removeBook/clearEntriesByBook 连带删 `mnemonic:{entryId}`；initVocab 增加启动清扫治愈历史孤儿；新建 vocab-store.test.ts 四例
- #21 fixed：azure 仅 `TimeoutError` 映射 UPSTREAM_TIMEOUT，其余网络错映射 SOE_UPSTREAM_ERROR+reason 走 soe-retry 重试；新建 azure-retry.test.ts 三例
- #22 fixed：收敛三份 WAV 时长解析为 `lib/wav-duration.ts`（RIFF 校验+chunk 遍历+对齐 padding），dashscope/mimo/transcribe 统一引用；新建 wav-duration.test.ts 四例
- #23 fixed：read-aloud restart 直接调用 resetSentenceState，不再依赖单句材料不触发的 `[cursor]` 效果
- #24 fixed：tts route `AbortSignal.any(request.signal, 300s 超时)` 贯穿 tts-service→两 provider→音频下载 fetch；AbortError 干净 504
- #25 fixed：transcribe `formData.get('audio')` 加 `instanceof Blob` 运行时校验，文本字段穿透回干净的 400
- #26 fixed：start.sh start_both/start_all 去掉 exec、前台运行 + `trap 'kill …' EXIT` 回收后台 Python 进程；start_soe（无后台子进程）保持 exec
- #27 fixed：puzzle shuffle 兑现「恒等再洗」承诺（上限 8 次 + 首尾对调兜底防病态 rng 死循环）；补两例
- #28 fixed：note-markdown 分隔行放宽到 GFM 单短横 `^:?-+:?$`；补一例
- #29 fixed：sentence-player setSentences 重置 rangeEndMs，试听区间停点不跨句集残留
- #30 fixed：player toggleFavorite 改函数式 setState，IDB 往返窗口内的交错收藏不再互相覆盖
- 门禁：client tsc 0 错 + 27 文件 277/277（较基线 +22 回归用例）；server tsc 0 错 + 9 文件 54/54（+3 azure 回归）

**2026-11-02 批次 4（第六节高价值簇：服务端收敛 + 错误统一 + IDB 并行化，本会话）**
- #34 fixed：SOE 三 provider 逐字拷贝的重试循环收敛为 soe-retry.ts 的 `withSoeRetry(env, fn, signal)`；`abortableSleep` 自 iflytek 上移共用
- #35 fixed：可重试错误重发前退避 200ms→400ms（上限 500ms），signal 中止即时打断退避；限流窗口内不再毫秒级重连浪费唯一一次重试
- #48 fixed：errors.ts 新增 `toLlmErrorResponse()`（translate/mnemonic 的 statusMap 口径），transcribe/tts 的 LlmError 从一律 500 改为统一映射——「API Key 未配置」四路由一致返回 400
- #50 fixed：translateTexts 改 3 路有界并发块池（按块索引回填，结果顺序不变），任一块失败快速失败并中止在途块；新建 translate.test.ts 三例（乱序回填/快速失败/预中止零请求）
- #54 fixed：player 页 getMediaBlob/favoriteSentenceIndexes/listNotes/getProgress 四读 Promise.all 并发（原五连串行事务）
- #55 fixed：favorites loadGroups 逐材料串行 getMaterialRecord 改并发
- #56 fixed：settings 备份统计与 backup.ts 完整备份清单阶段的逐 id 串行 blobsStore.get 均改并发
- #57 fixed：loadProgressPercents 改 `getAllEntriesByPrefix('progress:')` 单事务批量读（records v3 原语，补齐批量改造遗漏调用点）
- 门禁：client tsc 0 错 + 28 文件 280/280 + `next build` 通过；server tsc 0 错 + 54/54
- 遗留：第六节其余 23 条清理项未修（#32/#33/#36–#47/#49/#51–#53/#58–#62），含渲染性能簇（#51/#52/#53，需 agent-browser 实测）、legacy 影子副本+死端点删除（#40/#41，涉及存量数据迁移）与长尾去重

**2026-11-02 批次 5（渲染性能簇 #51/#52/#53，agent-browser 实测）**
- #51 fixed：三训练页高频 state 全部改自订阅子组件（范本 LiveControlBar）——
  - wave-bars.tsx 新增 `LiveRecordingWave`（自订阅 recorder ~30Hz volume + 200ms 计时），recitation/read-aloud 摘除 level/elapsed/timerRef；
  - shadowing 本地 `LivePlayProgress`（自订阅 player 10Hz timeupdate + 计时），摘除 playMs/recMs/timerRef；
  - 实测（agent-browser + react-devtools 渲染剖析，种子句临时压到 300，修复版 :3000 vs HEAD 基线 worktree :3101，麦克风 getUserMedia/MediaRecorder/Analyser 假件）：
    - recitation 录音中 5 秒窗：Recitation 自身渲染 **616.7ms → 0.3ms**，子树 1538ms → 110ms（35Hz 更新收进 LiveRecordingWave+WaveBars 178ms 小子树）；声波动画/计时功能不回归；空闲态 4 秒 0 render（无泄漏）
    - shadowing 录音中：基线 OriginalTextCard（300 句列表卡）每秒重渲染 ~27ms self；修复版录音期间 ≈0，进度更新收在 LivePlayProgress 26ms 子树
    - 注：剖析中两侧均见的 ~35Hz Next dev-router 层重渲染为 dev overlay 随 root commit 的产物（空闲态为零、生产构建不存在），不影响对比结论
- #52 fixed：word-bubble `useMemo` 预归一化 items，selectionchange 回调只剩 includes；
  - 实测（种子句压到 2000，页内隔离微基准，最坏全量扫描路径）：旧路径 **1.403ms/事件**（60Hz 拖选 = 每秒 84ms 主线程）→ 新路径 **0.030ms/事件**（47×）；两侧气泡功能实测弹出正常
- #53 fixed：/api/tts 响应改 multipart/form-data（meta JSON + 原始音频字节），客户端 `res.formData()` 原生解析，删除 atob+逐字节 charCodeAt 循环与 33% base64 膨胀；tts-route.test.ts 三例（formData 解析含字节一致性 / LlmError 400 / 未配置 400 不出网）
- 压测脚手架已还原：种子句恢复 HEAD、基线 worktree 已删、双 dev server 已停
- 门禁：client tsc 0 错 + 29 文件 283/283 + `next build` 通过；server 54/54
- 遗留更新：第六节余 20 条（#32/#33/#36–#47/#49/#58–#62）

**2026-11-02 批次 6（清理项收口 #32/#33/#36–#47/#49/#58–#62）**
- #32 fixed：新增 `lib/llm/asr-audio.ts`，DashScope 原生时间戳与 WhisperX 对齐共用 `WordTimestamp`/`groupWordsToSegments`
- #33 fixed：TTS 保存到设备改走 `lib/download.ts` 的 `downloadBlob`，删除页面内第 5 份 `<a download>` 拷贝
- #36 fixed：`callLlmTranscribe`/`callLocalTranscribe` 从 transcribe-shared 导出，recording-review 复用同一条转写梯子并透传服务端可读错误
- #37 fixed：MiMo/DashScope 共用 `asr-audio.ts` 的 `inferMimeType`
- #38 fixed：`LlmError` 改继承 contracts 的 `ApiError`；`toApiError` 统一识别网络错误，`toLlmError` 只做 LLM 错误码映射
- #39 fixed：`formatElapsed` 改为秒级截断并向 `player-parts.formatDuration` 转发，59900ms 统一显示 00:59；补边界测试
- #40 fixed：删除 `raw.llm` 影子副本同步；旧 `llm` 首次读取自动迁移为默认 `llmConfigs` 后删除，CRUD 只写 configs/defaultId；POST 补齐 whisper 字段
- #41 fixed：删除无调用方的 `/api/settings/llm` 死端点，LLM 配置唯一 API 收敛到 `/api/settings/llm-configs`
- #42 fixed：ModelConfigDialog 的 8 个服务字段 state 收敛为 `Record<ServiceKind,{model,endpoint}>`，新增服务只补SERVICE_TYPES 与类型映射
- #43 fixed：IDB object-store/index 双读统一走 `entriesSnapshotFromSource`，事务生命周期收口逻辑只剩一份
- #44 fixed：mnemonic 五张卡片抽 `MnemonicSectionCard`，Card/CardHeader/skeleton 模板不再五处复制
- #45 fixed：useTranscribe 的 `reset` 直接复用 `cancel`，两个导出名保留但状态复位实现唯一
- #46 fixed：local/model 两条转写链统一到参数化 `executeTranscribe`，健康检查只保留 local 分支差异
- #47 fixed：编号翻译严格/部分回填共用 `collectNumberedTranslations`，[N] 解析规则唯一
- #49 fixed：api-guard 导出唯一 `sameOriginGuard(request)`；proxy 与 5 个 settings 路由复用，403 响应形状统一
- #58 fixed：新增 material-store `putProgress()` 与 `shiftSentenceReferences()`；播放器删句不再逐家族直写 records/progress
- #59 fixed：training-record-store 新增 `getTrainingStats()` / `getLatestTrainingRecordsByMaterial()`；设置页与训练中心不再解析 train: 记录内部形状
- #60 fixed：schema 新增 `MATERIAL_OWNED_RECORD_PREFIXES` 作为材料属主记录唯一清单；removeMaterial 由清单驱动并保留 m-1/m-10 精确边界测试
- #61 fixed：useSentencePlayer 返回稳定 `playerRef` 并在 effect 内维护，四个训练页删除渲染期手写 ref 镜像
- #62 fixed：TTS 分句/时间轴/SRT 上限下沉 `core/tts/timeline.ts`；BFF、Kokoro、页面不再 import services/mock；mock 仅保留兼容 re-export
- 门禁：client tsc 0 错 + 29 文件 283/283 + `next build` 通过（已删除 settings/llm 后路由清单 15/15）；server tsc 0 错 + 9 文件 54/54
- 遗留：仅 #31 维持 skipped（原子导入 vs 外部 deflate 全量物化的有意取舍）

---

## 一、P1 安全 / 正确性（3）

- **1. `client/lib/api-guard.ts:62`**【工作区·P1 安全】`isPrivateIPv6` 用 `startsWith('fc'/'fd')` 字符串前缀判 ULA，无 IP 字面量结构校验，任意以 fc/fd 开头的 DNS 域名被判可信 IPv6 主机。
  场景：攻击者注册 `fd.evil.com`，A 记录指向 127.0.0.1（TTL 0 rebind），受害者在攻击者页面发起同源 fetch → Host/Origin 同为 `fd.evil.com:3000`，`isTrustedRequestHost` 实测返回 true → 恶意页面获得 BFF 全部同源权限：`PUT /api/settings/soe` 改 proxyUrl 窃取 Azure/Tencent/iflytek 明文密钥、覆盖全部配置、消耗 LLM 额度。实测 node 复现 `isTrustedRequestHost('fd.evil.com:3000')===true`，而 IPv4 侧 `10.0.0.1.evil.com` 正确拒绝——Next dev/prod 均不拦 `/api/*` 的 Host（block-cross-site-dev 只管 `/__nextjs`、`/_next`），api-guard 是唯一防线且文件头自 declare 防的就是 DNS rebinding。
- **2. `client/components/pages/mnemonic.tsx:297`** AssociationCard autoLoad effect 把 `loading` 放进依赖且失败路径无 error 哨兵，失败即无限重试循环。
  场景：difficulty=hard 词条打开页面（autoLoad=true），`/api/mnemonic` 返回非 2xx（BFF 未配 LLM/断网）→ finally `setLoading(false)` → effect 因 loading 变化重跑 → 再次 POST → RTT 节奏的重试风暴持续轰击 LLM 后端，且 try/finally 无 catch 使每次失败都是 unhandled rejection；组件仅 data/loading 两个 state，无任何终止条件。
- **3. `client/components/pages/mnemonic.tsx:538`** streamCard 消费 SSE 流无 AbortSignal 不 break 生成器，cancelled 标志只在流启动前检查。
  场景：词条 A 流式生成中通过历史跳转切到词条 B（react-router 不卸载同路由组件）：A 的 `done` 事件无条件 `setCard(A 的卡)`、`field` 持续 setPartialCard，B 页面最终显示 A 的助记卡（词 B + 卡 A 混排）；即使正常返回列表，fetch/reader 也继续在后台消费完整 LLM 流且 setState/saveMnemonic 在卸载后照跑；同词条双流也可触发（重试按钮无 disabled、error 事件不 break 循环）。

## 二、工作区门禁红：tsc / 测试（2）

- **4. `client/app/api/__tests__/models-route.test.ts:11`**【工作区·新增文件】类型导入 `'../route'` 路径错误（解析到不存在的 app/api/route.ts，实际在 app/api/models/route.ts），打断 tsc 门禁。
  场景：运行 `npx tsc --noEmit` 报 TS2307: Cannot find module '../route'——当前全仓唯一类型错误（第 19 行运行时导入已正确用 `@/app/api/models/route`，仅 11 行类型路径错），`pnpm build` 因构建期类型检查失败。
- **5. `client/lib/api-guard.ts:88`**【工作区】`isSameOriginRequest` 重写后完全忽略 `request.url`（`_selfUrl` 参数闲置），只认 Host 头，使 5 个既有 SOE 路由测试 403 变红。
  场景：route.test.ts 的 makeRequest 构造 `new Request('http://localhost:3000/...')` 不带 Host 头（undici Request 不自动加）→ `isTrustedRequestHost(null)` 返回 false → 5 个密钥掩码回归用例全 403（当前 5 failed / 250 passed）；真实部署 Host 头恒在，但声明的 `pnpm test` 门禁在工作区是红的——要么测试补 Host 头要么 guard 恢复 url 兜底。

## 三、工作区未提交改动新增缺陷（8）

- **6. `client/platform/storage/idb.ts:72`**【工作区】onblocked 分支删掉了 10s 超时降级后只 console.warn，v3 升级被旧标签页阻塞时 openDb 永不 settle。
  场景：用户有一个跑旧构建（onsuccess 无 onversionchange close，连接永不释放）的后台标签页，再开新构建 → `indexedDB.open(v3)` 触发 onblocked → dbPromise 永久 pending → initMaterials 第一步 recordsStore.get 就挂起 → materialStore.ready 永不置 true，所有页面停在「正在加载材料库」且无任何用户可见提示，只能手工关旧标签页；模块头注释（第 10 行『长时间 blocked 才降级内存』）与实现已矛盾。
- **7. `client/platform/storage/idb.ts:63`**【工作区】onversionchange 里 `db.close()` 后 dbPromise 仍缓存已关闭连接，无重开/刷新逻辑，本标签页后续读写永久失败。
  场景：未来 DB_VERSION 升 v4：旧标签页收到 versionchange 后 close 自己，但 dbPromise 已 resolve 的还是 closed db → 之后每次 `db.transaction()` 同步抛 InvalidStateError → wrapRead 静默吞成空结果（材料库/训练成绩显示为空，看似数据全丢）、wrapWrite 抛错被 appendTrainingRecord 调用方 `.catch(() => {})` 吞掉（训练记录静默丢失），直到用户刷新页面。
- **8. `client/components/pages/training/shadowing.tsx:215`**【工作区】转写返回后不区分空 transcript 即落库训练记录，静音录音被存成 0 分成绩（recitation.tsx:131 同款）。
  场景：用户误触开始跟读后立即结束（或麦克风静音）：ASR 返回空串，页面提示『未识别到语音内容』，但 appendReportTrainingRecord 已写入 total/accuracy/completeness 全 0 的 `train:` 记录并成为该材料×模式最新一条 → 训练中心「上次：综合 0 分」及统计被非真实尝试覆盖；守卫只有 reportSavedRef.current，无 text 非空判断。
- **9. `client/platform/storage/backup.ts:203`**【工作区】prefs 在 IDB 原子事务提交成功后才写入，replacePrefs 抛错时整次导入向 UI 报失败但数据已实际落库。
  场景：Safari 隐私模式/iOS WebView localStorage 配额满：putAllAtomic 已提交 materials/records/blobs，随后 replacePrefs 第一个 setPref 抛错 → importZipBackup 上抛 → 设置页显示「导入失败」，但数据已全部写入；用户换 skipExisting 策略重试得 allKeys 全命中 → materialsWritten=0，误以为备份是空的。
- **10. `client/platform/storage/backup.ts:293`**【工作区】mediaMissing 双重计数：openBackupZip 已统计清单缺条目数，导入循环对同一批条目再次自增。
  场景：完整备份 zip 缺 1 个媒体条目（manifest 有、zip 无、本机 blobs 也无）→ openBackupZip 算 missingInIndex=1，planImport 不看 zip 索引所以 toWrite 含该条 → 循环里 `!info` 再 +1 → 预览弹窗显示「缺失 1」而导入摘要显示「缺失 2」，用户以为备份损坏程度翻倍。
- **11. `client/app/api/models/route.ts:24`**【工作区】fetchModelList 的 fetch 无 AbortSignal/超时（GET 与 POST 共用）。
  场景：用户在配置对话框填了指向黑洞/被墙地址的 baseUrl（如 `https://10.255.255.1/v1`）→ POST /api/models 悬挂数分钟（undici 300s 默认兜底前无任何反馈）→ 前端 setFetchingModels 持续 true、按钮禁用转圈，只能刷新页面。
- **12. `client/lib/api-guard.ts:27`**【工作区】`PING_ENG_ALLOWED_HOSTS` 值带协议前缀时被 parseHost 静默误解析，白名单永不命中且无任何提示。
  场景：用户按直觉配置 `PING_ENG_ALLOWED_HOSTS="https://mybox.example.com"`（仓库无格式文档）→ 唯一冒号在 'https' 后 → parseHost 返回 `{ hostname: 'https', port: '//mybox.example.com' }`（实测）→ 真实 Host `mybox.example.com` 永不匹配 → 全部非 GET API 与 settings 读写 403，fail-closed 无害但排障极难。
- **13. `client/stores/training-record-store.ts:51`**【工作区】appendReportTrainingRecord 对 reportDetailFromText 连调两次分别取 score 与 detail。
  场景：score 来自第一次调用、detail.total 来自第二次：函数当前纯故数值一致，但后续引入非确定因素（fluency 接入计时）时列表 score 与详情 detail.total 静默分叉；同时是双份 LCS 型 diffWords DP 的纯浪费——算一次存局部即可。

## 四、已提交 HEAD 正确性（15）

- **14. `client/platform/recorder.ts:140`** cancel()/destroy() 对未决 getUserMedia 无记忆，权限弹窗期间离开页面后用户点『允许』，start() 无条件续建全套录音栈。
  场景：跟读页点开始 → 权限弹窗 → 用户离开页面（unmount 调 rec.destroy()，此时 stream/mediaRecorder 均 null 清理为空操作）→ 用户点『允许』→ getUserMedia resolve 后代码无条件建 AudioContext/MediaRecorder.start(250)/volume 轮询/60s maxTimer → 麦克风僵尸采集最长 60 秒（标签页录音指示灯常亮），事件发给已卸载组件；resolve 后无任何 cancelled/generation 检查（类字段里根本不存在）。
- **15. `client/core/subtitle/index.ts:82`** exportSrt 对 textEn 为空但 textZh 非空的句子导出出块内空行，生成的 SRT 无法再被本应用解析（实测复现）。
  场景：导入纯中文多行 SRT（splitBilingual 多行全中路径得 textEn=''）→ 播放器导出字幕得到 `1\n时间轴\n\n中文…\n` → 重新导入时空行触发 flush 把块判无时间轴 → 抛 SubtitleParseError('时间戳格式无法识别') 且块数据静默丢失；lib/translate.ts:110 是真实调用方——合法输入→导出→即不可逆。
- **16. `client/core/subtitle/lrc.ts:22`** 增强型 LRC（A2 格式）行内逐词时间标签 `<mm:ss.xx>` 未剥离，混入正文污染词表（实测复现）。
  场景：导入网易云/QQ 音乐导出的 `[00:12.30] <00:13.50>you <00:14.00>know` → textEn 原样保留 → splitWords 得 `['00:13.50>you','00:14.00>know']`，听写目标词、九宫格词块全部带时间戳垃圾，dictation diff 与拼句判定错乱；LRC_TS_HEAD_RE 只匹配 `[...]` 形态。
- **17. `client/core/subtitle/srt.ts:47`** 块间缺失空行的 SRT 后续块的序号行+时间轴行被静默吞进上一块文本，不报错（实测复现）。
  场景：手编/拼接错误的 SRT 第 1、2 块间无空行 → findIndex 只找首个时间轴行，group.slice(timingIdx+1) 把其后所有行当文本 → 解析只得 1 句且 words 含 `00:00:03,000` 等垃圾词，第 2 块时间信息不可恢复地丢失且无任何错误提示。
- **18. `client/core/subtitle/lrc.ts:12`** LRC_TS_HEAD_RE 第二分支 `[\w+:[^\]]*]` 无 ^ 锚定且 g 全局替换，行中段的 `[xx:yy]` 文本被从歌词内容删除（实测复现）。
  场景：歌词行 `[00:10.00]the answer [my:note] is here` → content 变 `the answer  is here`（[my:note] 被吞留双空格）；凡正文含 `[Chorus: 2]`、`[Kanye:]`、舞台指示等『词+冒号』括注即丢字，与头注释『只跳过元数据行』的意图不符。
- **19. `client/stores/material-store.ts:169`** removeMaterial 级联不回收生词词条 materialCounts 中该材料的贡献，删材料后 vocab frequency 永久虚高。
  场景：导入材料 M（'apple' 出现 50 次）→ updateFrequencies 记 materialCounts[M]=50 → 删除 M：removeMaterial 全函数无一个 vocab 调用，而 updateFrequencies 只在导入/重导入/删句路径被调，重导同文件也是新 UUID → 词条 frequency 永久显示 50，违反 types/vocabulary.ts:31 自述不变量『frequency = materialCounts 各值之和』。
- **20. `client/stores/vocab-store.ts:125`** removeEntry/removeBook/clearEntriesByBook 删除 vocabentry 时不清理其从属记录 `mnemonic:{entryId}`，孤儿永久累积且无 sweep 兜底。
  场景：加词 → 生成助记卡（写入 mnemonic:{entryId}）→ 删词/清空生词本 → mnemonic 记录永久残留：entryId 是 UUID 不会复现，clearMnemonic 全库唯一调用点是刷新卡片场景，RECORD_KEY_PREFIXES.mnemonic 全库零引用（对照 train: 有启动清扫）→ 每次全量备份导出/导入都搬运死数据，无上限累积。
- **21. `server/src/services/soe/azure.provider.ts:73`** Azure 把所有 fetch 异常（含 ECONNRESET/DNS 失败等连接层错误）统一映射为 UPSTREAM_TIMEOUT，而该码在 soe-retry 里被短路判死永不重试。
  场景：SOE_PROVIDER=azure 时上游 TCP 瞬断/DNS 抖动（undici 下都是 'fetch failed'）→ catch 分支抛 UPSTREAM_TIMEOUT → soe-retry.ts:16 在 reason 分支之前直接 return false → 单次尝试即 504 给用户重试整次跟读；同样的瞬断在 tencent/iflytek 走 SOE_UPSTREAM_ERROR+reason 自动重试一次成功；且错误码误报『超时』误导排障——azure.provider.ts:13 头注释自己声称『网络错要重试』。
- **22. `client/lib/llm/providers/dashscope-tts.ts:98`** parseWavDuration 在固定偏移 40 读 data 大小、不校验 RIFF 头不做 chunk 遍历（mimo-tts.ts:72 逐字拷贝），带 LIST/INFO chunk 的 WAV 时长算错。
  场景：上游发出 fmt 与 data 之间夹 26 字节 LIST chunk 的 WAV → 偏移 40 读到的是 LIST 大小 → 实测 1000ms 音频算出 1ms → tts route 的 `durationMs||1000` 保住 1 → ratio≈0 把全部 SRT 时间轴压缩到零、进度条分母错误；app/api/transcribe/route.ts:152 probeWavDurationMs 是已修好的第三份（RIFF 校验+chunk 遍历）却未收敛——应统一到后者的实现。
- **23. `client/components/pages/training/read-aloud.tsx:172`** restart 依赖 [cursor] 的重置 effect 单句材料时 cursor 恒 0 不触发，仅补偿清了 recordingUrl，phase/result/error 残留上一轮。
  场景：单句材料（或收藏 scope 恰一句）完成跟读出分后点「再来一轮」：setCursor(0) 与旧值 Object.is 相同 → 重置 effect 不跑 → phase 仍 'scored'、旧 ScorePanel 继续渲染、totals 已清空 → 随后小结在已评分句上显示『0 分（0 句）』；作者注释只补了 recordingUrl 一处。
- **24. `client/app/api/tts/route.ts:77`** generateTts 调用未传 request.signal 也无超时（tts-service 与两个 provider 的 fetch 均无 signal），对照 translate/mnemonic 路由有 120s 超时+AbortSignal.any。
  场景：用户在 TTS 生成中取消/关页 → 浏览器 fetch 中止但 BFF 继续等待上游完整合成（长文本数十秒~分钟，计费照常白耗）；上游接受连接后不回包则挂到 undici 默认 ~300s，期间 UI 无 504 只能干等；dashscope-tts.ts:85 二次音频 URL 下载同样裸奔。
- **25. `client/app/api/transcribe/route.ts:188`** formData.get('audio') 直接 as File 无运行时类型校验（对照 soe/evaluate 有 instanceof Blob 校验），文本字段穿透到下游抛 TypeError。
  场景：`curl -F audio=hello POST /api/transcribe`（可信 Host 无 Origin 即放行）→ audioFile 实为 string → provider 里 audioFile.arrayBuffer() 抛 'not a function' → 路由 catch 返回 500 且 error message 为引擎内部 TypeError 文本而非干净的 400 参数错误。
- **26. `server/start.sh:225`** start_all/start_both 用 exec pnpm start 占前台，两个 Python 后台进程无 trap 清理，前台死掉后成孤儿占端口与显存。
  场景：`./start.sh --server all` 启动后 SOE 代理崩溃或被 kill（实测复现：后台 uvicorn 存活、reparent 到 init、端口保持占用）→ 8765/8766 被占 + CUDA 显存不释放 → 再次 start.sh 绑定端口失败或 OOM，旧进程无日志输出生根难查；缺 `trap 'kill $ALIGN_PID $TRANSCRIBE_PID' EXIT`（注：Ctrl+C 因 uvicorn 自装 SIGINT handler 会正常退出，不属此列）。
- **27. `client/core/training/puzzle.ts:45`** shuffle 注释承诺『结果恰与正序相同时再洗一次避免无需拼开局』，实现只做单趟 Fisher-Yates 无重洗。
  场景：rng 产出恒等排列（注入确定性 rng 的测试/特定种子下概率放大）→ 九宫格初始顺序恰为答案顺序出现『无需拼』开局；2 词短句无干扰词时（grid 仅 2 格）Math.random 下 50% 概率正序开局，与 :44 注释声明的防重行为不一致。
- **28. `client/core/markdown/note-markdown.ts:55`** 表格分隔行判定要求每格至少 2 个连字符（`-{2,}`），GFM 常见的单短横分隔 `| - | - |` 不被识别（实测复现）。
  场景：用户笔记粘贴外部 GFM 表格（单短横分隔行）→ isSeparatorRow 判否 → `-`,`-` 作为数据行渲染成表格首行，表头/数据错位多一行垃圾；文件头已声明有意子集，属互操作缺口而非笔误。

## 五、PLAUSIBLE·当前无调用方踩中（3）

- **29. `client/core/player/sentence-player.ts:157`** setSentences 重置 loopIndex/lastIndex 但不重置 rangeEndMs；seekTo/handleEnded 也不清理，试听区间停点跨场景残留。
  场景：任何未来调用方在同一实例先 playRange(90000,95000) 再 setSentences(new)（或暂停后直接 play()）→ 进度一越过旧 95000ms 被 handleTimeUpdate 无故 pause；现状：setSentences 唯一调用方 player.tsx 从不 playRange，三个 playRange 页面换句集走 destroy 重建，故当前不可触发。
- **30. `client/components/pages/player.tsx:409`** toggleFavorite 在 await setFavorite 前后读渲染闭包里的 favSet（无函数式 setState/ref 镜像），后一次覆盖前一次。
  场景：两次不同句子的收藏在 ~几 ms 的 IDB 往返窗口内交错（当前唯一入口是当前句星标按钮，人类操作 ~200ms 难以踩中）→ 第二个 handler 以旧 favSet 计算 nextSet 覆盖 → 句 3 星标 UI 消失但 IDB 已收藏，重进页面才恢复；对照 :496 删除路径已用函数式更新。
- **31. `client/platform/storage/backup.ts:299`**【工作区】zip 导入重构后所有待写媒体 Blob 存活到单事务 putAllAtomic 才释放，破坏旧实现逐条 put 的有界内存。
  场景：导入被外部工具重打包成 deflate 的完整备份（自导 zip 恒 STORE 零拷贝不受影响）→ 每条 `new Blob([await readEntry(...)])` 全部膨胀后同时驻留至事务提交 → 数百 MB 媒体在移动端 Safari 常驻内存，可能 jetsam OOM；需 iOS 实测确认，Chrome 大 Blob 落盘可自愈。

## 六、清理：复用 / 精简 / 效率 / 层次（31）

### 重复实现收敛

- **32. `client/app/api/transcribe/route.ts:225`** WhisperX 词级时间戳→句级 segments 的整段分组算法（含 WordTimestamp 接口）是 dashscope-asr.ts groupWordsToSegments+buildSegment 的逐行拷贝。改分句规则必须同步两处，漏改则两种来源生成不一致字幕且无报错。
- **33. `client/components/pages/tts.tsx:349`** saveToDevice 手写 createElement('a')+click+remove 下载，绕过 lib/download.ts 自述『全应用唯一 downloadBlob 实现』（含 Safari 大 blob 延迟 revoke 修复）。第 5 份下载实现回潮，后续浏览器兼容修复不覆盖 TTS 保存按钮。
- **34. `server/src/services/soe/tencent.provider.ts:60`** SOE 重试循环（attempts 计数+isSoeRetryable 判定+lastErr 兜底）在 azure/tencent/iflytek 三个 provider 逐字拷贝三份，soe-retry.ts 只导出判定函数。重试策略演进要改三处，漏改即语义漂移——azure 那份的错误分类已与另两份分叉（见 #21）正是这份拷贝的维护税实证；应收敛为 `withSoeRetry(env, fn)`。
- **35. `server/src/services/soe/tencent.provider.ts:62`** 可重试错误 catch 后零退避立即重发（三家共性），限流窗口内第二次请求大概率再撞。腾讯 4006 并发超限或上游 429 → 毫秒级重连重发 → 再撞同一限流窗口 → 唯一一次重试被浪费并多打一发上游；iflytek.provider.ts 已有 abortableSleep 可直接承担 200-500ms 退避。
- **36. `client/components/pages/training/recording-review.tsx:29`** transcribeRecording 的 attempt() 重新实现 FormData POST + res.ok 检查 + 本机/云端梯子，与 transcribe-shared.tsx 的 callLocalTranscribe/callLlmTranscribe 并行且已漂移：transcribe-shared 失败时透传服务端 data.error（可读原因），recording-review 只抛 `${url} → ${res.status}`，训练页报错质量与转写页不一致。
- **37. `client/lib/llm/providers/mimo-asr.ts:83`** inferMimeType（扩展名→MIME 映射）与 dashscope-asr.ts:146 逐字重复。新增音频格式只改一份时，两条 ASR 链对同一文件的 data:URI MIME 不一致，排查被误导到供应商差异；应下沉 providers 共享模块。
- **38. `client/lib/llm/errors.ts:10`** LlmError+toLlmError 与 services/contracts.ts 的 ApiError+toApiError 同构两份且已漂移（连 AbortError→'ABORTED' 判定都相同）。toLlmError 识别 fetch failed/ECONNREFUSED 网络错误，toApiError 不识别一律 'INTERNAL' → 统一错误码时漏改一份，旧新代码对同一故障给出不同 code 与文案。
- **39. `client/core/training/scoring.ts:58`** formatElapsed（Math.round 四舍五入）与 player-parts.tsx:28 formatDuration（全程截断）是同一 mm:ss 格式的两份漂移实现。59900ms：训练小结显示 '01:00'、播放器显示 '00:59'——同一时长跨界面差 1 秒；player-parts.tsx:27 注释宣称『全应用唯一实现…口径统一』被直接证伪；core 实现转发导出即可收敛。
- **40. `client/lib/server-settings.ts:142`** legacy raw.llm 段是 llmConfigs+defaultLlmConfigId 的可推导影子副本，在 add/update/delete/setDefault 四处手工同步 + readEffectiveLlmSettings 优先读它 + 迁移字段清单。注释自证曾漏 mnemonic*/whisper* 两对造成数据丢失，且 whisper* 至今仍漏在 llm-configs POST 的字段清单（route.ts:81 只收 12 字段）外——经 POST 创建的配置永远带不上自建 whisper 地址；新增 LlmSettings 字段要同步 5 处。更简形式：readEffective 直接取默认项 toLlmSettings，删全部影子同步。
- **41. `client/app/api/settings/llm/route.ts:35`** 整个 /api/settings/llm GET/POST 路由是死端点：全库零 fetch 消费方（唯一文本引用是 model-config-list-dialog.tsx:231 的历史注释）。~120 行无调用方的代码维持『单配置时代 API 仍在』的假象；其 POST 是 llmConfigs CRUD 体系之外唯一直接整体写 raw.llm 的第二写者——只要它存在，#40 的影子副本就无法安全删除，两处死重量互相锁死。
- **42. `client/components/shared/model-config-list-dialog.tsx:153`** ModelConfigDialog 为 4 种服务 × (model,endpoint) 声明 8 个独立 useState，再写 getModel/setModel/getEndpoint/setEndpoint 四个 if 链分发器。新增服务能力需复制 2 个 state、4 个 if 分支、handleSave 2 行、重置 8 行、依赖数组全改——6 处以上同步点；单一 `Record<ServiceKind,{model,endpoint}>` + SERVICE_KINDS 循环可消（SERVICE_STYLES Record 已是同文件先例）。
- **43. `client/platform/storage/idb.ts:266`** recordsByMaterial 逐行复制 entriesSnapshot 的整套事务生命周期封装（双请求+onsuccess/onerror+oncomplete/onabort+reqError 收口），唯一差别是请求发在 index 而非 objectStore。『request 成功≠落盘、以事务生命周期收口』这条防 Firefox/Safari 假成功的关键语义存在两份拷贝——今后修事务收口类 bug 只改其中一份，另一份 silently 保留旧缺陷；参数化为请求工厂即可消除约 20 行重复。
- **44. `client/components/pages/mnemonic.tsx:86`** CoreMeaningCard/PhoneticCard/WordRootsCard/ExamplesCard/CollocationsCard 五组件（86-267 行）重复 Card+CardHeader(icon+title)+CardContent+『data?内容:骨架屏』模板。改卡片头部样式、间距或骨架屏形态要同步 5 处；735 行页面里约 180 行是模板复写；抽 MnemonicSectionCard({icon,title,hasData,skeleton}) 各节只写内容。
- **45. `client/components/shared/transcribe-shared.tsx:290`** useTranscribe 返回的 cancel 与 reset（290-310 行）函数体逐字节相同（abort + 7 个 setState 复位）。两个名字暗示两种语义但无差异：将来给 cancel 加『保留部分结果』或给 reset 加统计上报时另一份不跟，行为悄悄分叉；保留一个、两个导出名指向同一引用即可。
- **46. `client/components/shared/transcribe-shared.tsx:249`** start() 的 'local' 分支内联复制了 executeTranscribe 的整段流程（状态前置+segmentsToSrt+applyTranslation+相同 catch 链），只差 fetch 目标与健康检查。改 abort 语义、错误分类或结果落盘时机必须同步两处 try/catch，漏一处即 model 与 local 两条转写路径行为分叉；参数化 fetcher 可消。
- **47. `client/lib/llm/chat-service.ts:355`** extractNumberedTranslations 与 Partial 版本（386 行）共享同一正则与 while(exec) 扫描循环，仅尾部校验不同（恰 N 条 vs ≥1 条）。序号前缀解析规则修 bug 时两份只改其一 → 翻译重试的降级路径与严格路径对同一模型输出判定不一致，产生难复现的『有时回填有时重试』；留 Partial 返回稀疏数组、严格版一行判断即可。
- **48. `client/app/api/transcribe/route.ts:285`** LlmError catch 尾巴在 transcribe/mnemonic/translate/tts 四个 BFF 路由各手写一份且已漂移：translate/mnemonic 带 code→400/502 statusMap，transcribe/tts 一律 500。同一次『API Key 未配置』（API_KEY_MISSING）在翻译/助记返回 400、在转写/TTS 返回 500——客户端按状态码区分『去配置』还是『重试』时行为不一致；应收敛为 errors.ts 的 toLlmErrorResponse()。
- **49. `client/proxy.ts:30`**【工作区】同源防护策略三份手写形态：proxy.ts 自带 origin==host 比较与第二种 403 体 `{code:'FORBIDDEN_ORIGIN'}`，5 个 settings 路由各自拷贝 guard() 包装，isSameOriginRequest 的 _selfUrl 参数无用却强迫调用方传 request.url。加第 6 个敏感路由要再拷一份 guard()（漏拷则该路由裸奔）；收紧策略要同步改 proxy.ts、api-guard.ts 与 5 份拷贝；两个 403 体形状不同还破坏客户端错误解析的统一性；api-guard 应导出单一 sameOriginGuard(request)（需保留 proxy 豁免 GET 的差异选项）。

### 效率

- **50. `client/lib/translate.ts:36`** translateTexts 按每 50 句一块逐块串行 await /api/translate，1000 句字幕要 20 次串行 LLM 往返。每块 5-10s → 串行总耗时 100-200s；进度回调只报累计计数不依赖串行顺序（两消费者均只 setProgress）——固定并发（如 3 路）的块级池按索引回填可缩一半以上，注意池深有界防服务端限流。
- **51. `client/components/pages/training/recitation.tsx:85`** `rec.on('volume', setLevel)` 以 ~30Hz 触发整页 setState 重渲染含未 memo 的全句列表（shadowing.tsx:126 的 10Hz timeupdate、read-aloud.tsx:87 同款）。300 句材料录音 60s 期间：背诵页 30Hz×300 行 = 每秒 9000 次 DOM reconcile，全部发生在录音主线程上与音频采集抢 CPU，移动端表现为录音中卡顿掉帧；player.tsx:623 LiveControlBar 自订阅（注释自认『千句列表每秒万级 diff 由此消除』）是仓内现成修法范本。
- **52. `client/components/shared/word-bubble.tsx:87`** processSelection 每次选区变化（rAF 节流后 ~60Hz）对全部句子现场跑 normalize（trim+\s+ 合并+引号替换三次正则）做包含匹配，无预计算缓存。2000 句字幕的播放页拖动选择文本：每个 rAF tick 执行 2000×3 次正则（约 36 万次/秒主线程字符串处理）；useMemo 按 items 预计算归一化数组、事件里只 includes 即可。
- **53. `client/app/api/tts/route.ts:78`** 云端 TTS 音频以 base64 塞进 JSON 响应（33% 膨胀），客户端 atob 后逐字节 charCodeAt 循环重组。5000 字符上限（≈5.5 分钟 24kHz 音频 ≈15-16MB）→ 最坏 ~20MB base64 字符串 + atob 结果 + Uint8Array 三份同时驻留，外加 O(n) 单字节 JS 循环阻塞主线程数百 ms；改二进制响应体 + res.arrayBuffer() 或 Uint8Array.from(atob) 消两者。
- **54. `client/components/pages/player.tsx:168`** 播放器页进入时 getMaterialRecord → getMediaBlob → favoriteSentenceIndexes → listNotes → getProgress 五次串行 await 独立 IDB 事务。后四者只依赖 materialId 互相独立——record 到手后 Promise.all 四个读，收藏/笔记/续播位置合计早 40-80ms 展示。
- **55. `client/components/pages/favorites.tsx:53`** loadGroups 对每个有收藏的材料串行 await getMaterialRecord（整条含 subtitleData 的结构化克隆反序列化）。20 份材料有收藏：20 次串行事务线性叠加，首屏晚数百 ms；materialStore.refresh() 后内存 records 已含全部完整记录可直接读，或 Promise.all 并行（material-store.ts:42 有先例）。
- **56. `client/components/pages/settings.tsx:276`** BackupSection 媒体统计逐 id 串行 await blobsStore.get（backup.ts:83 完整备份清单阶段同一模式；同文件 backup.ts:53 已有 Promise.all 先例）。100 个含媒体材料：进设置页备份区即 100 次串行 IDB 事务（每次只读 .size 却各付事务开销），统计文案多转 0.5-1s。
- **57. `client/components/shared/player-parts.tsx:43`** loadProgressPercents 仍是每材料一次 getProgress 独立事务（library/collection 页挂载时并发发起），是 records v3 批量读改造遗漏的调用点。50 份材料 = 50 个各自开事务的 IDB 读挂在首屏；一个 getAllEntriesByPrefix('progress:') 单事务（v3 已提供该原语）即可构建同样映射——与 training-center/settings 已改批量快照的口径不一致。

### 层次 / 结构

- **58. `client/components/pages/player.tsx:491`** 删句后的句序维护在组件里逐家族手写编排（shiftNotes/shiftFavorites/shiftTraining/shiftVocab + 内存 favSet 平移 + 两处裸 recordsStore.put 直写 progress），store 层无单一入口、无 putProgress API。新增任何按句索引的记录族必须记得来 player.tsx 补第 7 个 shift 调用并保持顺序约定，漏一处即删句后该族数据静默指向错误句子；progress 直写绕开 material-store（读侧在 store、写侧在组件）；应收敛为 stores 层 shiftSentenceReferences(materialId, index)。
- **59. `client/components/pages/settings.tsx:61`** settings 全库 getAllEntries 物化 + `(v as TrainingRecord)?.score` 类型嗅探；training-center.tsx:57 同样直连 recordsStore 手写『各模式最新一条』分组——training-record-store 只有写 API 无读 API（对照 note/favorite/mnemonic store 均有读封装）。训练记录加新 mode/改 detail 形状时组件里的嗅探式解析静默失效（统计错数而非报错）；『哪些前缀算统计口径』清单在 settings 与 training-center 各存一份。
- **60. `client/stores/material-store.ts:178`** removeMaterial 手工枚举材料属主记录族（progress 精确键 + fav/note 前缀区间 + train 走索引再白名单排除 vocabentry），schema.ts 无归属清单可推导，6 处各背一份。新增按材料挂靠的记录族必须记得来 removeMaterial 补删（漏了则删材料留孤儿、备份反复搬运死数据）；getEntriesByMaterial 索引本返回一切值带 materialId 的记录、:183 白名单只留 train:——未来新族除非逐点改这 6 处，级联与统计会静默漏清/漏计；schema.ts 声明族挂靠方式（键含/值含/独立）一处推导。
- **61. `client/components/pages/training/shadowing.tsx:135`** useSentencePlayer 抽出后 4 个消费页（shadowing:135/read-aloud:80/dictation:54/puzzle:58）仍在渲染期各自手写 `playerRef.current = enginePlayer` 镜像。hook 将来把返回的 player 换成包装器/代理时 4 份手镜像静默捕获错对象（渲染期赋 ref 无报错）；渲染期副作用本身在并发特性/StrictMode 双渲染下语义靠运气——hook 直接返回稳定 ref 即消。
- **62. `client/app/api/tts/route.ts:16`** BFF 路由与服务端校验直接 import 客户端 mock 实现模块 @/services/mock/tts（splitTtsSentences/buildTtsTimeline/buildSrt/TTS_MAX_TEXT_LENGTH），tts.tsx:24 与 kokoro-tts.ts:20/kokoro-worker.ts:13 同型。违反 CLAUDE.md『Service contracts: Interfaces in services/contracts.ts, mock impls in mock/, factory in index.ts』分层：5000 字上限与分句规则只作为 mock 代码存在（contracts.ts:118 仅注释），BFF 真实云路径与页面 UI 都依赖 mock 实现——NEXT_PUBLIC_SERVICE_MODE 切到 api 实现后 mock 仍是 BFF 依赖，删 mock/ 目录直接编译失败。

---

## 被驳回的候选（9，供参考）

atob 校验、whisper 覆盖、collection 过滤、prune 平局、端口放宽、Python 临时文件、dialog 栈重排、estimateUsage 越层、core 层 Blob。
