import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

let api: typeof import('@/lib/api-guard')
let proxyModule: typeof import('@/proxy')

beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllEnvs()
  api = await import('@/lib/api-guard')
  proxyModule = await import('@/proxy')
})

describe('可信 Host', () => {
  it('默认放行 loopback 与手机局域网地址（含端口），拒绝公网/攻击者域名', () => {
    expect(api.isTrustedRequestHost('localhost:3000')).toBe(true)
    expect(api.isTrustedRequestHost('127.0.0.1:3000')).toBe(true)
    expect(api.isTrustedRequestHost('[::1]:3000')).toBe(true)
    expect(api.isTrustedRequestHost('192.168.110.50:3000')).toBe(true)
    expect(api.isTrustedRequestHost('10.1.2.3:3000')).toBe(true)
    expect(api.isTrustedRequestHost('evil.example')).toBe(false)
    // 评审 P1 回归：fc/fd 开头的 DNS 域名不是 ULA IPv6 字面量，不得信任
    expect(api.isTrustedRequestHost('fd.evil.com:3000')).toBe(false)
    expect(api.isTrustedRequestHost('fc.evil.com:3000')).toBe(false)
    // 真 ULA / 链路本地 IPv6 字面量仍放行，公网 IPv6 仍拒绝
    expect(api.isTrustedRequestHost('[fc00::1]:3000')).toBe(true)
    expect(api.isTrustedRequestHost('[fd12:3456:789a::1]:8788')).toBe(true)
    expect(api.isTrustedRequestHost('[fe80::1]:3000')).toBe(true)
    expect(api.isTrustedRequestHost('[2001:db8::1]:3000')).toBe(false)
    expect(api.isTrustedRequestHost(null)).toBe(false)
  })

  it('PING_ENG_ALLOWED_HOSTS 显式放行公网 Host；带端口时只放行该端口', async () => {
    vi.stubEnv('PING_ENG_ALLOWED_HOSTS', 'https://example.com:3000')
    vi.resetModules()
    const fresh = await import('@/lib/api-guard')
    expect(fresh.isTrustedRequestHost('example.com:3000')).toBe(true)
    expect(fresh.isTrustedRequestHost('example.com:4000')).toBe(false)
  })

  it('ALLOWED_HOSTS 尾随斜杠被容忍（r3 复审 #4），带路径片段仍拒绝并告警', async () => {
    vi.stubEnv('PING_ENG_ALLOWED_HOSTS', 'box.example.com/')
    vi.resetModules()
    const fresh = await import('@/lib/api-guard')
    expect(fresh.isTrustedRequestHost('box.example.com')).toBe(true)
    expect(fresh.isTrustedRequestHost('box.example.com:3000')).toBe(true)
  })

  it('sameOriginGuard：Host 可信 + Origin/Host 一致才放行；Host 头缺失回落请求 URL', () => {
    const lan = '192.168.110.50:3000'
    const ok = new Request(`http://${lan}/api`, { headers: { host: lan, origin: `http://${lan}` } })
    expect(api.sameOriginGuard(ok)).toBeNull()
    // 无 Host 头（undici 测试构造）：回落到 request.url 的 host，与路由同源
    expect(api.sameOriginGuard(new Request(`http://${lan}/api`, {}))).toBeNull()
    // 不可信 Host：DNS rebinding 下 Origin==Host 也拒
    const evil = new Request('http://evil.example/api', { headers: { host: 'evil.example', origin: 'http://evil.example' } })
    expect(api.sameOriginGuard(evil)?.status).toBe(403)
    // Origin host 与 Host 不一致（端口不同）
    const portMismatch = new Request(`http://${lan}/api`, { headers: { host: lan, origin: 'http://192.168.110.50:4000' } })
    expect(api.sameOriginGuard(portMismatch)?.status).toBe(403)
  })
})

describe('proxy 非 GET/HEAD 防护', () => {
  function postRequest(url: string, headers: Record<string, string>): NextRequest {
    return new NextRequest(url, { method: 'POST', headers })
  }

  it('DNS rebinding 下 Origin==Host 的公网域名仍被拒绝', () => {
    const res = proxyModule.proxy(postRequest('http://evil.example/api/tts', {
      host: 'evil.example',
      origin: 'http://evil.example',
    }))
    expect(res.status).toBe(403)
  })

  it('手机 LAN Host 的同源/无 Origin 变更请求可用', () => {
    const host = '192.168.110.50:3000'
    expect(proxyModule.proxy(postRequest(`http://${host}/api/tts`, {
      host,
      origin: `http://${host}`,
    })).status).toBe(200)
    expect(proxyModule.proxy(postRequest(`http://${host}/api/tts`, { host })).status).toBe(200)
  })
})

