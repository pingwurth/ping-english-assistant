/**
 * getSoeService 解析与缓存生命周期回归（2026-11 全仓复审 c044）：
 * 上轮评审的关键修复 ——「settings 拉取失败必须显式抛 SOE_SETTINGS_UNAVAILABLE，
 * 绝不回落 mock 伪评分」—— 与 soeServiceCache/invalidateSoeServiceCache 生命周期
 * 此前没有任何测试覆盖。伪分会写进永久 train: 训练记录，这是它的复活通道。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getSoeService, invalidateSoeServiceCache } from '../index'
import { MockSoeService } from '../mock/soe'
import { ApiSoeService } from '../api/soe'

const okResponse = (body: unknown): Promise<Response> =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response)

afterEach(() => {
  invalidateSoeServiceCache()
  vi.unstubAllGlobals()
})

describe('getSoeService', () => {
  it('provider=mock → 返回本地伪评分实现并缓存（同会话不重复 fetch）', async () => {
    const fetchMock = vi.fn(() => okResponse({ provider: 'mock' }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await getSoeService()
    const second = await getSoeService()
    expect(first).toBeInstanceOf(MockSoeService)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('provider 非 mock → 返回 BFF 代理实现', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okResponse({ provider: 'tencent' })))
    expect(await getSoeService()).toBeInstanceOf(ApiSoeService)
  })

  it('设置拉取失败 → 抛 SOE_SETTINGS_UNAVAILABLE，绝不回落 mock 伪评分', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch failed'))))
    await expect(getSoeService()).rejects.toMatchObject({
      code: 'SOE_SETTINGS_UNAVAILABLE',
      name: 'ApiError',
    })
    // 失败不留缓存：下次解析重新拉取
    vi.stubGlobal('fetch', vi.fn(() => okResponse({ provider: 'mock' })))
    expect(await getSoeService()).toBeInstanceOf(MockSoeService)
  })

  it('HTTP 非 200 同样抛 SOE_SETTINGS_UNAVAILABLE（settings.json 损坏/dev 抖动）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as unknown as Response)))
    await expect(getSoeService()).rejects.toBeInstanceOf(ApiError)
  })

  it('invalidateSoeServiceCache 后：下次解析重新拉取设置', async () => {
    let provider = 'mock'
    const fetchMock = vi.fn(() => okResponse({ provider }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getSoeService()).toBeInstanceOf(MockSoeService)
    provider = 'tencent' // 用户在设置页切换了真实评分
    invalidateSoeServiceCache()
    expect(await getSoeService()).toBeInstanceOf(ApiSoeService)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
