/**
 * 训练小结加工 —— 真源：docs/系统架构设计.md §2.5 scoring.ts / 原型设计 §4.5 §4.6 完成小结
 *
 * 纯 TS 零依赖：正确率 / 用时 / 最弱句 TOP3 汇总。
 */

import { diffWords, sentenceAccuracy, toWords } from './dictation-diff'
import type { ReportDetail } from '@/types/training'

/** 单句训练结果（各模式共用最小集） */
export interface SentenceResult {
  sentenceIndex: number
  correct: boolean
  /** 单句正确率 0-100 */
  accuracy: number
  /** 使用提示次数（九宫格） */
  hints?: number
  /** 提交次数 */
  attempts?: number
  /** 播放/重听次数（听写） */
  plays?: number
  /** 是否跳过 */
  skipped?: boolean
}

/** 会话小结 */
export interface SessionSummary {
  /** 总句数 */
  total: number
  /** 全对句数 */
  correctCount: number
  /** 平均正确率 0-100（按句均） */
  accuracy: number
  /** 总用时（毫秒） */
  durationMs: number
  /** 最弱句 TOP3（正确率升序的 sentenceIndex） */
  weakest: number[]
  /** 总播放次数（听写） */
  totalPlays: number
}

/** 汇总：正确率取句均；最弱句按正确率升序取前 3（全对句不入榜） */
export function summarize(results: SentenceResult[], durationMs: number): SessionSummary {
  const total = results.length
  const correctCount = results.filter((r) => r.correct).length
  const accuracy = total ? Math.round(results.reduce((sum, r) => sum + r.accuracy, 0) / total) : 0
  const weakest = results
    .filter((r) => !r.correct)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3)
    .map((r) => r.sentenceIndex)
  const totalPlays = results.reduce((sum, r) => sum + (r.plays ?? 0), 0)
  return { total, correctCount, accuracy, durationMs, weakest, totalPlays }
}

/** 格式化用时 mm:ss */
export function formatElapsed(durationMs: number): string {
  const totalSec = Math.max(0, Math.round(durationMs / 1000))
  return `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`
}

/**
 * 影子跟读/全文背诵的文本 diff 指标。
 * accuracy 沿用听写 diff 口径（漏读/错读/多读都扣分）；completeness 只看目标词覆盖率。
 * 当前链路没有语音时长/停顿数据，fluency 以文本 accuracy 作为保守代理，后续接入计时后再替换。
 */
export function reportDetailFromText(transcript: string, target: string): ReportDetail {
  const tokens = diffWords(transcript, target)
  const targetCount = toWords(target).length
  const correctCount = tokens.filter((t) => t.type === 'correct').length
  const accuracy = sentenceAccuracy(tokens, targetCount)
  const completeness = targetCount > 0 ? Math.round((correctCount / targetCount) * 100) : (tokens.length === 0 ? 100 : 0)
  return {
    total: Math.round((accuracy + completeness) / 2),
    completeness,
    accuracy,
    fluency: accuracy,
  }
}
