/**
 * Whisper ASR Provider —— OpenAI Whisper multipart form-data 语音识别
 *
 * 使用标准 OpenAI /v1/audio/transcriptions 接口。
 */

import type { AsrModelConfig, AsrResult, AsrSegment } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel } from '@/lib/service-endpoints'

/**
 * Whisper ASR 转写
 *
 * 发送 multipart form-data 请求，返回文本和句子级时间戳。
 */
export async function transcribeWhisper(
  audioFile: File,
  config: AsrModelConfig,
): Promise<AsrResult> {
  const model = config.model || getDefaultModel('whisper', 'asr') || config.provider
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'whisper', 'asr')

  if (!config.apiKey) {
    throw new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key')
  }

  const arrayBuffer = await audioFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Build multipart form data manually
  const boundary = `----FormBoundary${Date.now()}`
  const parts: Buffer[] = []

  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`))
  parts.push(Buffer.from(`${model}\r\n`))

  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(
    Buffer.from(
      `Content-Disposition: form-data; name="file"; filename="${audioFile.name}"\r\n`,
    ),
  )
  parts.push(Buffer.from(`Content-Type: ${audioFile.type || 'audio/mpeg'}\r\n\r\n`))
  parts.push(buffer)
  parts.push(Buffer.from(`\r\n`))

  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(Buffer.from(`Content-Disposition: form-data; name="response_format"\r\n\r\n`))
  parts.push(Buffer.from(`verbose_json\r\n`))

  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(parts)
  console.log('[ASR Whisper] URL:', url)
  console.log('[ASR Whisper] Model:', model, '| Audio:', audioFile.name, `(${(audioFile.size / 1024).toFixed(0)}KB)`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error('Whisper API error:', response.status, errorText)

    if (response.status === 404) {
      throw new LlmError(
        'UPSTREAM_ERROR',
        `转写接口不存在 (${url})。请检查：\n1. Base URL 是否正确\n2. 该 provider 是否支持音频转写\n3. 自定义端点路径是否正确`,
      )
    }
    throw new LlmError('UPSTREAM_ERROR', `转写失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const result = await response.json()

  const segments: AsrSegment[] = (result.segments || []).map(
    (seg: { start: number; end: number; text: string }) => ({
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text.trim(),
    }),
  )

  if (segments.length === 0 && result.text) {
    segments.push({ startMs: 0, endMs: 0, text: result.text.trim() })
  }

  return { text: result.text || '', segments }
}
