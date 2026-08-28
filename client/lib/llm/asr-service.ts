/**
 * ASR 服务 —— 统一封装语音识别调用
 *
 * 根据 provider 分发到不同的实现：
 *   - dashscope: 原生 multimodal-generation API
 *   - mimo: OpenAI-compatible multimodal
 *   - whisper: OpenAI Whisper multipart form-data
 *   - 其他: 回退到 whisper
 */

import type { AsrModelConfig, AsrResult } from './types'
import { LlmError } from './errors'
import { normalizeProvider } from './factory'
import { transcribeMimo } from './providers/mimo-asr'
import { transcribeDashScope } from './providers/dashscope-asr'
import { transcribeWhisper } from './providers/whisper-asr'

/**
 * 统一 ASR 转写入口
 *
 * @param audioFile  音频文件（File 对象）
 * @param config     ASR 配置
 * @returns          转写结果（文本 + 时间戳 segments）
 * @throws           LlmError 转写失败时抛出
 */
export async function transcribe(
  audioFile: File,
  config: AsrModelConfig,
): Promise<AsrResult> {
  const provider = normalizeProvider(config.provider)

  console.log(`[ASR] Provider: ${provider} | Model: ${config.model}`)
  console.log(`[ASR] BaseURL: ${config.baseUrl} | Endpoint: ${config.endpoint || '(default)'}`)
  console.log(`[ASR] Audio: ${audioFile.name} (${(audioFile.size / 1024).toFixed(0)}KB)`)

  switch (provider) {
    case 'dashscope':
      return transcribeDashScope(audioFile, config)

    case 'mimo':
      return transcribeMimo(audioFile, config)

    case 'whisper':
      return transcribeWhisper(audioFile, config)

    default:
      // 未知 provider 回退到 whisper（OpenAI-compatible）
      console.log(`[ASR] Unknown provider "${provider}", falling back to Whisper`)
      return transcribeWhisper(audioFile, config)
  }
}

/**
 * 检测 ASR provider 类型
 *
 * 用于 API 路由中判断是否为 multimodal 模型（决定是否需要 WhisperX 对齐）。
 */
export function getAsrProviderType(settings: { provider: string; asrModel?: string | null }): 'multimodal' | 'whisper' {
  const provider = normalizeProvider(settings.provider)
  const model = (settings.asrModel || '').toLowerCase()

  if (provider === 'mimo') return 'multimodal'
  if (provider === 'dashscope' && (model.startsWith('qwen-audio') || !model)) return 'multimodal'
  return 'whisper'
}
