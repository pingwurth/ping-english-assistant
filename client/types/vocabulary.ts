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
  /** 在所有已导入材料中的出现次数（= materialCounts 各值之和；重导入/重转写按材料先减旧贡献） */
  frequency: number
  /** 每材料出现次数记账（materialId → 次数）。防重跑转写/重导入字幕时频次无条件累加翻倍 */
  materialCounts?: Record<string, number>
  /** 可选 LLM 释义 */
  definition?: string
  /** 用户笔记 */
  note?: string
}

/** 默认生词本 ID */
export const DEFAULT_BOOK_ID = 'default'
