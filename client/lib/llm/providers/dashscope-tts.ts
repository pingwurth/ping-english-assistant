/**
 * DashScope TTS Provider —— 阿里云原生语音合成 API
 *
 * 使用 DashScope 原生 API 格式，支持语速调节。
 */

import type { TtsModelConfig, TtsResult } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel, getDefaultVoice } from '@/lib/service-endpoints'

/**
 * DashScope TTS 语音合成
 */
export async function generateTtsDashScope(
  text: string,
  config: TtsModelConfig,
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
    const audioBuffer = Buffer.from(audioBase64, 'base64').buffer
    const durationMs = parseWavDuration(audioBuffer)
    return { audioBuffer, durationMs }
  }

  // 旧格式：音频 URL
  const audioUrl: string | undefined = result?.output?.audio?.url
  if (audioUrl) {
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      throw new LlmError('UPSTREAM_ERROR', `音频下载失败 (${audioRes.status})`)
    }
    const audioBuffer = await audioRes.arrayBuffer()
    const durationMs = parseWavDuration(audioBuffer)
    return { audioBuffer, durationMs }
  }

  throw new LlmError('RESPONSE_EMPTY', 'TTS 响应中未返回音频数据')
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
