/**
 * 「产物页 → 导入页」一键带入的通用 handoff —— 音频 Blob 无法经 sessionStorage
 * 序列化，分两层存放：
 *  - 音频 Blob → IDB blobs store，key = {blobKeyPrefix}{taskId}
 *  - 索引 JSON → sessionStorage，key = {sessionPrefix}{taskId}
 * tts-export / transcribe-export 两模块由本工厂派生（原先为逐字节拷贝，清理路径
 * 只在一侧修过）。导入成功后调用 consume 清理两层临时产物。
 */

import { blobsStore, runAtomicOps } from '@/platform/storage/idb'

export interface MediaExportHandoffOptions {
  /** sessionStorage 索引键前缀（含冒号结尾） */
  sessionPrefix: string
  /** IDB blobs store 的 key 前缀（含冒号结尾） */
  blobKeyPrefix: string
}

/** 索引元数据必须携带 taskId 与字幕全文（读取侧据此校验与填充） */
export interface MediaExportMetaBase {
  taskId: string
  subtitleText: string
}

/** 写入时间标记的 key（blobs store，值为 epoch ms）—— 跨标签页孤儿判定的宽限依据 */
const tsKeyOf = (blobKeyPrefix: string, taskId: string) => `${blobKeyPrefix}ts:${taskId}`
/** 孤儿宽限期：handoff 是「生成 → 立刻切导入页」的短流程，10 分钟覆盖跨标签页在途 */
const ORPHAN_GRACE_MS = 10 * 60 * 1000

/**
 * 回收本业务前缀下无活动索引的孤儿 blob（每次 write 前调用，评审 #13）。
 * IDB/sessionStorage 任一环节失败都只记 console，不阻断本次写入。
 *
 * 跨标签页宽限（2026-11 全仓复审 c008）：IDB blobs 跨标签页共享而 sessionStorage
 * 每 tab 独立 —— 旧判定「本 tab 无索引即孤儿」会把别的 tab 仍在待导入的产物当孤儿
 * 删掉。新判定以 blobs store 里的写入时间标记为准：TTL 内一律保留；超 TTL 才回收。
 * 无时间标记的旧版键回落旧判定（sessionStorage 索引），升级前的孤儿照常清理。
 */
async function sweepOrphanBlobs(sessionPrefix: string, blobKeyPrefix: string): Promise<void> {
  try {
    const keys = await blobsStore.allKeys()
    const now = Date.now()
    for (const key of keys) {
      if (!key.startsWith(blobKeyPrefix)) continue
      const orphanTaskId = key.slice(blobKeyPrefix.length)
      if (orphanTaskId.startsWith('ts:')) continue // 时间标记本身不参与回收，随宿主增删
      const writtenAt = await blobsStore.get<number>(tsKeyOf(blobKeyPrefix, orphanTaskId))
      if (typeof writtenAt === 'number') {
        if (now - writtenAt < ORPHAN_GRACE_MS) continue // 在途（可能是别的标签页）→ 保留
        await blobsStore.delete(key)
        await blobsStore.delete(tsKeyOf(blobKeyPrefix, orphanTaskId))
        continue
      }
      // 旧版键（无时间标记）：沿用 sessionStorage 索引判定
      let indexed: string | null = null
      try {
        indexed = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(sessionPrefix + orphanTaskId) : null
      } catch { /* sessionStorage 抛错（隐私模式等）：无法证明活动就视为孤儿 */ }
      // 兼容旧版/他方烤入的撞前缀键：索引缺失或 taskId 不符 → 一并按孤儿处理
      let active = false
      if (indexed !== null) {
        try {
          active = (JSON.parse(indexed) as { taskId?: unknown }).taskId === orphanTaskId
        } catch { active = false }
      }
      if (!active) await blobsStore.delete(key)
    }
    // 对账清扫孤儿时间标记（quick 复审 c013）：标记只随宿主 blob 连带删除,
    // 宿主经其它路径消失时标记残留——每标记一个 number,量级极小,顺手清掉
    const liveTaskIds = new Set(
      keys
        .filter((key) => key.startsWith(blobKeyPrefix) && !key.slice(blobKeyPrefix.length).startsWith('ts:'))
        .map((key) => key.slice(blobKeyPrefix.length)),
    )
    for (const key of keys) {
      if (!key.startsWith(blobKeyPrefix)) continue
      const id = key.slice(blobKeyPrefix.length)
      if (id.startsWith('ts:') && !liveTaskIds.has(id.slice(3))) await blobsStore.delete(key)
    }
  } catch (err) {
    console.warn('[media-handoff] 孤儿 blob 回收失败（不影响本次写入）:', err)
  }
}

export function createMediaExportHandoff<M extends MediaExportMetaBase>(opts: MediaExportHandoffOptions) {
  const { sessionPrefix, blobKeyPrefix } = opts
  const blobKey = (taskId: string) => blobKeyPrefix + taskId

  return {
    blobKey,
    /**
     * 写入：音频入 IDB，索引入 sessionStorage（sessionStorage 不可用时静默降级，仅丢自动填充）。
     * 写前顺带回收同前缀孤儿 blob（评审 #13）：产物只有在同标签页导入成功后才被
     * consume 清理，生成后弃用/刷新页面（sessionStorage 索引丢失）会留下永不引用的
     * 多 MB 音频；除「清空全部数据」外再无回收路径，写入时机是唯一的低成本回收点。
     * 孤儿判定：无活动 sessionStorage 索引，或索引 taskId 非法/撞前缀（非本工厂产物）。
     */
    async write(taskId: string, audio: Blob, meta: Omit<M, 'taskId'>): Promise<void> {
      await sweepOrphanBlobs(sessionPrefix, blobKeyPrefix)
      // 音频 + 写入时间标记（跨标签页孤儿宽限依据）单事务写（quick 复审 c008）：
      // 两段写之间失败会留下「有音频无标记」，下轮清扫回落旧判定即可能删掉刚写的
      // 产物——宽限对该条失效
      await runAtomicOps({
        put: { blobs: [[blobKey(taskId), audio] as const, [tsKeyOf(blobKeyPrefix, taskId), Date.now()] as const] },
      })
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(sessionPrefix + taskId, JSON.stringify({ ...meta, taskId }))
        }
      } catch { /* sessionStorage 不可用时仅丢失自动填充能力，不崩溃 */ }
    },
    /** 导入页读取；产物缺失/索引损坏统一返回 null（空态兜底，用户仍可手动选择文件） */
    async read(taskId: string): Promise<{ meta: M; audio: Blob } | null> {
      try {
        if (typeof sessionStorage === 'undefined') return null
        const raw = sessionStorage.getItem(sessionPrefix + taskId)
        if (!raw) return null
        const meta = JSON.parse(raw) as M
        const audio = await blobsStore.get<Blob>(blobKey(taskId))
        if (!audio || typeof meta.subtitleText !== 'string') return null
        return { meta, audio }
      } catch { return null }
    },
    /** 导入成功后清理两层临时产物（含时间标记） */
    async consume(taskId: string): Promise<void> {
      try { sessionStorage.removeItem(sessionPrefix + taskId) } catch { /* ignore */ }
      await blobsStore.delete(blobKey(taskId))
      await blobsStore.delete(tsKeyOf(blobKeyPrefix, taskId))
    },
  }
}
