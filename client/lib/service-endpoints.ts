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

export type ServiceKind = 'tts' | 'asr' | 'translate' | 'mnemonic'
export type ProviderKey = 'dashscope' | 'mimo' | string

// ---------------------------------------------------------------------------
// 默认 endpoint 映射（唯一允许维护路径常量的地方）
// ---------------------------------------------------------------------------

const DASHSCOPE_ENDPOINTS: Record<ServiceKind, string> = {
  tts: '/services/audio/tts/SpeechSynthesizer',
  asr: '/services/aigc/multimodal-generation/generation',
  translate: '/chat/completions',
  mnemonic: '/chat/completions',
}

const MIMO_ENDPOINTS: Record<ServiceKind, string> = {
  tts: '/chat/completions',
  asr: '/chat/completions',
  translate: '/chat/completions',
  mnemonic: '/chat/completions',
}

const LOCAL_ENDPOINTS: Record<ServiceKind, string> = {
  tts: '/v1/chat/completions',
  asr: '/v1/chat/completions',
  translate: '/v1/chat/completions',
  mnemonic: '/v1/chat/completions',
}

/**
 * provider 别名归一（唯一出处）：'qwen' 是 'dashscope' 的别名，查表前先归一，
 * 使 endpoint / 默认模型 / 默认音色三张表各自只保留一份真源。
 * factory.normalizeProvider 也走这里 —— 此前两张手工同步表漏同步过一次，
 * 'qwen' 只在一侧归一时 ASR 会静默落到错误 provider（空 SRT）。
 */
const PROVIDER_ALIASES: Record<string, string> = { qwen: 'dashscope' }
export function normalizeProviderAlias(provider: ProviderKey): string {
  return PROVIDER_ALIASES[provider] ?? provider
}

const PROVIDER_ENDPOINTS: Record<string, Record<ServiceKind, string>> = {
  dashscope: DASHSCOPE_ENDPOINTS,
  mimo: MIMO_ENDPOINTS,
  local: LOCAL_ENDPOINTS,
}

// ---------------------------------------------------------------------------
// 默认本地服务地址
// ---------------------------------------------------------------------------

/** WhisperX 对齐服务默认地址 */
export const DEFAULT_WHISPER_ALIGN_URL = 'http://127.0.0.1:8765'
/** faster-whisper 转写服务默认地址 */
export const DEFAULT_WHISPER_TRANSCRIBE_URL = 'http://127.0.0.1:8766'
/** 本地模型（Ollama / vLLM 等）默认地址 */
export const DEFAULT_LOCAL_MODEL_URL = 'http://127.0.0.1:11434'
/** SOE 评分代理（Fastify server/，契约②）默认地址 */
export const DEFAULT_SOE_PROXY_URL = 'http://127.0.0.1:8788'
/** OpenAI-compatible `/models` 探测端点（模型配置弹窗使用） */
export const OPENAI_MODELS_ENDPOINT = '/models'
/** faster-whisper Python 服务端点 */
export const WHISPER_TRANSCRIBE_ENDPOINT = '/transcribe'
export const WHISPER_TRANSCRIBE_HEALTH_ENDPOINT = '/health'
/** WhisperX Python 服务端点 */
export const WHISPER_ALIGN_ENDPOINT = '/align'
/** Fastify SOE 代理端点 */
export const SOE_EVALUATE_ENDPOINT = '/api/v1/soe/evaluate'
export const SOE_HEALTH_ENDPOINT = '/healthz'

/** HuggingFace 模型下载默认源（可被 HF_BASE 环境变量覆盖，如 hf-mirror.com） */
export const DEFAULT_HF_BASE = 'https://huggingface.co'

// ---------------------------------------------------------------------------
// 默认模型
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<ServiceKind, Record<string, string>> = {
  tts: {
    dashscope: 'qwen-audio-3.0-tts-flash',
    mimo: 'qwen-audio-3.0-tts-flash',
  },
  asr: {
    dashscope: 'qwen-audio-3.0-asr-flash',
    mimo: 'mimo-v2.5-asr',
  },
  translate: {
    dashscope: 'qwen-turbo',
    mimo: 'mimo-v2.5',
    local: '',
  },
  mnemonic: {
    dashscope: 'qwen-turbo',
    mimo: 'mimo-v2.5',
    local: '',
  },
}

// ---------------------------------------------------------------------------
// 默认音色（仅 TTS）
// ---------------------------------------------------------------------------

const DEFAULT_VOICES: Record<string, string> = {
  dashscope: 'longanlingxin',
  mimo: 'Mia',
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 统一 URL 拼接：baseUrl 去尾部 `/` + endpoint。
 * 版本前缀去重：baseUrl 已以 /v1 结尾且 endpoint 也以 /v1 开头时只保留一个 ——
 * Ollama 官方文档写法 baseUrl=http://host:11434/v1 与本地默认 endpoint /v1/chat/completions
 * 直接拼接会得到 /v1/v1/...（模型列表路由早已做此归一，此处统一）。
 */
export function buildServiceUrl(baseUrl: string, endpoint: string): string {
  const host = baseUrl.replace(/\/+$/, '')
  const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  if (/\/v\d+$/.test(host) && /^\/v\d+\//.test(ep)) {
    return host + ep.slice(ep.indexOf('/', 1))
  }
  return `${host}${ep}`
}

/**
 * 获取指定 provider + service 的默认 endpoint。
 * 未知 provider 回退到 mimo（OpenAI-compatible）默认值。
 * 'qwen' 作为 'dashscope' 的别名处理。
 */
export function getDefaultEndpoint(provider: ProviderKey, service: ServiceKind): string {
  return PROVIDER_ENDPOINTS[normalizeProviderAlias(provider)]?.[service] ?? MIMO_ENDPOINTS[service]
}

/**
 * 获取指定 provider + service 的默认模型名。
 * 未配置时返回空字符串（由调用方决定兜底策略）。
 * 'qwen' 作为 'dashscope' 的别名处理。
 */
export function getDefaultModel(provider: ProviderKey, service: ServiceKind): string {
  return DEFAULT_MODELS[service]?.[normalizeProviderAlias(provider)] ?? ''
}

/**
 * 获取指定 provider 的默认 TTS 音色。
 * 'qwen' 作为 'dashscope' 的别名处理。
 */
export function getDefaultVoice(provider: ProviderKey): string {
  return DEFAULT_VOICES[normalizeProviderAlias(provider)] ?? 'alloy'
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
