/** ASR 上游与 WhisperX 共用的音频元数据 / 词级时间轴 / 请求脚手架工具 */
import type { AsrSegment } from './types'
import { LlmError, toLlmError } from './errors'

export interface WordTimestamp {
  word: string
  /** 秒；WhisperX 使用秒，DashScope 转换后也归一到秒 */
  start: number
  end: number
}

/** 从扩展名推断常见音频 MIME；未知扩展名沿用调用方 fallback（通常是 Blob.type） */
export function inferMimeType(filename: string, fallback: string): string {
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

/** 词级时间戳 → 句子级 segments（DashScope 原生时间戳与 WhisperX 对齐共用） */
export function groupWordsToSegments(words: WordTimestamp[]): AsrSegment[] {
  if (words.length === 0) return []

  const segments: AsrSegment[] = []
  const sentenceEnders = /[.!?]/
  const clauseBreaks = /[,;:]/
  let currentWords: WordTimestamp[] = []

  const flush = () => {
    if (currentWords.length === 0) return
    if (segments.length > 0 && currentWords.length <= 3) {
      const last = segments[segments.length - 1]!
      const merged = buildSegment(currentWords)
      segments[segments.length - 1] = {
        startMs: last.startMs,
        endMs: merged.endMs,
        text: `${last.text} ${merged.text}`,
      }
    } else {
      segments.push(buildSegment(currentWords))
    }
    currentWords = []
  }

  for (const word of words) {
    currentWords.push(word)
    const cleanWord = word.word.trim()
    const isSentenceEnd = sentenceEnders.test(cleanWord)
    const isLongClause = clauseBreaks.test(cleanWord) && currentWords.length >= 8
    if (isSentenceEnd || isLongClause) flush()
  }
  flush()

  return segments
}

function buildSegment(words: WordTimestamp[]): AsrSegment {
  // NaN 守卫：上游缺字段时 start/end 可能是 NaN（`?? 0` 只拦 null/undefined），
  // Math.round(NaN * 1000) = NaN 会污染时间轴并让字幕卡在第 0 秒
  const rawStart = words[0]?.start
  const rawEnd = words[words.length - 1]?.end
  return {
    startMs: Number.isFinite(rawStart) ? Math.round((rawStart as number) * 1000) : 0,
    endMs: Number.isFinite(rawEnd) ? Math.round((rawEnd as number) * 1000) : 0,
    text: words.map((w) => w.word.trim()).join(' ').trim(),
  }
}

// ---------------------------------------------------------------------------
// ASR 上游请求脚手架（mimo / dashscope 两 provider 共用；原两份逐字拷贝已漂移）
// ---------------------------------------------------------------------------

/** ASR 上游硬超时：整段音频转写慢于即时对话，给 180s（与 WhisperX 对齐预算同量级） */
export const ASR_TIMEOUT_MS = 180_000

/** File → base64 data:URL（两 provider 请求体里 input_audio.data 的通用形态） */
export async function toAudioDataUrl(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mime = inferMimeType(file.name, file.type || 'audio/wav')
  return `data:${mime};base64,${base64}`
}

/**
 * Bearer JSON POST + 取消传播 + 硬超时 + !ok 归一错误（ASR 上游通用）。
 * @param providerLabel 错误文案里的 provider 名（如 'MiMo' / 'DashScope'）
 */
export async function postAsrJson(
  url: string,
  apiKey: string,
  body: unknown,
  providerLabel: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!apiKey) throw new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key')
  // 取消传播 + 硬超时：客户端关页/取消后不再干等上游跑完计费
  const timeoutSignal = AbortSignal.timeout(ASR_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: combined,
  }).catch((err: unknown) => {
    // fetch 抛出的 TimeoutError（硬超时）/ AbortError（客户端取消）经归一转为
    // LlmError，路由层才能给出 504/499 而不是被当成未知异常回 500（评审 #4）
    throw toLlmError(err)
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error(`${providerLabel} ASR error:`, response.status, errorText)
    throw new LlmError('UPSTREAM_ERROR', `${providerLabel} 转写失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }
  return response.json()
}
