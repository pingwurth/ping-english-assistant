/**
 * Azure Pronunciation Assessment 响应 → 契约②字段映射 —— 真源：docs/发音评分技术选型报告.md §6.1。
 * REST 短音频接口 format=detailed，评分在 NBest[0]（响应结构见
 * learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short，查询于 2026-10）。
 *
 * 分数取整：Azure 返回一位小数（如 95.1），契约②沿用 mock 的整数口径，UI（ScorePanel）按整数渲染。
 */

import type { SoeEvaluateResponse, SoeWordErrorType } from './soe-provider'

/** Azure REST 响应中我们关心的子集（其余字段忽略） */
export interface AzurePronResponse {
  RecognitionStatus: 'Success' | 'NoMatch' | 'InitialSilenceTimeout' | 'BabbleTimeout' | 'Error'
  NBest?: Array<{
    PronScore?: number
    AccuracyScore?: number
    FluencyScore?: number
    CompletenessScore?: number
    Words?: Array<{
      Word: string
      AccuracyScore?: number
      ErrorType?: string
      Phonemes?: Array<{ Phoneme: string; AccuracyScore?: number }>
    }>
  }>
}

const round = (n: number | undefined): number => Math.round(n ?? 0)

const ERROR_TYPES: ReadonlySet<string> = new Set(['None', 'Omission', 'Insertion', 'Mispronunciation'])

/** NBest[0] → 契约②；四维一一对应（Pron/Accuracy/Fluency/Completeness → total/accuracy/fluency/integrity） */
export function mapAzureToContract(nbest: NonNullable<AzurePronResponse['NBest']>[number]): SoeEvaluateResponse {
  return {
    total: round(nbest.PronScore),
    accuracy: round(nbest.AccuracyScore),
    fluency: round(nbest.FluencyScore),
    integrity: round(nbest.CompletenessScore),
    words: (nbest.Words ?? []).map((w) => ({
      text: w.Word,
      score: round(w.AccuracyScore),
      errorType: (ERROR_TYPES.has(w.ErrorType ?? '') ? w.ErrorType : undefined) as SoeWordErrorType | undefined,
      phonemes: (w.Phonemes ?? []).map((p) => ({ symbol: p.Phoneme, score: round(p.AccuracyScore) })),
    })),
  }
}
