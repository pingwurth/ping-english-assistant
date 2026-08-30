/**
 * 翻译 API 路由（BFF）—— 调用 LLM chat 接口批量翻译文本
 *
 * 使用 LLM 服务层统一调用，消除 provider 分支判断。
 *
 * 请求：{ texts: string[], direction?: 'auto' | 'en2zh' | 'zh2en', configId?: string }
 * 响应：{ translations: string[] }（与输入等长）
 */

import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, readLlmConfigById } from '@/lib/server-settings'
import { translateTexts, LlmError } from '@/lib/llm'
import type { TranslateDirection, TranslateRequest } from '@/types/api'

/** 单次请求文本条数上限 */
const MAX_TEXTS = 500
/** 单次上游调用超时（毫秒） */
const REQUEST_TIMEOUT_MS = 120_000

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
    // direction 取值校验
    if (direction !== undefined && direction !== 'auto' && direction !== 'en2zh' && direction !== 'zh2en') {
      return NextResponse.json(
        { error: "direction 必须为 'auto'、'en2zh' 或 'zh2en'", code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }

    // ── 读取配置 ────────────────────────────────────────────
    const settings = configId
      ? await readLlmConfigById(configId)
      : await readEffectiveLlmSettings()
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

    console.log('[Translate] Provider:', settings.provider, '| Model:', settings.translateModel)
    console.log('[Translate] BaseURL:', settings.baseUrl, '| Endpoint:', settings.translateEndpoint || '(default)')

    // ── 调用 LLM 服务层 ─────────────────────────────────────
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    // 将客户端断开（request.signal）并入中止信号
    const combined = AbortSignal.any([request.signal, controller.signal])

    try {
      const translations = await translateTexts(
        texts,
        {
          provider: settings.provider || 'dashscope',
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.translateModel,
          endpoint: settings.translateEndpoint,
          direction: (direction || 'auto') as TranslateDirection,
        },
        combined,
      )

      return NextResponse.json({ translations })
    } catch (err) {
      // 客户端主动断开
      if (request.signal.aborted) {
        return new NextResponse(null, { status: 499 })
      }
      // 超时
      if (combined.aborted) {
        return NextResponse.json(
          { error: '翻译请求超时，请稍后重试', code: 'TRANSLATE_TIMEOUT' },
          { status: 504 },
        )
      }
      throw err
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    // 客户端断开导致的中止
    if (request.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return new NextResponse(null, { status: 499 })
    }

    // LLM 服务层错误
    if (error instanceof LlmError) {
      console.error('[Translate] LlmError:', error.code, error.message)
      const statusMap: Record<string, number> = {
        API_KEY_MISSING: 400,
        BASE_URL_MISSING: 400,
        MODEL_NOT_CONFIGURED: 400,
        RESPONSE_EMPTY: 502,
        RESPONSE_FORMAT_ERROR: 502,
        UPSTREAM_ERROR: 502,
        REQUEST_TIMEOUT: 504,
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] || 502 },
      )
    }

    console.error('Translate API error:', error)
    const message = error instanceof Error ? error.message : '翻译失败'
    return NextResponse.json({ error: message, code: 'TRANSLATE_UPSTREAM_ERROR' }, { status: 502 })
  }
}
