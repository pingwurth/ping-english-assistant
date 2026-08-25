/**
 * 训练记录模型 —— 真源：docs/系统架构设计.md §4.1 前端核心模型
 * 五种训练模式的联合 detail 类型；评分字段口径对齐 §3.3 契约②③④。
 */

/** 九宫格（选词拼句）训练明细 */
export interface PuzzleDetail {
  /** 完成的句子数 */
  completedSentenceCount: number
  /** 使用提示次数 */
  hintUsedCount: number
  /** 是否一次通过（未撤回重拼） */
  firstTryCorrect: boolean
}

/** 单句听写训练明细 */
export interface DictationDetail {
  /** 单句正确率（0-100） */
  accuracy: number
  /** 听写目标句 index（SubtitleSentence.index） */
  sentenceIndex: number
}

/** 跟读评分训练明细（口径对齐 §3.3 契约② SOE 响应） */
export interface ReadAloudDetail {
  /** 综合分（0-100） */
  total: number
  /** 准确度（0-100） */
  accuracy: number
  /** 流利度（0-100） */
  fluency: number
  /** 完整度（0-100） */
  integrity: number
}

/** 影子跟读 / 全文背诵报告明细（口径对齐 §3.3 契约③④ result 事件） */
export interface ReportDetail {
  /** 综合分（0-100） */
  total: number
  /** 完整度（0-100） */
  completeness: number
  /** 准确度（0-100） */
  accuracy: number
  /** 流利度（0-100） */
  fluency: number
  /** LLM 流式生成的 Markdown 分析报告 */
  reportMarkdown?: string
}

export type TrainingMode =
  | 'puzzle'
  | 'dictation'
  | 'read-aloud'
  | 'shadowing'
  | 'recitation'

/** 训练记录（五模式联合类型） */
export interface TrainingRecord {
  id: string
  materialId: string
  mode: TrainingMode
  scope: { type: 'all' } | { type: 'favorites' }
  /** 各模式归一化综合分（0-100） */
  score: number
  detail: PuzzleDetail | DictationDetail | ReadAloudDetail | ReportDetail
  createdAt: number
}
