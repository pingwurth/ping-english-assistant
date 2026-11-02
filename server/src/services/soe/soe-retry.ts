/**
 * SOE provider 共享的重试判定与重试执行器（azure / tencent / iflytek 一致）。
 *
 * 原则（与各 provider 头注释一致）：
 *   - 网络层瞬断（连接错误）与 429 / 上游 5xx：值得重试一次；
 *   - 400/401/403 等确定性失败：重试只会双倍请求 + 双倍时延，不重试；
 *   - 超时：重试让用户等待翻倍，不重试。
 */
import { ApiError, ERR } from '../../lib/api-error'
import type { Env } from '../../config/env'

export const isSoeRetryable = (err: unknown): boolean => {
  if (!(err instanceof ApiError)) return false
  // 429：瞬时限流，稍后重试有意义
  if (err.code === ERR.UPSTREAM_RATE_LIMIT.code) return true
  // 超时不重试（等待翻倍）
  if (err.code === ERR.UPSTREAM_TIMEOUT.code) return false
  if (err.code !== ERR.SOE_UPSTREAM_ERROR.code) return false

  const d = err.detail as { reason?: unknown; statusCode?: unknown; status?: unknown } | undefined
  // 连接层错误（DNS/断连等）：瞬断常见，重试一次
  if (typeof d?.reason === 'string') return true
  // 上游 HTTP 状态：5xx 瞬时故障可重试；401/403/400 等确定性失败不可
  const code = typeof d?.statusCode === 'number' ? d.statusCode : typeof d?.status === 'number' ? d.status : undefined
  return code !== undefined && code >= 500
}

/** 可中止 sleep：signal 中止时立刻 reject（自 iflytek.provider 上移共用） */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 共享重试执行器（评审 #34：azure/tencent/iflytek 三份逐字拷贝的重试循环收敛于此，
 * 重试策略演进只改这一处）。attempts = SOE_RETRY + 1。
 * 评审 #35：可重试错误重发前退避 200ms→400ms（上限 500ms）——毫秒级重连重发
 * 大概率再撞同一限流窗口（腾讯 4006 并发超限/上游 429），白白浪费唯一一次重试。
 */
export async function withSoeRetry<T>(env: Env, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const attempts = env.SOE_RETRY + 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // 重试判定见 isSoeRetryable：429/5xx/连接层错误重试，鉴权等确定性失败与超时不重试
      if (attempt === attempts || !isSoeRetryable(err)) throw err
      await abortableSleep(Math.min(200 * 2 ** (attempt - 1), 500), signal)
    }
  }
  throw lastErr // 不可达（attempts≥1），取悦类型系统
}
