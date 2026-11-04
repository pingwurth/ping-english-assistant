/**
 * 生词助记 API 路由（BFF）—— 调用 LLM 生成助记卡片（流式）、联想、练习、批改
 *
 * 请求：{ action: 'card_stream'|'association'|'exercises'|'evaluate', word, context?, note?, meaning?, collocations?, difficulty?, sentence?, configId? }
 * 响应：MnemonicCard 流（SSE）| Association | Exercises | SentenceEvaluation
 *
 * 模型优先级：mnemonicModel > translateModel
 * 配置未设置时返回 400 SETTINGS_NOT_CONFIGURED
 */

import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, readLlmConfigs, readLlmConfigById } from '@/lib/server-settings'
import { isUnsafeUpstreamUrl, sameOriginGuard, unsafeUpstreamResponse } from '@/lib/api-guard'
import { upstreamAbortResponse, withUpstreamTimeout } from '@/lib/bff-upstream'
import { readJsonBodyCapped } from '@/lib/upload-limit'
import {
  generateMnemonicCardStream,
  generateAssociation,
  generateMnemonicExercises,
  evaluateSentence,
  LlmError,
  toLlmErrorResponse,
} from '@/lib/llm'
import type { ChatModelConfig } from '@/lib/llm'

/** 单次上游调用超时（毫秒） */
const REQUEST_TIMEOUT_MS = 120_000

type MnemonicAction = 'card_stream' | 'association' | 'exercises' | 'evaluate'

interface MnemonicRequest {
  action: MnemonicAction
  word: string
  context?: string
  note?: string
  meaning?: string
  collocations?: string[]
  difficulty?: string
  sentence?: string
  configId?: string
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 同源守卫（评审 #2）：本路由会用用户真实密钥消耗云端助记配额
  const denied = sameOriginGuard(request)
  if (denied) return denied
  // 带体积上限的 JSON 解析（c034：与 tts/translate 同纪律，json() 全量缓冲）
  const parsedBody = await readJsonBodyCapped(request)
  if (!parsedBody.ok) return parsedBody.response
  const body = parsedBody.body as MnemonicRequest

