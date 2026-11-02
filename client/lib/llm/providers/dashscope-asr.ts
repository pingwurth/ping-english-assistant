/**
 * DashScope ASR Provider —— 阿里云原生 multimodal-generation API
 *
 * 使用 qwen-audio 系列模型的原生 API，返回文本和词级时间戳。
 */

import type { AsrModelConfig, AsrResult, AsrSegment } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel } from '@/lib/service-endpoints'
import { groupWordsToSegments, inferMimeType, type WordTimestamp } from '../asr-audio'

interface DashScopeWord {
  begin_time: number
  end_time: number
  text: string
  punctuation?: string
}

/** ASR 上游硬超时：整段音频转写慢于即时对话，给 180s（与 WhisperX 对齐预算同量级） */
const ASR_TIMEOUT_MS = 180_000


/**
 * DashScope ASR 转写
 *
 * 使用原生 multimodal-generation API，可返回词级时间戳。
 */
export async function transcribeDashScope(
  audioFile: File,
  config: AsrModelConfig,
  signal?: AbortSignal,
): Promise<AsrResult> {
  const model = config.model || getDefaultModel('dashscope', 'asr')
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'dashscope', 'asr')

  if (!config.apiKey) {
    throw new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key')
  }

  const arrayBuffer = await audioFile.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mime = inferMimeType(audioFile.name, audioFile.type || 'audio/wav')

  // DashScope native API 使用 input.messages with input_audio
  const body = {
    model,
    input: {
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
    },
    parameters: {
      format: inferAudioFormat(audioFile.name),
    },
  }

  console.log(`[ASR DashScope] POST ${url} (model=${model}, audio=${(audioFile.size / 1024).toFixed(0)}KB)`)

  // 取消传播 + 硬超时（对齐 TTS 路径评审 #24）：客户端关页/取消后不再干等上游跑完计费
  const timeoutSignal = AbortSignal.timeout(ASR_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: combined,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error('DashScope ASR error:', response.status, errorText)
    throw new LlmError('UPSTREAM_ERROR', `转写失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const result = await response.json()

  // Response format: { sentence: { text, begin_time, end_time, words: [...] } }
  const sentence = result?.sentence
  const text: string =
    sentence?.text ||
    result?.output?.text ||
    result?.output?.output?.sentence?.text ||
    ''

  if (!text.trim()) {
    console.warn('DashScope ASR returned empty text. Response:', JSON.stringify(result).slice(0, 500))
    return { text: '', segments: [] }
  }

  // 使用 API 返回的词级时间戳
  const apiWords: DashScopeWord[] = sentence?.words || []

  if (apiWords.length > 0) {
    const words: WordTimestamp[] = apiWords.map(w => ({
      word: w.punctuation ? `${w.text}${w.punctuation}` : w.text,
      // NaN 兜底：上游缺 begin_time/end_time 时 `undefined/1000 = NaN` 会污染时间轴，回退为 0
      start: Number.isFinite(w.begin_time) ? w.begin_time / 1000 : 0,
      end: Number.isFinite(w.end_time) ? w.end_time / 1000 : 0,
    }))
    const segments = groupWordsToSegments(words)
    console.log(`[ASR DashScope] ${words.length} words → ${segments.length} segments`)
    return { text: text.trim(), segments }
  }

  // 回退：使用句子级时间戳
  if (sentence?.begin_time != null && sentence?.end_time != null) {
    const segments: AsrSegment[] = [{
      startMs: sentence.begin_time,
      endMs: sentence.end_time,
      text: text.trim(),
    }]
    return { text: text.trim(), segments }
  }

  // 最后回退：无时间戳，返回纯文本
  console.log('[ASR DashScope] No timestamps available, returning text only')
  return { text: text.trim(), segments: [] }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** Infer audio format from filename extension for DashScope parameters */
function inferAudioFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    mp3: 'mp3', wav: 'wav', m4a: 'm4a', ogg: 'ogg', flac: 'flac',
    webm: 'webm', aac: 'aac', amr: 'amr', avi: 'avi', flv: 'flv',
    mkv: 'mkv', mov: 'mov', mp4: 'mp4', mpeg: 'mpeg', opus: 'opus',
    wma: 'wma', wmv: 'wmv',
  }
  return map[ext || ''] || 'mp3'
}
