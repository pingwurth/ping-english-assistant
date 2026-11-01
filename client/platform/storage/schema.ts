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

/**
 * records store 的 key 前缀 —— 唯一出处。统计面板/级联清理等需要扫描前缀的地方
 * 一律从这里取（`startsWith(RECORD_KEY_PREFIXES.train)`），
 * 不要在组件里手写 `'train:'` 字面量（键格式变更时会逐个静默弄坏扫描器）。
 */
export const RECORD_KEY_PREFIXES = {
  progress: 'progress:',
  favorite: 'fav:',
  note: 'note:',
  training: 'train:',
  vocabBook: 'vocabbook:',
  vocabEntry: 'vocabentry:',
  mnemonic: 'mnemonic:',
  collection: 'collection:',
} as const

/** records store 的 key 前缀约定（类型前缀 + 业务 id） */
export const RECORD_KEYS = {
  progress: (materialId: string) => `progress:${materialId}`,
  favorite: (materialId: string, sentenceIndex: number) => `fav:${materialId}:${sentenceIndex}`,
  note: (materialId: string, sentenceIndex: number) => `note:${materialId}:${sentenceIndex}`,
  training: (recordId: string) => `train:${recordId}`,
  vocabBook: (bookId: string) => `vocabbook:${bookId}`,
  vocabEntry: (entryId: string) => `vocabentry:${entryId}`,
  mnemonic: (entryId: string) => `mnemonic:${entryId}`,
  collection: (collectionId: string) => `collection:${collectionId}`,
} as const
