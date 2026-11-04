/**
 * fetchLlmConfigs 模块级缓存语义回归（2026-11 全仓复审 c001）：
 * 旧实现缓存只在失败时清、force 不丢缓存 promise —— 「保存配置又弹出配置框、
 * 转写永不启动」死循环的根因。force 必须真发新请求；invalidate 后下次重取；
 * 同屏多次调用只发一次请求（缓存的本来目的）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLlmConfigs, invalidateLlmConfigsCache } from '../use-service-configs'

const jsonResponse = (configs: Array<{ id: string }>): Promise<Response> =>
  Promise.resolve({ json: () => Promise.resolve({ configs }) } as unknown as Response)

afterEach(() => {
  invalidateLlmConfigsCache()
  vi.unstubAllGlobals()
})

describe('fetchLlmConfigs 缓存语义', () => {
  it('同屏多次调用共享一次请求（缓存的本来目的）', async () => {
    const fetchMock = vi.fn(() => jsonResponse([{ id: 'a' }]))
    vi.stubGlobal('fetch', fetchMock)
    const [r1, r2] = await Promise.all([fetchLlmConfigs(), fetchLlmConfigs()])
    expect(((r1.configs ?? []) as Array<{ id: string }>).length).toBe(1)
    expect(((r2.configs ?? []) as Array<{ id: string }>).length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('force=true 丢弃已 resolve 的缓存，真发新请求', async () => {
    let configs: Array<{ id: string }> = []
    const fetchMock = vi.fn(() => jsonResponse(configs))
    vi.stubGlobal('fetch', fetchMock)
    expect(((await fetchLlmConfigs()).configs as Array<{ id: string }>).length).toBe(0) // 首次：空列表被缓存
    configs = [{ id: 'saved' }] // 「用户保存了新配置」
    expect(((await fetchLlmConfigs()).configs as Array<{ id: string }>).length).toBe(0) // 非 force：命中缓存（0 次新请求）
    expect(((await fetchLlmConfigs(true)).configs as Array<{ id: string }>).length).toBe(1) // force：必须看到新配置
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('invalidateLlmConfigsCache 后下次调用重新拉取', async () => {
    let configs: Array<{ id: string }> = []
    const fetchMock = vi.fn(() => jsonResponse(configs))
    vi.stubGlobal('fetch', fetchMock)
    await fetchLlmConfigs()
    configs = [{ id: 'saved' }]
    invalidateLlmConfigsCache()
    expect(((await fetchLlmConfigs()).configs as Array<{ id: string }>).length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('失败清缓存：下次调用重试而不是复用失败', async () => {
    let fail = true
    const fetchMock = vi.fn(() => (fail ? Promise.reject(new Error('net')) : jsonResponse([{ id: 'a' }])))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchLlmConfigs()).rejects.toThrow('net')
    fail = false
    expect(((await fetchLlmConfigs()).configs as Array<{ id: string }>).length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
