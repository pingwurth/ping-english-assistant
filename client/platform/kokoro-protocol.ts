/**
 * Kokoro 主线程 ↔ Worker 的消息协议与共享类型。
 *
 * 单独成一个模块，避免 kokoro-tts.ts（门面）与 kokoro-worker.ts（推理）互相 import
 * 把对方的实现也拖进自己的 bundle —— worker 里不该出现 DOM 相关代码。
 */

import type { TtsSentenceTiming } from '@/services/mock/tts'

export type KokoroLoadPhase =
  /** 命中磁盘缓存，正在读本地文件 */
  | 'loading'
  /** 磁盘没有，正在从 huggingface.co 下载（下载完会落盘） */
  | 'downloading'
  /** 文件已就位，正在建 ONNX 会话 */
  | 'initializing'

export interface KokoroLoadEvent {
  phase: KokoroLoadPhase
  /** 当前处理中的文件名 */
  file?: string
  /** 下载百分比 0-100（只有 downloading 阶段拿得到） */
  percent?: number
}

/** 加载状态；null = 已就绪，没有正在进行的加载 */
export type KokoroLoadState = KokoroLoadEvent | null

/** Worker 回传的合成产物：已按句拼接、含句间静音的 PCM */
export interface KokoroSynthesisResult {
  sampleRate: number
  samples: Float32Array
  durationMs: number
  timings: TtsSentenceTiming[]
}

export type KokoroWorkerRequest =
  /** 启动 worker 并开始加载模型（幂等，模型常驻 worker） */
  | { type: 'init'; modelId: string }
  | { type: 'generate'; id: number; text: string; voice: string; speed: number }
  /** 请求取消某次生成；单句推理无法中断，worker 会在句间停下 */
  | { type: 'cancel'; id: number }

export type KokoroWorkerResponse =
  | { type: 'load'; event: KokoroLoadState }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'done'; id: number; result: KokoroSynthesisResult }
  | { type: 'aborted'; id: number }
  /** id 为 null 表示模型加载阶段的错误（不属于某次生成） */
  | { type: 'error'; id: number | null; message: string }