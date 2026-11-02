/**
 * MiMo TTS Provider —— OpenAI-compatible 语音合成
 *
 * 使用 /chat/completions + modalities: ['text', 'audio'] 生成音频。
 */

import type { TtsModelConfig, TtsResult } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel, getDefaultVoice } from '@/lib/service-endpoints'
import { parseWavDurationWithFallback } from '@/lib/wav-duration'

/**
 * MiMo TTS 语音合成
 */
export async function generateTtsMimo(
  text: string,
  config: TtsModelConfig,
  signal?: AbortSignal,
): Promise<TtsResult> {
  const model = config.model || getDefaultModel('mimo', 'tts')
  const voice = config.voice || getDefaultVoice('mimo')
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'mimo', 'tts')

  if (!config.apiKey) {
    throw new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key')
  }

  const requestBody = {
    model,
    messages: [{ role: 'assistant', content: text }],
    modalities: ['text', 'audio'],
    audio: { voice, format: 'wav' },
  }

  console.log('[TTS MiMo] URL:', url)
  console.log('[TTS MiMo] Model:', model, '| Voice:', voice)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const errBody = await res.json()
      detail = errBody.error?.message || errBody.message || JSON.stringify(errBody)
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 500)
    }
    throw new LlmError('UPSTREAM_ERROR', `TTS 调用失败 (${res.status})：${detail}`)
  }

  const result = await res.json()
  const base64: string | undefined = result?.choices?.[0]?.message?.audio?.data
  if (!base64) {
    throw new LlmError('RESPONSE_EMPTY', 'TTS 响应中未返回音频数据')
  }

  // slice 出精确视图：小 payload（≤4KB）时 Node 从 8KB 池分配，直接取 .buffer 会带出池内垃圾
  const buf = Buffer.from(base64, 'base64')
  const audioBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  // 24kHz mono 16-bit = 48kB/s：头解析失败时的字节率估算兜底
  const durationMs = parseWavDurationWithFallback(audioBuffer, 24_000 * 2)

  return { audioBuffer, durationMs }
}
