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

/* ── translateSrtToBilingual 统一编排（2026-11 全仓复审 c047）：
 *   a4ced2e 收敛的两份手写编排此前零测试 —— 取消→AbortError、失败→单语降级带
 *   warning、onDegraded 漏翻接线都无护栏。 ── */

import { translateSrtToBilingual } from '../translate'

const SRT = [
  '1', '00:00:00,000 --> 00:00:02,000', 'Hello there.', '',
  '2', '00:00:02,000 --> 00:00:04,000', 'General Kenobi.', '',
].join('\n')

describe('translateSrtToBilingual（c047）', () => {
  it('成功路径：合并出双语 SRT（译文上屏为 textZh）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { texts: string[] }
      return new Response(JSON.stringify({ translations: body.texts.map((t) => `译(${t})`) }), { status: 200 })
    }))
    const out = await translateSrtToBilingual(SRT, undefined, undefined)
    expect(out.srt).toContain('Hello there.')
    expect(out.srt).toContain('译(Hello there.)')
    expect(out.warning).toBeUndefined()
  })

  it('非取消失败：降级保留单语并带 warning，不抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })))
    const out = await translateSrtToBilingual(SRT, undefined, undefined)
    expect(out.srt).toBe(SRT)
    expect(out.warning).toContain('翻译失败')
    expect(out.warning).toContain('保留单语')
  })

  it('用户取消：统一抛 DOMException AbortError 而不是降级', async () => {
    const ac = new AbortController()
    ac.abort() // 调用方先取消：translateTexts 在首个块前抛 AbortError
    await expect(translateSrtToBilingual(SRT, undefined, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('上游部分漏翻回填：onDegraded 接线产出 warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { texts: string[] }
      // 第二条漏翻（译文为空串触发原文回填）
      const translations = body.texts.map((t, i) => (i === 1 ? '' : `译(${t})`))
      return new Response(JSON.stringify({ translations, filledWithSource: 1 }), { status: 200 })
    }))
    const out = await translateSrtToBilingual(SRT, undefined, undefined)
    expect(out.warning).toContain('漏翻 1/2')
    // 漏翻句保留原文
    expect(out.srt).toContain('General Kenobi.')
  })
})
