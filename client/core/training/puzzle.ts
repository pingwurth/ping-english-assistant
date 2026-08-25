/**
 * 九宫格拼句算法 —— 真源：docs/系统架构设计.md §2.5 puzzle.ts
 *
 * 纯 TS 零依赖：rng 注入（可测）、词数 >15 按标点并块、checkAnswer 返回 firstErrorIndex。
 */

import type { SubtitleSentence } from '@/types/subtitle'

/** 可注入随机源（测试时传确定性 rng） */
export type Rng = () => number

/** 词块（id 用于 React key 与重复词区分） */
export interface PuzzleTile {
  id: number
  text: string
}

export interface PuzzleCheckResult {
  correct: boolean
  /** 首个错误位 index；全对为 -1 */
  firstErrorIndex: number
}

/** 并块触发阈值：词数 >15 时按标点合并短语块（原型设计 §4.5） */
const CHUNK_THRESHOLD = 15
const CHUNK_PUNCT = /[.,;:!?…](["')\]]*)$/

/**
 * 目标序列：正常按 words 逐词；词数 >15 时按标点并块（逗号/句号等切分短语），
 * 仍只有 1 块时退化为每 3 词一块，保证单屏可操作。
 */
export function splitTargets(sentence: SubtitleSentence): string[] {
  const tokens = sentence.textEn.trim().split(/\s+/).filter(Boolean)
  if (tokens.length <= CHUNK_THRESHOLD) return sentence.words.length ? [...sentence.words] : tokens

  const chunks: string[] = []
  let buffer: string[] = []
  for (const token of tokens) {
    buffer.push(token)
    if (CHUNK_PUNCT.test(token)) {
      chunks.push(buffer.join(' '))
      buffer = []
    }
  }
  if (buffer.length) chunks.push(buffer.join(' '))
  if (chunks.length > 1) return chunks

  // 无标点可切 → 每 3 词一块
  const grouped: string[] = []
  for (let i = 0; i < tokens.length; i += 3) grouped.push(tokens.slice(i, i + 3).join(' '))
  return grouped
}

/** Fisher-Yates 洗牌（rng 注入；结果恰与正序相同时再洗一次，避免"无需拼"的开局） */
function shuffle<T>(list: T[], rng: Rng): T[] {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

/** 生成乱序词块：拆词（或并块）+ 洗牌 */
export function buildTiles(sentence: SubtitleSentence, rng: Rng = Math.random): PuzzleTile[] {
  const targets = splitTargets(sentence)
  let shuffled = shuffle(targets, rng)
  if (targets.length > 1 && shuffled.every((t, i) => t === targets[i])) shuffled = shuffle(shuffled, rng)
  return shuffled.map((text, i) => ({ id: i, text }))
}

/** 判定：逐位对比 picked 与目标序列，返回首个错误位（全对 -1） */
export function checkAnswer(picked: PuzzleTile[], sentence: SubtitleSentence): PuzzleCheckResult {
  const targets = splitTargets(sentence)
  const len = Math.max(picked.length, targets.length)
  for (let i = 0; i < len; i++) {
    const p = picked[i]?.text ?? ''
    const t = targets[i] ?? ''
    if (p !== t) return { correct: false, firstErrorIndex: i }
  }
  return { correct: true, firstErrorIndex: -1 }
}

/** 提示：返回下一个应选词块（targets[hintCursor]），越界返回 null */
export function nextHint(pickedCount: number, sentence: SubtitleSentence): string | null {
  const targets = splitTargets(sentence)
  return targets[pickedCount] ?? null
}

/** 拼句得分：全对句 +10，每次提示 -2，下限 0 */
export function puzzleScore(correctSentenceCount: number, hintUsedCount: number): number {
  return Math.max(0, correctSentenceCount * 10 - hintUsedCount * 2)
}
