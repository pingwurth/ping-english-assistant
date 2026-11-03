/**
 * AI 服务契约 —— 真源：docs/系统架构设计.md §3.3 API 契约（契约②⑧）
 *
 * 字段严格对齐 types/api.ts（批次 A 已按架构 §3.3 落型的请求/响应类型）。
 * 未来替换为真实 Fastify 客户端时只改实现（services/mock/* → services/api/*），
 * 本文件定义的接口签名与类型保持不变。
 *
 * 所有方法接受可选 AbortSignal；失败统一抛 ApiError（含中止：code === 'ABORTED'）。
 * 注：契约①③④已移除 —— ①ASR 与③④训练报告均改走 BFF 直连或页内呈现
 * （录音转写见 pages/training/recording-review.tsx 的 transcribeRecording、
 * 素材导入见 components/shared/transcribe-shared.tsx，服务端 lib/llm/asr-service.ts）；
 * 契约⑥⑦ TtsService 已于 2026-11 删除（真实路径 tts.tsx → /api/tts，旧契约零调用方）；
 * 助记 SSE 事件类型为 types/mnemonic.ts 的 MnemonicSseEvent（不走本文件）。
 */

import type {
  ApiError as ApiErrorShape,
  SoeEvaluateResponse,
} from '../types/api'
import type {
  Association,
  Exercises,
  MnemonicCard,
  MnemonicSseEvent,
  SentenceEvaluation,
} from '../types/mnemonic'

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

/** 将任意未知错误归一为 ApiError（中止 → code 'ABORTED'；硬超时 → 'REQUEST_TIMEOUT'） */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  // AbortSignal.timeout() 的 abort reason 是 TimeoutError（不是 AbortError），
  // 不单独识别会让超时被归成 INTERNAL/ABORTED（评审 #4：全仓曾无任何 REQUEST_TIMEOUT 抛出点）
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new ApiError('REQUEST_TIMEOUT', '请求超时', err)
  }
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return new ApiError('ABORTED', '操作已取消', err)
  }
  if (err instanceof Error) {
    // 网络层错误是可预期故障，不应被误报成 INTERNAL；上层可按需映射自己的错误码。
    const isNetworkError = err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')
    return new ApiError(isNetworkError ? 'NETWORK_ERROR' : 'INTERNAL', isNetworkError ? `网络请求失败：${err.message}` : err.message || '未知错误', err)
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

/** 契约⑧ 生词助记 —— LLM 生成助记卡片（流式）、联想、练习、造句批改。
 *  非流式 generateCard 已随 BFF 'card' action 一并删除（页面只用流式路径，2026-11）。 */
export interface MnemonicService {
  /** 流式生成助记卡片 — 返回 AsyncGenerator，逐字段 yield SSE 事件 */
  generateCardStream(word: string, context: string, note?: string, signal?: AbortSignal): AsyncGenerator<MnemonicSseEvent>
  /** 生成联想记忆（hard 词自动触发或用户手动触发） */
  generateAssociation(word: string, meaning: string, signal?: AbortSignal): Promise<Association>
  /** 生成深度练习题（用户按需触发） */
  generateExercises(word: string, meaning: string, collocations: string[], difficulty: string, signal?: AbortSignal): Promise<Exercises>
  /** 批改用户造句 */
  evaluateSentence(word: string, meaning: string, sentence: string, signal?: AbortSignal): Promise<SentenceEvaluation>
}

/** 服务聚合（供工厂 services/index.ts 与上层 store/页面注入使用） */
export interface AppServices {
  soe: SoeService
  mnemonic: MnemonicService
}
