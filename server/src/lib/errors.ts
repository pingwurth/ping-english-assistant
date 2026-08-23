/**
 * 统一错误码与规范化（架构文档 §3.3）
 * 错误格式 { code, message, detail? }；HTTP 状态语义化。
 */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message: string, detail?: unknown) => new AppError(400, 'bad-request', message, detail),
  payloadTooLarge: (message = '音频过大（上限 25MB）') => new AppError(413, 'payload-too-large', message),
  tooMany: (message = '请求过于频繁，请稍后再试') => new AppError(429, 'rate-limited', message),
  upstream: (service: string, detail?: unknown) =>
    new AppError(502, 'upstream-error', `上游服务失败: ${service}`, detail),
  timeout: (service: string) => new AppError(502, 'upstream-timeout', `上游服务超时: ${service}`),
  internal: (message = '服务器内部错误') => new AppError(500, 'internal-error', message),
  notFound: (message = '资源不存在') => new AppError(404, 'not-found', message)
};

export function toErrorBody(e: unknown): { statusCode: number; body: { code: string; message: string; detail?: unknown } } {
  if (e instanceof AppError) {
    return {
      statusCode: e.statusCode,
      body: { code: e.code, message: e.message, ...(e.detail !== undefined ? { detail: e.detail } : {}) }
    };
  }
  const message = e instanceof Error ? e.message : '服务器内部错误';
  return { statusCode: 500, body: { code: 'internal-error', message } };
}
