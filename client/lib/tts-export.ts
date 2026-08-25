/**
 * TTS（P11）→ 导入（P1）一键带入契约 —— 架构 §4.2「TTS 产物」/ 原型设计 §4.2 元素清单
 *
 * 批次E（P11 页面）生成产物后调用 writeTtsExport 写入，再跳转
 * `/import?source=tts&taskId={taskId}`；导入页通过 readTtsExport 自动填充 ①②。
 *
 * 音频 Blob 无法经 sessionStorage 序列化，故分两层存放：
 *  - 音频 Blob → IDB blobs store，key = `tts:{taskId}`
 *  - 索引 JSON → sessionStorage，key = `ping-english:tts-export:{taskId}`，结构见 TtsExportMeta
 * 导入成功后调用 consumeTtsExport 清理临时产物。
 */

import { blobsStore } from '@/platform/storage/idb'

export const TTS_EXPORT_SESSION_PREFIX = 'ping-english:tts-export:'
export const ttsBlobKey = (taskId: string) => `tts:${taskId}`

/** sessionStorage 中的 TTS 产物索引（JSON） */
export interface TtsExportMeta {
  taskId: string
  /** 建议的材料名（导入页可编辑） */
  name: string
  /** 音频文件名（含扩展名） */
  audioFileName: string
  /** TTS 生成的字幕全文 */
  subtitleText: string
  subtitleFormat: 'srt' | 'lrc'
  createdAt: number
}

export interface TtsExportPayload {
  meta: TtsExportMeta
  audio: Blob
}

/** 批次E 写入：音频入 IDB，索引入 sessionStorage（写失败静默降级） */
export async function writeTtsExport(taskId: string, audio: Blob, meta: Omit<TtsExportMeta, 'taskId'>): Promise<void> {
  await blobsStore.put(ttsBlobKey(taskId), audio)
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(TTS_EXPORT_SESSION_PREFIX + taskId, JSON.stringify({ ...meta, taskId }))
    }
  } catch { /* sessionStorage 不可用时仅丢失自动填充能力，不崩溃 */ }
}

/** 导入页读取；产物缺失或读取失败统一返回 null（空态兜底，用户仍可手动选择文件） */
export async function readTtsExport(taskId: string): Promise<TtsExportPayload | null> {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(TTS_EXPORT_SESSION_PREFIX + taskId)
    if (!raw) return null
    const meta = JSON.parse(raw) as TtsExportMeta
    const audio = await blobsStore.get<Blob>(ttsBlobKey(taskId))
    if (!audio || typeof meta.subtitleText !== 'string') return null
    return { meta, audio }
  } catch { return null }
}

/** 导入成功后清理临时产物 */
export async function consumeTtsExport(taskId: string): Promise<void> {
  try { sessionStorage.removeItem(TTS_EXPORT_SESSION_PREFIX + taskId) } catch { /* ignore */ }
  await blobsStore.delete(ttsBlobKey(taskId))
}
