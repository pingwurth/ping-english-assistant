import { NextResponse } from 'next/server'
import { readLlmSettings } from '@/lib/server-settings'

/**
 * POST /api/transcribe/local
 *
 * Proxy route: forwards multipart audio to the local faster-whisper
 * transcription server (transcribe_server.py, default port 8766).
 */

const DEFAULT_TRANSCRIBE_URL = 'http://127.0.0.1:8766'
const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes for long audio

/** Read the transcription server URL from settings */
async function getTranscribeUrl(): Promise<string> {
  try {
    const settings = await readLlmSettings()
    return settings?.whisperTranscribeUrl || DEFAULT_TRANSCRIBE_URL
  } catch {
    return DEFAULT_TRANSCRIBE_URL
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
    }

    const transcribeUrl = await getTranscribeUrl()

    // Forward FormData to the Python transcription server
    const forwardForm = new FormData()
    forwardForm.append('audio', audioFile)
    forwardForm.append('language', formData.get('lang')?.toString() || 'en')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(`${transcribeUrl}/transcribe`, {
        method: 'POST',
        body: forwardForm,
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        return NextResponse.json(
          { error: '转写超时，音频文件可能过长' },
          { status: 504 },
        )
      }
      // Server not running or network error
      return NextResponse.json(
        {
          error:
            'faster-whisper 服务未启动。请先运行:\n' +
            '  cd server && ./start.sh --server transcribe\n\n' +
            '或在设置中配置转写服务地址。',
        },
        { status: 503 },
      )
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return NextResponse.json(
        { error: `转写服务错误 (${response.status}): ${errText.slice(0, 300)}` },
        { status: 502 },
      )
    }

    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Local transcribe proxy error:', error)
    const message = error instanceof Error ? error.message : 'Local transcription failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * GET /api/transcribe/local/health
 *
 * Health check: pings the faster-whisper server and returns its status.
 */
export async function GET() {
  const transcribeUrl = await getTranscribeUrl()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${transcribeUrl}/health`, {
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return NextResponse.json(
        { connected: false, error: `Server returned ${response.status}` },
        { status: 200 },
      )
    }

    const data = await response.json()
    return NextResponse.json({ connected: true, ...data })
  } catch {
    return NextResponse.json(
      {
        connected: false,
        url: transcribeUrl,
        error: 'Cannot connect to faster-whisper server',
      },
      { status: 200 },
    )
  }
}
