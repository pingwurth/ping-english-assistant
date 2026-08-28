/**
 * LLM 服务层统一错误处理
 *
 * 复用 contracts.ts 的 ApiError 模式，提供 LLM 特定的错误码和工厂函数。
 */

import type { LlmErrorCode } from './types'

/** LLM 服务层错误 */
export class LlmError extends Error {
  readonly code: LlmErrorCode
  readonly detail?: unknown

  constructor(code: LlmErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.detail = detail
  }
}

/** 将任意未知错误归一为 LlmError */
export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err

  // AbortError（超时或用户取消）
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return new LlmError('ABORTED', '操作已取消', err)
  }

  if (err instanceof Error) {
    // 识别 fetch 网络错误
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      return new LlmError('UPSTREAM_ERROR', `网络请求失败：${err.message}`, err)
    }
    return new LlmError('UPSTREAM_ERROR', err.message || '未知错误', err)
  }

  return new LlmError('UPSTREAM_ERROR', String(err), err)
}

/** 检查 AbortSignal 是否已中止 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LlmError('ABORTED', '操作已取消')
  }
}
