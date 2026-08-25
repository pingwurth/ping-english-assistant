/**
 * AI 服务契约 —— 真源：docs/系统架构设计.md §3.3 API 契约（契约①②③④⑥⑦）
 *
 * 字段严格对齐 types/api.ts（批次 A 已按架构 §3.3 落型的请求/响应/SSE 事件类型）。
 * 未来替换为真实 Fastify 客户端时只改实现（services/mock/* → services/api/*），
 * 本文件定义的接口签名与类型保持不变。
 *
 * 所有方法接受可选 AbortSignal；失败统一抛 ApiError（含中止：code === 'ABORTED'）。
 * SSE 流式报告以 AsyncGenerator<SseEvent> 表达（事件序 status → token → result → done，
 * 错误走 error 事件后终止流）。
 */

import type {
  ApiError as ApiErrorShape,
  AsrTranscribeResponse,
  SoeEvaluateResponse,
  SseEvent,
  TrainingReportRequest,
  TtsGenerateRequest,
  TtsGenerateResponseMeta,
  TtsSubtitleResponse,
} from '../types/api'

/** 可抛出的 API 错误：同时满足统一错误格式 { code, message, detail? }（§3.3 统一约定） */
export class ApiError extends Error implements ApiErrorShape {
  readonly code: string
  readonly detail?: unknown

  constructor(code: string, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.detail = detail
  }
}

/** 载荷形态别名（与 types/api.ts 的 ApiError 接口一致） */
export type ApiErrorPayload = ApiErrorShape

/** 将任意未知错误归一为 ApiError（中止 → code 'ABORTED'） */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return new ApiError('ABORTED', '操作已取消', err)
  }
  if (err instanceof Error) {
    return new ApiError('INTERNAL', err.message || '未知错误', err)
  }
  return new ApiError('INTERNAL', String(err), err)
}

/** AbortSignal 已中止时立即抛出 ApiError('ABORTED')；未提供 signal 时为空操作 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ApiError('ABORTED', '操作已取消')
}

/** 可中止的延迟：signal 中止时以 ApiError('ABORTED') reject（供 mock 实现模拟延迟） */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('ABORTED', '操作已取消'))
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(new ApiError('ABORTED', '操作已取消'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort)
  })
}

/** SOE 评测模式（契约② evalMode；MVP 仅句子模式） */
export type SoeEvalMode = 'sentence'

/** 契约① POST /api/v1/asr/transcribe —— 录音转写 */
export interface AsrService {
  /**
   * @param audio  wav/pcm 16kHz mono（multipart 单文件 ≤25MB）
   * @param lang   固定 'en'
   * @param signal 中止信号（抛 ApiError code 'ABORTED'）
   * @returns { text, durationMs, segments[{startMs,endMs,text}] }
   */
  transcribe(audio: Blob, lang: 'en', signal?: AbortSignal): Promise<AsrTranscribeResponse>
}

/** 契约② POST /api/v1/soe/evaluate —— 发音评分代理 */
export interface SoeService {
  /**
   * @param audio    wav/pcm 16kHz mono
   * @param refText  参考原文
   * @param evalMode 'sentence'
   * @returns { total, accuracy, fluency, integrity, words[{text,score,phonemes}] }
   */
  evaluate(
    audio: Blob,
    refText: string,
    evalMode: SoeEvalMode,
    signal?: AbortSignal,
  ): Promise<SoeEvaluateResponse>
}

/** 契约③ POST /api/v1/reports/shadowing —— 影子跟读报告（SSE） */
export interface ShadowingReportService {
  /** 事件序：status → token → result → done；错误发 error 事件后终止 */
  shadowing(payload: TrainingReportRequest, signal?: AbortSignal): AsyncGenerator<SseEvent>
}

/** 契约④ POST /api/v1/reports/recitation —— 背诵报告（SSE） */
export interface RecitationReportService {
  /** 事件序：status → token → result → done；错误发 error 事件后终止 */
  recitation(payload: TrainingReportRequest, signal?: AbortSignal): AsyncGenerator<SseEvent>
}

/** 契约⑥ POST /api/v1/tts/generate —— 音频二进制 + 响应头元信息（X-Tts-*） */
export interface TtsGenerateResult {
  /** 响应 Body（Content-Type: audio/wav | audio/mpeg） */
  audio: Blob
  /** 响应头元信息：taskId / durationMs / sentenceCount */
  meta: TtsGenerateResponseMeta
}

/** 契约⑥⑦ TTS 服务（实现留给批次 E；本批次仅定义接口） */
export interface TtsService {
  /** 契约⑥ POST /api/v1/tts/generate（text 上限 5000 字符，超限抛 ApiError code 'TEXT_TOO_LONG'） */
  generate(request: TtsGenerateRequest, signal?: AbortSignal): Promise<TtsGenerateResult>
  /** 契约⑦ GET /api/v1/tts/subtitle/:taskId（未命中缓存抛 ApiError code 'SUBTITLE_NOT_FOUND'） */
  getSubtitle(taskId: string, signal?: AbortSignal): Promise<TtsSubtitleResponse>
}

/** 服务聚合（供工厂 services/index.ts 与上层 store/页面注入使用） */
export interface AppServices {
  asr: AsrService
  soe: SoeService
  shadowingReport: ShadowingReportService
  recitationReport: RecitationReportService
  tts: TtsService
}
