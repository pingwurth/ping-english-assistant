import { NextRequest, NextResponse } from 'next/server'
import { sameOriginGuard } from '@/lib/api-guard'

/**
 * BFF 变更请求的同源防护。
 *
 * CORS 只能阻止浏览器读取响应，不能阻止 cross-site simple request 到达服务端；
 * 因此所有可能写设置、消耗上游额度或落盘的非 GET/HEAD 请求都必须校验 Origin。
 * 无 Origin 的本机 curl/服务端调用保持可用；浏览器 cross-site POST 会带 Origin。
 */
export function proxy(request: NextRequest) {
  return sameOriginGuard(request, { skipSafeMethods: true }) ?? NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
