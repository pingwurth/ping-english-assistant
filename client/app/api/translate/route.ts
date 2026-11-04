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
import { isUnsafeUpstreamUrl, sameOriginGuard, unsafeUpstreamResponse } from '@/lib/api-guard'
import { upstreamAbortResponse, withUpstreamTimeout } from '@/lib/bff-upstream'
import { readJsonBodyCapped } from '@/lib/upload-limit'
import { translateTexts, LlmError, toLlmErrorResponse } from '@/lib/llm'
import type { TranslateDirection, TranslateRequest } from '@/types/api'

/** 单次请求文本条数上限 */
const MAX_TEXTS = 500
/** 单次上游调用超时（毫秒） */
const REQUEST_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 同源守卫（评审 #2）：本路由会用用户真实密钥消耗云端翻译配额
  const denied = sameOriginGuard(request)
  if (denied) return denied
  // 请求体解析单独处理：非法 JSON → 400 请求错误（不是 502 上游错误）；
  // 带体积上限（c034：json() 同样全量缓冲，App Router 无框架级 body 限制）
  const parsedBody = await readJsonBodyCapped(request)
  if (!parsedBody.ok) return parsedBody.response
  const body = parsedBody.body as TranslateRequest

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
    // 已存 baseUrl 过 SSRF 门（c066）。truthiness 先行（quick c017）：空 baseUrl
    // 报「未配置」而非误报网段不允许
    if (settings?.baseUrl && isUnsafeUpstreamUrl(settings.baseUrl)) return unsafeUpstreamResponse()
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
    // 客户端取消 + 路由层超时统一走 lib/bff-upstream（c060：消除手搓样板漂移）
    const upstream = withUpstreamTimeout(request.signal, REQUEST_TIMEOUT_MS)
    try {
      const { translations, filledWithSource } = await translateTexts(
        texts,
        {
          provider: settings.provider || 'dashscope',
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.translateModel,
          endpoint: settings.translateEndpoint,
          direction: (direction || 'auto') as TranslateDirection,
        },
        upstream.signal,
      )

      // filledWithSource > 0 = 有缺失位被原文回填：透传给客户端展示“部分未翻”警告
      return NextResponse.json({ translations, ...(filledWithSource > 0 ? { filledWithSource } : {}) })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return upstreamAbortResponse(request, '翻译请求超时，请稍后重试', 'TRANSLATE_TIMEOUT')
      }
      throw err
    } finally {
      upstream.done()
    }
  } catch (error) {
    // 客户端断开导致的中止
    if (request.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return new NextResponse(null, { status: 499 })
    }

    // LLM 服务层错误（状态码映射收敛于 toLlmErrorResponse，评审 #48）
    if (error instanceof LlmError) {
      console.error('[Translate] LlmError:', error.code, error.message)
      return toLlmErrorResponse(error)
    }

    console.error('Translate API error:', error)
    const message = error instanceof Error ? error.message : '翻译失败'
    return NextResponse.json({ error: message, code: 'TRANSLATE_UPSTREAM_ERROR' }, { status: 502 })
  }
}
