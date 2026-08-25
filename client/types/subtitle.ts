/**
 * 字幕数据模型 —— 真源：docs/技术选型报告.md §2.4 句子级字幕数据模型
 */

/** 单个字幕句子 */
export interface SubtitleSentence {
  /** 句子序号，从 0 开始 */
  index: number
  /** 起始时间（毫秒） */
  startMs: number
  /** 结束时间（毫秒） */
  endMs: number
  /** 英文原文 */
  textEn: string
  /** 中文译文（可为空，如纯英文字幕） */
  textZh: string | null
  /** 英文按空格拆分的单词数组（已剥离标点，供九宫格训练用） */
  words: string[]
}

/** 字幕文件解析结果 */
export interface SubtitleData {
  /** 来源格式 */
  format: 'srt' | 'lrc'
  /** 是否包含双语 */
  isBilingual: boolean
  /** 句子列表，按时间排序 */
  sentences: SubtitleSentence[]
  /** 总时长（毫秒） */
  totalDurationMs: number
}

/** 播放器字幕显示模式 */
export type SubtitleMode = 'bilingual' | 'english' | 'chinese'
