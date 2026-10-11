/**
 * SOE 代理健康检查 BFF — 同源转发 {proxyUrl}/healthz，配置卡的连接徽标用。
 * 演示模式 / 未配置 / 代理不可达 → { ok: false }。
 */
import { NextResponse } from 'next/server'
import { readSoeConfig } from '@/lib/server-settings'
import { buildServiceUrl } from '@/lib/service-endpoints'

export async function GET() {
  const cfg = await readSoeConfig()
  if (!cfg || cfg.provider === 'mock' || !cfg.proxyUrl) {
    return NextResponse.json({ ok: false })
  }
  try {
    const res = await fetch(buildServiceUrl(cfg.proxyUrl, '/healthz'), { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return NextResponse.json({ ok: false })
    const data = await res.json().catch(() => null)
    return NextResponse.json(data ?? { ok: false })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
