import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverSettings = vi.hoisted(() => ({
  readEffectiveLlmSettings: vi.fn(),
  readLlmConfigById: vi.fn(),
  maskSecret: vi.fn((secret: string) => (secret.length <= 8 ? '***' : `${secret.slice(0, 8)}***`)),
}))

vi.mock('@/lib/server-settings', () => serverSettings)

let route: typeof import('@/app/api/models/route')

beforeEach(async () => {
  vi.resetModules()
  serverSettings.readEffectiveLlmSettings.mockReset()
  serverSettings.readLlmConfigById.mockReset()
  serverSettings.maskSecret.mockClear()
  global.fetch = vi.fn()
  route = await import('@/app/api/models/route')
})

function makeRequest(body: unknown, origin?: string): Request {
  return new Request('http://localhost:3000/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  })
}

describe('POST /api/models 编辑配置探测', () => {
  it('掩码原样回传且 baseUrl 未变时，服务端使用已存真实 key', async () => {
    serverSettings.readLlmConfigById.mockResolvedValue({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'real-secret-key',
    })
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), {
      headers: { 'Content-Type': 'application/json' },
    }))

    const res = await route.POST(makeRequest({
      configId: 'cfg-1',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'real-sec***',
    }))
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer real-secret-key' }),
      }),
    )
    expect(await res.json()).toEqual({ models: ['model-a'] })
  })

  it('baseUrl 改变时掩码 key 不能代表真实凭据，直接拒绝且不出网', async () => {
    serverSettings.readLlmConfigById.mockResolvedValue({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'real-secret-key',
    })

    const res = await route.POST(makeRequest({
      configId: 'cfg-1',
      baseUrl: 'https://other.example.com/v1',
      apiKey: 'real-sec***',
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Base URL 已修改；请重新输入 API Key 后再探测模型列表' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('元数据/链路本地 baseUrl 被 SSRF 闸门拒绝且不出网（复审 #2）', async () => {
    const res = await route.POST(makeRequest({
      baseUrl: 'http://169.254.169.254',
      apiKey: 'x',
    }))
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('跨源 Origin 被同源守卫拦下 403（复审 #2 接线验证）', async () => {
    const res = await route.POST(makeRequest(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'x' },
      'http://evil.example.com',
    ))
    expect(res.status).toBe(403)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
