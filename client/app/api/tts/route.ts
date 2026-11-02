/**
 * TTS API 路由 — 云端语音合成
 *
 * 使用 LLM 服务层统一封装，消除 provider 分支判断。
 * SRT 字幕构建逻辑保持不变（非 LLM 调用）。
 */

import { NextResponse } from 'next/server'
import { readEffectiveLlmSettings, readLlmConfigById } from '@/lib/server-settings'
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
  try {
    const body = await request.json()
    const { text, voice, speed, configId } = body as {
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
    if (!settings?.baseUrl || !settings?.apiKey) {
      return NextResponse.json(
        { error: '请先在设置页配置 TTS 模型（Base URL 和 API Key）', code: 'SETTINGS_NOT_CONFIGURED' },
        { status: 400 },
      )
    }

    const provider = settings.provider || 'dashscope'
    const ttsModel = settings.ttsModel || getDefaultModel(provider, 'tts')
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
    // 此前用户关页/取消后 BFF 仍等上游完整合成，计费白耗）
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS)
    const combined = AbortSignal.any([request.signal, controller.signal])

    let result: Awaited<ReturnType<typeof generateTts>>
    try {
      result = await generateTts(text, ttsConfig, combined)
    } finally {
      clearTimeout(timeout)
    }
    const { audioBuffer, durationMs: rawDurationMs } = result
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
    const meta = JSON.stringify({ taskId, durationMs, sentenceCount: sentences.length, srt })
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
    // 客户端取消 / 路由层超时（fetch 抛 AbortError 透传至此）：干净的 504，
    // 不落到通用 500 把「取消」误报成服务故障
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: '语音合成已取消或超时', code: 'TIMEOUT_OR_ABORTED' },
        { status: 504 },
      )
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
