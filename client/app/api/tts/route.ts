/**
 * TTS API 路由 — 云端语音合成
 *
 * apiKey / baseUrl / ttsModel 均从 ~/.ping-eng/settings.json 读取；
 * TTS 端点由 baseUrl 推导（去掉 /compatible-mode/v1 等后缀，拼接原生
 * /api/v1/services/audio/tts/SpeechSynthesizer 路径）。
 *
 * 请求：{ text, voice?, speed? }
 * 响应：{ audioBase64, taskId, durationMs, sentenceCount, srt }
 *
 * SDK 文档：docs/qwen语音生成接入.md
 */

import { NextResponse } from 'next/server'
import { readLlmSettings } from '@/lib/server-settings'
import {
  splitTtsSentences,
  buildTtsTimeline,
  buildSrt,
  TTS_MAX_TEXT_LENGTH,
} from '@/services/mock/tts'

/** DashScope TTS 路径（接在 host 后面） */
const DASHSCOPE_TTS_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer'

/** 默认音色（qwen-audio-3.0-tts-plus 双语音色，兼容英文） */
const DEFAULT_VOICE = 'longanlingxin'

/** 默认模型（settings 未配置时的回退值） */
const DEFAULT_MODEL = 'qwen-audio-3.0-tts-flash'

/**
 * 从 settings.baseUrl 构造 TTS 端点 URL。
 * baseUrl 可能是：
 *   - https://dashscope.aliyuncs.com/compatible-mode/v1
 *   - https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
 *   - https://dashscope.aliyuncs.com/api/v1
 * 统一去掉 /compatible-mode/v1 或 /api/v1 等后缀，拼接原生 TTS 路径。
 */
function buildTtsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const host = trimmed.replace(/\/(compatible-mode\/v1|v1|api\/v1)$/, '')
  return `${host}${DASHSCOPE_TTS_PATH}`
}

/** 从 WAV ArrayBuffer 解析采样率 / 数据大小，计算时长 */
function parseWavDuration(buf: ArrayBuffer): number {
  if (buf.byteLength < 44) return 0
  const view = new DataView(buf)
  const sampleRate = view.getUint32(24, true)
  const channels = view.getUint16(22, true)
  const dataSize = view.getUint32(40, true)
  if (!sampleRate || !channels || !dataSize) return 0
  
  const durationMs = Math.round((dataSize / (sampleRate * channels * 2)) * 1000)
  
  // Sanity check: if duration > 5 minutes (300s), the WAV header is likely malformed
  // Fall back to rough estimate based on file size (assume 24kHz mono 16-bit PCM ≈ 48KB/s)
  if (durationMs > 300_000) {
    console.warn(`parseWavDuration: suspicious duration ${durationMs}ms, falling back to byte-based estimate`)
    const estimatedBytesPerSecond = 24000 * 1 * 2 // 24kHz, mono, 16-bit
    return Math.round((buf.byteLength / estimatedBytesPerSecond) * 1000)
  }
  
  return durationMs
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { text, voice, speed } = body as {
      text: string
      voice?: string
      speed?: number
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
    const settings = await readLlmSettings()
    if (!settings?.baseUrl || !settings?.apiKey) {
      return NextResponse.json(
        { error: '请先在设置页配置 TTS 模型（Base URL 和 API Key）', code: 'SETTINGS_NOT_CONFIGURED' },
        { status: 400 },
      )
    }

    const ttsModel = settings.ttsModel || DEFAULT_MODEL
    const spd = Math.max(0.5, Math.min(2.0, speed || 1.0))
    const ttsVoice = voice || DEFAULT_VOICE
    const apiUrl = buildTtsUrl(settings.baseUrl)

    // ── 调用 DashScope Qwen-Audio-TTS（原生端点）────────────
    const apiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: ttsModel,
        input: {
          text,
          voice: ttsVoice,
          format: 'wav',
          sample_rate: 24000,
          rate: spd,
          language_hints: ['en'],
        },
      }),
    })

    if (!apiRes.ok) {
      let detail = ''
      try {
        const errBody = await apiRes.json()
        detail =
          errBody.message ||
          errBody.error?.message ||
          errBody.code ||
          JSON.stringify(errBody)
      } catch {
        detail = (await apiRes.text().catch(() => '')).slice(0, 500)
      }
      return NextResponse.json(
        { error: `TTS 调用失败 (${apiRes.status})：${detail}`, url: apiUrl },
        { status: 502 },
      )
    }

    // DashScope 原生模式：响应是 JSON，音频在 output.audio.url
    const result = await apiRes.json()
    const audioUrl: string | undefined = result?.output?.audio?.url
    if (!audioUrl) {
      return NextResponse.json(
        { error: 'TTS 响应中未返回音频 URL', raw: result },
        { status: 502 },
      )
    }

    // 下载音频二进制
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      return NextResponse.json(
        { error: `音频下载失败 (${audioRes.status})` },
        { status: 502 },
      )
    }

    const audioBuf = await audioRes.arrayBuffer()
    const audioBase64 = Buffer.from(audioBuf).toString('base64')
    const durationMs = parseWavDuration(audioBuf) || 1000

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
    console.error('TTS API error:', error)
    const message = error instanceof Error ? error.message : 'TTS 生成失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
