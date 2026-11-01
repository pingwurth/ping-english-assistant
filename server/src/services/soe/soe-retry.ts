/**
 * SOE provider 共享的重试判定（azure / tencent / iflytek 一致）。
 *
 * 原则（与各 provider 头注释一致）：
 *   - 网络层瞬断（连接错误）与 429 / 上游 5xx：值得重试一次；
 *   - 400/401/403 等确定性失败：重试只会双倍请求 + 双倍时延，不重试；
 *   - 超时：重试让用户等待翻倍，不重试。
 */
import { ApiError, ERR } from '../../lib/api-error'

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
