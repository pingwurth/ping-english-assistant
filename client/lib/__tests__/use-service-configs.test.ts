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

/* ── 状态机用例（四轮复审 c005/c001）：在途合流、代际作废、失败复位 ── */

/** 可手动 resolve 的 deferred fetch 桩：精确控制在途窗口 */
function deferredFetch() {
  const pending: Array<{ url: string; resolve: (body: unknown) => void; reject: (e: unknown) => void }> = []
  const fetchMock = vi.fn(() => new Promise<Response>((resolve, reject) => {
    pending.push({ url: '', resolve: (body) => resolve({ json: () => Promise.resolve(body) } as unknown as Response), reject })
  }))
  return {
    fetchMock,
    calls: () => pending,
  }
}

describe('fetchLlmConfigs 状态机（c005/c001）', () => {
  it('同 tick 两次 force 合流为一次请求（在途合流,同屏一次请求不变量）', async () => {
    const { fetchMock, calls } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const p1 = fetchLlmConfigs(true)
    const p2 = fetchLlmConfigs(true) // 第一次仍在途 → 合流
    expect(p2).toBe(p1)
    calls()[0]!.resolve({ configs: [{ id: 'a' }] })
    expect((await p1).configs).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invalidate 作废旧代际在途请求：force 起新请求,旧响应不落缓存（c001 回归锚）', async () => {
    const { fetchMock, calls } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const stale = fetchLlmConfigs() // 保存前发起(旧代际)
    invalidateLlmConfigsCache()     // 用户保存 → 代际递增
    const fresh = fetchLlmConfigs(true) // 不得合流进旧代际 → 起新请求
    expect(fetchMock).toHaveBeenCalledTimes(2)
    calls()[0]!.resolve({ configs: [] })        // 旧请求 settle(保存前数据)
    calls()[1]!.resolve({ configs: [{ id: 'saved' }] })
    expect(((await fresh).configs as Array<{ id: string }>).length).toBe(1)
    // 旧代际响应不可充当缓存：非 force 调用命中新代际缓存,不再发第 3 次请求
    const again = await fetchLlmConfigs()
    expect(((again).configs as Array<{ id: string }>).length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await stale
  })

  it('失败复位：reject 后 fetching/缓存归位,下次调用可重试', async () => {
    const { fetchMock, calls } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const p = fetchLlmConfigs()
    calls()[0]!.reject(new Error('net'))
    await expect(p).rejects.toThrow('net')
    // 复位后：非 force 也能重新发起（缓存为 null）
    const retry = fetchLlmConfigs()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    calls()[1]!.resolve({ configs: [{ id: 'ok' }] })
    await retry
  })

  it('非 force 在途 → invalidate → 非 force 调用：不合流旧代际,必起新请求（五轮复审 c004）', async () => {
    const { fetchMock, calls } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const stale = fetchLlmConfigs() // 保存前发起(旧代际,非 force)
    invalidateLlmConfigsCache()     // 保存
    const fresh = fetchLlmConfigs() // 保存后挂载的 hook(load() 非 force)——不得合流旧代际
    expect(fetchMock).toHaveBeenCalledTimes(2)
    calls()[0]!.resolve({ configs: [] })
    calls()[1]!.resolve({ configs: [{ id: 'saved' }] })
    expect(((await fresh).configs as Array<{ id: string }>).length).toBe(1)
    // 旧代际响应不落缓存:后续非 force 命中新代际
    expect(((await fetchLlmConfigs()).configs as Array<{ id: string }>).length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await stale
  })

  it('已 settle 的当前代际缓存：force 拒绝（强制重取）,非 force 命中', async () => {
    const { fetchMock, calls } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const first = fetchLlmConfigs()
    calls()[0]!.resolve({ configs: [] })
    await first
    await fetchLlmConfigs() // 非 force 命中缓存
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const forced = fetchLlmConfigs(true) // force 重取(先拿到 promise 再 resolve,避免测试自锁)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    calls()[1]!.resolve({ configs: [] })
    await forced
  })
})
