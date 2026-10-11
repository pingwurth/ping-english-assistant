/**
 * services/api/soe 单测：multipart 组装（audio/refText/evalMode/provider）、URL 拼接与错误映射。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiSoeService } from '../soe'
import { ApiError } from '../../contracts'

const BASE = 'http://127.0.0.1:8788'
const okBody = { total: 90, accuracy: 90, fluency: 90, integrity: 90, words: [] }
const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })

/** 捕获 fetch 调用参数：[url, init] */
function lastFetchCall(): { url: string; form: FormData } {
  const fetchMock = vi.mocked(fetch)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, form: init.body as FormData }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiSoeService.evaluate 请求组装', () => {
  it('multipart 字段齐全：audio 为 Blob、refText/evalMode=sentence，URL 为 buildServiceUrl 拼接结果', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const svc = new ApiSoeService({ baseUrl: `${BASE}/` }) // 带尾斜杠验证拼接去重
    const r = await svc.evaluate(audioBlob, 'Good morning', 'sentence')
    expect(r).toEqual(okBody)
    const { url, form } = lastFetchCall()
    expect(url).toBe(`${BASE}/api/v1/soe/evaluate`)
    expect(form.get('audio')).toBeInstanceOf(Blob)
    expect(form.get('refText')).toBe('Good morning')
    expect(form.get('evalMode')).toBe('sentence')
  })

  it('opts.provider=azure → 携带 provider 字段', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const svc = new ApiSoeService({ baseUrl: BASE, provider: 'azure' })
    await svc.evaluate(audioBlob, 'Hello', 'sentence')
    expect(lastFetchCall().form.get('provider')).toBe('azure')
  })

  it('opts.provider 缺省或为 mock → 不携带 provider 字段（走代理默认）', async () => {
    for (const provider of [undefined, 'mock']) {
      const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(okBody), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const svc = new ApiSoeService({ baseUrl: BASE, provider })
      await svc.evaluate(audioBlob, 'Hello', 'sentence')
      expect(lastFetchCall().form.get('provider')).toBeNull()
    }
  })
})

describe('ApiSoeService.evaluate 错误路径', () => {
  it('HTTP 非 ok 且 body 带统一错误格式 → 抛 ApiError（透传 code/message）', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({ code: 'SOE_UPSTREAM_ERROR', message: 'x' }), { status: 502 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const svc = new ApiSoeService({ baseUrl: BASE, provider: 'azure' })
    await expect(svc.evaluate(audioBlob, 'Hello', 'sentence')).rejects.toBeInstanceOf(ApiError)
    await expect(svc.evaluate(audioBlob, 'Hello', 'sentence')).rejects.toMatchObject({ code: 'SOE_UPSTREAM_ERROR', message: 'x' })
  })

  it('网络不可达且未中止 → ApiError SOE_UPSTREAM_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))
    const svc = new ApiSoeService({ baseUrl: BASE, provider: 'azure' })
    await expect(svc.evaluate(audioBlob, 'Hello', 'sentence')).rejects.toMatchObject({ code: 'SOE_UPSTREAM_ERROR' })
  })

  it('网络抛错且 signal 已中止 → ApiError ABORTED（read-aloud 静默分支依赖该 code）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))
    const ctrl = new AbortController()
    ctrl.abort()
    const svc = new ApiSoeService({ baseUrl: BASE, provider: 'azure' })
    await expect(svc.evaluate(audioBlob, 'Hello', 'sentence', ctrl.signal)).rejects.toBeInstanceOf(ApiError)
    await expect(svc.evaluate(audioBlob, 'Hello', 'sentence', ctrl.signal)).rejects.toMatchObject({ code: 'ABORTED' })
  })
})
