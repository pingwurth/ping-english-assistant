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

export function createMediaExportHandoff<M extends MediaExportMetaBase>(opts: MediaExportHandoffOptions) {
  const { sessionPrefix, blobKeyPrefix } = opts
  const blobKey = (taskId: string) => blobKeyPrefix + taskId

  return {
    blobKey,
    /** 写入：音频入 IDB，索引入 sessionStorage（sessionStorage 不可用时静默降级，仅丢自动填充） */
    async write(taskId: string, audio: Blob, meta: Omit<M, 'taskId'>): Promise<void> {
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
