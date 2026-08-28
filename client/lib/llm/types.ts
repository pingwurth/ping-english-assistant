/**
 * LLM 服务层共享类型
 *
 * 统一所有 LLM provider 的输入/输出类型，消除 API 路由中的 provider 分支判断。
 */

import type { TranslateDirection } from '@/types/api'

// ---------------------------------------------------------------------------
// Provider 配置
// ---------------------------------------------------------------------------

/** 从 LlmSettings 提取的 provider 配置（去除非 LLM 相关字段） */
export interface LlmProviderConfig {
  provider: string
  baseUrl: string
  apiKey: string
}

/** Chat 模型配置（翻译、报告生成等） */
export interface ChatModelConfig extends LlmProviderConfig {
  model: string
  /** 自定义 endpoint 路径（覆盖 provider 默认值） */
  endpoint?: string | null
}

/** ASR 模型配置 */
export interface AsrModelConfig extends LlmProviderConfig {
  model: string
  endpoint?: string | null
  /** WhisperX 对齐服务地址 */
  whisperAlignUrl?: string
}

/** TTS 模型配置 */
export interface TtsModelConfig extends LlmProviderConfig {
  model: string
  endpoint?: string | null
  voice: string
  speed: number
}

// ---------------------------------------------------------------------------
// ASR 类型
// ---------------------------------------------------------------------------

export interface AsrSegment {
  startMs: number
  endMs: number
  text: string
}

export interface AsrResult {
  text: string
  segments: AsrSegment[]
}

// ---------------------------------------------------------------------------
// TTS 类型
// ---------------------------------------------------------------------------

export interface TtsResult {
  audioBuffer: ArrayBuffer
  durationMs: number
}

// ---------------------------------------------------------------------------
// Chat 类型
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// 翻译类型
// ---------------------------------------------------------------------------

export interface TranslateConfig extends ChatModelConfig {
  direction: 'auto' | TranslateDirection
}

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

/** LLM 服务层错误码 */
export type LlmErrorCode =
  | 'PROVIDER_NOT_SUPPORTED'
  | 'MODEL_NOT_CONFIGURED'
  | 'API_KEY_MISSING'
  | 'BASE_URL_MISSING'
  | 'REQUEST_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'RESPONSE_EMPTY'
  | 'RESPONSE_FORMAT_ERROR'
  | 'ABORTED'
