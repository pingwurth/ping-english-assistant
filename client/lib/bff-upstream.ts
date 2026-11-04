/**
 * BFF 上游调用的统一中止/超时基建 —— 唯一实现（2026-11 全仓复审 c060/c069：
 * tts/translate/mnemonic×2 四处手搓同一段 controller+setTimeout+AbortSignal.any
 * + clearTimeout + 499/504 判别，已经开始彼此漂移：tts 把取消也报成 504）。
 *
 * 用法：
 *   const upstream = withUpstreamTimeout(request.signal, TIMEOUT_MS)
 *   try { await fetchUpstream(upstream.signal) }
 *   finally { upstream.done() }
 * 捕获 AbortError 后用 upstreamAbortResponse 判别 499（客户端取消）/504（超时）。
 */
import { NextResponse } from 'next/server'

export interface UpstreamTimeout {
  /** 客户端取消 + 路由层硬超时的合并中止信号 */
  signal: AbortSignal
  /** 上游调用结束（无论成败）后必须调用：清定时器防泄漏 */
  done: () => void
}

/** 客户端取消（request.signal）与路由层硬超时并入一个中止信号 */
export function withUpstreamTimeout(requestSignal: AbortSignal | undefined, timeoutMs: number): UpstreamTimeout {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: requestSignal ? AbortSignal.any([requestSignal, controller.signal]) : controller.signal,
    done: () => clearTimeout(timer),
  }
}

/**
 * AbortError 的统一判别响应：request.signal 已中止 = 客户端主动取消 → 499（空体）；
 * 否则视为路由层超时 → 504（带 code 的 JSON）。取消不是服务故障（lib/llm/errors 同口径）。
 * 仅在上游调用抛 AbortError（或任何 error 且 request.signal.aborted）时调用。
 */
export function upstreamAbortResponse(request: Request, timeoutMessage: string, timeoutCode: string): NextResponse {
  if (request.signal.aborted) return new NextResponse(null, { status: 499 })
  return NextResponse.json({ error: timeoutMessage, code: timeoutCode }, { status: 504 })
}
