import { NextResponse } from 'next/server'
import { readLlmSettings, type LlmSettings } from '@/lib/server-settings'

interface WordTimestamp {
  word: string
  start: number // seconds
  end: number // seconds
}

interface SegmentResult {
  startMs: number
  endMs: number
  text: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect whether the model should use chat completions for audio transcription */
function isAudioChatModel(settings: LlmSettings): boolean {
  const model = (settings.model || '').toLowerCase()
  const baseUrl = settings.baseUrl.toLowerCase()

  // MiMo ASR models
  if (
    settings.provider === 'mimo' ||
    baseUrl.includes('xiaomimimo.com') ||
    model.startsWith('mimo')
  ) {
    return true
  }

  // DashScope qwen-audio models (ASR and realtime)
  if (model.startsWith('qwen-audio')) {
    return true
  }

  return false
}

/** Detect the audio chat API format based on provider/model */
function detectAudioChatFormat(settings: LlmSettings): 'mimo' | 'dashscope' {
  const model = (settings.model || '').toLowerCase()
  const baseUrl = settings.baseUrl.toLowerCase()

  if (
    settings.provider === 'mimo' ||
    baseUrl.includes('xiaomimimo.com') ||
    model.startsWith('mimo')
  ) {
    return 'mimo'
  }

  return 'dashscope'
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

/** Build the base URL, ensuring /v1 suffix */
function buildBaseUrl(raw: string): string {
  let base = raw.replace(/\/+$/, '')
  if (!base.endsWith('/v1')) {
    base = `${base}/v1`
  }
  return base
}

// ---------------------------------------------------------------------------
// WhisperX forced alignment
// ---------------------------------------------------------------------------

/** Call local WhisperX alignment service to get word-level timestamps */
async function alignWithWhisperX(
  audioFile: File,
  text: string,
  alignUrl: string,
): Promise<WordTimestamp[] | null> {
  try {
    const formData = new FormData()
    formData.append('audio', audioFile)
    formData.append('text', text)
    formData.append('language', 'en')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000) // 2min timeout

    const response = await fetch(`${alignUrl}/align`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.warn('WhisperX alignment failed:', response.status, errText)
      return null
    }

    const result = await response.json()
    const words: WordTimestamp[] = result.words || []

    if (words.length === 0) {
      console.warn('WhisperX returned no words')
      return null
    }

    return words
  } catch (err) {
    // Service not running or network error — silently fall back
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('WhisperX alignment timed out')
    } else {
      console.warn('WhisperX alignment unavailable:', err)
    }
    return null
  }
}

/** Group word-level timestamps into sentence-level segments */
function groupWordsToSegments(words: WordTimestamp[]): SegmentResult[] {
  if (words.length === 0) return []

  const segments: SegmentResult[] = []
  const sentenceEnders = /[.!?]/
  const clauseBreaks = /[,;:]/

  let currentWords: WordTimestamp[] = []

  for (const word of words) {
    currentWords.push(word)

    const cleanWord = word.word.trim()
    const isSentenceEnd = sentenceEnders.test(cleanWord)
    const isLongClause = clauseBreaks.test(cleanWord) && currentWords.length >= 8

    if (isSentenceEnd || isLongClause) {
      segments.push(_buildSegment(currentWords))
      currentWords = []
    }
  }

  // Flush remaining words
  if (currentWords.length > 0) {
    // If we already have segments and this is just a few leftover words, merge
    if (segments.length > 0 && currentWords.length <= 3) {
      const last = segments[segments.length - 1]
      const merged = _buildSegment(currentWords)
      segments[segments.length - 1] = {
        startMs: last.startMs,
        endMs: merged.endMs,
        text: `${last.text} ${merged.text}`,
      }
    } else {
      segments.push(_buildSegment(currentWords))
    }
  }

  return segments
}

function _buildSegment(words: WordTimestamp[]): SegmentResult {
  return {
    startMs: Math.round((words[0]?.start ?? 0) * 1000),
    endMs: Math.round((words[words.length - 1]?.end ?? 0) * 1000),
    text: words.map(w => w.word.trim()).join(' ').trim(),
  }
}

// ---------------------------------------------------------------------------
// Fallback: sentence splitting + proportional timestamp distribution
// ---------------------------------------------------------------------------

