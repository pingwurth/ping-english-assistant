/**
 * LLM 工厂 —— 根据 provider 配置创建 LangChain ChatModel 实例
 *
 * 支持的 provider：
 *   - dashscope: 阿里云 DashScope（Qwen 系列）
 *   - mimo: MiMo（OpenAI-compatible）
 *   - 其他: 回退到 OpenAI-compatible
 */

import { ChatOpenAI } from '@langchain/openai'
import type { ChatModelConfig } from './types'
import { LlmError } from './errors'
import { resolveServiceUrl } from '@/lib/service-endpoints'

// ---------------------------------------------------------------------------
// Chat Model 工厂
// ---------------------------------------------------------------------------

/**
 * 创建 LangChain ChatOpenAI 实例
 *
 * 所有 provider 统一使用 ChatOpenAI，因为：
 *   - mimo 本身就是 OpenAI-compatible
 *   - dashscope 的 chat completions 也兼容 OpenAI 格式（/chat/completions）
 *   - 非标准格式（DashScope 原生 ASR/TTS）走各自的 provider 封装
 */
export interface CreateChatModelOptions {
  /** 是否启用流式模式（默认 false） */
  streaming?: boolean
}

export function createChatModel(config: ChatModelConfig, options?: CreateChatModelOptions): ChatOpenAI {
  if (!config.apiKey) {
    throw new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key')
  }
  if (!config.baseUrl) {
    throw new LlmError('BASE_URL_MISSING', '请先在设置页配置 Base URL')
  }
  if (!config.model) {
    throw new LlmError('MODEL_NOT_CONFIGURED', '该配置未设置翻译模型')
  }

  const useStreaming = options?.streaming ?? false

  // 构建完整的 API base URL（包含 endpoint 路径）
  // ChatOpenAI 的 basePath 需要去掉 /chat/completions 后缀，只保留基础路径
  const fullUrl = resolveServiceUrl(
    config.baseUrl,
    config.endpoint,
    config.provider || 'mimo',
    'translate',
  )

  // 从完整 URL 提取 basePath（去掉 /chat/completions）
  // ChatOpenAI 内部会拼接 /chat/completions
  const basePath = fullUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '')

  const provider = normalizeProvider(config.provider)

  return new ChatOpenAI({
    modelName: config.model,
    apiKey: config.apiKey,
    configuration: {
      baseURL: basePath,
      // DashScope 流式需要 SSE enable header
      defaultHeaders: provider === 'dashscope'
        ? { 'X-DashScope-SSE': useStreaming ? 'enable' : 'disable' }
        : undefined,
    },
    timeout: 120_000,
    maxRetries: 1,
    streaming: useStreaming,
  })
}

// ---------------------------------------------------------------------------
// Provider 归一化
// ---------------------------------------------------------------------------

/** 将 provider 别名归一化为标准 key */
export function normalizeProvider(provider: string): string {
  return provider || 'mimo'
}

/**
 * 判断是否使用 DashScope 原生 API（非 OpenAI-compatible）
 *
 * DashScope 的 chat completions 支持 OpenAI 格式，但 ASR/TTS 使用原生 API。
 * 此函数用于 ASR/TTS 路由判断是否需要走原生实现。
 */
export function isDashScopeNative(provider: string): boolean {
  return normalizeProvider(provider) === 'dashscope'
}

/**
 * 判断是否使用 OpenAI-compatible 接口
 */
export function isOpenAICompatible(provider: string): boolean {
  const p = normalizeProvider(provider)
  return p !== 'dashscope'
}

// ---------------------------------------------------------------------------
// URL 解析工具（供 ASR/TTS provider 使用）
// ---------------------------------------------------------------------------

/**
 * 解析服务端点 URL（复用 service-endpoints 的逻辑）
 */
export function resolveProviderUrl(
  baseUrl: string,
  endpoint: string | null | undefined,
  provider: string,
  service: 'tts' | 'asr' | 'translate',
): string {
  return resolveServiceUrl(baseUrl, endpoint, normalizeProvider(provider), service)
}
