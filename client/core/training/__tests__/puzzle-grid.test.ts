/**
 * 九宫格滑窗算法单测：initGridState / selectGridWord / getGridHint / collectDistractorWords。
 */
import { describe, expect, it } from 'vitest'
import {
  collectDistractorWords,
  getGridHint,
  GRID_SIZE,
  initGridState,
  selectGridWord,
} from '../puzzle'
import type { SubtitleSentence } from '@/types/subtitle'

function makeSentence(words: string[], index = 0): SubtitleSentence {
  return {
    index,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    textEn: words.join(' '),
    textZh: null,
    words,
  }
}

/** 确定性 rng：返回固定序列（便于断言洗牌结果） */
function deterministicRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('initGridState', () => {
  it('目标句 ≥9 词时，grid 有 GRID_SIZE 格，答案在其中', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`)
    const sentence = makeSentence(words)
    const state = initGridState(sentence)

    expect(state.grid).toHaveLength(GRID_SIZE)
    expect(state.targets).toEqual(words)
    expect(state.cursor).toBe(0)
    expect(state.done).toBe(false)
    // 答案（targets[0]）必须在 grid 中
    expect(state.grid.some((c) => c.text === 'w0')).toBe(true)
    expect(state.answerIndex).toBeGreaterThanOrEqual(0)
    expect(state.grid[state.answerIndex]!.text).toBe('w0')
  })

  it('目标句 <9 词时，用干扰词补齐到 GRID_SIZE', () => {
    const sentence = makeSentence(['hello', 'world'])
    const distractors = ['foo', 'bar', 'baz', 'qux', 'quux', 'corge', 'grault']
    const state = initGridState(sentence, distractors)

    expect(state.grid).toHaveLength(GRID_SIZE)
    // grid 中包含目标词
    const gridTexts = state.grid.map((c) => c.text)
    expect(gridTexts).toContain('hello')
    expect(gridTexts).toContain('world')
  })

  it('目标句 <9 词且干扰词不足时，grid 按实际数量', () => {
    const sentence = makeSentence(['a', 'b', 'c'])
    const state = initGridState(sentence, ['d'])

    expect(state.grid).toHaveLength(4) // 3 目标 + 1 干扰
    expect(state.done).toBe(false)
  })

  it('空句子 → done', () => {
    const sentence: SubtitleSentence = {
      index: 0, startMs: 0, endMs: 1000, textEn: '', textZh: null, words: [],
    }
    const state = initGridState(sentence)
    expect(state.done).toBe(true)
    expect(state.grid).toHaveLength(0)
  })

  it('pool 包含超出 grid 的目标词', () => {
    const words = Array.from({ length: 15 }, (_, i) => `w${i}`)
    const sentence = makeSentence(words)
    const state = initGridState(sentence)

    expect(state.pool).toHaveLength(15 - GRID_SIZE)
    expect(state.pool[0]).toBe('w9')
  })

  it('干扰词不会与目标词重复（不区分大小写）', () => {
    const sentence = makeSentence(['Hello', 'World'])
    const distractors = ['hello', 'world', 'foo', 'bar', 'baz', 'qux', 'quux']
    const state = initGridState(sentence, distractors)

    const gridTexts = state.grid.map((c) => c.text.toLowerCase())
    // hello 和 world 只各出现一次（目标词），干扰词去重
    const helloCount = gridTexts.filter((t) => t === 'hello').length
    const worldCount = gridTexts.filter((t) => t === 'world').length
    expect(helloCount).toBe(1)
    expect(worldCount).toBe(1)
  })
})

describe('selectGridWord', () => {
  it('选对 → cursor 推进，grid 补词，答案在新 grid 中', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`)
    const sentence = makeSentence(words)
    const state = initGridState(sentence, [], deterministicRng([0.5, 0.3, 0.1, 0.8, 0.2, 0.6, 0.4, 0.7, 0.9, 0.15, 0.35, 0.55]))

    const result = selectGridWord(state, state.answerIndex)
    expect(result.correct).toBe(true)
    expect(result.state.cursor).toBe(1)
    expect(result.state.done).toBe(false)
    // 新答案（targets[1]）必须在新 grid 中
    expect(result.state.grid.some((c) => c.text === 'w1')).toBe(true)
    expect(result.state.grid[result.state.answerIndex]!.text).toBe('w1')
  })

  it('选错 → state 不变，correct=false', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`)
    const sentence = makeSentence(words)
    const state = initGridState(sentence)

    const wrongIndex = state.answerIndex === 0 ? 1 : 0
    const result = selectGridWord(state, wrongIndex)
    expect(result.correct).toBe(false)
    expect(result.state).toBe(state) // 同一引用，未修改
  })

  it('选完最后一个词 → done=true，grid 清空', () => {
    // 2 个词的句子，用干扰词补齐
    const sentence = makeSentence(['a', 'b'])
    const distractors = ['c', 'd', 'e', 'f', 'g', 'h', 'i']
    const state = initGridState(sentence, distractors)

    // 选对第一个
    const r1 = selectGridWord(state, state.answerIndex)
    expect(r1.correct).toBe(true)
    expect(r1.state.cursor).toBe(1)
    expect(r1.state.done).toBe(false)

    // 选对第二个
    const r2 = selectGridWord(r1.state, r1.state.answerIndex)
    expect(r2.correct).toBe(true)
    expect(r2.state.cursor).toBe(2)
    expect(r2.state.done).toBe(true)
    expect(r2.state.grid).toHaveLength(0)
  })

  it('多次选对后 pool 词持续补入 grid', () => {
    const words = Array.from({ length: 15 }, (_, i) => `w${i}`)
    const sentence = makeSentence(words)
    let state = initGridState(sentence)

    // 连续选对 5 次
    for (let i = 0; i < 5; i++) {
      const result = selectGridWord(state, state.answerIndex)
      expect(result.correct).toBe(true)
      state = result.state
    }
    expect(state.cursor).toBe(5)
    // grid 应仍有 GRID_SIZE 格（pool 足够）
    expect(state.grid).toHaveLength(GRID_SIZE)
    // 答案在 grid 中
    expect(state.grid.some((c) => c.text === state.targets[state.cursor])).toBe(true)
  })

  it('超出 grid 范围的 index → correct=false', () => {
    const sentence = makeSentence(Array.from({ length: 12 }, (_, i) => `w${i}`))
    const state = initGridState(sentence)

    expect(selectGridWord(state, -1).correct).toBe(false)
    expect(selectGridWord(state, GRID_SIZE).correct).toBe(false)
  })

  it('同句重复词：点任意一个同词格都算对（判定按词匹配，不是 index）', () => {
    const sentence = makeSentence(['that', 'is', 'that', 'ok'])
    const state = initGridState(sentence, ['a', 'b', 'c', 'd', 'e'])

    const thatIndexes = state.grid.map((c, i) => ({ text: c.text, i })).filter((c) => c.text === 'that').map((c) => c.i)
    expect(thatIndexes).toHaveLength(2)

    // 两个 "that" 格各自判定都应正确，且都推进到 cursor=1
    for (const i of thatIndexes) {
      const r = selectGridWord(state, i)
      expect(r.correct).toBe(true)
      expect(r.state.cursor).toBe(1)
    }
  })

  it('同句同词大小写不同（You … you）：区分大小写，各只有一个正确格', () => {
    // 种子材料原句：You should answer the questions as you listen.
    const words = ['You', 'should', 'answer', 'the', 'questions', 'as', 'you', 'listen.']
    const sentence = makeSentence(words)
    const state = initGridState(sentence, ['do', 'not', 'here', 'now', 'ok'])

    const upperYou = state.grid.findIndex((c) => c.text === 'You')
    const lowerYou = state.grid.findIndex((c) => c.text === 'you')
    expect(upperYou).toBeGreaterThanOrEqual(0)
    expect(lowerYou).toBeGreaterThanOrEqual(0)

    // cursor=0 目标为 'You'：点小写 'you' 判错，state 不变
    const wrong = selectGridWord(state, lowerYou)
    expect(wrong.correct).toBe(false)
    expect(wrong.state).toBe(state)

    // 点大写 'You' 才判对
    const right = selectGridWord(state, upperYou)
    expect(right.correct).toBe(true)
    expect(right.state.cursor).toBe(1)

    // 整句按精确文本仍可依次选完（游标 6 的目标 'you' 对应剩下的小写格）
    let s = right.state
    while (!s.done) {
      const target = s.targets[s.cursor]!
      const idx = s.grid.findIndex((c) => c.text === target)
      expect(idx).toBeGreaterThanOrEqual(0)
      const r = selectGridWord(s, idx)
      expect(r.correct).toBe(true)
      s = r.state
    }
    expect(s.cursor).toBe(words.length)
  })

  it('同句重复词：cursor 推进后下一个目标词仍在 grid 中', () => {
    // "it is it" —— 点掉第一个 it 后，下一个目标仍是 it
    const sentence = makeSentence(['it', 'is', 'it'])
    const state = initGridState(sentence, ['a', 'b', 'c', 'd', 'e', 'f'])

    const first = selectGridWord(state, state.answerIndex)
    expect(first.correct).toBe(true)
    expect(first.state.targets[first.state.cursor]).toBe('is')

    const isIndex = first.state.grid.findIndex((c) => c.text === 'is')
    const second = selectGridWord(first.state, isIndex)
    expect(second.correct).toBe(true)
    expect(second.state.targets[second.state.cursor]).toBe('it')
    expect(second.state.answerIndex).toBeGreaterThanOrEqual(0)
    expect(second.state.grid[second.state.answerIndex]!.text).toBe('it')

    // 剩下的那个 it 格可继续选对
    const last = selectGridWord(second.state, second.state.answerIndex)
    expect(last.correct).toBe(true)
    expect(last.state.done).toBe(true)
  })

  it('词文本不等于当前目标词 → 仍判错', () => {
    // grid 里有 "is"（第 2 个目标词），但 cursor 在第 1 个目标词 "it" 上
    const sentence = makeSentence(['it', 'is', 'ok'])
    const state = initGridState(sentence, ['a', 'b', 'c', 'd', 'e', 'f'])

    const isIndex = state.grid.findIndex((c) => c.text === 'is')
    const r = selectGridWord(state, isIndex)
    expect(r.correct).toBe(false)
    expect(r.state).toBe(state)

    // 干扰词同样判错
    const distractorIndex = state.grid.findIndex((c) => c.text === 'a')
    expect(selectGridWord(state, distractorIndex).correct).toBe(false)
  })

  it('已完成状态 → 任何选择都返回 correct=false', () => {
    const sentence = makeSentence(['a'])
    const distractors = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const state = initGridState(sentence, distractors)

    const r = selectGridWord(state, state.answerIndex)
    expect(r.state.done).toBe(true)
    // 再选
    expect(selectGridWord(r.state, 0).correct).toBe(false)
  })
})

describe('answer position distribution', () => {
  it('答案位置在多次初始化中均匀分布（无固定规律）', () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`)
    const sentence = makeSentence(words)
    const counts = new Array(GRID_SIZE).fill(0)
    const trials = 900

    for (let i = 0; i < trials; i++) {
      const state = initGridState(sentence)
      counts[state.answerIndex]++
    }

    // 每个位置应出现约 trials/GRID_SIZE = 100 次
    // 允许 ±50% 偏差（宽松断言，避免 flaky）
    const expected = trials / GRID_SIZE
    for (let i = 0; i < GRID_SIZE; i++) {
      expect(counts[i]).toBeGreaterThan(expected * 0.5)
      expect(counts[i]).toBeLessThan(expected * 1.5)
    }
  })
})

