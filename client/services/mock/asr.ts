/**
 * Mock ASR（契约① POST /api/v1/asr/transcribe）—— 真源：docs/系统架构设计.md §3.3 契约①
 *
 * 确定性行为：直接返回构造时注入的参考原文（refText）作为转写结果（segments 单段），
 * 供影子跟读/背诵"转写 → 人工修正 → 生成报告"链路在离线环境走通。
 *
 * durationMs 策略：
 * 1. 标准 16kHz 单声道 16bit WAV → 从 data chunk 字节数精确计算；
 * 2. 非标准/非 WAV → 按 16kHz 单声道 16bit 字节率估算（32000 B/s）。
 * 两者均不可得（空 Blob）时取 0。
 *
 * 纯 TS、零浏览器 API 依赖、node 可测。
 */

import type { AsrTranscribeResponse } from '../../types/api'
import { ApiError, abortableDelay, throwIfAborted, type AsrService } from '../contracts'

export interface MockAsrOptions {
  /** 固定返回的参考原文（转写结果 = 该文本） */
  refText?: string
  /** 模拟延迟范围 ms（确定性不影响；默认 200-600ms） */
  latencyMinMs?: number
  latencyMaxMs?: number
}

/** 从标准 WAV（PCM 16bit）解析音频时长；非 WAV/解析失败返回 null */
function probeWavDurationMs(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 44) return null
  const dv = new DataView(buf)
  const tag = (off: number, len: number) => String.fromCharCode(...new Uint8Array(buf, off, len))
  if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WAVE') return null
  const channels = dv.getUint16(22, true)
  const sampleRate = dv.getUint32(24, true)
  const blockAlign = dv.getUint16(32, true)
  if (!channels || !sampleRate || !blockAlign) return null
  // 逐 chunk 定位 data（不假定 fmt 后紧跟 data）
  let off = 12
  while (off + 8 <= buf.byteLength) {
    const id = tag(off, 4)
    const size = dv.getUint32(off + 4, true)
    if (id === 'data') return Math.round((size / blockAlign / sampleRate) * 1000)
    off += 8 + size + (size & 1)
  }
  return null
}

/** 估算音频时长：优先 WAV 精确解析，其次按 16kHz 单声道 16bit 字节率估算 */
async function estimateDurationMs(audio: Blob): Promise<number> {
  if (audio.size === 0) return 0
  const buf = await audio.arrayBuffer()
  const wavMs = probeWavDurationMs(buf)
  if (wavMs !== null) return wavMs
  // 16000Hz × 2Byte × 1ch = 32000 B/s
  return Math.round((audio.size / 32000) * 1000)
}

export class MockAsrService implements AsrService {
  private readonly refText: string
  private readonly latencyMinMs: number
  private readonly latencyMaxMs: number

  constructor(options: MockAsrOptions = {}) {
    this.refText = options.refText ?? ''
    this.latencyMinMs = options.latencyMinMs ?? 200
    this.latencyMaxMs = options.latencyMaxMs ?? 600
  }

  async transcribe(audio: Blob, lang: 'en', signal?: AbortSignal): Promise<AsrTranscribeResponse> {
    throwIfAborted(signal)
    if (lang !== 'en') {
      throw new ApiError('BAD_REQUEST', 'ASR 仅支持 lang=en（契约①）', { lang })
    }
    const latency = this.latencyMinMs + Math.random() * Math.max(0, this.latencyMaxMs - this.latencyMinMs)
    await abortableDelay(latency, signal)
    const durationMs = await estimateDurationMs(audio)
    return {
      text: this.refText,
      durationMs,
      segments: [{ startMs: 0, endMs: durationMs, text: this.refText }],
    }
  }
}
