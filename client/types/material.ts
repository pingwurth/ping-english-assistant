/**
 * 学习材料业务模型 —— 真源：docs/系统架构设计.md §4.1 前端核心模型
 * 注意：展示型字段（color/progress/last）不进数据模型，由组件按 id 派生。
 */

/** 学习材料（元数据，媒体与字幕文件本体存端内文件系统） */
export interface Material {
  /** nanoid */
  id: string
  name: string
  mediaType: 'video' | 'audio'
  /** 端内本地引用：H5 为 IndexedDB 中的 Blob key，小程序为本地文件路径 */
  mediaRef: string
  mediaFileName: string
  mediaSizeBytes: number
  subtitle: {
    /** 字幕文件本地引用 */
    ref: string
    format: 'srt' | 'lrc'
    isBilingual: boolean
    sentenceCount: number
  } | null
  durationMs: number
  createdAt: number
  lastOpenedAt: number
}
