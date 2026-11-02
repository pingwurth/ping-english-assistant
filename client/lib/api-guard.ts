/**
 * BFF 可信 Host / 同源校验 —— 本地优先应用的安全边界。
 *
 * settings.json 存有第三方 API 明文密钥，且 dev server 可能监听局域网
 * （next.config.mjs allowedDevOrigins）。恶意局域网页面可通过 CSRF 到达服务端，
 * DNS rebinding 也可让 Origin 与 Host 同为攻击者域名。
 *
 * 策略：
 *  - Host 必须属于默认可信的本机/局域网地址，或通过 PING_ENG_ALLOWED_HOSTS 显式配置；
 *  - 带 Origin 的请求还要求 Origin host 与请求 Host 完全一致；
 *  - 无 Origin 的 curl/服务端调用只要 Host 可信即放行；
 *  - 浏览器跨源 GET 会带异源 Origin，settings 读接口同样会被拦下。
 */

interface HostAllowance {
  hostname: string
  /** undefined = 该主机任意端口；指定则必须完全匹配 */
  port?: string
}

function parseHost(host: string): { hostname: string; port?: string } | null {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end < 0) return null
    return { hostname: host.slice(1, end), port: host.slice(end + 2) || undefined }
  }
  const colon = host.lastIndexOf(':')
  if (colon >= 0 && host.indexOf(':') === colon) {
    return { hostname: host.slice(0, colon), port: host.slice(colon + 1) }
  }
  if (colon >= 0) return null // 未包方括号的 IPv6 Host 不合法
  return { hostname: host }
}

function parseConfiguredHost(value: string): { hostname: string; port?: string } | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      // 允许用户按直觉配置 https://box.example.com:3000；显式端口会被保留。
      return parseHost(new URL(value).host)
    } catch {
      return null
    }
  }
  return parseHost(value)
}

const EXPLICIT_HOSTS: HostAllowance[] = (process.env.PING_ENG_ALLOWED_HOSTS || '')
  .split(',')
  .flatMap((value) => {
    const parsed = parseConfiguredHost(value.trim())
    if (!parsed && value.trim()) console.warn(`[api-guard] 忽略无效 PING_ENG_ALLOWED_HOSTS 项：${value}`)
    return parsed ? [parsed] : []
  })

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

/**
 * 是否为 IPv6 字面量：仅十六进制组与冒号、至少 2 个冒号。
 * DNS 名称不可能满足（'fd.evil.com' 含 '.'，'fc' 无冒号），
 * 以此防止「fc/fd 开头的域名」被误判为 ULA IPv6 主机（评审 P1）。
 */
function isIpv6Literal(hostname: string): boolean {
  const value = hostname.toLowerCase()
  if (!value.includes(':') || !/^[0-9a-f:]+$/.test(value)) return false
  const sides = value.split('::')
  if (sides.length > 2) return false
  const groups = sides.flatMap((side) => (side === '' ? [] : side.split(':')))
  if (groups.some((group) => group.length === 0 || group.length > 4 || !/^[0-9a-f]+$/.test(group))) return false
  return sides.length === 2 ? groups.length <= 8 : groups.length === 8
}

function isPrivateIPv6(hostname: string): boolean {
  if (!isIpv6Literal(hostname)) return false
  const value = hostname.toLowerCase()
  if (value === '::1' || value.startsWith('fe80:')) return true
  // ULA fc00::/7：首个 16 位组（hextet）落在 fc00–fdff
  const firstGroup = parseInt(value.split(':')[0], 16)
  return Number.isInteger(firstGroup) && (firstGroup & 0xfe00) === 0xfc00
}

function isDefaultTrustedHost({ hostname }: { hostname: string }): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' ||
    isPrivateIPv4(hostname) || isPrivateIPv6(hostname)
}

/** Host（可带端口）是否属于本应用可信的本机/局域网/显式配置边界 */
export function isTrustedRequestHost(host: string | null): boolean {
  const parsed = host ? parseHost(host) : null
  if (!parsed) return false
  if (isDefaultTrustedHost(parsed)) return true
  return EXPLICIT_HOSTS.some(
    (allowed) => allowed.hostname.toLowerCase() === parsed.hostname.toLowerCase() &&
      (allowed.port === undefined || allowed.port === parsed.port),
  )
}

/**
 * 判断请求是否来自可信同源上下文。
 * @param origin 请求的 Origin 头（可能为 null）
 * @param host   请求的 Host 头
 */
export function isSameOriginRequest(origin: string | null, host: string | null, selfUrl: string): boolean {
  // Host 是第一道边界：仅 Origin==Host 挡不住 DNS rebinding。
  // Host 头缺失时（HTTP/1.1 必带，仅测试构造的 Request / 极端客户端）回落到请求自身 URL 的 host，
  // 与服务端路由所用的是同一来源，不构成放宽。
  const effectiveHost = host ?? (selfUrl ? hostOf(selfUrl) : null)
  if (!isTrustedRequestHost(effectiveHost)) return false
  if (origin) return hostOf(origin) === effectiveHost
  return true
}

/** 拒绝响应体（403）—— 不暴露接口细节；proxy 与 settings 路由保持同一形状 */
export function forbiddenOriginResponse(): Response {
  return new Response(JSON.stringify({ code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin BFF request is not allowed' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface SameOriginGuardOptions {
  /** proxy 可跳过 GET/HEAD/OPTIONS；敏感 settings 路由即使 GET 也必须校验 */
  skipSafeMethods?: boolean
}

/** 单一 BFF 同源防护入口：可信 Host + Origin/Host 一致性；通过返回 null */
export function sameOriginGuard(
  request: Request,
  options: SameOriginGuardOptions = {},
): Response | null {
  if (options.skipSafeMethods && ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return null
  const host = request.headers.get('host')
  const effectiveHost = host ?? (request.url ? hostOf(request.url) : null)
  if (!isTrustedRequestHost(effectiveHost)) return forbiddenOriginResponse()
  const origin = request.headers.get('origin')
  if (!origin) return null
  return hostOf(origin) === effectiveHost ? null : forbiddenOriginResponse()
}