describe('collectDistractorWords', () => {
  it('收集其他句子的词，排除当前句', () => {
    const sentences = [
      makeSentence(['hello', 'world'], 0),
      makeSentence(['foo', 'bar'], 1),
      makeSentence(['baz', 'qux'], 2),
    ]
    const words = collectDistractorWords(sentences, 0, new Set(['hello', 'world']))
    expect(words).toEqual(['foo', 'bar', 'baz', 'qux'])
  })

  it('去重（不区分大小写）', () => {
    const sentences = [
      makeSentence(['Hello', 'world'], 0),
      makeSentence(['hello', 'foo'], 1),
      makeSentence(['WORLD', 'bar'], 2),
    ]
    const words = collectDistractorWords(sentences, 0, new Set())
    // 'hello' 和 'foo' 来自句1，'bar' 来自句2（'WORLD' 与 'world' 冲突被排除）
    expect(words).toContain('hello')
    expect(words).toContain('foo')
    expect(words).toContain('bar')
    // 重复词不包含
    const lowerWords = words.map((w) => w.toLowerCase())
    expect(lowerWords.filter((w) => w === 'hello')).toHaveLength(1)
  })

  it('只有一句时返回空数组', () => {
    const sentences = [makeSentence(['only', 'one'], 0)]
    expect(collectDistractorWords(sentences, 0, new Set())).toEqual([])
  })
})

describe('getGridHint', () => {
  it('返回答案在 grid 中的 index', () => {
    const sentence = makeSentence(Array.from({ length: 12 }, (_, i) => `w${i}`))
    const state = initGridState(sentence)
    expect(getGridHint(state)).toBe(state.answerIndex)
    expect(state.grid[getGridHint(state)]!.text).toBe(state.targets[0])
  })
})
