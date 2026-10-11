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

/** SSE 事件：status（阶段进度） */
export interface SseStatusEvent {
  event: 'status'
  data: { stage: string }
}

/** SSE 事件：token（流式 Markdown 文本） */
export interface SseTokenEvent {
  event: 'token'
  data: { text: string }
}

/** SSE 事件：result（结构化评分） */
export interface SseResultEvent {
  event: 'result'
  data: {
    total: number
    completeness: number
    accuracy: number
    fluency: number
  }
}

/** SSE 事件：done */
export interface SseDoneEvent {
  event: 'done'
  data: Record<string, never>
}

/** SSE 事件：error（统一错误格式） */
export interface SseErrorEvent {
  event: 'error'
  data: ApiError
}

/** SSE 事件序列：status → token → result → done / error */
export type SseEvent =
  | SseStatusEvent
  | SseTokenEvent
  | SseResultEvent
  | SseDoneEvent
  | SseErrorEvent

/* ── 契约⑤ POST /api/v1/llm/explain 单词/句子讲解（SSE，V1.3 预置） ── */

export interface LlmExplainRequest {
  word?: string
  sentence?: string
  materialId?: string
}

/** 讲解同样走统一 SSE 事件序列 */
export type LlmExplainSseEvent = SseEvent

/* ── 契约⑥ POST /api/v1/tts/generate 文字转语音（Kokoro-82M） ── */

export interface TtsGenerateRequest {
  /** 上限 5000 字符，超限返回 400 */
  text: string
  /** Kokoro 声音 ID，见架构 §3.4 */
  voice: string
  /** 0.5 ~ 2.0 */
  speed: number
  /** wav（默认）| mp3（需镜像内 ffmpeg） */
  format: 'wav' | 'mp3'
  /** 是否生成分句对齐的 SRT */
  withSubtitle: boolean
}

/** 响应 Body 为音频二进制（audio/wav | audio/mpeg），附带头部元信息 */
export interface TtsGenerateResponseMeta {
  /** X-Tts-Task-Id：字幕领取凭据 */
  taskId: string
  /** X-Tts-Duration-Ms */
  durationMs: number
  /** X-Tts-Sentence-Count */
  sentenceCount: number
}

/* ── 契约⑦ GET /api/v1/tts/subtitle/:taskId 领取生成的字幕 ── */

export interface TtsSubtitleResponse {
  srt: string
  sentenceCount: number
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
}
