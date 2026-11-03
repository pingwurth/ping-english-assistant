/**
 * ASR 服务 —— 统一封装语音识别调用
 *
 * 根据 provider 分发到不同的实现：
 *   - dashscope: 原生 multimodal-generation API
 *   - mimo: OpenAI-compatible multimodal
 *   - 其他: 回退到 mimo
 */

import type { AsrModelConfig, AsrResult } from './types'
import { LlmError } from './errors'
import { normalizeProvider } from './factory'
import { transcribeMimo } from './providers/mimo-asr'
import { transcribeDashScope } from './providers/dashscope-asr'

/**
 * 统一 ASR 转写入口
 *
 * @param audioFile  音频文件（File 对象）
 * @param config     ASR 配置
 * @param signal     可选取消信号（客户端关页/中断时中止上游）
 * @returns          转写结果（文本 + 时间戳 segments）
 * @throws           LlmError 转写失败时抛出
 */
export async function transcribe(
  audioFile: File,
  config: AsrModelConfig,
  signal?: AbortSignal,
): Promise<AsrResult> {
  const provider = normalizeProvider(config.provider)

  console.log(`[ASR] Provider: ${provider} | Model: ${config.model}`)
  console.log(`[ASR] BaseURL: ${config.baseUrl} | Endpoint: ${config.endpoint || '(default)'}`)
  console.log(`[ASR] Audio: ${audioFile.name} (${(audioFile.size / 1024).toFixed(0)}KB)`)

  switch (provider) {
    case 'dashscope':
      return transcribeDashScope(audioFile, config, signal)

    case 'mimo':
      return transcribeMimo(audioFile, config, signal)

    default:
      // 未知 provider 回退到 mimo（OpenAI-compatible）
      console.log(`[ASR] Unknown provider "${provider}", falling back to MiMo`)
      return transcribeMimo(audioFile, config, signal)
  }
}