/** Split text into sentences by punctuation */
function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation
  const raw = text.split(/(?<=[.!?])\s+/)
  const sentences: string[] = []

  for (const s of raw) {
    const trimmed = s.trim()
    if (!trimmed) continue

    // If sentence is too long, split on clause breaks
    if (trimmed.length > 100) {
      const clauses = trimmed.split(/(?<=[,;])\s+/)
      let buffer = ''
      for (const clause of clauses) {
        if (buffer && buffer.length + clause.length > 100) {
          sentences.push(buffer.trim())
          buffer = clause
        } else {
          buffer = buffer ? `${buffer} ${clause}` : clause
        }
      }
      if (buffer.trim()) sentences.push(buffer.trim())
    } else {
      sentences.push(trimmed)
    }
  }

  // Merge very short fragments into the previous sentence
  const merged: string[] = []
  for (const s of sentences) {
    if (merged.length > 0 && s.length < 10) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${s}`
    } else {
      merged.push(s)
    }
  }

  return merged.length > 0 ? merged : [text.trim()]
}

/** Distribute timestamps proportionally by word count */
function distributeTimestamps(sentences: string[], totalDurationMs: number): SegmentResult[] {
  if (sentences.length === 0) return []

  // Count words per sentence
  const wordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length)
  const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1

  const segments: SegmentResult[] = []
  let currentMs = 0

  for (let i = 0; i < sentences.length; i++) {
    const ratio = wordCounts[i] / totalWords
    const durationMs = Math.round(totalDurationMs * ratio)
    const startMs = currentMs
    const endMs = i === sentences.length - 1 ? totalDurationMs : currentMs + durationMs

    segments.push({ startMs, endMs, text: sentences[i] })
    currentMs = endMs
  }

  return segments
}

// ---------------------------------------------------------------------------
// MiMo ASR + alignment pipeline
// ---------------------------------------------------------------------------

/** Transcribe via MiMo ASR, then align timestamps via WhisperX or fallback */
async function transcribeMimo(
  audioFile: File,
  settings: LlmSettings,
): Promise<{ text: string; segments: SegmentResult[] }> {
  // Step 1: Get transcription text from MiMo ASR
  const modelName = settings.model || 'mimo-v2.5-asr'
  const baseUrl = buildBaseUrl(settings.baseUrl)
  const url = `${baseUrl}/chat/completions`

  const arrayBuffer = await audioFile.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mime = inferMimeType(audioFile.name, audioFile.type || 'audio/wav')

  const body = {
    model: modelName,
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error('MiMo ASR error:', response.status, errorText)
    throw new Error(`MiMo 转写失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const result = await response.json()
  const text: string = result.choices?.[0]?.message?.content || ''

  if (!text.trim()) {
    return { text: '', segments: [] }
  }

  // Step 2: Try WhisperX forced alignment for precise timestamps
  const alignUrl = settings.whisperAlignUrl || 'http://127.0.0.1:8765'
  const words = await alignWithWhisperX(audioFile, text.trim(), alignUrl)

  if (words && words.length > 0) {
    // WhisperX alignment succeeded — group words into sentence segments
    const segments = groupWordsToSegments(words)
    console.log(`WhisperX alignment: ${words.length} words → ${segments.length} segments`)
    return { text: text.trim(), segments }
  }

  // Step 3: Fallback — estimate duration + proportional timestamp distribution
  console.log('Falling back to proportional timestamp distribution')
  const durationMs = estimateAudioDurationMs(arrayBuffer, audioFile)
  const sentences = splitIntoSentences(text.trim())
  const segments = distributeTimestamps(sentences, durationMs)

  return { text: text.trim(), segments }
}

/** Estimate audio duration from file headers or file size */
function estimateAudioDurationMs(buffer: ArrayBuffer, file: File): number {
  // Try WAV header parsing
  const wavMs = probeWavDurationMs(buffer)
  if (wavMs !== null) return wavMs

  // Fallback: estimate by file size (128kbps for mp3/m4a)
  const bytesPerSecond = 16_000 // ~128kbps
  return Math.round((file.size / bytesPerSecond) * 1000)
}

/** Parse WAV file header for exact duration */
function probeWavDurationMs(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 44) return null
  const dv = new DataView(buf)

  const tag = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(buf, off, len))

  if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WAVE') return null

  const channels = dv.getUint16(22, true)
  const sampleRate = dv.getUint32(24, true)
  const blockAlign = dv.getUint16(32, true)
  if (!channels || !sampleRate || !blockAlign) return null

  // Walk chunks to find 'data'
  let off = 12
  while (off + 8 <= buf.byteLength) {
    const id = tag(off, 4)
    const size = dv.getUint32(off + 4, true)
    if (id === 'data') {
      return Math.round((size / blockAlign / sampleRate) * 1000)
    }
    off += 8 + size + (size & 1)
  }
  return null
}

// ---------------------------------------------------------------------------
// DashScope qwen-audio — native multimodal-generation API
// ---------------------------------------------------------------------------

/**
 * Derive the DashScope native API root from the configured base URL.
 * Handles both standard DashScope (`dashscope.aliyuncs.com`) and
 * token-plan endpoints (`token-plan.cn-beijing.maas.aliyuncs.com`).
 */
function deriveDashScopeRoot(baseUrl: string): string {
  let root = baseUrl.replace(/\/+$/, '')
  // Strip OpenAI-compatible path suffixes
  root = root.replace(/\/compatible-mode\/v1$/i, '')
  root = root.replace(/\/v1$/i, '')
  return root
}

