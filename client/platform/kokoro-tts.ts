/**
 * Kokoro-82M 本地离线语音合成 —— 基于 kokoro-js（ONNX Runtime Web）
 * —— 真源：docs/系统架构设计.md §3.4 Kokoro-82M
 *
 * 这里是主线程门面：驱动 UI、拼 WAV、生成 SRT。
 * 真正的 ONNX 推理全部跑在 Worker 里（kokoro-worker.ts）——推理是同步计算，
 * 放主线程会让页面在每句推理期间完全卡死、取消按钮也点不动。
 *
 * 模型与音色统一经本地代理（/api/hf/）加载，由代理读写磁盘缓存
 * （~/.ping-eng/kokoro-models/，路径见设置里的 kokoro.modelPath）。
 * 浏览器侧不留副本：每次加载先查磁盘，命中直接读，未命中才下载一次。
 *
 * 时间轴口径（对齐 §3.4「句级时间轴为分句合成真实边界」）：
 *  - 按 [.!?;:\n] 分句，逐句拿到真实音频时长；
 *  - 句间插入 120ms 静音，拼接为完整 24kHz 单声道 WAV；
 *  - 时间轴由真实句长累计而来，SRT 字幕精确对齐。
 */

import { encodeWav } from '@/core/audio/wav-encoder'
import { buildSrt, splitTtsSentences, type TtsSentenceTiming } from '@/services/mock/tts'
import type {
  KokoroLoadState,
  KokoroSynthesisResult,
  KokoroWorkerRequest,
  KokoroWorkerResponse,
} from './kokoro-protocol'

export type { KokoroLoadEvent, KokoroLoadPhase, KokoroLoadState } from './kokoro-protocol'

const DEFAULT_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

/** 当前模型 ID（可通过 setKokoroModelId 动态修改） */
let currentModelId = DEFAULT_MODEL_ID

/** 英文音色（美式；a?_* 前缀 = American，f/m = 女/男） */
export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart · Female (US)' },
  { id: 'af_nicole', label: 'Nicole · Female (US)' },
  { id: 'am_adam', label: 'Adam · Male (US)' },
  { id: 'am_michael', label: 'Michael · Male (US)' },
] as const

/* ── 加载状态订阅 ─────────────────────────────────────── */

const loadListeners = new Set<(e: KokoroLoadState) => void>()
let lastLoad: KokoroLoadState = null

function emitLoad(e: KokoroLoadState): void {
  lastLoad = e
  loadListeners.forEach((cb) => cb(e))
}

/**
 * 订阅模型加载状态；返回取消订阅函数。
 *
 * 订阅瞬间先回放当前状态：预加载在应用挂载时就开始了，晚订阅的人（TTS 页）
 * 否则只会看到「加载中」的空白，甚至错过整段下载进度。
 */
export function subscribeKokoroLoad(cb: (e: KokoroLoadState) => void): () => void {
  cb(lastLoad)
  loadListeners.add(cb)
  return () => { loadListeners.delete(cb) }
}

/* ── Worker 生命周期 ─────────────────────────────────── */

interface PendingRequest {
  resolve: (r: KokoroSynthesisResult) => void
  reject: (e: Error) => void
  onSentenceProgress?: (done: number, total: number) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingRequest>()

function failAllPending(message: string): void {
  pending.forEach((p) => p.reject(new Error(message)))
  pending.clear()
}

function handleMessage(e: MessageEvent<KokoroWorkerResponse>): void {
  const msg = e.data
  switch (msg.type) {
    case 'load':
      emitLoad(msg.event)
      break
    case 'progress':
      pending.get(msg.id)?.onSentenceProgress?.(msg.done, msg.total)
      break
    case 'done': {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      p?.resolve(msg.result)
      break
    }
    case 'aborted':
      // 取消时主线程已经 reject 并移除，这里通常无事可做
      pending.delete(msg.id)
      break
    case 'error': {
      if (msg.id === null) {
        emitLoad(null)
        console.warn('[kokoro-tts] 模型加载失败:', msg.message)
        break
      }
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      p?.reject(new Error(msg.message))
      break
    }
  }
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./kokoro-worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', (e) => {
      failAllPending(`Kokoro Worker 异常：${e.message || '未知错误'}`)
      // worker 可能已经不可用，销毁掉让下次调用重建，避免请求永远挂住
      worker?.terminate()
      worker = null
      emitLoad(null)
    })
  }
  return worker
}

/** 启动 worker 并让它加载模型；模型常驻 worker，避免每次生成都重新加载 */
function ensureModelLoaded(): void {
  const req: KokoroWorkerRequest = { type: 'init', modelId: currentModelId }
  ensureWorker().postMessage(req)
}

/** 设置 Kokoro 模型来源 ID（需在首次加载前调用） */
export function setKokoroModelId(id: string): void {
  if (id && id !== currentModelId) {
    currentModelId = id
    // 模型换了：原 worker 里那个已经作废，销毁后下次调用会用新 modelId 重建
    failAllPending('Kokoro 模型已切换')
    worker?.terminate()
    worker = null
    emitLoad(null)
  }
}

/** 获取当前模型 ID */
export function getKokoroModelId(): string {
  return currentModelId
}

/** 静默预加载模型（启动时调用，失败不抛异常） */
export function preloadKokoroModel(): void {
  try {
    ensureModelLoaded()
  } catch (err) {
    console.warn('[kokoro-tts] 预加载失败（不影响后续使用）:', err)
  }
}

/* ── 合成 ─────────────────────────────────────────────── */

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
  /** 模型/音色加载进度订阅（本次生成期间有效） */
  onLoad?: (e: KokoroLoadState) => void
}

export async function generateKokoroTts(options: KokoroGenerateOptions): Promise<KokoroTtsResult> {
  const { text, voice, speed, signal, onSentenceProgress, onLoad } = options

  if (splitTtsSentences(text).length === 0) throw new Error('文本为空，无法合成语音')
  if (signal?.aborted) throw new DOMException('已取消生成', 'AbortError')

  const unsubscribe = onLoad ? subscribeKokoroLoad(onLoad) : () => {}
  try {
    const id = nextId++
    const w = ensureWorker()
    let detachAbort: () => void = () => {}

    const result = await new Promise<KokoroSynthesisResult>((resolve, reject) => {
      const finish = (fn: () => void) => {
        detachAbort()
        fn()
      }

      pending.set(id, {
        resolve: (r) => finish(() => resolve(r)),
        reject: (e) => finish(() => reject(e)),
        onSentenceProgress,
      })

      const onAbort = () => {
        // 主线程立刻失败，不等 worker 跑完当前句 —— 单句推理无法中断，
        // worker 收到 cancel 后会在句与句之间停下
        if (pending.delete(id)) {
          w.postMessage({ type: 'cancel', id })
          finish(() => reject(new DOMException('已取消生成', 'AbortError')))
        }
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        detachAbort = () => signal.removeEventListener('abort', onAbort)
      }

      const req: KokoroWorkerRequest = { type: 'generate', id, text, voice, speed }
      w.postMessage(req)
    })

    return {
      taskId: `tts_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      blob: encodeWav(result.samples, result.sampleRate),
      sampleRate: result.sampleRate,
      durationMs: result.durationMs,
      timings: result.timings,
      srt: buildSrt(result.timings),
    }
  } finally {
    unsubscribe()
  }
}