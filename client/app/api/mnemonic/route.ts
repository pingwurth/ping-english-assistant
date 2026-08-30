/**
 * 生词助记 API 路由（BFF）—— 调用 LLM 生成助记卡片、联想、练习、批改
 *
 * 请求：{ action: 'card'|'association'|'exercises'|'evaluate', word, context?, note?, meaning?, collocations?, difficulty?, sentence?, configId? }
 * 响应：MnemonicCard | Association | Exercises | SentenceEvaluation
 *
 * 模型优先级：mnemonicModel > translateModel
 * 配置未设置时返回 400 SETTINGS_NOT_CONFIGURED
 */

import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, readLlmConfigs, readLlmConfigById } from '@/lib/server-settings'
import {
  generateMnemonicCard,
  generateMnemonicCardStream,
  generateAssociation,
  generateMnemonicExercises,
  evaluateSentence,
  LlmError,
} from '@/lib/llm'
import type { ChatModelConfig } from '@/lib/llm'

/** 单次上游调用超时（毫秒） */
const REQUEST_TIMEOUT_MS = 120_000

type MnemonicAction = 'card' | 'card_stream' | 'association' | 'exercises' | 'evaluate'

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
  let body: MnemonicRequest
  try {
    body = (await request.json()) as MnemonicRequest
  } catch {
    return NextResponse.json(
      { error: '请求体必须为合法 JSON', code: 'INVALID_REQUEST' },
      { status: 400 },
    )
  }

  try {
    const { action, word, context, note, meaning, collocations, difficulty, sentence, configId } = body

    // ── 请求校验 ──
    if (!action || !word) {
      return NextResponse.json(
        { error: '缺少必要参数: action, word', code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }

    const validActions: MnemonicAction[] = ['card', 'card_stream', 'association', 'exercises', 'evaluate']
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `action 必须为 ${validActions.join(' | ')}`, code: 'INVALID_REQUEST' },
        { status: 400 },
      )
    }

    if ((action === 'card' || action === 'card_stream') && !context) {
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
          const controller2 = new AbortController()
          const timeout2 = setTimeout(() => controller2.abort(), REQUEST_TIMEOUT_MS)
          const combined2 = AbortSignal.any([request.signal, controller2.signal])

          try {
            const gen = generateMnemonicCardStream(word, context!, note, chatConfig, combined2)
            for await (const event of gen) {
              const sseData = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
              controller.enqueue(encoder.encode(sseData))
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '流式生成失败'
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`))
          } finally {
            clearTimeout(timeout2)
            controller.close()
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const combined = AbortSignal.any([request.signal, controller.signal])

    try {
      let llmResult: { data: unknown; timing: { invokeMs: number; parseMs: number; contentLength: number } }

      switch (action) {
        case 'card':
          llmResult = await generateMnemonicCard(word, context!, note, chatConfig, combined)
          break
        case 'association':
          llmResult = await generateAssociation(word, meaning!, chatConfig, combined)
          break
        case 'exercises':
          llmResult = await generateMnemonicExercises(word, meaning!, collocations!, difficulty!, chatConfig, combined)
          break
        case 'evaluate':
          llmResult = await evaluateSentence(word, meaning!, sentence!, chatConfig, combined)
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
      if (request.signal.aborted) {
        return new NextResponse(null, { status: 499 })
      }
      if (combined.aborted) {
        return NextResponse.json(
          { error: '助记请求超时，请稍后重试', code: 'MNEMONIC_TIMEOUT' },
          { status: 504 },
        )
      }
      throw err
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    if (request.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return new NextResponse(null, { status: 499 })
    }

    if (error instanceof LlmError) {
      console.error('[Mnemonic] LlmError:', error.code, error.message)
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

    console.error('[Mnemonic] API error:', error)
    const message = error instanceof Error ? error.message : '助记生成失败'
    return NextResponse.json({ error: message, code: 'MNEMONIC_UPSTREAM_ERROR' }, { status: 502 })
  }
}
