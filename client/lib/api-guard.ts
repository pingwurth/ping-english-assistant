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
    const hostname = host.slice(0, colon)
    if (hostname.includes('/')) return null // Host 头/配置值里不可能合法出现路径分隔符
    return { hostname, port: host.slice(colon + 1) }
  }
  if (colon >= 0) return null // 未包方括号的 IPv6 Host 不合法
  if (host.includes('/')) return null
  return { hostname: host }
}

function parseConfiguredHost(value: string): { hostname: string; port?: string } | null {
  // 容忍尾随斜杠（r3 复审 #4）：'box.example.com/' 原先被解析成带 '/' 的 hostname，
  // 白名单永不命中且无任何提示——正是 #12 要消除的「fail-closed 但不可排障」陷阱
  const trimmed = value.replace(/\/+$/, '')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      // 允许用户按直觉配置 https://box.example.com:3000；显式端口会被保留。
      return parseHost(new URL(trimmed).host)
    } catch {
      return null
    }
  }
  return parseHost(trimmed)
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

/** 拒绝响应体（403）—— 不暴露接口细节；proxy 与 settings 路由保持同一形状 */
export function forbiddenOriginResponse(): Response {
  return new Response(JSON.stringify({ code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin BFF request is not allowed' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 上游 URL 不安全（isUnsafeUpstreamUrl 为真）时的统一 400 响应 —— 各 BFF 出网路由
 *  与设置持久化路径共用同一判断与文案（2026-11 全仓复审 c066/c090：门禁原先只接在
 *  POST /api/models 一处，其余服务端外连全部无门） */
export function unsafeUpstreamResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'UNSAFE_UPSTREAM',
      error: '上游地址协议或网段不被允许（仅 http/https，禁止链路本地/元数据地址）',
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}

export interface SameOriginGuardOptions {
  /** proxy 可跳过 GET/HEAD/OPTIONS；敏感 settings 路由即使 GET 也必须校验 */
  skipSafeMethods?: boolean
}

/**
 * 把 IPv6 字面量展开为 8 个 16 位组；非法（组数不齐、坏字符、多处 ::）返回 null。
 * 支持 '::' 压缩与尾部内嵌 IPv4（'::ffff:1.2.3.4'）。WHATWG URL 会把点分内嵌
 * 归一成十六进制，这里仍按两种写法都能解析防御。
 */
function expandIpv6Groups(raw: string): number[] | null {
  let value = raw.toLowerCase()
  const lastColon = value.lastIndexOf(':')
  const tail = lastColon >= 0 ? value.slice(lastColon + 1) : value
  if (tail.includes('.')) {
    const parts = tail.split('.').map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hi = ((parts[0]! << 8) | parts[1]!).toString(16)
    const lo = ((parts[2]! << 8) | parts[3]!).toString(16)
    value = `${value.slice(0, lastColon + 1)}${hi}:${lo}`
  }
  if (!/^[0-9a-f:]+$/.test(value)) return null
  const sides = value.split('::')
  if (sides.length > 2) return null
  const parseSide = (side: string): number[] | null => {
    if (side === '') return []
    const groups: number[] = []
    for (const g of side.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      groups.push(parseInt(g, 16))
    }
    return groups
  }
  const head = parseSide(sides[0] ?? '')
  const tailGroups = parseSide(sides[1] ?? '')
  if (head === null || tailGroups === null) return null
  const total = head.length + tailGroups.length
  if (sides.length === 2) {
    if (total > 7) return null // '::' 至少压缩一个组
    return [...head, ...Array<number>(8 - total).fill(0), ...tailGroups]
  }
  return total === 8 ? [...head, ...tailGroups] : null
}

/** IPv6 组序列是否落在拒绝段：fe80::/10 整段、未指定地址、映射/兼容/NAT64 内嵌的 169.254/16 */
function isUnsafeIpv6Groups(groups: number[]): boolean {
  // fe80::/10 = 首组 & 0xffc0 === 0xfe80（覆盖 fe80–febf，不止 fe80 前缀）
  if ((groups[0]! & 0xffc0) === 0xfe80) return true
  // 未指定地址 '::'（含 '0:0:0:0:0:0:0:0' 拼写）
  if (groups.every((g) => g === 0)) return true
  // IPv4 映射段 ::ffff:0:0/96（高 80 位零 + 第 6 组 ffff）或已废弃的兼容段 ::/96（高 96 位零）：
  // 低 32 位就是 IPv4 地址，按 IPv4 策略拦链路本地。
  // WHATWG 把 [::ffff:169.254.169.254] 序列化成 '[::ffff:a9fe:a9fe]'，字符串前缀永远拦不住它。
  const embeddedV4 =
    (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) ||
    groups.slice(0, 6).every((g) => g === 0)
  if (embeddedV4 && groups[6]! >> 8 === 169 && (groups[6]! & 0xff) === 254) return true
  // NAT64 64:ff9b::/96 内嵌 IPv4 链路本地（同理可达 169.254.169.254）
  if (groups[0]! === 0x64 && groups[1]! === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    if (groups[6]! >> 8 === 169 && (groups[6]! & 0xff) === 254) return true
  }
  return false
}

/**
 * 服务端出网目标（用户可传的 LLM baseUrl）的 SSRF 闸门（评审 #2）。
 * 本应用默认就要连局域网/本机推理服务，不能按「只允许可路由地址」拦，
 * 但链路本地段（169.254.0.0/16、fe80::/10 全段，含 IPv4-mapped/NAT64 内嵌形态）
 * 在本地部署中永为用户有意配置、在云主机上恰是元数据端点（169.254.169.254）
 * → 一律拒绝；协议只允 http/https。
 */
export function isUnsafeUpstreamUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return true // 不可解析的 baseUrl 同样拒绝，不让它流入 fetch 拼接
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
  // IPv6 字面量在 URL.hostname 里保留方括号（'[fe80::1]'），先去括号再判定
  const h = (u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname).toLowerCase()
  if (h.includes(':')) {
    const groups = expandIpv6Groups(h)
    return groups === null ? true : isUnsafeIpv6Groups(groups) // 解析不动的 IPv6 形态 → 拒绝
  }
  if (h.startsWith('169.254.')) return true // 含 169.254.169.254 元数据端点
  return false
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
