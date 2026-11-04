/**
 * DashScope ASR 响应形态回归（2026-11 全仓复审 c010/c049）：
 * 上轮评审遗留的「待实证」项 —— 三形态文本回退链、NaN begin_time 守卫、标点拼接、
 * 嵌套形态的词级时间戳（此前 words 只读顶层，嵌套形态静默丢词级时间轴）。
 */
import { describe, expect, it } from 'vitest'
import { parseDashScopeAsrResponse } from '../dashscope-asr'

describe('parseDashScopeAsrResponse', () => {
  it('原生顶层形态：sentence.text + 词级时间戳 + 标点拼接', () => {
    const r = parseDashScopeAsrResponse({
      sentence: {
        text: 'Hello world.',
        begin_time: 0,
        end_time: 900,
        words: [
          { text: 'Hello', begin_time: 0, end_time: 400 },
          { text: 'world', begin_time: 420, end_time: 850, punctuation: '.' },
        ],
      },
    })
    expect(r.text).toBe('Hello world.')
    expect(r.segments.length).toBeGreaterThan(0)
    // 标点拼进词条（w.text + w.punctuation）
    const words = r.segments.flatMap((s) => s.text.split(' '))
    expect(words).toContain('world.')
  })

  it('兼容层形态：output.text，无时间戳 → 纯文本', () => {
    const r = parseDashScopeAsrResponse({ output: { text: 'compat shape' } })
    expect(r.text).toBe('compat shape')
    expect(r.segments).toEqual([])
  })

  it('嵌套形态：output.output.sentence 的文本与词级时间戳都被采用（c010 核心）', () => {
    // 词时间戳（100–500ms）刻意与句级时间戳（100–800ms）不同：若 words 被静默丢弃，
    // 会走句子级回退得到 endMs=800 —— 断言 endMs=500 才证明词级时间轴真的被采用了
    const r = parseDashScopeAsrResponse({
      output: {
        output: {
          sentence: {
            text: 'nested shape',
            begin_time: 100,
            end_time: 800,
            words: [
              { text: 'nested', begin_time: 100, end_time: 300 },
              { text: 'shape', begin_time: 320, end_time: 500 },
            ],
          },
        },
      },
    })
    expect(r.text).toBe('nested shape')
    expect(r.segments.length).toBe(1)
    expect(r.segments[0]!.startMs).toBe(100)
    expect(r.segments[0]!.endMs).toBe(500) // 词级，而非句子级的 800
    expect(r.segments[0]!.text).toContain('nested')
    expect(r.segments[0]!.text).toContain('shape')
  })

  it('词缺 begin_time/end_time → NaN 守卫回退 0，不污染时间轴', () => {
    const r = parseDashScopeAsrResponse({
      sentence: {
        text: 'no ts',
        words: [{ text: 'no' }, { text: 'ts', begin_time: 100 }],
      },
    })
    expect(r.text).toBe('no ts')
    for (const seg of r.segments) {
      expect(Number.isNaN(seg.startMs)).toBe(false)
      expect(Number.isNaN(seg.endMs)).toBe(false)
    }
  })

  it('无词级时间戳但有句子级时间戳 → 整句单 segment', () => {
    const r = parseDashScopeAsrResponse({
      sentence: { text: 'sentence ts', begin_time: 120, end_time: 3400 },
    })
    expect(r.segments).toEqual([{ startMs: 120, endMs: 3400, text: 'sentence ts' }])
  })

  it('空文本（三形态全缺）→ 空结果不抛错', () => {
    expect(parseDashScopeAsrResponse({})).toEqual({ text: '', segments: [] })
    expect(parseDashScopeAsrResponse(null)).toEqual({ text: '', segments: [] })
    expect(parseDashScopeAsrResponse({ sentence: { words: [{ text: 'x', begin_time: 0, end_time: 1 }] } })).toEqual({ text: '', segments: [] })
  })
})
