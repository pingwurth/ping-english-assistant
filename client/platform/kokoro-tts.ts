/**
 * Kokoro-82M 本地离线语音合成 —— 基于 kokoro-js（ONNX Runtime Web）
 * —— 真源：docs/系统架构设计.md §3.4 Kokoro-82M
 *
 * 首次使用从 HuggingFace 下载 q8 ONNX 模型（约 90MB）并缓存到浏览器
 * Cache Storage，之后完全离线可用。
 *
 * 合成策略（对齐 §3.4「句级时间轴为分句合成真实边界」）：
 *  - 按 [.!?;:\n] 分句，逐句调用模型，得到每句真实音频时长；
 *  - 句间插入 120ms 静音，拼接为完整 24kHz 单声道 WAV；
 *  - 时间轴由真实句长累计而来，SRT 字幕精确对齐。
 */

import { encodeWav } from '@/core/audio/wav-encoder'
import { buildSrt, splitTtsSentences, type TtsSentenceTiming } from '@/services/mock/tts'
import type { KokoroTTS } from 'kokoro-js'

/** Kokoro 音色 ID 联合类型（推导自 kokoro-js generate 选项） */
type KokoroVoiceId = NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

/** 句间静音（与云端路径的 buildTtsTimeline 估算口径一致） */
const INTER_SENTENCE_GAP_MS = 120

/** 英文音色（美式；a?_* 前缀 = American，f/m = 女/男） */
export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart · Female (US)' },
  { id: 'af_nicole', label: 'Nicole · Female (US)' },
  { id: 'am_adam', label: 'Adam · Male (US)' },
  { id: 'am_michael', label: 'Michael · Male (US)' },
] as const

export type KokoroLoadPhase = 'downloading' | 'initializing'

export interface KokoroLoadEvent {
  phase: KokoroLoadPhase
  /** 正在下载的文件名（downloading 阶段） */
  file?: string
  /** 当前文件下载百分比 0-100 */
  percent?: number
}

const loadListeners = new Set<(e: KokoroLoadEvent) => void>()

function emitLoad(e: KokoroLoadEvent): void {
  loadListeners.forEach((cb) => cb(e))
}

/** 订阅模型加载/下载进度；返回取消订阅函数 */
export function subscribeKokoroLoad(cb: (e: KokoroLoadEvent) => void): () => void {
  loadListeners.add(cb)
  return () => { loadListeners.delete(cb) }
}

let ttsPromise: Promise<KokoroTTS> | null = null
let ttsReady = false

/** 懒加载单例：首次调用时下载并初始化模型 */
export function getKokoroTts(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    emitLoad({ phase: 'downloading' })
    ttsPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js')
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p && p.status === 'progress') {
            emitLoad({ phase: 'downloading', file: p.file, percent: p.progress })
          }
        },
      })
      ttsReady = true
      return tts
    })().catch((err) => {
      ttsPromise = null
      throw err
    })
  }
  return ttsPromise
}

export interface KokoroTtsResult {
  taskId: string
  blob: Blob
  sampleRate: number
  durationMs: number
  timings: TtsSentenceTiming[]
  srt: string
}

export interface KokoroGenerateOptions {
  text: string
  voice: string
  speed: number
  signal?: AbortSignal
  /** 逐句合成进度（已完成句数 / 总句数） */
  onSentenceProgress?: (done: number, total: number) => void
  /** 模型下载/加载进度订阅（本次生成期间有效） */
  onLoad?: (e: KokoroLoadEvent) => void
}

export async function generateKokoroTts(options: KokoroGenerateOptions): Promise<KokoroTtsResult> {
  const { text, voice, speed, signal, onSentenceProgress, onLoad } = options

  const sentences = splitTtsSentences(text)
  if (sentences.length === 0) throw new Error('文本为空，无法合成语音')

  const unsubscribe = onLoad ? subscribeKokoroLoad(onLoad) : () => {}
  try {
    if (!ttsReady) emitLoad({ phase: 'initializing' })
    const tts = await getKokoroTts()
    if (signal?.aborted) throw new DOMException('已取消生成', 'AbortError')

    const timings: TtsSentenceTiming[] = []
    const chunks: Float32Array[] = []
    let sampleRate = 24000
    let cursorMs = 0

    for (let i = 0; i < sentences.length; i++) {
      if (signal?.aborted) throw new DOMException('已取消生成', 'AbortError')
      const raw = await tts.generate(sentences[i]!, { voice: voice as KokoroVoiceId, speed })
      sampleRate = raw.sampling_rate
      const durMs = Math.round((raw.audio.length / sampleRate) * 1000)
      timings.push({ index: i, text: sentences[i]!, startMs: cursorMs, endMs: cursorMs + durMs })
      chunks.push(raw.audio)
      cursorMs += durMs
      if (i < sentences.length - 1) {
        chunks.push(new Float32Array(Math.round((INTER_SENTENCE_GAP_MS / 1000) * sampleRate)))
        cursorMs += INTER_SENTENCE_GAP_MS
      }
      onSentenceProgress?.(i + 1, sentences.length)
    }

    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const c of chunks) {
      samples.set(c, offset)
      offset += c.length
    }

    return {
      taskId: `tts_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      blob: encodeWav(samples, sampleRate),
      sampleRate,
      durationMs: cursorMs,
      timings,
      srt: buildSrt(timings),
    }
  } finally {
    unsubscribe()
  }
}
