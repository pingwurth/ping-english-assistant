/**
 * 语音转写 API 路由（BFF）—— 统一调用 ASR 服务
 *
 * 使用 LLM 服务层统一封装，消除 provider 分支判断。
 * WhisperX 对齐和时间戳回退逻辑保持不变（非 LLM 调用）。
 */

import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, readLlmConfigById, readLocalServices } from '@/lib/server-settings'
import { MAX_TRANSCRIBE_UPLOAD_BYTES, rejectOversizedUpload } from '@/lib/upload-limit'
import { parseWavDurationMs } from '@/lib/wav-duration'
import { groupWordsToSegments, type WordTimestamp } from '@/lib/llm/asr-audio'
import { transcribe, LlmError, toLlmErrorResponse } from '@/lib/llm'
import type { AsrModelConfig, AsrSegment } from '@/lib/llm'
import {
  getDefaultModel,
  DEFAULT_WHISPER_ALIGN_URL,
  WHISPER_ALIGN_ENDPOINT,
  buildServiceUrl,
} from '@/lib/service-endpoints'

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
    const timeout = setTimeout(() => controller.abort(), 120_000)

    // fetch 抛错（连接失败等）时也要清掉定时器：否则悬挂 120s 且误 abort 已复用的 signal
    const response = await fetch(buildServiceUrl(alignUrl, WHISPER_ALIGN_ENDPOINT), {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

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
  const wavMs = parseWavDurationMs(buffer)
  if (wavMs !== null) return wavMs

  const bytesPerSecond = 16_000
  return Math.round((file.size / bytesPerSecond) * 1000)
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // formData() 会把整个 multipart 缓冲进内存：按声明体积提前拒绝（c055）
  const oversized = rejectOversizedUpload(request, MAX_TRANSCRIBE_UPLOAD_BYTES)
  if (oversized) return oversized
  try {
    const formData = await request.formData()
    // 运行时类型校验（评审 #25）：文本字段穿透到下游会以引擎内部 TypeError 500 收场，
    // 对照 soe/evaluate 的 instanceof Blob 校验，这里给干净的 400
    const audioFile = formData.get('audio')

    if (!(audioFile instanceof Blob)) {
      return NextResponse.json({ error: 'Missing or invalid audio file' }, { status: 400 })
    }
    // 真实字节二次闸：Content-Length 可被 chunked 伪造绕过声明预检，这里按已解析出的
    // 实际体积拦截，避免超大音频进入 base64（内存膨胀 3 份）与上游计费
    if (audioFile.size > MAX_TRANSCRIBE_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `上传内容过大（上限 ${Math.round(MAX_TRANSCRIBE_UPLOAD_BYTES / 1048576)} MB）` },
        { status: 413 },
      )
    }

    const configId = formData.get('configId') as string | null
    const settings = configId
      ? await readLlmConfigById(configId)
      : await readEffectiveLlmSettings()
    if (!settings) {
      return NextResponse.json({ error: 'LLM settings not configured' }, { status: 400 })
    }

    // ── 构建 ASR 配置 ───────────────────────────────────────
    const asrConfig: AsrModelConfig = {
      provider: settings.provider || 'dashscope',
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.asrModel || getDefaultModel(settings.provider || 'dashscope', 'asr'),
      endpoint: settings.asrEndpoint,
      whisperAlignUrl: settings.whisperAlignUrl,
    }

    // ── 调用 ASR 服务（传播客户端取消；provider 内部再叠加硬超时）────────
    let result = await transcribe(audioFile, asrConfig, request.signal)

    // ── 时间戳后处理（ASR 未返回时间戳时；不分 provider） ────────────
    // 曾按 providerType='standard' 信任「必带时间轴」，但 dashscope 非 qwen-audio
    // 模型实际可能不带 → 转写「成功」却产出空 SRT（2026-11 全仓复审）。只要识别出了
    // 文本而 segments 为空，一律走 WhisperX 对齐 / 比例分配兜底。
    if (result.segments.length === 0 && result.text.trim()) {
      // 尝试 WhisperX 对齐（地址优先取设置页「本地服务配置」的 localServices 段）
      const localServices = await readLocalServices()
      const alignUrl = localServices.whisperAlignUrl || settings.whisperAlignUrl || DEFAULT_WHISPER_ALIGN_URL
      const words = await alignWithWhisperX(audioFile, result.text.trim(), alignUrl)

      if (words && words.length > 0) {
        const segments = groupWordsToSegments(words)
        console.log(`[Transcribe] WhisperX alignment: ${words.length} words → ${segments.length} segments`)
        result = { text: result.text.trim(), segments }
      } else {
        // 回退：比例分配时间戳
        console.log('[Transcribe] Falling back to proportional timestamp distribution')
        // 时长优先用客户端实测（媒体 metadata，durationMs 字段随请求上传）：按字节估算
        // 只对 ~128kbps 压缩音频近似，高码率 MP3 会估出 2 倍时长并烤进 SRT
        const requestedMs = Number(formData.get('durationMs'))
        const durationMs = Number.isFinite(requestedMs) && requestedMs > 0
          ? requestedMs
          : estimateAudioDurationMs(await audioFile.arrayBuffer(), audioFile)
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
      // 状态码映射与 translate/mnemonic 统一（评审 #48：原先一律 500，
      // 「API Key 未配置」在转写路由被误报为服务故障）
      return toLlmErrorResponse(error)
    }

    console.error('Transcribe error:', error)
    const message = error instanceof Error ? error.message : 'Transcription failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
