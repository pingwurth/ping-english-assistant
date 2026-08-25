/**
 * 种子数据 —— 由原 study-app.tsx 的 mock 数据逐字映射为新模型（docs/系统架构设计.md §4.1）。
 * 展示型字段（color/progress/last）不在此处，由组件按 id 派生；本数据供后续阶段写入存储。
 */

import type { Material } from '@/types/material'
import type { SubtitleSentence } from '@/types/subtitle'

/** mock-001 材料的 5 句字幕（words 已剥离标点） */
export const seedSentences: SubtitleSentence[] = [
  { index: 0, startMs: 2000, endMs: 9000, textEn: 'You should answer the questions as you listen.', textZh: '你应该边听边回答问题。', words: ['You','should','answer','the','questions','as','you','listen'] },
  { index: 1, startMs: 9000, endMs: 15000, textEn: 'For each question, you will hear four choices.', textZh: '对于每个问题，你将听到四个选项。', words: ['For','each','question','you','will','hear','four','choices'] },
  { index: 2, startMs: 15000, endMs: 22000, textEn: 'You will hear the recording only once.', textZh: '录音只播放一遍。', words: ['You','will','hear','the','recording','only','once'] },
  { index: 3, startMs: 22000, endMs: 30000, textEn: 'Listen carefully and choose the best answer.', textZh: '请仔细听并选择最佳答案。', words: ['Listen','carefully','and','choose','the','best','answer'] },
  { index: 4, startMs: 30000, endMs: 38000, textEn: 'Now look at the pictures in your booklet.', textZh: '现在请看小册子里的图片。', words: ['Now','look','at','the','pictures','in','your','booklet'] },
]

/** 种子时间基准（固定时间戳，保证原型渲染稳定） */
const SEED_CREATED_AT = 1750000000000
const DAY_MS = 86400000

/** 材料库 4 条种子材料 */
export const seedMaterials: Material[] = [
  { id: 'mock-001', name: '真题模拟 001', mediaType: 'video', mediaRef: 'seed://media/mock-001.mp4', mediaFileName: 'mock-001.mp4', mediaSizeBytes: 11534336, subtitle: { ref: 'seed://subtitle/mock-001.srt', format: 'srt', isBilingual: true, sentenceCount: seedSentences.length }, durationMs: 725000, createdAt: SEED_CREATED_AT - 7 * DAY_MS, lastOpenedAt: SEED_CREATED_AT - 1 * DAY_MS },
  { id: 'ted', name: 'TED 演讲精选', mediaType: 'audio', mediaRef: 'seed://media/ted.mp3', mediaFileName: 'ted.mp3', mediaSizeBytes: 17825792, subtitle: { ref: 'seed://subtitle/ted.srt', format: 'srt', isBilingual: true, sentenceCount: seedSentences.length }, durationMs: 1110000, createdAt: SEED_CREATED_AT - 10 * DAY_MS, lastOpenedAt: SEED_CREATED_AT - 2 * DAY_MS },
  { id: 'bbc', name: 'BBC 六分钟英语', mediaType: 'audio', mediaRef: 'seed://media/bbc.mp3', mediaFileName: 'bbc.mp3', mediaSizeBytes: 5976064, subtitle: { ref: 'seed://subtitle/bbc.srt', format: 'srt', isBilingual: false, sentenceCount: seedSentences.length }, durationMs: 372000, createdAt: SEED_CREATED_AT - 3 * DAY_MS, lastOpenedAt: 0 },
  { id: 'movie', name: '电影片段-01', mediaType: 'video', mediaRef: 'seed://media/movie.mp4', mediaFileName: 'movie.mp4', mediaSizeBytes: 4608000, subtitle: { ref: 'seed://subtitle/movie.srt', format: 'srt', isBilingual: true, sentenceCount: seedSentences.length }, durationMs: 288000, createdAt: SEED_CREATED_AT - 14 * DAY_MS, lastOpenedAt: SEED_CREATED_AT - 1 * DAY_MS },
]
