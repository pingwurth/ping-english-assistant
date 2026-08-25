/**
 * core/training/dictation-diff 单测：normalize 归一化 + 四类标记（correct/wrong/missing/extra）。
 */
import { describe, expect, it } from 'vitest'
import { normalize, toWords, diffWords, sentenceAccuracy } from '../dictation-diff'

describe('normalize', () => {
  it('小写、去标点、压缩空格', () => {
    expect(normalize('  Hello,   World! ')).toBe('hello world')
    expect(normalize('I’m fine.')).toBe("i'm fine") // 弯引号 ’ → 直引号
    expect(normalize('a-b_c')).toBe('a b c') // 非字母数字均视为分隔
    expect(normalize('')).toBe('')
  })

  it('toWords：空串 → 空数组', () => {
    expect(toWords('')).toEqual([])
    expect(toWords('  !!! ')).toEqual([])
    expect(toWords('One Two')).toEqual(['one', 'two'])
  })
})

describe('diffWords 四类标记', () => {
  it('全对 → 全 correct', () => {
    const tokens = diffWords('Good morning.', 'good morning')
    expect(tokens).toEqual([
      { type: 'correct', text: 'good' },
      { type: 'correct', text: 'morning' },
    ])
  })

  it('单个错词 → wrong（含用户实际输入）', () => {
    const tokens = diffWords('good evening', 'good morning')
    expect(tokens).toEqual([
      { type: 'correct', text: 'good' },
      { type: 'wrong', text: 'morning', input: 'evening' },
    ])
  })

  it('漏词 → missing', () => {
    const tokens = diffWords('good', 'good morning sir')
    expect(tokens).toEqual([
      { type: 'correct', text: 'good' },
      { type: 'missing', text: 'morning' },
      { type: 'missing', text: 'sir' },
    ])
  })

  it('多词 → extra', () => {
    const tokens = diffWords('good morning sir extra', 'good morning')
    expect(tokens).toEqual([
      { type: 'correct', text: 'good' },
      { type: 'correct', text: 'morning' },
      { type: 'extra', text: 'sir' },
      { type: 'extra', text: 'extra' },
    ])
  })

  it('错词+漏词混合：未对齐块内 missing/extra 按序配对为 wrong', () => {
    const tokens = diffWords('the cat sat', 'a cat sits down')
    // LCS 对齐 'cat'；the→a 配对为 wrong，sits→? 与 down 未配对
    const types = tokens.map((t) => t.type)
    expect(types).toContain('wrong')
    expect(types).toContain('correct')
    // 目标侧每个词都以 correct/wrong/missing 形式出现一次
    const targetSide = tokens.filter((t) => t.type !== 'extra').map((t) => t.text)
    expect(targetSide).toEqual(['a', 'cat', 'sits', 'down'])
  })

  it('空输入对非空目标 → 全 missing', () => {
    const tokens = diffWords('', 'good morning')
    expect(tokens).toEqual([
      { type: 'missing', text: 'good' },
      { type: 'missing', text: 'morning' },
    ])
  })

  it('双方为空 → 空数组', () => {
    expect(diffWords('', '')).toEqual([])
  })
})

describe('sentenceAccuracy', () => {
  it('目标为空：空输入 100，非空输入 0', () => {
    expect(sentenceAccuracy([], 0)).toBe(100)
    expect(sentenceAccuracy([{ type: 'extra', text: 'x' }], 0)).toBe(0)
  })

  it('正确率 = correct / 目标词数（四舍五入）', () => {
    const tokens = diffWords('good evening', 'good morning') // 1/2
    expect(sentenceAccuracy(tokens, 2)).toBe(50)
    const tokens3 = diffWords('a b', 'a b c') // 2/3 → 67
    expect(sentenceAccuracy(tokens3, 3)).toBe(67)
  })
})
