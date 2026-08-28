/**
 * TTS 服务 —— 统一封装语音合成调用
 *
 * 根据 provider 分发到不同的实现：
 *   - dashscope: 阿里云原生 TTS API
 *   - mimo: OpenAI-compatible TTS
 *   - 其他: 回退到 dashscope
 */

import type { TtsModelConfig, TtsResult } from './types'
import { LlmError } from './errors'
import { normalizeProvider } from './factory'
import { generateTtsMimo } from './providers/mimo-tts'
import { generateTtsDashScope } from './providers/dashscope-tts'

/**
 * 统一 TTS 生成入口
 *
 * @param text     待合成文本
 * @param config   TTS 配置
 * @returns        音频 buffer 和时长
 * @throws         LlmError 合成失败时抛出
 */
export async function generateTts(
  text: string,
  config: TtsModelConfig,
): Promise<TtsResult> {
  if (!text.trim()) {
    throw new LlmError('RESPONSE_EMPTY', '文本不能为空，无法合成语音')
  }

  const provider = normalizeProvider(config.provider)

  console.log(`[TTS] Provider: ${provider} | Model: ${config.model}`)
  console.log(`[TTS] BaseURL: ${config.baseUrl} | Endpoint: ${config.endpoint || '(default)'}`)

  switch (provider) {
    case 'mimo':
      return generateTtsMimo(text, config)

    case 'dashscope':
      return generateTtsDashScope(text, config)

    default:
      // 未知 provider 回退到 dashscope
      console.log(`[TTS] Unknown provider "${provider}", falling back to DashScope`)
      return generateTtsDashScope(text, config)
  }
}
