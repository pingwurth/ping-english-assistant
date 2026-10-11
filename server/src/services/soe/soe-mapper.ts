/**
 * 各 provider 响应 → 契约②字段映射。
 *
 * - Azure：真源 docs/发音评分技术选型报告.md §6.1。REST 短音频接口 format=detailed，
 *   评分在 NBest[0]（响应结构见
 *   learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short，查询于 2026-10）。
 * - 腾讯：新版口语评测（OEN）WS result 内嵌 JSON（2026-10 官方文档；句子级字段与旧版 REST 同名，
 *   词标签 Tag 替代 MatchTag、音素数组 PhoneInfo 替代 PhoneInfos —— 两种形状均防御性兼容）。
 * - 讯飞：ISE 结果 XML 解析后的 IflytekIseResult。
 *
 * 分数取整：上游返回小数（Azure 一位 / 腾讯多位 / 讯飞 0–5 或 0–100 分制），
 * 契约②沿用 mock 的整数口径，UI（ScorePanel）按整数渲染。
 */

import type { SoeEvaluateResponse, SoeWordErrorType } from './soe-provider'
import type { IflytekIseResult } from './iflytek-xml'

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

/** 腾讯 SOE 评分结果中我们关心的子集（新版 WS result 内嵌 JSON 解析后的形态；其余字段忽略） */
export interface TencentSoeResponse {
  /** [-1,100]，-1 = 未匹配/无语音 */
  PronAccuracy?: number
  /** [0,1] 小数 */
  PronFluency?: number
  /** [0,1] 小数（注意字段名是 PronCompletion） */
  PronCompletion?: number
  /** [0,100] 综合建议分 */
  SuggestedScore?: number
  Words?: Array<{
    Word?: string
    /** 参考词（增读/漏读对齐用；暂不映射） */
    ReferenceWord?: string
    PronAccuracy?: number
    PronFluency?: number
    /** 新版 WS 词标签（⚠️ 官方文档未标注枚举顺序，暂沿用旧版 MatchTag 口径，接入真实凭据后核对） */
    Tag?: number
    /** 旧版 REST 字段名（双形状防御兼容） */
    MatchTag?: number
    /** 音素数组：新版 PhoneInfo / 旧版 PhoneInfos（双形状防御兼容；英文句子模式可能为空数组） */
    PhoneInfo?: TencentSoePhone[]
    PhoneInfos?: TencentSoePhone[]
  }>
  RequestId?: string
}

/** 腾讯音素项：字段名 Phone / Phoneme 双形状防御兼容（新版文档以 PhoneInfo[]-Phone 为主） */
export interface TencentSoePhone {
  Phone?: string
  Phoneme?: string
  PronAccuracy?: number
}

/** 腾讯 Tag/MatchTag → 契约② errorType（0 匹配 / 1 漏读 / 2 增读 / 3 错读；
 *  新版 Tag 枚举顺序官方文档未标注，暂按旧版 MatchTag 口径，接入真实凭据后核对） */
const TENCENT_MATCH_TAG: Record<number, SoeWordErrorType> = {
  0: 'None',
  1: 'Omission',
  2: 'Insertion',
  3: 'Mispronunciation',
}

/** 百分制归一：取整 + clamp 到 [0,100]；-1 等负值经 max(0,·) 先归 0 */
const pct = (n: number | undefined): number => Math.max(0, Math.min(100, Math.round(n ?? 0)))

/** [0,1] 小数归一：×100 后取整 clamp（⚠️ 弄反会输出 fluency=1） */
const frac = (n: number | undefined): number => pct((n ?? 0) * 100)

/** 腾讯评分结果 → 契约② */
export function mapTencentToContract(res: TencentSoeResponse): SoeEvaluateResponse {
  return {
    total: pct(res.SuggestedScore ?? res.PronAccuracy),
    accuracy: pct(res.PronAccuracy),
    fluency: frac(res.PronFluency),
    integrity: frac(res.PronCompletion),
    words: (res.Words ?? []).map((w) => {
      // Tag 优先（新版），MatchTag 兜底（旧版）；未知取值 → undefined
      const tag = w.Tag ?? w.MatchTag
      return {
        text: w.Word ?? '',
        score: pct(w.PronAccuracy),
        errorType: tag !== undefined ? TENCENT_MATCH_TAG[tag] : undefined,
        phonemes: (w.PhoneInfo ?? w.PhoneInfos ?? []).map((p) => ({
          symbol: p.Phone ?? p.Phoneme ?? '',
          score: pct(p.PronAccuracy),
        })),
      }
    }),
  }
}

/** 讯飞 dp_message → 契约② errorType */
const DP_MESSAGE_MAP: Record<number, SoeWordErrorType> = {
  0: 'None',
  16: 'Omission',
  32: 'Insertion',
  128: 'Mispronunciation',
  64: 'None', // 回读：契约②无对应枚举，近似
}

/** 讯飞 ISE 结果 → 契约② */
export function mapIflytekToContract(r: IflytekIseResult): SoeEvaluateResponse {
  // 评分量纲启发：讯飞英文可能 0–5 分制（FAQ：优=4.3~5≈86~100；真实凭据接入后复核）
  const scale = (r.total ?? 0) > 5 ? 1 : 20
  const norm = (n: number | undefined): number => Math.max(0, Math.min(100, Math.round((n ?? 0) * scale)))
  return {
    total: norm(r.total),
    accuracy: norm(r.accuracy),
    fluency: norm(r.fluency),
    integrity: norm(r.integrity),
    words: r.words.map((w) => ({
      text: w.text,
      score: norm(w.score),
      errorType: DP_MESSAGE_MAP[w.dpMessage] ?? 'None',
      // 英文朗读题型音素级仅错误标记无数值分 → 降级（报告 §2.2）
      phonemes: [],
    })),
  }
}
