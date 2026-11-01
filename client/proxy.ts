import { NextRequest, NextResponse } from 'next/server'

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

  const origin = request.headers.get('origin')
  if (!origin) return NextResponse.next()

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return forbiddenOrigin()
  }

  // 只比较 host（含端口）以兼容反向代理终止 TLS；跨 host/端口仍然全部拒绝。
  if (originUrl.host !== request.nextUrl.host) return forbiddenOrigin()
  return NextResponse.next()
}

function forbiddenOrigin() {
  return NextResponse.json(
    { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin BFF mutations are not allowed' },
    { status: 403 },
  )
}

export const config = { matcher: '/api/:path*' }
