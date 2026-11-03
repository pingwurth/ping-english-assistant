import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, readLocalServices } from '@/lib/server-settings'
import { MAX_TRANSCRIBE_UPLOAD_BYTES, rejectOversizedUpload } from '@/lib/upload-limit'
import {
  DEFAULT_WHISPER_TRANSCRIBE_URL,
  WHISPER_TRANSCRIBE_ENDPOINT,
  WHISPER_TRANSCRIBE_HEALTH_ENDPOINT,
  buildServiceUrl,
} from '@/lib/service-endpoints'

/**
 * POST /api/transcribe/local
 *
 * 代理路由：把 multipart 音频转发给本地 faster-whisper 转写服务（transcribe_server.py）。
 */

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes for long audio

/**
 * 从设置读取转写服务地址。
 * 设置页「本地服务配置」写入 localServices 段（唯一有效写入口），
 * legacy llm.whisperTranscribeUrl 仅作历史数据 fallback。
 */
async function getTranscribeUrl(): Promise<string> {
  try {
    const ls = await readLocalServices()
    if (ls.whisperTranscribeUrl) return ls.whisperTranscribeUrl
    const settings = await readEffectiveLlmSettings()
    return settings?.whisperTranscribeUrl || DEFAULT_WHISPER_TRANSCRIBE_URL
  } catch {
    return DEFAULT_WHISPER_TRANSCRIBE_URL
  }
}

export async function POST(request: Request) {
  // formData() 会把整个 multipart 缓冲进内存：按声明体积提前拒绝（c055）
  const oversized = rejectOversizedUpload(request, MAX_TRANSCRIBE_UPLOAD_BYTES)
  if (oversized) return oversized
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio')

    if (!(audioFile instanceof Blob)) {
      return NextResponse.json({ error: 'Missing or invalid audio file' }, { status: 400 })
    }
    // 真实字节二次闸（与 /api/transcribe 对齐）：chunked 上传不带 Content-Length 可绕过
    // 声明预检，按已解析出的实际体积拦截，避免超大音频整段缓冲后转发给 whisper 服务
    if (audioFile.size > MAX_TRANSCRIBE_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `上传内容过大（上限 ${Math.round(MAX_TRANSCRIBE_UPLOAD_BYTES / 1048576)} MB）` },
        { status: 413 },
      )
    }

    const transcribeUrl = await getTranscribeUrl()

    // Forward FormData to the Python transcription server
    const forwardForm = new FormData()
    forwardForm.append('audio', audioFile, audioFile instanceof File ? audioFile.name : 'audio')
    forwardForm.append('language', formData.get('lang')?.toString() || 'en')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(buildServiceUrl(transcribeUrl, WHISPER_TRANSCRIBE_ENDPOINT), {
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

    const response = await fetch(buildServiceUrl(transcribeUrl, WHISPER_TRANSCRIBE_HEALTH_ENDPOINT), {
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
