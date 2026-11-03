/**
 * MiMo TTS Provider —— OpenAI-compatible 语音合成
 *
 * 使用 /chat/completions + modalities: ['text', 'audio'] 生成音频。
 */

import type { TtsModelConfig, TtsResult } from '../types'
import { LlmError, readUpstreamErrorDetail } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel, getDefaultVoice } from '@/lib/service-endpoints'
import { decodeTtsAudioPayload } from '@/lib/wav-duration'

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

  // MiMo 网关的 /chat/completions 音频模态不保证 speed 字段（评审 #3）：
  // 与其静默丢弃让用户以为调速生效，不如标 speedApplied=false 交给路由/页面提示
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
    throw new LlmError('UPSTREAM_ERROR', `TTS 调用失败 (${res.status})：${await readUpstreamErrorDetail(res)}`)
  }

  const result = await res.json()
  const base64: string | undefined = result?.choices?.[0]?.message?.audio?.data
  if (!base64) {
    throw new LlmError('RESPONSE_EMPTY', 'TTS 响应中未返回音频数据')
  }

  // base64 解码（含 Node 8KB 池 slice 修正）+ 时长解析见 lib/wav-duration 唯一实现
  const decoded = decodeTtsAudioPayload(base64)
  return { ...decoded, speedApplied: false }
}
