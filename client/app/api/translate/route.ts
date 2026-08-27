/**
 * 翻译 API 路由（BFF）—— 调用 OpenAI-compatible chat 接口批量翻译文本
 *
 * 请求：{ texts: string[], direction?: 'auto' | 'en2zh' | 'zh2en', configId?: string }
 * 响应：{ translations: string[] }（与输入等长）
 *
 * 设计参照：
 *  - /api/tts：配置读取（readLlmSettings / readLlmConfigById）+ 端点拼接 + 错误归一
 *  - /api/transcribe：AbortController + setTimeout 超时
 */

import { NextResponse } from 'next/server'
import { readLlmSettings, readLlmConfigById } from '@/lib/server-settings'
import type { TranslateDirection, TranslateRequest } from '@/types/api'

/** 单次请求文本条数上限 */
const MAX_TEXTS = 500
/** 单次上游调用超时（毫秒） */
const REQUEST_TIMEOUT_MS = 120_000
/** 服务端方向判定的抽样条数 */
const DIRECTION_SAMPLE_SIZE = 20
/** CJK 判定正则（覆盖扩展部首至基本汉字区） */
const CJK_RE = /[\u2E80-\u9FFF]/

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 端点拼接：baseUrl 去尾部 `/` + endpoint（缺省 /chat/completions，缺前导 `/` 时补上） */
function buildTranslateUrl(baseUrl: string, endpoint?: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const ep = endpoint || '/chat/completions'
  return `${trimmed}${ep.startsWith('/') ? '' : '/'}${ep}`
}

/** 服务端方向自动判定：抽样文本含 CJK → zh2en，否则 en2zh */
function detectDirectionOnServer(texts: string[]): TranslateDirection {
  const sample = texts.slice(0, DIRECTION_SAMPLE_SIZE)
  return sample.some((t) => CJK_RE.test(t)) ? 'zh2en' : 'en2zh'
}

/**
 * 从 LLM content 中提取 JSON 字符串数组。
 * 容错：剥掉可能的 ```json 包裹；截取首个 `[` 至末个 `]` 再解析。
 * 校验：长度与输入一致且每项为非空字符串；不通过返回 null。
 */
function extractTranslations(content: string, expectedLength: number): string[] | null {
  let text = content.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) text = fence[1].trim()

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null

  let arr: unknown
  try {
    arr = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(arr) || arr.length !== expectedLength) return null
  if (!arr.every((v) => typeof v === 'string' && v.trim().length > 0)) return null

  return arr.map((v) => (v as string).trim())
}

/**
 * 单次上游调用：返回解析校验后的译文数组；条数不一致返回 null（触发重试）。
 * 上游 HTTP 错误 / 网络错误抛出带中文提示的 Error。
 */
