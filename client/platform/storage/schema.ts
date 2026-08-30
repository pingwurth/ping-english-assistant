/**
 * 存储记录结构约定 —— 真源：docs/系统架构设计.md §4.1 / §4.2
 * materials store 的一条记录 = 材料元数据 + 解析后字幕 JSON（避免每次启动重复解析）。
 */

import type { Material } from '@/types/material'
import type { SubtitleData } from '@/types/subtitle'

/** materials store 单条记录（key = material.id） */
export interface MaterialRecord {
  material: Material
  /** 解析后的句子级字幕；无字幕材料为 null */
  subtitleData: SubtitleData | null
}

/** records store 的 key 前缀约定（类型前缀 + 业务 id） */
export const RECORD_KEYS = {
  progress: (materialId: string) => `progress:${materialId}`,
  favorite: (materialId: string, sentenceIndex: number) => `fav:${materialId}:${sentenceIndex}`,
  training: (recordId: string) => `train:${recordId}`,
  vocabBook: (bookId: string) => `vocabbook:${bookId}`,
  vocabEntry: (entryId: string) => `vocabentry:${entryId}`,
  mnemonic: (entryId: string) => `mnemonic:${entryId}`,
} as const
