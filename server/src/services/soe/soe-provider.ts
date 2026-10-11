/**
 * SoeProvider 接口与契约②响应类型 —— 真源：docs/系统架构设计.md §3.3 契约②。
 * 字段与 client/types/api.ts 的 SoeEvaluateResponse 保持一致；
 * errorType 为选型报告 §7 新增的 optional 字段（真实 provider 填充，mock 语义不变）。
 */

/** 音素符号统一 IPA 字符集（报告 §7-3；Azure 侧由 PhonemeAlphabet=IPA 保证） */
export interface SoePhonemeScore {
  symbol: string
  score: number
}

export type SoeWordErrorType = 'None' | 'Omission' | 'Insertion' | 'Mispronunciation'

export interface SoeWordScore {
  text: string
  score: number
  /** 词级错误类型（漏读/增读/误读），真实 provider 返回；mock 不填 */
  errorType?: SoeWordErrorType
  phonemes: SoePhonemeScore[]
}

export interface SoeEvaluateResponse {
  total: number
  accuracy: number
  fluency: number
  /** 语义 = 完整度 Completeness（已发音词/参考词比值），字段名沿用契约②（报告 §7-1） */
  integrity: number
  words: SoeWordScore[]
}

export interface SoeInput {
  /** wav/pcm 16kHz mono */
  audio: Buffer
  /** 参考原文 */
  refText: string
  evalMode: 'sentence'
}

/** 全部 provider 名（env.SOE_PROVIDER 枚举同源；请求 provider 字段可取同名值） */
export type SoeProviderName = 'mock' | 'azure' | 'tencent' | 'iflytek'

export interface SoeProvider {
  readonly name: SoeProviderName
  evaluate(input: SoeInput, signal?: AbortSignal): Promise<SoeEvaluateResponse>
}
