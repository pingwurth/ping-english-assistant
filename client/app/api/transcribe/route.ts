/**
 * 语音转写 API 路由（BFF）—— 统一调用 ASR 服务
 *
 * 使用 LLM 服务层统一封装，消除 provider 分支判断。
 * WhisperX 对齐和时间戳回退逻辑保持不变（非 LLM 调用）。
 */

import { NextResponse } from 'next/server'
import { readLlmSettings, readLlmConfigById } from '@/lib/server-settings'
import { transcribe, getAsrProviderType, LlmError } from '@/lib/llm'
import type { AsrModelConfig, AsrSegment } from '@/lib/llm'
import {
  getDefaultModel,
  DEFAULT_WHISPER_ALIGN_URL,
} from '@/lib/service-endpoints'

// ---------------------------------------------------------------------------
// WhisperX forced alignment
// ---------------------------------------------------------------------------

interface WordTimestamp {
  word: string
  start: number // seconds
  end: number // seconds
}

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
    const timeout = setTimeout(() => controller.abort(), 120_000)

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
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('WhisperX alignment timed out')
    } else {
      console.warn('WhisperX alignment unavailable:', err)
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Fallback: sentence splitting + proportional timestamp distribution
// ---------------------------------------------------------------------------

/** Split text into sentences by punctuation */
function splitIntoSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/)
  const sentences: string[] = []

  for (const s of raw) {
    const trimmed = s.trim()
    if (!trimmed) continue

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
function distributeTimestamps(sentences: string[], totalDurationMs: number): AsrSegment[] {
  if (sentences.length === 0) return []

  const wordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length)
  const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1

  const segments: AsrSegment[] = []
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

/** Estimate audio duration from file headers or file size */
function estimateAudioDurationMs(buffer: ArrayBuffer, file: File): number {
  const wavMs = probeWavDurationMs(buffer)
  if (wavMs !== null) return wavMs

  const bytesPerSecond = 16_000
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
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
    }

    const configId = formData.get('configId') as string | null
    const settings = configId
      ? await readLlmConfigById(configId)
      : await readLlmSettings()
    if (!settings) {
      return NextResponse.json({ error: 'LLM settings not configured' }, { status: 400 })
    }

    // ── 构建 ASR 配置 ───────────────────────────────────────
    const providerType = getAsrProviderType(settings)
    const asrConfig: AsrModelConfig = {
      provider: settings.provider || 'dashscope',
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.asrModel || getDefaultModel(settings.provider || 'dashscope', 'asr'),
      endpoint: settings.asrEndpoint,
      whisperAlignUrl: settings.whisperAlignUrl,
    }

    // ── 调用 ASR 服务 ───────────────────────────────────────
    let result = await transcribe(audioFile, asrConfig)

    // ── 时间戳后处理（multimodal 模型且无时间戳时） ────────────
    if (providerType === 'multimodal' && result.segments.length === 0 && result.text.trim()) {
      // 尝试 WhisperX 对齐
      const alignUrl = settings.whisperAlignUrl || DEFAULT_WHISPER_ALIGN_URL
      const words = await alignWithWhisperX(audioFile, result.text.trim(), alignUrl)

      if (words && words.length > 0) {
        // WhisperX alignment succeeded — group words into sentence segments
        const sentenceEnders = /[.!?]/
        const clauseBreaks = /[,;:]/
        const segments: AsrSegment[] = []
        let currentWords: WordTimestamp[] = []

        for (const word of words) {
          currentWords.push(word)
          const cleanWord = word.word.trim()
          const isSentenceEnd = sentenceEnders.test(cleanWord)
          const isLongClause = clauseBreaks.test(cleanWord) && currentWords.length >= 8

          if (isSentenceEnd || isLongClause) {
            segments.push({
              startMs: Math.round((currentWords[0]?.start ?? 0) * 1000),
              endMs: Math.round((currentWords[currentWords.length - 1]?.end ?? 0) * 1000),
              text: currentWords.map(w => w.word.trim()).join(' ').trim(),
            })
            currentWords = []
          }
        }

        if (currentWords.length > 0) {
          if (segments.length > 0 && currentWords.length <= 3) {
            const last = segments[segments.length - 1]
            segments[segments.length - 1] = {
              startMs: last.startMs,
              endMs: Math.round((currentWords[currentWords.length - 1]?.end ?? 0) * 1000),
              text: `${last.text} ${currentWords.map(w => w.word.trim()).join(' ').trim()}`,
            }
          } else {
            segments.push({
              startMs: Math.round((currentWords[0]?.start ?? 0) * 1000),
              endMs: Math.round((currentWords[currentWords.length - 1]?.end ?? 0) * 1000),
              text: currentWords.map(w => w.word.trim()).join(' ').trim(),
            })
          }
        }

        console.log(`[Transcribe] WhisperX alignment: ${words.length} words → ${segments.length} segments`)
        result = { text: result.text.trim(), segments }
      } else {
        // 回退：比例分配时间戳
        console.log('[Transcribe] Falling back to proportional timestamp distribution')
        const arrayBuffer = await audioFile.arrayBuffer()
        const durationMs = estimateAudioDurationMs(arrayBuffer, audioFile)
        const sentences = splitIntoSentences(result.text.trim())
        const segments = distributeTimestamps(sentences, durationMs)
        result = { text: result.text.trim(), segments }
      }
    }

    const { text, segments } = result

    return NextResponse.json({
      text,
      durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : 0,
      segments,
    })
  } catch (error) {
    // LLM 服务层错误
    if (error instanceof LlmError) {
      console.error('[Transcribe] LlmError:', error.code, error.message)
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 })
    }

    console.error('Transcribe error:', error)
    const message = error instanceof Error ? error.message : 'Transcription failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
