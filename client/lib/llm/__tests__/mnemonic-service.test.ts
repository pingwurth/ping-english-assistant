/**
 * 助记卡流式 JSON 字段提取器回归（2026-11 全仓复审 c052）：
 * 括号闭合分支原先把外层对象的 '}' 切进值里，JSON.parse 恒抛 → 该分支永不产出
 * 字段（流式渲染在「对象最后一个字段」上永远缺席）。
 */
import { describe, expect, it } from 'vitest'
import { extractCompletedFields } from '../mnemonic-service'

describe('extractCompletedFields', () => {
  it('字符串值在对象收尾处闭合：值不含外层 }（c052 核心）', () => {
    const r = extractCompletedFields('{"title":"联想记忆","meaning":"apple"}', new Set())
    // 旧实现：meaning 分支 slice 带 '}' → JSON.parse('"apple"}') 抛错被吞 → 缺失
    expect(r).toContainEqual({ field: 'title', value: '联想记忆' })
    expect(r).toContainEqual({ field: 'meaning', value: 'apple' })
  })

  it('对象值同样在收尾处闭合且保留自身括号', () => {
    const r = extractCompletedFields('{"card":{"front":"a","back":"b"}}', new Set())
    expect(r).toContainEqual({ field: 'card', value: { front: 'a', back: 'b' } })
  })

  it('逗号分支：简单值正常产出', () => {
    const r = extractCompletedFields('{"count": 3, "note": null}', new Set())
    expect(r).toContainEqual({ field: 'count', value: 3 })
    expect(r).toContainEqual({ field: 'note', value: null })
  })

  it('yielded 集合中的字段不重复产出', () => {
    const r = extractCompletedFields('{"a":1,"a":2}', new Set(['a']))
    expect(r).toEqual([])
  })

  it('未闭合的部分 JSON 不产出该字段', () => {
    const r = extractCompletedFields('{"title":"联想', new Set())
    expect(r).toEqual([])
  })
})
