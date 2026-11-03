/**
 * API 契约类型 —— 真源：docs/系统架构设计.md §3.3 API 契约（契约②⑤⑦⑧）
 * （契约①③④服务类型已移除：转写/报告改走 BFF 直连或页内呈现，segments 类型保留）
 */

/** 统一错误格式（§3.3 统一约定） */
export interface ApiError {
  code: string
  message: string
  detail?: unknown
}

/* ── 转写响应 segments（BFF /api/transcribe* 返回体；契约①服务接口已随 mock ASR 移除） ── */

export interface AsrTranscribeSegment {
  startMs: number
  endMs: number
  text: string
}

/* ── 契约② POST /api/v1/soe/evaluate 发音评分代理 ── */

export interface SoeEvaluateRequest {
  audio: File | Blob
  refText: string
  evalMode: 'sentence'
}

export interface SoePhonemeScore {
  symbol: string
  score: number
}

export interface SoeWordScore {
  text: string
  score: number
  phonemes: SoePhonemeScore[]
  /** 词级错误类型（漏读/增读/误读），真实 provider 返回；mock 不填 */
  errorType?: 'None' | 'Omission' | 'Insertion' | 'Mispronunciation'
}

export interface SoeEvaluateResponse {
  total: number
  accuracy: number
  fluency: number
  integrity: number
  words: SoeWordScore[]
}

/* ── 契约⑧ POST /api/translate 批量文本翻译（BFF） ── */

/** 翻译方向：英译中 / 中译英 */
export type TranslateDirection = 'en2zh' | 'zh2en'

export interface TranslateRequest {
  /** 待翻译文本（每 50 条一块分批提交，上限 500 条） */
  texts: string[]
  /** 'auto' 或缺省时由服务端按抽样文本自动判定方向 */
  direction?: 'auto' | TranslateDirection
  /** 指定模型配置 id；缺省用默认配置 */
  configId?: string
}

export interface TranslateResponse {
  /** 与输入 texts 等长的译文数组 */
  translations: string[]
  /** 模型漏翻、缺失位被原文回填的条数（>0 时才返回；上层据此提示“部分未翻”） */
  filledWithSource?: number
}
