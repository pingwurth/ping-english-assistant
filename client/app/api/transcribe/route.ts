import { NextResponse } from 'next/server'
import { readLlmSettings } from '@/lib/server-settings'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Missing audio file' },
        { status: 400 }
      )
    }

    const settings = await readLlmSettings()
    if (!settings) {
      return NextResponse.json(
        { error: 'LLM settings not configured' },
        { status: 400 }
      )
    }

    // Use selected model or fall back to provider name
    const modelName = settings.model || settings.provider

    // Build the transcription endpoint URL
    let baseUrl = settings.baseUrl.replace(/\/+$/, '')
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = `${baseUrl}/v1`
    }

    // Use custom endpoint if provided, otherwise default to /audio/transcriptions
    const endpoint = settings.endpoint || '/audio/transcriptions'
    const url = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

    // Convert File to buffer for the request
    const arrayBuffer = await audioFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Build multipart form data manually for the upstream API
    const boundary = `----FormBoundary${Date.now()}`
    const parts: Buffer[] = []

    // Add model field
    parts.push(Buffer.from(`--${boundary}\r\n`))
    parts.push(Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`))
    parts.push(Buffer.from(`${modelName}\r\n`))

    // Add file field
    parts.push(Buffer.from(`--${boundary}\r\n`))
    parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${audioFile.name}"\r\n`))
    parts.push(Buffer.from(`Content-Type: ${audioFile.type || 'audio/mpeg'}\r\n\r\n`))
    parts.push(buffer)
    parts.push(Buffer.from(`\r\n`))

    // Add response_format field to get verbose JSON with timestamps
    parts.push(Buffer.from(`--${boundary}\r\n`))
    parts.push(Buffer.from(`Content-Disposition: form-data; name="response_format"\r\n\r\n`))
    parts.push(Buffer.from(`verbose_json\r\n`))

    // Close boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('Transcribe API error:', response.status, errorText)

      // Provide helpful error messages
      if (response.status === 404) {
        return NextResponse.json(
          {
            error: `转写接口不存在 (${url})。请检查：
1. Base URL 是否正确
2. 该 provider 是否支持音频转写
3. 自定义端点路径是否正确（默认: /audio/transcriptions）`,
          },
          { status: 404 }
        )
      }

      return NextResponse.json(
        { error: `转写失败 (${response.status}): ${errorText.slice(0, 200)}` },
        { status: response.status }
      )
    }

    const result = await response.json()

    // Handle different response formats
    // OpenAI verbose_json format includes segments
    const segments = (result.segments || []).map((seg: { start: number; end: number; text: string }) => ({
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text.trim(),
    }))

    // If no segments, create a single segment from the full text
    if (segments.length === 0 && result.text) {
      segments.push({
        startMs: 0,
        endMs: 0,
        text: result.text.trim(),
      })
    }

    return NextResponse.json({
      text: result.text || '',
      durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : 0,
      segments,
    })
  } catch (error) {
    console.error('Transcribe error:', error)
    const message = error instanceof Error ? error.message : 'Transcription failed'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
