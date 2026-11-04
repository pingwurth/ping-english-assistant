/**
 * TTS API 路由 — 云端语音合成
 *
 * 使用 LLM 服务层统一封装，消除 provider 分支判断。
 * SRT 字幕构建逻辑保持不变（非 LLM 调用）。
 */

import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, readLlmConfigById } from '@/lib/server-settings'
import { isUnsafeUpstreamUrl, sameOriginGuard, unsafeUpstreamResponse } from '@/lib/api-guard'
import { upstreamAbortResponse, withUpstreamTimeout } from '@/lib/bff-upstream'
import { readJsonBodyCapped } from '@/lib/upload-limit'
import { generateTts, LlmError, toLlmErrorResponse } from '@/lib/llm'
import type { TtsModelConfig } from '@/lib/llm'
import {
  splitTtsSentences,
  buildTtsTimeline,
  buildSrt,
  TTS_MAX_TEXT_LENGTH,
} from '@/core/tts/timeline'
import {
  getDefaultModel,
  getDefaultVoice,
} from '@/lib/service-endpoints'

/** 长文本合成上限约 5.5 分钟音频，超时给足余量（对照 translate/mnemonic 的 120s） */
const TTS_REQUEST_TIMEOUT_MS = 300_000

export async function POST(request: Request) {
  // 同源守卫（评审 #2）：本路由会用用户真实密钥消耗云端 TTS 配额
  const denied = sameOriginGuard(request)
  if (denied) return denied
  // 带体积上限的 JSON 解析（c034：json() 与 formData() 一样全量缓冲，此前 JSON
  // 路由不在 upload-limit 纪律内）；解析错误在此返回 400，不落进下方 500 通道
  const parsedBody = await readJsonBodyCapped(request)
  if (!parsedBody.ok) return parsedBody.response
  try {
    const { text, voice, speed, configId } = parsedBody.body as {
      text: string
      voice?: string
      speed?: number
      configId?: string
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: '文本不能为空' }, { status: 400 })
    }
    if (text.length > TTS_MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `文本超过 ${TTS_MAX_TEXT_LENGTH} 字符上限` },
        { status: 400 },
      )
    }

    const sentences = splitTtsSentences(text)
    if (sentences.length === 0) {
      return NextResponse.json({ error: '文本为空，无法合成语音' }, { status: 400 })
    }

    // ── 读取配置 ────────────────────────────────────────────
    const settings = configId
      ? await readLlmConfigById(configId)
      : await readEffectiveLlmSettings()
    // 已存 baseUrl 过 SSRF 门（c066）。truthiness 先行（quick c007）：空 baseUrl 的
    // 配置应报「未配置」——isUnsafeUpstreamUrl('') 会因 URL 解析失败被判不安全，
    // 把配置缺失误报成网段不允许的安全问题
    if (settings?.baseUrl && isUnsafeUpstreamUrl(settings.baseUrl)) return unsafeUpstreamResponse()
    if (!settings?.baseUrl || !settings?.apiKey) {
      return NextResponse.json(
        { error: '请先在设置页配置 TTS 模型（Base URL 和 API Key）', code: 'SETTINGS_NOT_CONFIGURED' },
        { status: 400 },
      )
    }

    const provider = settings.provider || 'dashscope'
    const ttsModel = settings.ttsModel || getDefaultModel(provider, 'tts')
    // 快速失败（对齐同层 translate 路由口径）：local/未知 provider 无默认模型时
    // getDefaultModel 回空串，不能拿空 model 去请求上游（返回不可归因的 4xx/5xx）
    if (!ttsModel) {
      return NextResponse.json(
        { error: '请先在设置页配置 TTS 模型', code: 'MODEL_NOT_CONFIGURED' },
        { status: 400 },
      )
    }
    const ttsVoice = voice || getDefaultVoice(provider)
    const spd = Math.max(0.5, Math.min(2.0, speed || 1.0))

    console.log('[TTS] Provider:', provider, '| Model:', ttsModel, '| Voice:', ttsVoice, '| Speed:', spd)

    // ── 调用 TTS 服务层 ─────────────────────────────────────
    const ttsConfig: TtsModelConfig = {
      provider,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: ttsModel,
      endpoint: settings.ttsEndpoint,
      voice: ttsVoice,
      speed: spd,
    }

    // ── 调用 TTS 服务层 ─────────────────────────────────────
    // 客户端取消（request.signal）与路由层超时并入中止信号（评审 #24：
    // 此前用户关页/取消后 BFF 仍等上游完整合成，计费白耗）。
    // 统一走 lib/bff-upstream（c060：四处手搓同款样板已漂移）
    const upstream = withUpstreamTimeout(request.signal, TTS_REQUEST_TIMEOUT_MS)
    let result: Awaited<ReturnType<typeof generateTts>>
    try {
      result = await generateTts(text, ttsConfig, upstream.signal)
    } finally {
      upstream.done()
    }
    const { audioBuffer, durationMs: rawDurationMs, speedApplied } = result
    const durationMs = rawDurationMs || 1000

    // ── 构建 SRT 字幕 ──────────────────────────────────────
    const taskId = `tts_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const { timings } = buildTtsTimeline(sentences, spd)
    const estimatedTotal = timings[timings.length - 1]?.endMs || durationMs
    const ratio = durationMs / estimatedTotal
    const scaledTimings = timings.map((t, i) => ({
      index: t.index,
      text: t.text,
      startMs: i === 0 ? 0 : Math.round(timings[i - 1]!.endMs * ratio),
      endMs: Math.round(t.endMs * ratio),
    }))
    const srt = buildSrt(scaledTimings)

    // multipart 传输（评审 #53）：原 base64 塞 JSON 使音频体积 +33%，客户端还要
    // atob 后逐字节 charCodeAt 重组（千万次迭代阻塞主线程、三份拷贝同时驻留）。
    // JSON 元数据 + 原始音频字节走 multipart，客户端 res.formData() 原生解析。
    const boundary = `----pingeng${taskId}`
    // speedApplied（评审 #3）：MiMo 等 OpenAI-compatible 网关不保证语速参数生效，
    // 缺省 true；provider 显式标 false 时客户端据此提示「语速未生效」而非静默空转
    const meta = JSON.stringify({ taskId, durationMs, sentenceCount: sentences.length, srt, speedApplied: speedApplied !== false })
    const multipartBody = new Blob([
      `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="tts.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      audioBuffer,
      `\r\n--${boundary}--\r\n`,
    ])
    return new Response(multipartBody, {
      status: 200,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    })
  } catch (error) {
    // 客户端取消 / 路由层超时（fetch 抛 AbortError 透传至此）：按 request.signal
    // 判别 —— 取消是 499（不是服务故障），超时才是 504（c069：原先一律 504，
    // 把用户主动取消误报成超时故障，与 translate/mnemonic/lib/llm/errors 口径漂移）
    if (error instanceof Error && error.name === 'AbortError') {
      return upstreamAbortResponse(request, '语音合成超时', 'TTS_TIMEOUT')
    }
    // LLM 服务层错误
    if (error instanceof LlmError) {
      console.error('[TTS] LlmError:', error.code, error.message)
      // 状态码映射与 translate/mnemonic 统一（评审 #48，原先一律 500）
      return toLlmErrorResponse(error)
    }

    console.error('TTS API error:', error)
    const message = error instanceof Error ? error.message : 'TTS 生成失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
