/**
 * SOE 代理健康检查 BFF — 同源转发 {proxyUrl}/healthz，配置卡的连接徽标用。
 * 演示模式 / 未配置 / 代理不可达 → { ok: false }。
 */
import { NextResponse } from 'next/server'
import { readSoeConfig } from '@/lib/server-settings'
import { isUnsafeUpstreamUrl, sameOriginGuard } from '@/lib/api-guard'
import { SOE_HEALTH_ENDPOINT, buildServiceUrl } from '@/lib/service-endpoints'

export async function GET(request: Request) {
  // 同源守卫（评审 #2）：避免恶意局域网页探测代理地址与在线状态
  const denied = sameOriginGuard(request)
  if (denied) return denied
  const cfg = await readSoeConfig()
  if (!cfg || cfg.provider === 'mock' || !cfg.proxyUrl) {
    return NextResponse.json({ ok: false })
  }
  // proxyUrl 过 SSRF 门（c090）：与 evaluate 同判断，不安全的地址不探测
  if (isUnsafeUpstreamUrl(cfg.proxyUrl)) return NextResponse.json({ ok: false })
  try {
    const res = await fetch(buildServiceUrl(cfg.proxyUrl, SOE_HEALTH_ENDPOINT), { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return NextResponse.json({ ok: false })
    const data = await res.json().catch(() => null)
    return NextResponse.json(data ?? { ok: false })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
