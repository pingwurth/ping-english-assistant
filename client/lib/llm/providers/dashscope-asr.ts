/**
 * DashScope ASR Provider —— 阿里云原生 multimodal-generation API
 *
 * 使用 qwen-audio 系列模型的原生 API，返回文本和词级时间戳。
 * 请求脚手架（鉴权/超时/取消/错误归一/data-URL 构造）见 asr-audio.ts 共享实现。
 */

import type { AsrModelConfig, AsrResult, AsrSegment } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { groupWordsToSegments, postAsrJson, toAudioDataUrl, type WordTimestamp } from '../asr-audio'

interface DashScopeWord {
  begin_time: number
  end_time: number
  text: string
  punctuation?: string
}


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
  // 配置解析只有一处真源（评审 #8）：路由层已保证 model 非空，这里不再拿
  // 别家默认模型名二次兜底 —— 兜底会把 qwen 模型发给用户自建 baseUrl
  if (!config.model) {
    throw new LlmError('MODEL_NOT_CONFIGURED', '请先在设置页配置转写（ASR）模型')
  }
  const model = config.model
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'dashscope', 'asr')

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
              input_audio: { data: await toAudioDataUrl(audioFile) },
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

  const result = (await postAsrJson(url, config.apiKey, body, 'DashScope', signal)) as {
    sentence?: { text?: string; begin_time?: number; end_time?: number; words?: DashScopeWord[] }
    output?: { text?: string; output?: { sentence?: { text?: string } } }
  }

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

/** 按文件扩展名推断音频格式（DashScope 参数用） */
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
