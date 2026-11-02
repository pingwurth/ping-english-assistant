/**
 * DashScope TTS Provider —— 阿里云原生语音合成 API
 *
 * 使用 DashScope 原生 API 格式，支持语速调节。
 */

import type { TtsModelConfig, TtsResult } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel, getDefaultVoice } from '@/lib/service-endpoints'
import { parseWavDurationWithFallback } from '@/lib/wav-duration'

/**
 * DashScope TTS 语音合成
 */
export async function generateTtsDashScope(
  text: string,
  config: TtsModelConfig,
  signal?: AbortSignal,
): Promise<TtsResult> {
  const model = config.model || getDefaultModel('dashscope', 'tts')
  const voice = config.voice || getDefaultVoice('dashscope')
  const speed = Math.max(0.5, Math.min(2.0, config.speed || 1.0))
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'dashscope', 'tts')

  if (!config.apiKey) {
    throw new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key')
  }

  const requestBody = {
    model,
    input: {
      text,
    },
    parameters: {
      voice,
      format: 'wav',
      sample_rate: 24000,
      speed,
    },
  }

  console.log('[TTS DashScope] URL:', url)
  console.log('[TTS DashScope] Model:', model, '| Voice:', voice, '| Speed:', speed)

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
      detail =
        errBody.message ||
        errBody.error?.message ||
        errBody.code ||
        JSON.stringify(errBody)
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 500)
    }
    throw new LlmError('UPSTREAM_ERROR', `TTS 调用失败 (${res.status})：${detail}`)
  }

  const result = await res.json()

  // 新格式：base64 音频数据
  const audioBase64: string | undefined =
    result?.output?.choices?.[0]?.message?.audio?.data
  if (audioBase64) {
    // slice 出精确视图：小 payload（≤4KB）时 Node 从 8KB 池分配，直接取 .buffer
    // 会把池内垃圾一起带给上层编码成坏 WAV
    const buf = Buffer.from(audioBase64, 'base64')
    const audioBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    // 24kHz mono 16-bit = 48kB/s：头解析失败时的字节率估算兜底
    const durationMs = parseWavDurationWithFallback(audioBuffer, 24_000 * 2)
    return { audioBuffer, durationMs }
  }

  // 旧格式：音频 URL
  const audioUrl: string | undefined = result?.output?.audio?.url
  if (audioUrl) {
    const audioRes = await fetch(audioUrl, { signal })
    if (!audioRes.ok) {
      throw new LlmError('UPSTREAM_ERROR', `音频下载失败 (${audioRes.status})`)
    }
    const audioBuffer = await audioRes.arrayBuffer()
    const durationMs = parseWavDurationWithFallback(audioBuffer, 24_000 * 2)
    return { audioBuffer, durationMs }
  }

  throw new LlmError('RESPONSE_EMPTY', 'TTS 响应中未返回音频数据')
}
