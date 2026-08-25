/**
 * core/training/puzzle 单测：buildTiles 洗牌多重集守恒、>15 词并块、checkAnswer firstErrorIndex。
 */
import { describe, expect, it } from 'vitest'
import { buildTiles, splitTargets, checkAnswer, nextHint, puzzleScore, type Rng } from '../puzzle'
import type { SubtitleSentence } from '@/types/subtitle'

/** 确定性 rng（线性同余），保证测试可复现 */
function makeRng(seed = 42): Rng {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

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

describe('buildTiles', () => {
  it('洗牌后多重集守恒（含重复词）', () => {
    const s = sentence('the cat and the dog chased the cat')
    const tiles = buildTiles(s, makeRng(7))
    const sorted = (xs: string[]) => [...xs].sort().join('|')
    expect(tiles).toHaveLength(8)
    expect(sorted(tiles.map((t) => t.text))).toBe(sorted(['the', 'cat', 'and', 'the', 'dog', 'chased', 'the', 'cat']))
  })

  it('tile id 唯一（重复词可区分）', () => {
    const s = sentence('go go go now')
    const tiles = buildTiles(s, makeRng(3))
    expect(new Set(tiles.map((t) => t.id)).size).toBe(tiles.length)
  })

  it('确定性 rng → 结果可复现', () => {
    const s = sentence('one two three four five six')
    const a = buildTiles(s, makeRng(99)).map((t) => t.text)
    const b = buildTiles(s, makeRng(99)).map((t) => t.text)
    expect(a).toEqual(b)
  })

  it('多块时避免洗成与目标完全相同的正序开局', () => {
    const s = sentence('one two three four five six seven')
    for (const seed of [1, 2, 3, 4, 5]) {
      const tiles = buildTiles(s, makeRng(seed)).map((t) => t.text)
      expect(tiles).not.toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven'])
    }
  })

  it('单块句子：返回唯一词块', () => {
    const tiles = buildTiles(sentence('Hello'), makeRng(1))
    expect(tiles).toEqual([{ id: 0, text: 'Hello' }])
  })
})

describe('checkAnswer', () => {
  const s = sentence('Good morning my friend')

  it('全对 → correct=true，firstErrorIndex=-1', () => {
    const picked = [
      { id: 0, text: 'Good' },
      { id: 1, text: 'morning' },
      { id: 2, text: 'my' },
      { id: 3, text: 'friend' },
    ]
    expect(checkAnswer(picked, s)).toEqual({ correct: true, firstErrorIndex: -1 })
  })

  it('首位错 → firstErrorIndex=0', () => {
    const picked = [
      { id: 1, text: 'morning' },
      { id: 0, text: 'Good' },
      { id: 2, text: 'my' },
      { id: 3, text: 'friend' },
    ]
    expect(checkAnswer(picked, s)).toEqual({ correct: false, firstErrorIndex: 0 })
  })

  it('中间错 → 返回第一个错误位', () => {
    const picked = [
      { id: 0, text: 'Good' },
      { id: 2, text: 'my' },
      { id: 1, text: 'morning' },
      { id: 3, text: 'friend' },
    ]
    expect(checkAnswer(picked, s)).toEqual({ correct: false, firstErrorIndex: 1 })
  })

  it('选择数量不足 → 缺失位为错误位', () => {
    const picked = [{ id: 0, text: 'Good' }]
    expect(checkAnswer(picked, s)).toEqual({ correct: false, firstErrorIndex: 1 })
  })

  it('选择过多 → 末位错误', () => {
    const picked = [
      { id: 0, text: 'Good' },
      { id: 1, text: 'morning' },
      { id: 2, text: 'my' },
      { id: 3, text: 'friend' },
      { id: 4, text: 'extra' },
    ]
    expect(checkAnswer(picked, s)).toEqual({ correct: false, firstErrorIndex: 4 })
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