  try {
    const { action, word, context, note, meaning, collocations, difficulty, sentence, configId } = body

    // ── 请求校验 ──
    if (!action || !word) {
      return NextResponse.json(
        { error: '缺少必要参数: action, word', code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }

    const validActions: MnemonicAction[] = ['card_stream', 'association', 'exercises', 'evaluate']
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `action 必须为 ${validActions.join(' | ')}`, code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }

    if (action === 'card_stream' && !context) {
      return NextResponse.json(
        { error: 'card action 需要 context 参数', code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }
    if (action === 'exercises' && (!meaning || !collocations || !difficulty)) {
      return NextResponse.json(
        { error: 'exercises action 需要 meaning, collocations, difficulty 参数', code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }
    if (action === 'evaluate' && (!meaning || !sentence)) {
      return NextResponse.json(
        { error: 'evaluate action 需要 meaning, sentence 参数', code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }

    // ── 读取配置 ──
    const t0 = Date.now()
    let settings = configId
      ? await readLlmConfigById(configId)
      : await readEffectiveLlmSettings()

    // 兜底：如果 readEffectiveLlmSettings 没拿到 translateModel，直接读 llmConfigs
    if (settings && !settings.translateModel && !settings.mnemonicModel) {
      const { configs, defaultId } = await readLlmConfigs()
      const fallback = defaultId
        ? configs.find(c => c.id === defaultId)
        : configs[0]
      if (fallback?.translateModel || fallback?.mnemonicModel) {
        console.log('[Mnemonic] Fallback to llmConfigs default:', fallback.name)
        const { id: _id, name: _name, ...rest } = fallback
        settings = rest
      }
    }
    const configMs = Date.now() - t0

    console.log('[Mnemonic] Config read:', {
      configId: configId || '(default)',
      configMs,
      provider: settings?.provider || '(not set)',
      mnemonicModel: settings?.mnemonicModel || '(not set)',
      translateModel: settings?.translateModel || '(not set)',
      baseUrl: settings?.baseUrl?.slice(0, 50) || '(not set)',
    })

    if (!settings?.baseUrl || !settings?.apiKey) {
      return NextResponse.json(
        { error: '请先在设置页配置 LLM 模型（Base URL 和 API Key）', code: 'SETTINGS_NOT_CONFIGURED' },
        { status: 400 },
      )
    }
    // 已存 baseUrl 过 SSRF 门（quick 复审 c002：tts/translate/models/transcribe/soe
    // 都有门,唯独本路由漏网——「全出网路由接入」在这里补齐;置于配置缺失检查之后,
    // 空 baseUrl 报「未配置」而非误报网段不允许）
    if (settings.baseUrl && isUnsafeUpstreamUrl(settings.baseUrl)) return unsafeUpstreamResponse()

    // 模型优先级：mnemonicModel > translateModel
    const model = settings.mnemonicModel || settings.translateModel
    if (!model) {
      return NextResponse.json(
        { error: `请先在设置页配置助记模型或翻译模型（当前配置: mnemonicModel=${settings.mnemonicModel || '未设置'}, translateModel=${settings.translateModel || '未设置'}）`, code: 'SETTINGS_NOT_CONFIGURED' },
        { status: 400 },
      )
    }

    const chatConfig: ChatModelConfig = {
      provider: settings.provider || 'dashscope',
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model,
      endpoint: settings.mnemonicEndpoint || settings.translateEndpoint,
    }

    console.log('[Mnemonic] Provider:', settings.provider, '| Model:', model, '| Action:', action)

    // ── card_stream: SSE 流式响应 ──
    if (action === 'card_stream') {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          const upstream = withUpstreamTimeout(request.signal, REQUEST_TIMEOUT_MS)
          try {
            const gen = generateMnemonicCardStream(word, context!, note, chatConfig, upstream.signal)
            for await (const event of gen) {
              const sseData = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
              controller.enqueue(encoder.encode(sseData))
            }
          } catch (err) {
            // 仅客户端断开才静默（enqueue/close 已会抛,quick 复审 c009：原先把
            // 120s 硬超时的 AbortError 也一并吞掉,SSE 无 error 帧静默断流）——
            // 硬超时时 request.signal 未中止,必须照发超时 error 帧
            if (request.signal.aborted) return
            const errorMsg = (err instanceof Error && err.name === 'AbortError')
              ? '生成超时，请稍后重试'
              : err instanceof Error ? err.message : '流式生成失败'
            try {
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`))
            } catch { /* 流已被取消：error 帧无处投递，静默 */ }
          } finally {
            upstream.done()
            try { controller.close() } catch { /* 已随断开关闭 */ }
          }
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // ── 调用 LLM（非流式） ──
    const tLlm = Date.now()
    const upstream = withUpstreamTimeout(request.signal, REQUEST_TIMEOUT_MS)

    try {
      let llmResult: { data: unknown; timing: { invokeMs: number; parseMs: number; contentLength: number } }

      switch (action) {
        case 'association':
          llmResult = await generateAssociation(word, meaning!, chatConfig, upstream.signal)
          break
        case 'exercises':
          llmResult = await generateMnemonicExercises(word, meaning!, collocations!, difficulty!, chatConfig, upstream.signal)
          break
        case 'evaluate':
          llmResult = await evaluateSentence(word, meaning!, sentence!, chatConfig, upstream.signal)
          break
      }

      const llmMs = Date.now() - tLlm
      const totalMs = Date.now() - t0
      console.log('[Mnemonic] Timing:', {
        action,
        configMs,
        invokeMs: llmResult!.timing.invokeMs,
        parseMs: llmResult!.timing.parseMs,
        llmMs,
        totalMs,
        contentLength: llmResult!.timing.contentLength,
        model,
      })

      return NextResponse.json(llmResult!.data, {
        headers: {
          'X-Mnemonic-Config-Ms': String(configMs),
          'X-Mnemonic-Invoke-Ms': String(llmResult!.timing.invokeMs),
          'X-Mnemonic-Parse-Ms': String(llmResult!.timing.parseMs),
          'X-Mnemonic-LLM-Ms': String(llmMs),
          'X-Mnemonic-Total-Ms': String(totalMs),
          'X-Mnemonic-Content-Length': String(llmResult!.timing.contentLength),
          'X-Mnemonic-Model': model,
          'X-Mnemonic-Provider': settings.provider || '',
        },
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return upstreamAbortResponse(request, '助记请求超时，请稍后重试', 'MNEMONIC_TIMEOUT')
      }
      throw err
    } finally {
      upstream.done()
    }
  } catch (error) {
    if (request.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return new NextResponse(null, { status: 499 })
    }

    if (error instanceof LlmError) {
      console.error('[Mnemonic] LlmError:', error.code, error.message)
      return toLlmErrorResponse(error)
    }

    console.error('[Mnemonic] API error:', error)
    const message = error instanceof Error ? error.message : '助记生成失败'
    return NextResponse.json({ error: message, code: 'MNEMONIC_UPSTREAM_ERROR' }, { status: 502 })
  }
}
