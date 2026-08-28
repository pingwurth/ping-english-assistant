/**
 * 服务端点统一管理 —— 所有 AI 服务的默认 endpoint、URL 拼接、默认模型/音色。
 *
 * 设计原则：
 *   - 代码中不得硬编码任何 baseUrl 或 endpoint 路径
 *   - 所有 URL = buildServiceUrl(baseUrl, endpoint)
 *   - endpoint 缺省值由 getDefaultEndpoint(provider, service) 提供
 *   - 默认模型 / 音色由 getDefaultModel / getDefaultVoice 提供
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceKind = 'tts' | 'asr' | 'translate'
export type ProviderKey = 'dashscope' | 'mimo' | 'whisper' | string

// ---------------------------------------------------------------------------
// 默认 endpoint 映射（唯一允许维护路径常量的地方）
// ---------------------------------------------------------------------------

const DASHSCOPE_ENDPOINTS: Record<ServiceKind, string> = {
  tts: '/services/audio/tts/SpeechSynthesizer',
  asr: '/services/aigc/multimodal-generation/generation',
  translate: '/chat/completions',
}

const QWEN_ENDPOINTS: Record<ServiceKind, string> = {
  tts: '/services/audio/tts/SpeechSynthesizer',
  asr: '/services/aigc/multimodal-generation/generation',
  translate: '/chat/completions',
}

const MIMO_ENDPOINTS: Record<ServiceKind, string> = {
  tts: '/chat/completions',
  asr: '/chat/completions',
  translate: '/chat/completions',
}

const WHISPER_ENDPOINTS: Record<ServiceKind, string> = {
  tts: '/v1/audio/speech',
  asr: '/v1/audio/transcriptions',
  translate: '/v1/chat/completions',
}

const PROVIDER_ENDPOINTS: Record<string, Record<ServiceKind, string>> = {
  dashscope: DASHSCOPE_ENDPOINTS,
  qwen: QWEN_ENDPOINTS,
  mimo: MIMO_ENDPOINTS,
  whisper: WHISPER_ENDPOINTS,
}

// ---------------------------------------------------------------------------
// 默认本地服务地址
// ---------------------------------------------------------------------------

/** WhisperX 对齐服务默认地址 */
export const DEFAULT_WHISPER_ALIGN_URL = 'http://127.0.0.1:8765'
/** faster-whisper 转写服务默认地址 */
export const DEFAULT_WHISPER_TRANSCRIBE_URL = 'http://127.0.0.1:8766'

// ---------------------------------------------------------------------------
// 默认模型
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<ServiceKind, Record<string, string>> = {
  tts: {
    dashscope: 'qwen-audio-3.0-tts-flash',
    qwen: 'qwen-audio-3.0-tts-flash',
    mimo: 'qwen-audio-3.0-tts-flash',
  },
  asr: {
    dashscope: 'qwen-audio-3.0-asr-flash',
    qwen: 'qwen-audio-3.0-asr-flash',
    mimo: 'mimo-v2.5-asr',
  },
  translate: {
    dashscope: 'qwen-turbo',
    qwen: 'qwen-turbo',
    mimo: 'mimo-v2.5',
  },
}

// ---------------------------------------------------------------------------
// 默认音色（仅 TTS）
// ---------------------------------------------------------------------------

const DEFAULT_VOICES: Record<string, string> = {
  dashscope: 'longanlingxin',
  qwen: 'longanlingxin',
  mimo: 'Mia',
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 统一 URL 拼接：baseUrl 去尾部 `/` + endpoint。
 */
export function buildServiceUrl(baseUrl: string, endpoint: string): string {
  const host = baseUrl.replace(/\/+$/, '')
  const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${host}${ep}`
}

/**
 * 获取指定 provider + service 的默认 endpoint。
 * 未知 provider 回退到 whisper（OpenAI-compatible）默认值。
 * 'qwen' 作为 'dashscope' 的别名处理。
 */
export function getDefaultEndpoint(provider: ProviderKey, service: ServiceKind): string {
  return PROVIDER_ENDPOINTS[provider]?.[service] ?? WHISPER_ENDPOINTS[service]
}

/**
 * 获取指定 provider + service 的默认模型名。
 * 未配置时返回空字符串（由调用方决定兜底策略）。
 * 'qwen' 作为 'dashscope' 的别名处理。
 */
export function getDefaultModel(provider: ProviderKey, service: ServiceKind): string {
  return DEFAULT_MODELS[service]?.[provider] ?? ''
}

/**
 * 获取指定 provider 的默认 TTS 音色。
 * 'qwen' 作为 'dashscope' 的别名处理。
 */
export function getDefaultVoice(provider: ProviderKey): string {
  return DEFAULT_VOICES[provider] ?? 'alloy'
}

/**
 * 组合快捷函数：给定 settings 字段，返回最终 URL。
 * endpoint 为空时自动取 provider 默认值。
 */
export function resolveServiceUrl(
  baseUrl: string,
  endpoint: string | null | undefined,
  provider: ProviderKey,
  service: ServiceKind,
): string {
  const ep = endpoint || getDefaultEndpoint(provider, service)
  return buildServiceUrl(baseUrl, ep)
}
