/**
 * 统一 API 错误 —— 与前端 services/contracts.ts 的 ApiError 及架构 §3.3 的错误格式对齐：
 * 响应体 { code, message, detail? }；HTTP 状态语义化（400 参数错 / 413 音频过大 / 429 限流 / 502 上游失败 / 503 provider 未配置）。
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 500,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 错误码与 HTTP 状态的固定映射（契约②相关；后续接口复用） */
export const ERR = {
  BAD_REQUEST: { code: 'BAD_REQUEST', status: 400 },
  PAYLOAD_TOO_LARGE: { code: 'PAYLOAD_TOO_LARGE', status: 413 },
  SOE_NO_SPEECH: { code: 'SOE_NO_SPEECH', status: 400 },
  UPSTREAM_RATE_LIMIT: { code: 'UPSTREAM_RATE_LIMIT', status: 429 },
  UPSTREAM_TIMEOUT: { code: 'UPSTREAM_TIMEOUT', status: 504 },
  SOE_UPSTREAM_ERROR: { code: 'SOE_UPSTREAM_ERROR', status: 502 },
  /** 请求指定了服务端未配置密钥的 provider（注册表查不到） */
  PROVIDER_UNAVAILABLE: { code: 'PROVIDER_UNAVAILABLE', status: 503 },
  INTERNAL: { code: 'INTERNAL', status: 500 },
} as const

export const apiError = (
  kind: { code: string; status: number },
  message: string,
  detail?: unknown,
): ApiError => new ApiError(kind.code, message, kind.status, detail)
