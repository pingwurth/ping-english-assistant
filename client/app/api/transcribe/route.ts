import { NextResponse } from 'next/server'
import { readLlmSettings, type LlmSettings } from '@/lib/server-settings'

/** Detect whether the configured provider uses MiMo ASR format */
function isMimoAsr(settings: LlmSettings): boolean {
  return (
    settings.provider === 'mimo' ||
    settings.baseUrl.includes('xiaomimimo.com') ||
    (settings.model || '').startsWith('mimo')
  )
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

/** Transcribe via MiMo ASR (chat/completions + base64 audio) */
async function transcribeMimo(
  audioFile: File,
  settings: LlmSettings,
): Promise<{ text: string; segments: Array<{ startMs: number; endMs: number; text: string }> }> {
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

  // MiMo ASR may not return timestamps — create a single segment
  const segments =
    text.length > 0
      ? [{ startMs: 0, endMs: 0, text: text.trim() }]
      : []

  return { text: text.trim(), segments }
}

/** Transcribe via OpenAI Whisper (multipart form-data → /audio/transcriptions) */
async function transcribeWhisper(
  audioFile: File,
  settings: LlmSettings,
): Promise<{ text: string; segments: Array<{ startMs: number; endMs: number; text: string }> }> {
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
  parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${audioFile.name}"\r\n`))
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

  const segments = (result.segments || []).map(
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

    // Route to MiMo ASR or OpenAI Whisper based on provider
    const { text, segments } = isMimoAsr(settings)
      ? await transcribeMimo(audioFile, settings)
      : await transcribeWhisper(audioFile, settings)

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
