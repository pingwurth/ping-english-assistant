/** 生词本数据模型 */

/** 生词本 */
export interface VocabBook {
  /** 唯一 ID */
  id: string
  /** 生词本名称 */
  name: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** 词条 */
export interface VocabEntry {
  /** 唯一 ID */
  id: string
  /** 选中的文本（单词/词组/短句） */
  text: string
  /** 所在句子原文 */
  context: string
  /** 来源素材 ID */
  materialId: string
  /** 来源句子索引 */
  sentenceIndex: number
  /** 所属生词本 ID */
  bookId: string
  /** 添加时间戳 */
  addedAt: number
  /** 可选 LLM 释义 */
  definition?: string
}

/** 默认生词本 ID */
export const DEFAULT_BOOK_ID = 'default'
