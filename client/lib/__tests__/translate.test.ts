/**
 * translateTexts 并发块池回归（评审 #50）：
 * 3 路并发按块索引回填——结果顺序必须与原文一致（乱序完成也不串位）；
 * 任一块失败快速失败并中止其余在途块。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { translateTexts } from '../translate'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 按块返回 {translations: [chunk 前缀标记]}；latencyMs 控制完成顺序 */
function stubFetchByChunk(delays: number[], textsPerChunk: number): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { texts: string[] }
    const idx = Math.floor(Number(body.texts[0]?.split('-')[1] ?? 0) / textsPerChunk)
    await new Promise((r) => setTimeout(r, delays[Math.min(idx, delays.length - 1)]))
    return new Response(JSON.stringify({ translations: body.texts.map((t) => `译:${t}`) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

describe('translateTexts 并发块池（评审 #50）', () => {
  it('乱序完成的块按索引回填，结果顺序与原文一致；进度只报累计数', async () => {
    const texts = Array.from({ length: 120 }, (_, i) => `s-${i}`) // 3 块：50+50+20
    // 第 0 块最慢、第 2 块最快 —— 并发下完成顺序 2,1,0
    vi.stubGlobal('fetch', stubFetchByChunk([60, 30, 1], 50))

    const progress: Array<[number, number]> = []
    const results = await translateTexts(texts, undefined, 'en2zh', undefined, (done, total) => {
      progress.push([done, total])
    })

    expect(results).toHaveLength(120)
    expect(results[0]).toBe('译:s-0')
    expect(results[59]).toBe('译:s-59')
    expect(results[100]).toBe('译:s-100') // 后完成的第 0 块没有覆盖第 2 块的落点
    expect(results[119]).toBe('译:s-119')
    // 进度单调不减且 total 恒定
    expect(progress.every(([d, t], i) => t === 120 && (i === 0 || d >= progress[i - 1]![0]))).toBe(true)
  })

  it('任一块失败快速失败：抛出该块错误，不再发出排在后面的块', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls++
      const body = JSON.parse(String(init?.body)) as { texts: string[] }
      const first = Number(body.texts[0]!.split('-')[1])
      if (first === 50) return new Response(JSON.stringify({ error: '上游限流' }), { status: 429 })
      await new Promise((r) => setTimeout(r, 1))
      return new Response(JSON.stringify({ translations: body.texts.map((t) => `译:${t}`) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const texts = Array.from({ length: 200 }, (_, i) => `s-${i}`) // 4 块
    await expect(translateTexts(texts, undefined, 'en2zh')).rejects.toThrow('上游限流')
    expect(calls).toBeLessThan(4) // 失败后未把剩余块全部发出
  })

  it('调用方 signal 已中止 → 直接抛「翻译已取消」且零请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(translateTexts(['a'], undefined, 'en2zh', ctrl.signal)).rejects.toThrow('翻译已取消')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
