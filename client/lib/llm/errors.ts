/**
 * LLM 服务层统一错误处理
 *
 * 复用 contracts.ts 的 ApiError 模式，提供 LLM 特定的错误码和工厂函数。
 */

import { ApiError, throwIfAborted as throwBaseIfAborted, toApiError } from '@/services/contracts'
import type { LlmErrorCode } from './types'

/** LLM 服务层错误 */
export class LlmError extends ApiError {
  declare readonly code: LlmErrorCode

  constructor(code: LlmErrorCode, message: string, detail?: unknown) {
    super(code, message, detail)
    this.name = 'LlmError'
  }
}

/** 将任意未知错误归一为 LlmError（错误分类复用 services/contracts.ts） */
export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err
  const normalized = toApiError(err)
  if (normalized.code === 'ABORTED') return new LlmError('ABORTED', normalized.message, normalized.detail)
  if (normalized.code === 'NETWORK_ERROR') return new LlmError('UPSTREAM_ERROR', normalized.message, normalized.detail)
  return new LlmError('UPSTREAM_ERROR', normalized.message || '未知错误', normalized.detail)
}

/** 检查 AbortSignal 是否已中止 */
export function throwIfAborted(signal?: AbortSignal): void {
  try {
    throwBaseIfAborted(signal)
  } catch (err) {
    throw toLlmError(err)
  }
}

/**
 * LlmError → BFF 统一 JSON 错误响应（评审 #48）。
 * 此前 translate/mnemonic 各自手写 statusMap、transcribe/tts 一律 500，同一
 * 「API Key 未配置」在不同路由返回不同状态码，客户端按状态码区分「去配置」
 * 还是「重试」时行为不一致。新增 LlmError code 或路由只需改这一处。
 */
export function toLlmErrorResponse(error: LlmError): Response {
  const statusMap: Record<string, number> = {
    API_KEY_MISSING: 400,
    BASE_URL_MISSING: 400,
    MODEL_NOT_CONFIGURED: 400,
    RESPONSE_EMPTY: 502,
    RESPONSE_FORMAT_ERROR: 502,
    UPSTREAM_ERROR: 502,
    REQUEST_TIMEOUT: 504,
  }
  return new Response(JSON.stringify({ error: error.message, code: error.code }), {
    status: statusMap[error.code] ?? 502,
    headers: { 'Content-Type': 'application/json' },
  })
}
