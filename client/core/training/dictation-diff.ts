/**
 * 听写逐词对比 —— 真源：docs/系统架构设计.md §2.5 dictation-diff.ts
 *
 * normalize：小写、去标点、压缩空格；
 * diffWords：逐词 LCS diff，输出 correct / wrong / missing / extra 四类标记供 UI 着色。
 * 纯 TS 零依赖，node 可直接单测。
 */

/** 逐词 diff 标记：正确 / 错词（红删）/ 漏词（绿插）/ 多词（灰） */
export type DiffType = 'correct' | 'wrong' | 'missing' | 'extra'

export interface DiffToken {
  type: DiffType
  /** 原文侧词（wrong/missing/correct 为目标词；extra 为用户多写的词） */
  text: string
  /** type === 'wrong' 时用户实际写出的词 */
  input?: string
}

/** 归一化：小写、剥离所有标点、压缩连续空格 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’]+/gu, ' ')
    .replace(/['’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 归一化后按空格拆词 */
export function toWords(s: string): string[] {
  const n = normalize(s)
  return n ? n.split(' ') : []
}

/** LCS 表（经典 DP；句子词数有限，O(n*m) 足够） */
function lcsTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  return dp
}

/**
 * 逐词 diff：以目标句为基准对齐。
 * 未对齐块内的 漏词(missing) 与 多词(extra) 按序配对为 错词(wrong)。
 */
export function diffWords(input: string, target: string): DiffToken[] {
  const ins = toWords(input)
  const tgs = toWords(target)
  const dp = lcsTable(ins, tgs)

  // 回溯生成原始操作序列（正序）
  const ops: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < ins.length || j < tgs.length) {
    if (i < ins.length && j < tgs.length && ins[i] === tgs[j]) {
      ops.push({ type: 'correct', text: tgs[j]! })
      i++; j++
      continue
    }
    if (j < tgs.length && (i >= ins.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      ops.push({ type: 'missing', text: tgs[j]! })
      j++
    } else {
      ops.push({ type: 'extra', text: ins[i]! })
      i++
    }
  }

  // 未对齐块内 missing/extra 按序配对 → wrong
  const merged: DiffToken[] = []
  let k = 0
  while (k < ops.length) {
    const op = ops[k]!
    if (op.type === 'correct') { merged.push(op); k++; continue }
    const missing: DiffToken[] = []
    const extra: DiffToken[] = []
    while (k < ops.length && ops[k]!.type !== 'correct') {
      if (ops[k]!.type === 'missing') missing.push(ops[k]!)
      else extra.push(ops[k]!)
      k++
    }
    const pairCount = Math.min(missing.length, extra.length)
    for (let p = 0; p < pairCount; p++) merged.push({ type: 'wrong', text: missing[p]!.text, input: extra[p]!.text })
    for (let p = pairCount; p < missing.length; p++) merged.push(missing[p]!)
    for (let p = pairCount; p < extra.length; p++) merged.push(extra[p]!)
  }
  return merged
}

/** 单句正确率（0-100）：正确词数 / 目标词数；目标为空时按输入是否为空给 100/0 */
export function sentenceAccuracy(tokens: DiffToken[], targetWordCount: number): number {
  if (targetWordCount === 0) return tokens.length === 0 ? 100 : 0
  const correct = tokens.filter((t) => t.type === 'correct').length
  return Math.round((correct / targetWordCount) * 100)
}