/** Transcribe via DashScope qwen-audio native multimodal-generation API */
async function transcribeDashScopeAudio(
  audioFile: File,
  settings: LlmSettings,
): Promise<{ text: string; segments: SegmentResult[] }> {
  const modelName = settings.model || 'qwen-audio-3.0-asr-flash'
  const root = deriveDashScopeRoot(settings.baseUrl)
  const url = `${root}/api/v1/services/aigc/multimodal-generation/generation`

  const arrayBuffer = await audioFile.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mime = inferMimeType(audioFile.name, audioFile.type || 'audio/wav')

  // DashScope native API uses input.messages with input_audio
  const body = {
    model: modelName,
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

  console.log(`DashScope ASR: POST ${url} (model=${modelName}, audio=${(audioFile.size / 1024).toFixed(0)}KB)`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error('DashScope audio error:', response.status, errorText)
    throw new Error(`转写失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const result = await response.json()

  // Response format: { sentence: { text, begin_time, end_time, words: [...] } }
  // or per docs: { output: { text, output: { sentence: { text } } } }
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

  // Use word-level timestamps from the API if available
  const apiWords: Array<{ begin_time: number; end_time: number; text: string; punctuation?: string }> =
    sentence?.words || []

  if (apiWords.length > 0) {
    // Convert API word timestamps (ms) to our WordTimestamp format (seconds)
    // Append punctuation to word text so groupWordsToSegments can detect sentence boundaries
    const words: WordTimestamp[] = apiWords.map(w => ({
      word: w.punctuation ? `${w.text}${w.punctuation}` : w.text,
      start: w.begin_time / 1000,
      end: w.end_time / 1000,
    }))
    const segments = groupWordsToSegments(words)
    console.log(`DashScope ASR: ${words.length} words → ${segments.length} segments`)
    return { text: text.trim(), segments }
  }

  // Fallback: use sentence-level timestamps
  if (sentence?.begin_time != null && sentence?.end_time != null) {
    const segments: SegmentResult[] = [{
      startMs: sentence.begin_time,
      endMs: sentence.end_time,
      text: text.trim(),
    }]
    return { text: text.trim(), segments }
  }

  // Last resort: proportional distribution
  console.log('Falling back to proportional timestamp distribution')
  const durationMs = estimateAudioDurationMs(arrayBuffer, audioFile)
  const sentences = splitIntoSentences(text.trim())
  const segments = distributeTimestamps(sentences, durationMs)

  return { text: text.trim(), segments }
}

/** Infer audio format from filename extension for DashScope parameters */
function inferAudioFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    mp3: 'mp3',
    wav: 'wav',
    m4a: 'm4a',
    ogg: 'ogg',
    flac: 'flac',
    webm: 'webm',
    aac: 'aac',
    amr: 'amr',
    avi: 'avi',
    flv: 'flv',
    mkv: 'mkv',
    mov: 'mov',
    mp4: 'mp4',
    mpeg: 'mpeg',
    opus: 'opus',
    wma: 'wma',
    wmv: 'wmv',
  }
  return map[ext || ''] || 'mp3'
}

// ---------------------------------------------------------------------------
// Whisper (OpenAI-compatible) — unchanged
// ---------------------------------------------------------------------------

/** Transcribe via OpenAI Whisper (multipart form-data → /audio/transcriptions) */
async function transcribeWhisper(
  audioFile: File,
  settings: LlmSettings,
): Promise<{ text: string; segments: SegmentResult[] }> {
  const modelName = settings.model || settings.provider
  const baseUrl = buildBaseUrl(settings.baseUrl)
  const endpoint = settings.endpoint || '/audio/transcriptions'
  const url = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  const arrayBuffer = await audioFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Build multipart form data manually
  const boundary = `----FormBoundary${Date.now()}`
  const parts: Buffer[] = []

  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`))
  parts.push(Buffer.from(`${modelName}\r\n`))

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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error('Whisper API error:', response.status, errorText)

    if (response.status === 404) {
      throw new Error(
        `转写接口不存在 (${url})。请检查：\n1. Base URL 是否正确\n2. 该 provider 是否支持音频转写\n3. 自定义端点路径是否正确（默认: /audio/transcriptions）`,
      )
    }
    throw new Error(`转写失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const result = await response.json()

  const segments: SegmentResult[] = (result.segments || []).map(
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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
    }

    const settings = await readLlmSettings()
    if (!settings) {
      return NextResponse.json({ error: 'LLM settings not configured' }, { status: 400 })
    }

    // Route to appropriate transcription method
    let result: { text: string; segments: SegmentResult[] }

    if (isAudioChatModel(settings)) {
      const format = detectAudioChatFormat(settings)
      if (format === 'mimo') {
        result = await transcribeMimo(audioFile, settings)
      } else {
        result = await transcribeDashScopeAudio(audioFile, settings)
      }
    } else {
      result = await transcribeWhisper(audioFile, settings)
    }

    const { text, segments } = result

    return NextResponse.json({
      text,
      durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : 0,
      segments,
    })
  } catch (error) {
    console.error('Transcribe error:', error)
    const message = error instanceof Error ? error.message : 'Transcription failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
