/**
 * 训练会话状态机 —— 真源：docs/系统架构设计.md §2.5 session.ts
 *
 * createSession(mode, sentences, scope) 起一个纯函数状态机：
 * 题目队列、当前句推进、submit/next/hint/skip 事件迁移、每句结果收集。
 * 与 UI 框架无关（无 React/无 DOM），所有事件迁移返回新状态对象。
 */

import type { SubtitleSentence } from '@/types/subtitle'
import type { TrainingMode } from '@/types/training'
import type { SentenceResult } from './scoring'

/** 训练范围：全文 / 收藏句（原型阶段收藏范围降级，见 P3 说明） */
export type TrainingScope = { type: 'all' } | { type: 'favorites'; sentenceIndexes: number[] }

export type SessionStatus = 'active' | 'done'

export interface SessionState {
  mode: TrainingMode
  /** 题目队列（按范围解析后的句子，保持原时间轴顺序） */
  queue: SubtitleSentence[]
  /** 当前题目游标 */
  cursor: number
  status: SessionStatus
  /** 已收集结果（按提交顺序） */
  results: SentenceResult[]
  /** 当前句已用提示次数（submit 时并入结果） */
  hintCount: number
  /** 当前句提交次数 */
  attemptCount: number
  startedAt: number
}

/** 依据范围解析题目队列 */
function resolveQueue(sentences: SubtitleSentence[], scope: TrainingScope): SubtitleSentence[] {
  if (scope.type === 'all') return [...sentences]
  const set = new Set(scope.sentenceIndexes)
  return sentences.filter((s) => set.has(s.index))
}

/** 创建训练会话（纯函数；now 注入便于测试） */
export function createSession(
  mode: TrainingMode,
  sentences: SubtitleSentence[],
  scope: TrainingScope = { type: 'all' },
  now: number = Date.now(),
): SessionState {
  const queue = resolveQueue(sentences, scope)
  return {
    mode,
    queue,
    cursor: 0,
    status: queue.length ? 'active' : 'done',
    results: [],
    hintCount: 0,
    attemptCount: 0,
    startedAt: now,
  }
}

/** 当前句（队列为空或已结束时返回 undefined） */
export function currentSentence(state: SessionState): SubtitleSentence | undefined {
  return state.status === 'active' ? state.queue[state.cursor] : undefined
}

/** 提交结果：收集当前句结果（游标不动，由 next 推进）；attempts 取 attempt() 累计值 */
export function submit(state: SessionState, result: Omit<SentenceResult, 'sentenceIndex' | 'hints' | 'attempts'>): SessionState {
  const sentence = currentSentence(state)
  if (!sentence) return state
  const entry: SentenceResult = { ...result, sentenceIndex: sentence.index, hints: state.hintCount, attempts: Math.max(1, state.attemptCount) }
  // 同一句重试提交：覆盖上一条同句结果
  const results = state.results.filter((r) => r.sentenceIndex !== sentence.index)
  results.push(entry)
  return { ...state, results }
}

/** 提交计数事件：每次点击提交先计一次（无论对错，驱动"每句最多 N 次提交"上限） */
export function attempt(state: SessionState): SessionState {
  if (state.status !== 'active') return state
  return { ...state, attemptCount: state.attemptCount + 1 }
}

/** 使用一次提示（九宫格：每句上限由 UI 层控制） */
export function hint(state: SessionState): SessionState {
  if (state.status !== 'active') return state
  return { ...state, hintCount: state.hintCount + 1 }
}

/** 下一句：推进游标；超出队尾 → done */
export function next(state: SessionState): SessionState {
  if (state.status !== 'active') return state
  const cursor = state.cursor + 1
  if (cursor >= state.queue.length) return { ...state, cursor: state.queue.length, status: 'done' }
  return { ...state, cursor, hintCount: 0, attemptCount: 0 }
}

/** 跳过当前句：记一条 0 分结果并推进 */
export function skip(state: SessionState): SessionState {
  const sentence = currentSentence(state)
  if (!sentence) return state
  const skipped = submit(state, { correct: false, accuracy: 0, skipped: true })
  return next(skipped)
}

/** 重练指定句（小结"最弱句"点回）：游标跳回该句在队列中的位置 */
export function retryAt(state: SessionState, sentenceIndex: number): SessionState {
  const pos = state.queue.findIndex((s) => s.index === sentenceIndex)
  if (pos < 0) return state
  return { ...state, cursor: pos, status: 'active', hintCount: 0, attemptCount: 0 }
}

/** 训练记录 id（零依赖：时间戳 36 进制 + 随机段；node 可用） */
export function makeRecordId(now: number = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
