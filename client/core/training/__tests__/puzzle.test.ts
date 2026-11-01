/**
 * core/training/puzzle 单测：splitTargets 并块、nextHint/puzzleScore（tiles 拼句模式的 buildTiles/checkAnswer 已随 grid 模式取代而删除）。
 */
import { describe, expect, it } from 'vitest'
import { splitTargets, nextHint, puzzleScore } from '../puzzle'
import type { SubtitleSentence } from '@/types/subtitle'

function sentence(textEn: string, words?: string[]): SubtitleSentence {
  return {
    index: 0,
    startMs: 0,
    endMs: 1000,
    textEn,
    textZh: null,
    words: words ?? textEn.replace(/[.,!?;:]/g, '').split(/\s+/).filter(Boolean),
  }
}

describe('splitTargets', () => {
  it('≤15 词：按 words 逐词', () => {
    const s = sentence('Good morning my dear friend.')
    expect(splitTargets(s)).toEqual(['Good', 'morning', 'my', 'dear', 'friend'])
  })

  it('words 为空时退化用 textEn 分词', () => {
    const s: SubtitleSentence = { index: 0, startMs: 0, endMs: 1, textEn: 'a b c', textZh: null, words: [] }
    expect(splitTargets(s)).toEqual(['a', 'b', 'c'])
  })

  it('>15 词且有标点：按标点并块', () => {
    const text = 'When you wake up in the morning, take a deep breath, and smile at the new day ahead.'
    const s = sentence(text)
    const chunks = splitTargets(s)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThan(16)
    // 并块后拼回应等于原句（空格归一比较）
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.trim())
  })

  it('>15 词且无标点：每 3 词一块', () => {
    const text = Array.from({ length: 16 }, (_, i) => `w${i}`).join(' ')
    const s = sentence(text)
    const chunks = splitTargets(s)
    expect(chunks).toHaveLength(Math.ceil(16 / 3)) // 6 块
    expect(chunks[0]).toBe('w0 w1 w2')
    expect(chunks.join(' ')).toBe(text)
  })
})

describe('nextHint / puzzleScore', () => {
  const s = sentence('a b c')

  it('nextHint 返回下一个应选词块，越界返回 null', () => {
    expect(nextHint(0, s)).toBe('a')
    expect(nextHint(2, s)).toBe('c')
    expect(nextHint(3, s)).toBeNull()
  })

  it('puzzleScore：全对句 +10，提示 -2，下限 0', () => {
    expect(puzzleScore(3, 0)).toBe(30)
    expect(puzzleScore(1, 2)).toBe(6)
    expect(puzzleScore(0, 5)).toBe(0)
    expect(puzzleScore(1, 10)).toBe(0)
  })
})
