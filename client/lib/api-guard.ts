/**
 * BFF 写接口同源校验 —— 本地优先应用的安全边界收紧
 *
 * settings.json 存有第三方 API 明文密钥，且 dev server 可能监听局域网
 * （next.config.mjs allowedDevOrigins）。恶意局域网页面可通过 CSRF（跨站请求
 * 伪造）向 /api/settings/* 发起写操作，或利用 DNS rebinding 让浏览器以
 * 「同源」身份读写本机接口。
 *
 * 策略：
 *  - 带 Origin 头的请求：Origin host 必须与请求 Host 一致，否则 403；
 *  - 无 Origin 的同源语义请求（本机 curl 等工具）：Host 必须是本机地址；
 *  - 浏览器跨源 GET 会带异源 Origin，同样被拦下。
 */

/** 本机 Host 白名单（回环默认放行；局域网使用 PING_ENG_ALLOWED_HOSTS="192.168.110.50" 显式追加） */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
for (const h of (process.env.PING_ENG_ALLOWED_HOSTS || '').split(',')) {
  if (h.trim()) LOCAL_HOSTS.add(h.trim())
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * 判断请求是否来自本机同源上下文。
 * @param origin 请求的 Origin 头（可能为 null）
 * @param host   请求的 Host 头
 * @param selfUrl 当前请求自身的完整 URL（用于同源比对基准）
 */
export function isSameOriginRequest(origin: string | null, host: string | null, selfUrl: string): boolean {
  const selfHost = hostOf(selfUrl) || host || ''
  const selfName = hostOf(`http://${selfHost}`).split(':')[0]
  // Host 必须首先是本机地址 —— 只比对 Origin==Host 挡不住 DNS rebinding
  // （攻击者域名解析到 127.0.0.1 后，Origin 与 Host 同为攻击域名仍会放行）
  if (!LOCAL_HOSTS.has(selfName)) return false
  if (origin) {
    // 浏览器请求（含本机页面）：Origin host 必须与自身 host 一致
    return hostOf(origin) === selfHost
  }
  // 无 Origin：curl 等非浏览器工具，Host 是本机地址即放行
  return true
}

/** 拒绝响应体（403）—— 不暴露接口细节 */
export function forbiddenOriginResponse(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden: cross-origin request' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
