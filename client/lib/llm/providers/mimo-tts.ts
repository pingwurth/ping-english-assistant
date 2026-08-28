/**
 * MiMo TTS Provider —— OpenAI-compatible 语音合成
 *
 * 使用 /chat/completions + modalities: ['text', 'audio'] 生成音频。
 */

import type { TtsModelConfig, TtsResult } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel, getDefaultVoice } from '@/lib/service-endpoints'

/**
 * MiMo TTS 语音合成
 */
export async function generateTtsMimo(
  text: string,
  config: TtsModelConfig,
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

  const audioBuffer = Buffer.from(base64, 'base64').buffer
  const durationMs = parseWavDuration(audioBuffer)

  return { audioBuffer, durationMs }
}

/** 从 WAV ArrayBuffer 解析时长 */
function parseWavDuration(buf: ArrayBuffer): number {
  if (buf.byteLength < 44) return 0
  const view = new DataView(buf)
  const sampleRate = view.getUint32(24, true)
  const channels = view.getUint16(22, true)
  const dataSize = view.getUint32(40, true)
  if (!sampleRate || !channels || !dataSize) return 0

  const durationMs = Math.round((dataSize / (sampleRate * channels * 2)) * 1000)

  if (durationMs > 300_000) {
    console.warn(`parseWavDuration: suspicious duration ${durationMs}ms, falling back to byte-based estimate`)
    const estimatedBytesPerSecond = 24000 * 1 * 2
    return Math.round((buf.byteLength / estimatedBytesPerSecond) * 1000)
  }

  return durationMs
}
