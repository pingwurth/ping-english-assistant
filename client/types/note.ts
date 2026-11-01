/**
 * 句子笔记模型 —— 播放器中边听边记，与单个句子绑定（Markdown 文本）。
 */

/** 句子笔记（每材料每句最多一条，key = note:{materialId}:{sentenceIndex}） */
export interface SentenceNote {
  materialId: string
  sentenceIndex: number
  /** Markdown 源文本 */
  content: string
  createdAt: number
  updatedAt: number
}
