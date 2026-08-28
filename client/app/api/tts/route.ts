/**
 * TTS API 路由 — 云端语音合成
 *
 * 使用 LLM 服务层统一封装，消除 provider 分支判断。
 * SRT 字幕构建逻辑保持不变（非 LLM 调用）。
 */

import { NextResponse } from 'next/server'
import { readLlmSettings, readLlmConfigById } from '@/lib/server-settings'
import { generateTts, LlmError } from '@/lib/llm'
import type { TtsModelConfig } from '@/lib/llm'
import {
  splitTtsSentences,
  buildTtsTimeline,
  buildSrt,
  TTS_MAX_TEXT_LENGTH,
} from '@/services/mock/tts'
import {
  getDefaultModel,
  getDefaultVoice,
} from '@/lib/service-endpoints'

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
      : await readLlmSettings()
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

    const { audioBuffer, durationMs: rawDurationMs } = await generateTts(text, ttsConfig)
    const audioBase64 = Buffer.from(audioBuffer).toString('base64')
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

    return NextResponse.json({
      audioBase64,
      taskId,
      durationMs,
      sentenceCount: sentences.length,
      srt,
    })
  } catch (error) {
    // LLM 服务层错误
    if (error instanceof LlmError) {
      console.error('[TTS] LlmError:', error.code, error.message)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 },
      )
    }

    console.error('TTS API error:', error)
    const message = error instanceof Error ? error.message : 'TTS 生成失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
