/**
 * 音频转文字（/transcribe）→ 导入（/import）一键带入契约
 *
 * 转写完成后调用 writeTranscribeExport 写入，再跳转
 * `/import?source=transcribe&taskId={taskId}`；导入页通过 readTranscribeExport 自动填充 ①②。
 *
 * 音频 File 无法经 sessionStorage 序列化，故分两层存放：
 *  - 音频 Blob → IDB blobs store，key = `transcribe:{taskId}`
 *  - 索引 JSON → sessionStorage，key = `ping-english:transcribe-export:{taskId}`
 * 导入成功后调用 consumeTranscribeExport 清理临时产物。
 */

import { blobsStore } from '@/platform/storage/idb'

export const TRANSCRIBE_EXPORT_SESSION_PREFIX = 'ping-english:transcribe-export:'
export const transcribeBlobKey = (taskId: string) => `transcribe:${taskId}`

/** sessionStorage 中的转写产物索引（JSON） */
export interface TranscribeExportMeta {
  taskId: string
  /** 建议的材料名（导入页可编辑） */
  name: string
  /** 音频文件名（含扩展名） */
  audioFileName: string
  /** 转写生成的 SRT 字幕全文 */
  subtitleText: string
  subtitleFormat: 'srt'
  createdAt: number
}

export interface TranscribeExportPayload {
  meta: TranscribeExportMeta
  audio: Blob
}

/** 转写页写入：音频入 IDB，索引入 sessionStorage（写失败静默降级） */
export async function writeTranscribeExport(
  taskId: string,
  audio: File | Blob,
  meta: Omit<TranscribeExportMeta, 'taskId'>,
): Promise<void> {
  await blobsStore.put(transcribeBlobKey(taskId), audio)
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(TRANSCRIBE_EXPORT_SESSION_PREFIX + taskId, JSON.stringify({ ...meta, taskId }))
    }
  } catch { /* sessionStorage 不可用时仅丢失自动填充能力，不崩溃 */ }
}

/** 导入页读取；产物缺失或读取失败统一返回 null（空态兜底，用户仍可手动选择文件） */
export async function readTranscribeExport(taskId: string): Promise<TranscribeExportPayload | null> {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(TRANSCRIBE_EXPORT_SESSION_PREFIX + taskId)
    if (!raw) return null
    const meta = JSON.parse(raw) as TranscribeExportMeta
    const audio = await blobsStore.get<Blob>(transcribeBlobKey(taskId))
    if (!audio || typeof meta.subtitleText !== 'string') return null
    return { meta, audio }
  } catch { return null }
}

/** 导入成功后清理临时产物 */
export async function consumeTranscribeExport(taskId: string): Promise<void> {
  try { sessionStorage.removeItem(TRANSCRIBE_EXPORT_SESSION_PREFIX + taskId) } catch { /* ignore */ }
  await blobsStore.delete(transcribeBlobKey(taskId))
}
