import { NextRequest, NextResponse } from 'next/server'
import { isTrustedRequestHost } from '@/lib/api-guard'

/**
 * BFF 变更请求的同源防护。
 *
 * CORS 只能阻止浏览器读取响应，不能阻止 cross-site simple request 到达服务端；
 * 因此所有可能写设置、消耗上游额度或落盘的非 GET/HEAD 请求都必须校验 Origin。
 * 无 Origin 的本机 curl/服务端调用保持可用；浏览器 cross-site POST 会带 Origin。
 */
export function proxy(request: NextRequest) {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return NextResponse.next()

  // Host 是第一道边界：公网 Host 未显式配置时，即使没有 Origin 也不能变更本地配置或消耗额度。
  if (!isTrustedRequestHost(request.headers.get('host'))) return forbiddenOrigin()

  const origin = request.headers.get('origin')
  if (!origin) return NextResponse.next()

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return forbiddenOrigin()
  }

  // 可信反代/局域网访问要求 Origin 与请求 Host 同 host（含端口）；
  // DNS rebinding 的攻击者域名已在 isTrustedRequestHost 处被拒绝。
  if (originUrl.host !== request.headers.get('host')) return forbiddenOrigin()
  return NextResponse.next()
}

function forbiddenOrigin() {
  return NextResponse.json(
    { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin BFF mutations are not allowed' },
    { status: 403 },
  )
}

export const config = { matcher: '/api/:path*' }
