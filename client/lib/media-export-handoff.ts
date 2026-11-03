/**
 * 「产物页 → 导入页」一键带入的通用 handoff —— 音频 Blob 无法经 sessionStorage
 * 序列化，分两层存放：
 *  - 音频 Blob → IDB blobs store，key = {blobKeyPrefix}{taskId}
 *  - 索引 JSON → sessionStorage，key = {sessionPrefix}{taskId}
 * tts-export / transcribe-export 两模块由本工厂派生（原先为逐字节拷贝，清理路径
 * 只在一侧修过）。导入成功后调用 consume 清理两层临时产物。
 */

import { blobsStore } from '@/platform/storage/idb'

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

/**
 * 回收本业务前缀下无活动索引的孤儿 blob（每次 write 前调用，评审 #13）。
 * IDB/sessionStorage 任一环节失败都只记 console，不阻断本次写入。
 */
async function sweepOrphanBlobs(sessionPrefix: string, blobKeyPrefix: string): Promise<void> {
  try {
    const keys = await blobsStore.allKeys()
    for (const key of keys) {
      if (!key.startsWith(blobKeyPrefix)) continue
      const orphanTaskId = key.slice(blobKeyPrefix.length)
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
      await blobsStore.put(blobKey(taskId), audio)
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
    /** 导入成功后清理两层临时产物 */
    async consume(taskId: string): Promise<void> {
      try { sessionStorage.removeItem(sessionPrefix + taskId) } catch { /* ignore */ }
      await blobsStore.delete(blobKey(taskId))
    },
  }
}
