import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, resolveLocalServiceUrl } from '@/lib/server-settings'
import { sameOriginGuard } from '@/lib/api-guard'
import { MAX_TRANSCRIBE_UPLOAD_BYTES, rejectOversizedBlob, rejectOversizedUpload } from '@/lib/upload-limit'
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
 * 从设置解析转写服务地址。
 * 优先级统一走 resolveLocalServiceUrl（localServices 段 → legacy 配置字段 → 默认）；
 * legacy 档取 effective 配置（本路由无 per-request configId）。读设置失败回落默认地址。
 */
async function getTranscribeUrl(): Promise<string> {
  try {
    const settings = await readEffectiveLlmSettings()
    return await resolveLocalServiceUrl('transcribe', settings?.whisperTranscribeUrl)
  } catch {
    return DEFAULT_WHISPER_TRANSCRIBE_URL
  }
}

export async function POST(request: Request) {
  // 同源守卫（评审 #2）：避免恶意局域网页 CSRF 驱动本机 faster-whisper 干跑推理
  const denied = sameOriginGuard(request)
  if (denied) return denied
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
    const oversizedBlob = rejectOversizedBlob(audioFile, MAX_TRANSCRIBE_UPLOAD_BYTES)
    if (oversizedBlob) return oversizedBlob

    const transcribeUrl = await getTranscribeUrl()

    // Forward FormData to the Python transcription server
    const forwardForm = new FormData()
    forwardForm.append('audio', audioFile, audioFile instanceof File ? audioFile.name : 'audio')
    // lang 运行时类型校验（与 /api/transcribe 口径对齐）：传 File 等非字符串时
    // toString() 会得到「[object File]」直接当 language 转发给 Python
    const langRaw = formData.get('lang')
    forwardForm.append('language', typeof langRaw === 'string' && langRaw ? langRaw : 'en')

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
export async function GET(request: Request) {
  // 探活 GET 同样收口（评审 #2）：浏览器跨源 GET 带异源 Origin 会被拦；
  // skipSafeMethods 不适用于本应用——同源无 Origin 的 curl 探测仍然放行
  const denied = sameOriginGuard(request)
  if (denied) return denied
  const transcribeUrl = await getTranscribeUrl()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    // 探活失败（连接拒绝等）时 fetch 直接抛错，成功路径的 clearTimeout 跑不到；
    // 与同一仓 transcribe/route.ts 的口径，用 finally 统一清理悬挂定时器（评审 #14）
    const response = await fetch(buildServiceUrl(transcribeUrl, WHISPER_TRANSCRIBE_HEALTH_ENDPOINT), {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

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
