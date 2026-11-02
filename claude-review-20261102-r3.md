# Claude 复审报告（第 3 轮 · 修复代码回归审查）

- 日期：2026-11-02 · `/code-review high df69e53..HEAD`（--max-findings all）
- 对象：评审修复批次两个提交（6963584 汇总修复 + 3e4924c 并行会话收敛），8 角度 → 10 条发现
- 结论：修复批次总体可靠，但 **HEAD 不自洽（P1）** + 2 条修复引入的行为回归 + 3 条健壮性边角 + 4 条清理

## 修复记录

**2026-11-02（r3 复审处置）**
- P1 fixed（297f571）：补交 3e4924c 遗漏的 `client/core/tts/timeline.ts` 与 `client/lib/llm/asr-audio.ts`（9 个已提交文件 import 它们但未入库，干净检出即 tsc/build 失败）；worktree 干净检出 tsc 验证通过
- 回归① fixed：mnemonic AssociationCard/ExercisesSection 加 `key={entry.id}` —— 同路由跳转不卸载组件，autoTriedRef（once-per-mount）使第二个 hard 词条不再自动生成、练习题显示上一词条缓存
- 回归② fixed：player deleteSentence 在无落盘 progress 记录（shiftSentenceReferences 返回 undefined，如播放不足 5s 未 flush）时就地平移内存 played 集合，不再清空（原先脏标记使后续 flush 写不回，已播标记永久丢失）
- 健壮性① fixed：api-guard `PING_ENG_ALLOWED_HOSTS` 尾随斜杠容忍（`box.example.com/` 原解析出带 `/` 的 hostname 永不匹配且无告警）；`parseHost` 拒绝含 `/` 的 hostname；补测试
- 健壮性② fixed：`AbortSignal.any` 需 Node ≥20.3.0，client/server package.json 补 `engines`（translate/mnemonic 既有代码同样依赖，属补声明而非新约束）
- 健壮性③ fixed：idb `putAllAtomic` 在 open 失败翻转内存降级后按设计写入内存兜底（原先裸 `new Error('memory')` 拒绝，导入以字面量 "memory" 报错且写入丢失）；`tx()` 裸错改可读中文
- 清理① fixed：删除死导出 `isSameOriginRequest`（sameOriginGuard 迁移后零生产调用），测试改用 sameOriginGuard 覆盖同一语义
- 清理② deferred：models 掩码-保留规则与 updateLlmConfig 双份（server-settings 掩码实现耦合，并行会话活跃区，归长尾）
- 清理③ deferred：LivePlayProgress 计时 effect 与 LiveRecordingWave 重复（可抽 useRecorderElapsed，归长尾）
- 清理④ deferred：reportSavedRef 守卫 + appendReportTrainingRecord 调用在 shadowing/recitation 双份（归长尾）
- 门禁：client tsc 0 错 + 29 文件 284/284；server tsc 0 错 + 54/54；HEAD 干净检出 worktree tsc 通过

---

## 原始发现（10 条）

1. **P1** `client/app/api/tts/route.ts:17` — HEAD import 两个未提交模块（core/tts/timeline、llm/asr-audio），干净检出 tsc/build 失败；此前门禁只在脏工作区成立
2. `client/components/pages/mnemonic.tsx:290` — autoTriedRef 回归：AssociationCard 未按词条 key 化，第二个及之后的 hard 词条不再自动生成联想
3. `client/components/pages/player.tsx:508` — deleteSentence 在无持久化 progress 时把内存 played 集合清空而非平移，已播标记永久丢失、进度回 0
4. `client/lib/api-guard.ts:44` — ALLOWED_HOSTS 无协议但带尾斜杠的项被静默误解析（hostname 含 `/`），白名单永不命中且无告警
5. `client/app/api/tts/route.ts:85` — AbortSignal.any 需 Node ≥20.3.0，仓库只声明 20+
6. `client/platform/storage/idb.ts:106` — putAllAtomic 在降级翻转竞态下以裸 'memory' 拒绝，导入报错不可读且写入丢失
7. `client/app/api/models/route.ts:95` — 掩码-保留凭据规则在探测路径与 updateLlmConfig 双实现，漂移即两路径对「掩码 key」判定不一致
8. `client/lib/api-guard.ts:121` — isSameOriginRequest 死导出（sameOriginGuard 迁移后仅测试引用），与 guard 平行维护两份 host 解析
9. `client/components/pages/training/shadowing.tsx:107` — LivePlayProgress 重写 LiveRecordingWave 的录音计时 effect（同 200ms interval 模式）
10. `client/components/pages/training/shadowing.tsx:253` — reportSavedRef 守卫 + 落库调用在 shadowing/recitation 逐字双份
