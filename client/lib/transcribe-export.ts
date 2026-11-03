/**
 * 音频转文字（/transcribe）→ 导入（/import）一键带入契约
 *
 * 转写完成后调用 writeTranscribeExport 写入，再跳转
 * `/import?source=transcribe&taskId={taskId}`；导入页通过 readTranscribeExport 自动填充 ①②。
 * 两层存放（IDB Blob + sessionStorage 索引）与清理路径由 lib/media-export-handoff
 * 工厂统一实现（原与 tts-export 互为逐字节拷贝）。
 */

import { createMediaExportHandoff } from '@/lib/media-export-handoff'

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

const handoff = createMediaExportHandoff<TranscribeExportMeta>({
  sessionPrefix: TRANSCRIBE_EXPORT_SESSION_PREFIX,
  blobKeyPrefix: 'transcribe:',
})

/** 转写页写入：音频入 IDB，索引入 sessionStorage */
export const writeTranscribeExport = handoff.write

/** 导入页读取；产物缺失或读取失败统一返回 null */
export const readTranscribeExport = handoff.read

/** 导入成功后清理临时产物 */
export const consumeTranscribeExport = handoff.consume
