/**
 * 学习进度与收藏模型 —— 真源：docs/系统架构设计.md §4.1 前端核心模型
 */

/** 学习进度（每材料一条） */
export interface LearningProgress {
  materialId: string
  lastPositionMs: number
  /** 精听/训练中播放过的句子，驱动材料库进度条 */
  playedSentenceIndexes: number[]
  updatedAt: number
}

/** 句子收藏 */
export interface Favorite {
  materialId: string
  sentenceIndex: number
  createdAt: number
}