async function translateOnce(
  url: string,
  apiKey: string,
  model: string,
  texts: string[],
  direction: TranslateDirection,
  signal: AbortSignal,
): Promise<string[] | null> {
  const targetLang = direction === 'zh2en' ? '英文' : '简体中文'
  const systemPrompt =
    `你是专业翻译。用户消息是一个 JSON 字符串数组，请将其逐条翻译为${targetLang}。` +
    '只返回与输入等长的 JSON 字符串数组，禁止增删条目、禁止 markdown 包裹、禁止任何额外文字。'

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(texts) },
      ],
    }),
    signal,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const errBody = await res.json()
      detail = errBody.error?.message || errBody.message || JSON.stringify(errBody)
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 500)
    }
    throw new Error(`翻译接口调用失败 (${res.status})：${detail}`.slice(0, 600))
  }

  const result = await res.json()
  const content: string = result?.choices?.[0]?.message?.content || ''
  if (!content.trim()) {
    throw new Error('翻译接口未返回内容')
  }

  return extractTranslations(content, texts.length)
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 请求体解析单独 try/catch：非法 JSON 抛出的 SyntaxError 不应被归一为 502 上游错误，而是 400 请求错误
  let body: TranslateRequest
  try {
    body = (await request.json()) as TranslateRequest
  } catch {
    return NextResponse.json(
      { error: '请求体必须为合法 JSON', code: 'INVALID_REQUEST' },
      { status: 400 },
    )
  }

  try {
    const { texts, direction, configId } = body

    // ── 请求校验 ────────────────────────────────────────────
    if (!Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json(
        { error: '待翻译文本不能为空', code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }
    if (texts.length > MAX_TEXTS) {
      return NextResponse.json(
        { error: `单次翻译最多 ${MAX_TEXTS} 条文本`, code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }
    if (texts.some((t) => typeof t !== 'string' || !t.trim())) {
      return NextResponse.json(
        { error: '待翻译文本必须为非空字符串', code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }
    // direction 取值校验：非法值不再隐式当作英译中，直接 400 拒绝（避免非法请求被误归一）
    if (direction !== undefined && direction !== 'auto' && direction !== 'en2zh' && direction !== 'zh2en') {
      return NextResponse.json(
        { error: "direction 必须为 'auto'、'en2zh' 或 'zh2en'", code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }

    // ── 读取配置 ────────────────────────────────────────────
    const settings = configId
      ? await readLlmConfigById(configId)
      : await readLlmSettings()
    if (!settings?.baseUrl || !settings?.apiKey) {
      return NextResponse.json(
        { error: '请先在设置页配置翻译模型（Base URL 和 API Key）', code: 'SETTINGS_NOT_CONFIGURED' },
        { status: 400 },
      )
    }
    if (!settings.translateModel) {
      return NextResponse.json(
        { error: '该配置未设置翻译模型', code: 'SETTINGS_NOT_CONFIGURED' },
        { status: 400 },
      )
    }

    const url = buildTranslateUrl(settings.baseUrl, settings.translateEndpoint)
    const finalDirection: TranslateDirection =
      direction === 'auto' || direction === undefined
        ? detectDirectionOnServer(texts)
        : direction

    // ── 调用上游（校验失败自动重试 1 次，共 2 次） ──────────────
    let translations: string[] | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      // 将客户端断开（request.signal）并入中止信号：浏览器取消后即刻中止上游调用，不再继续消耗额度；
      // 任一信号触发都会使 combined.aborted 为 true，通过 request.signal.aborted 区分超时与客户端断开。
      const combined = AbortSignal.any([request.signal, controller.signal])
      try {
        translations = await translateOnce(
          url,
          settings.apiKey,
          settings.translateModel,
          texts,
          finalDirection,
          combined,
        )
      } catch (err) {
        if (combined.aborted) {
          // 客户端主动断开：直接中止返回，避免向已关闭连接写响应；超时则返回 504。
          if (request.signal.aborted) {
            return new NextResponse(null, { status: 499 })
          }
          return NextResponse.json(
            { error: '翻译请求超时，请稍后重试', code: 'TRANSLATE_TIMEOUT' },
            { status: 504 },
          )
        }
        throw err
      } finally {
        clearTimeout(timeout)
      }
      if (translations) break
    }

    if (!translations) {
      return NextResponse.json(
        { error: '翻译结果与原文条数不一致，请重试', code: 'TRANSLATE_ALIGN_FAILED' },
        { status: 502 },
      )
    }

    return NextResponse.json({ translations })
  } catch (error) {
    // 客户端断开导致的 fetch 中止：不再当作上游错误上报，直接中止返回。
    // 注：AbortSignal.any 派生信号的 AbortError 可能为 DOMException 而非 Error，需双重判定。
    if (request.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return new NextResponse(null, { status: 499 })
    }
    console.error('Translate API error:', error)
    const message = error instanceof Error ? error.message : '翻译失败'
    return NextResponse.json({ error: message, code: 'TRANSLATE_UPSTREAM_ERROR' }, { status: 502 })
  }
}
