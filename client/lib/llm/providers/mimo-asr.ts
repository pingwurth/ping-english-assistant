/**
 * MiMo ASR Provider —— OpenAI-compatible multimodal 语音识别
 *
 * 使用 input_audio content type 发送 base64 音频数据。
 */

import type { AsrModelConfig, AsrResult } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel } from '@/lib/service-endpoints'

/**
 * MiMo ASR 转写
 *
 * 发送 OpenAI-compatible multimodal 请求，返回转写文本。
 * 时间戳需通过 WhisperX 对齐或比例分配获取（本函数不处理）。
 */
export async function transcribeMimo(
  audioFile: File,
  config: AsrModelConfig,
): Promise<AsrResult> {
  const model = config.model || getDefaultModel('mimo', 'asr')
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'mimo', 'asr')

  if (!config.apiKey) {
    throw new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key')
  }

  const arrayBuffer = await audioFile.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mime = inferMimeType(audioFile.name, audioFile.type || 'audio/wav')

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: `data:${mime};base64,${base64}`,
            },
          },
        ],
      },
    ],
    extra_body: {
      asr_options: { language: 'auto' },
    },
  }

  console.log('[ASR MiMo] URL:', url)
  console.log('[ASR MiMo] Model:', model, '| Audio:', (audioFile.size / 1024).toFixed(0), 'KB')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error('MiMo ASR error:', response.status, errorText)
    throw new LlmError('UPSTREAM_ERROR', `MiMo 转写失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const result = await response.json()
  const text: string = result.choices?.[0]?.message?.content || ''

  if (!text.trim()) {
    return { text: '', segments: [] }
  }

  // MiMo ASR 不返回时间戳，返回纯文本，由上层处理时间戳
  return { text: text.trim(), segments: [] }
}

/** Infer MIME type from filename */
function inferMimeType(filename: string, fallback: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    webm: 'audio/webm',
  }
  return map[ext || ''] || fallback
}
