/**
 * TTS（P11）→ 导入（P1）一键带入契约 —— 架构 §4.2「TTS 产物」/ 原型设计 §4.2 元素清单
 *
 * 批次E（P11 页面）生成产物后调用 writeTtsExport 写入，再跳转
 * `/import?source=tts&taskId={taskId}`；导入页通过 readTtsExport 自动填充 ①②。
 * 两层存放（IDB Blob + sessionStorage 索引）与清理路径由 lib/media-export-handoff
 * 工厂统一实现（原与 transcribe-export 互为逐字节拷贝）。
 */

import { createMediaExportHandoff } from '@/lib/media-export-handoff'

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

const handoff = createMediaExportHandoff<TtsExportMeta>({
  sessionPrefix: TTS_EXPORT_SESSION_PREFIX,
  blobKeyPrefix: 'tts:',
})

/** 批次E 写入：音频入 IDB，索引入 sessionStorage */
export const writeTtsExport = handoff.write

/** 导入页读取；产物缺失或读取失败统一返回 null */
export const readTtsExport = handoff.read

/** 导入成功后清理临时产物 */
export const consumeTtsExport = handoff.consume
