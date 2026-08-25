/**
 * core/training/session 单测：submit/next/hint/skip/attempt 状态迁移与小结汇总（scoring）。
 */
import { describe, expect, it } from 'vitest'
import { createSession, currentSentence, submit, attempt, hint, next, skip, retryAt, makeRecordId } from '../session'
import { summarize, formatElapsed } from '../scoring'
import type { SubtitleSentence } from '@/types/subtitle'

function makeSentences(n: number): SubtitleSentence[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    startMs: i * 1000,
    endMs: (i + 1) * 1000,
    textEn: `sentence ${i}`,
    textZh: null,
    words: ['sentence', String(i)],
  }))
}

const OK = { correct: true, accuracy: 100 }

describe('createSession', () => {
  it('初始状态：active、cursor=0、注入 now', () => {
    const st = createSession('dictation', makeSentences(3), { type: 'all' }, 12345)
    expect(st.status).toBe('active')
    expect(st.cursor).toBe(0)
    expect(st.queue).toHaveLength(3)
    expect(st.startedAt).toBe(12345)
    expect(currentSentence(st)?.index).toBe(0)
  })

  it('空队列 → 直接 done', () => {
    const st = createSession('dictation', [], { type: 'all' }, 0)
    expect(st.status).toBe('done')
    expect(currentSentence(st)).toBeUndefined()
  })

  it('favorites 范围按 sentenceIndexes 过滤', () => {
    const st = createSession('puzzle', makeSentences(5), { type: 'favorites', sentenceIndexes: [1, 3] }, 0)
    expect(st.queue.map((s) => s.index)).toEqual([1, 3])
  })

  it('favorites 范围过滤后为空 → done 空会话（无匹配收藏不进入死循环）', () => {
    const st = createSession('puzzle', makeSentences(3), { type: 'favorites', sentenceIndexes: [] }, 0)
    expect(st.status).toBe('done')
    expect(st.queue).toHaveLength(0)
    expect(currentSentence(st)).toBeUndefined()
    expect(next(st)).toBe(st) // done 后空操作
    // 空会话小结：零值不报错
    expect(summarize(st.results, 0)).toMatchObject({ total: 0, correctCount: 0, accuracy: 0, weakest: [] })
  })
})

describe('submit / attempt / hint', () => {
  it('submit 收集结果并附带 hints/attempts；同句重复提交覆盖', () => {
    let st = createSession('dictation', makeSentences(2), { type: 'all' }, 0)
    st = hint(st)
    st = attempt(st)
    st = attempt(st)
    st = submit(st, OK)
    expect(st.results).toHaveLength(1)
    expect(st.results[0]).toMatchObject({ sentenceIndex: 0, correct: true, hints: 1, attempts: 2 })

    // 同句再提交 → 覆盖而非追加
    st = submit(st, { correct: false, accuracy: 50 })
    expect(st.results).toHaveLength(1)
    expect(st.results[0]).toMatchObject({ correct: false, accuracy: 50 })
  })

  it('未 attempt 时 attempts 至少为 1', () => {
    const st = submit(createSession('dictation', makeSentences(1), { type: 'all' }, 0), OK)
    expect(st.results[0]!.attempts).toBe(1)
  })

  it('done 状态下 submit/hint/attempt 均为空操作', () => {
    const done = createSession('dictation', [], { type: 'all' }, 0)
    expect(submit(done, OK)).toBe(done)
    expect(hint(done)).toBe(done)
    expect(attempt(done)).toBe(done)
  })
})

describe('next / skip / retryAt', () => {
  it('next 推进游标并重置 hint/attempt 计数', () => {
    let st = createSession('dictation', makeSentences(2), { type: 'all' }, 0)
    st = hint(hint(st))
    st = attempt(st)
    st = submit(st, OK)
    st = next(st)
    expect(st.cursor).toBe(1)
    expect(st.hintCount).toBe(0)
    expect(st.attemptCount).toBe(0)
    expect(st.status).toBe('active')
  })

  it('next 越过队尾 → done', () => {
    let st = createSession('dictation', makeSentences(1), { type: 'all' }, 0)
    st = next(st)
    expect(st.status).toBe('done')
    expect(currentSentence(st)).toBeUndefined()
    expect(next(st)).toBe(st) // done 后空操作
  })

  it('skip 记一条 0 分 skipped 结果并推进', () => {
    let st = createSession('dictation', makeSentences(2), { type: 'all' }, 0)
    st = skip(st)
    expect(st.cursor).toBe(1)
    expect(st.results).toHaveLength(1)
    expect(st.results[0]).toMatchObject({ sentenceIndex: 0, correct: false, accuracy: 0, skipped: true })
  })

  it('retryAt 跳回指定句并恢复 active', () => {
    let st = createSession('dictation', makeSentences(3), { type: 'all' }, 0)
    st = next(next(st))
    st = next(st)
    expect(st.status).toBe('done')
    st = retryAt(st, 1)
    expect(st.status).toBe('active')
    expect(currentSentence(st)?.index).toBe(1)
    expect(retryAt(st, 99)).toBe(st) // 不存在的句 → 空操作
  })
})

describe('makeRecordId', () => {
  it('带时间戳前缀且两次不同', () => {
    const a = makeRecordId(1000)
    const b = makeRecordId(1000)
    expect(a).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
    expect(a).not.toBe(b)
  })
})

describe('scoring.summarize / formatElapsed', () => {
  it('汇总：总数、全对数、句均正确率、最弱句 TOP3（全对不入榜）', () => {
    const results = [
      { sentenceIndex: 0, correct: true, accuracy: 100 },
      { sentenceIndex: 1, correct: false, accuracy: 20 },
      { sentenceIndex: 2, correct: false, accuracy: 60 },
      { sentenceIndex: 3, correct: false, accuracy: 10, plays: 4 },
      { sentenceIndex: 4, correct: false, accuracy: 40, plays: 1 },
    ]
    const sum = summarize(results, 65000)
    expect(sum.total).toBe(5)
    expect(sum.correctCount).toBe(1)
    expect(sum.accuracy).toBe(Math.round((100 + 20 + 60 + 10 + 40) / 5)) // 46
    expect(sum.durationMs).toBe(65000)
    expect(sum.weakest).toEqual([3, 1, 4]) // 正确率升序前 3
    expect(sum.totalPlays).toBe(5)
  })

  it('空结果 → 零值', () => {
    expect(summarize([], 0)).toEqual({ total: 0, correctCount: 0, accuracy: 0, durationMs: 0, weakest: [], totalPlays: 0 })
  })

  it('formatElapsed：mm:ss 补零', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65000)).toBe('01:05')
    expect(formatElapsed(3594000)).toBe('59:54')
    expect(formatElapsed(-1000)).toBe('00:00')
  })
})
