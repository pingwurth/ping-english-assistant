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

// ── 九宫格滑窗算法 ─────────────────────────────────────────

/** 九宫格常量 */
export const GRID_SIZE = 9

/** 九宫格词格 */
export interface GridCell {
  id: number
  text: string
}

/** 九宫格滑窗状态 */
export interface PuzzleGridState {
  /** 目标句词序列（正确顺序） */
  targets: string[]
  /** 当前应选第几个词（0-based） */
  cursor: number
  /** 剩余未展示的目标句词（cursor 之后、尚未在 grid 中的） */
  pool: string[]
  /** 当前 9 格 */
  grid: GridCell[]
  /** 当前正确答案在 grid 中的 index */
  answerIndex: number
  /** 是否已完成 */
  done: boolean
}

/**
 * 拆成逐词序列（九宫格专用）：始终按空格拆分，不做短语合并。
 */
export function splitWords(sentence: SubtitleSentence): string[] {
  return sentence.textEn.trim().split(/\s+/).filter(Boolean)
}

/**
 * 收集同材料其他句子的词表（去重），用于短句填充干扰项。
 * 传入 sentences 和当前 sentenceIndex，排除当前句。
 */
export function collectDistractorWords(
  sentences: SubtitleSentence[],
  currentIndex: number,
  exclude: Set<string>,
): string[] {
  const words: string[] = []
  for (const s of sentences) {
    if (s.index === currentIndex) continue
    for (const w of s.words) {
      const lower = w.toLowerCase()
      if (!exclude.has(lower) && !words.includes(w)) words.push(w)
    }
  }
  return words
}

/**
 * 初始化九宫格状态。
 * @param sentence 当前句
 * @param distractorPool 干扰词池（其他句子的词）
 * @param rng 可注入随机源
 */
export function initGridState(
  sentence: SubtitleSentence,
  distractorPool: string[] = [],
  rng: Rng = Math.random,
): PuzzleGridState {
  const targets = splitWords(sentence)
  if (targets.length === 0) {
    return { targets, cursor: 0, pool: [], grid: [], answerIndex: -1, done: true }
  }

  // 取前 min(GRID_SIZE, targets.length) 个目标词放入 grid
  const initialTargetCount = Math.min(GRID_SIZE, targets.length)
  const initialTargets = targets.slice(0, initialTargetCount)

  // 剩余目标词进 pool
  const pool = targets.slice(initialTargetCount)

  // 短句不足 GRID_SIZE 时，从干扰池取词补齐
  const gridTexts = [...initialTargets]
  const usedSet = new Set(gridTexts.map((t) => t.toLowerCase()))
  const distractors: string[] = []
  for (const w of distractorPool) {
    if (gridTexts.length >= GRID_SIZE) break
    if (!usedSet.has(w.toLowerCase())) {
      distractors.push(w)
      usedSet.add(w.toLowerCase())
      gridTexts.push(w)
    }
  }

  // 打乱
  const shuffled = shuffle(gridTexts, rng)
  const grid: GridCell[] = shuffled.map((text, i) => ({ id: i, text }))

  // 定位答案（targets[0]）
  const answerIndex = grid.findIndex((c) => c.text === targets[0])

  return {
    targets,
    cursor: 0,
    pool,
    grid,
    answerIndex,
    done: false,
  }
}

/**
 * 用户点击 grid 中第 pickedIndex 格。
 * - 正确：cursor 推进，移除该格，从 pool 补词，重新洗牌
 * - 错误：返回 correct=false，state 不变
 */
export function selectGridWord(
  state: PuzzleGridState,
  pickedIndex: number,
  rng: Rng = Math.random,
): { state: PuzzleGridState; correct: boolean } {
  if (state.done || pickedIndex < 0 || pickedIndex >= state.grid.length) {
    return { state, correct: false }
  }

  const correct = pickedIndex === state.answerIndex
  if (!correct) return { state, correct: false }

  const newCursor = state.cursor + 1

  // 句子完成
  if (newCursor >= state.targets.length) {
    return {
      state: { ...state, cursor: newCursor, grid: [], answerIndex: -1, done: true },
      correct: true,
    }
  }

  // 移除选中的格子
  const remaining = state.grid.filter((_, i) => i !== pickedIndex)

  // 从 pool 取一个词补入（优先目标句剩余词）
  let newPool = [...state.pool]
  const newGridTexts = remaining.map((c) => c.text)

  if (newPool.length > 0) {
    // 从 pool 头部取一个
    const word = newPool.shift()!
    newGridTexts.push(word)
  }

  // 打乱
  const shuffled = shuffle(newGridTexts, rng)
  const newGrid: GridCell[] = shuffled.map((text, i) => ({ id: i, text }))

  // 定位新答案
  const nextTarget = state.targets[newCursor]
  const answerIndex = newGrid.findIndex((c) => c.text === nextTarget)

  // 安全检查：答案必须在 grid 中（算法保证，但防御性处理）
  if (answerIndex === -1) {
    // 强制插入答案
    newGrid[0] = { id: newGrid.length, text: nextTarget }
    return {
      state: {
        targets: state.targets,
        cursor: newCursor,
        pool: newPool,
        grid: shuffle(newGrid.map((c) => c.text), rng).map((text, i) => ({ id: i, text })),
        answerIndex: 0, // 会在下面重新定位
        done: false,
      },
      correct: true,
    }
  }

  return {
    state: {
      targets: state.targets,
      cursor: newCursor,
      pool: newPool,
      grid: newGrid,
      answerIndex,
      done: false,
    },
    correct: true,
  }
}

/**
 * 获取提示：返回答案在 grid 中的 index。
 */
export function getGridHint(state: PuzzleGridState): number {
  return state.answerIndex
}

/**
 * 九宫格拼句得分：每句基础 10 分，每次提示 -2，下限 0。
 */
export function gridScore(correctSentenceCount: number, hintUsedCount: number): number {
  return Math.max(0, correctSentenceCount * 10 - hintUsedCount * 2)
}
