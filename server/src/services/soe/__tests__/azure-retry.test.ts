/**
 * Azure provider 网络错误映射与重试回归 —— 评审 #21：
 * 连接层瞬断（'fetch failed'）曾一律映射 UPSTREAM_TIMEOUT，被 soe-retry
 * 短路判死（单次尝试即 504）；应映射 SOE_UPSTREAM_ERROR + reason 自动重试，
 * 只有 AbortSignal.timeout 的 TimeoutError 才是真超时（不重试）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../config/env'
import { createAzureSoeProvider } from '../azure.provider'

const baseEnv = {
  AZURE_SPEECH_KEY: 'test-key',
  AZURE_SPEECH_REGION: 'eastasia',
  SOE_TIMEOUT_MS: 2_000,
  SOE_RETRY: 1,
} as unknown as Env

const input = { refText: 'hello', evalMode: 'sentence' as const, audio: Buffer.from('wav-bytes') }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('azure 网络错误分类（评审 #21）', () => {
  it('连接层错误（fetch failed）→ SOE_UPSTREAM_ERROR 且重试满 SOE_RETRY+1 次', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAzureSoeProvider(baseEnv)
    await expect(provider.evaluate(input)).rejects.toMatchObject({ code: 'SOE_UPSTREAM_ERROR' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // 1 次原始 + 1 次重试
  })

  it('AbortSignal.timeout 的 TimeoutError → UPSTREAM_TIMEOUT，不重试', async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAzureSoeProvider(baseEnv)
    await expect(provider.evaluate(input)).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('调用方取消（signal.aborted）原样上抛，不计为上游错误', async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error('This operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAzureSoeProvider(baseEnv)
    const controller = new AbortController()
    controller.abort()
    // aborted signal 进入 fetch 即抛 AbortError；provider 侧因 signal.aborted 原样透传
    await expect(provider.evaluate(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
