import { describe, expect, it } from 'vitest'
import { splitTtsSentences, buildTtsTimeline, TTS_SENTENCE_GAP_MS } from '../timeline'

describe('splitTtsSentences', () => {
  it('基本分句：句末标点归属前句，空白/纯标点片段丢弃', () => {
    expect(splitTtsSentences('Hello world. How are you? Fine; thanks.')).toEqual([
      'Hello world.',
      'How are you?',
      'Fine;',
      'thanks.',
    ])
  })

  it('换行也是句界', () => {
    expect(splitTtsSentences('first line\nsecond line')).toEqual(['first line', 'second line'])
  })

  it('数字语境不切分：时间/金额/小数中的 . : ; 不是句界（2026-11 全仓复审）', () => {
    expect(splitTtsSentences('The meeting is at 10:30, pay $3.50. See you!')).toEqual([
      'The meeting is at 10:30, pay $3.50.',
      'See you!',
    ])
    // 版本号、比例：数字之间的 . 与 : 全部保留；句法位置的分号照常切
    expect(splitTtsSentences('Version 3.5.1 shipped; ratio 1:2 ok.')).toEqual([
      'Version 3.5.1 shipped;',
      'ratio 1:2 ok.',
    ])
    expect(splitTtsSentences('10:30')).toEqual(['10:30'])
  })
})

describe('buildTtsTimeline', () => {
  it('逐句累计且句间留 120ms 静音；总时长不含末尾静音', () => {
    const { timings, durationMs } = buildTtsTimeline(['aaaa', 'bbbbbbbb'], 1)
    expect(timings).toHaveLength(2)
    expect(timings[1]!.startMs).toBe(timings[0]!.endMs + TTS_SENTENCE_GAP_MS)
    expect(durationMs).toBe(timings[1]!.endMs)
  })
})
