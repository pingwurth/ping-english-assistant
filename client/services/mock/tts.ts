/**
 * Mock TTS（契约⑥ POST /api/v1/tts/generate · 契约⑦ GET /api/v1/tts/subtitle/:taskId）
 * —— 真源：docs/系统架构设计.md §3.3 契约⑥⑦ / §3.4 Kokoro-82M
 *
 * 离线模拟 Kokoro 合成：
 *  - 分句：按 [.!?;:\n] 切分（保留标点归属前句）；
 *  - 时长：按句长等比估算（约 15 字符/秒，句最短 400ms），语速除以 speed；
 *  - 时间轴：句间留 120ms 静音间隙，逐句累计 startMs/endMs；
 *  - SRT：契约⑦格式（序号 + HH:MM:SS,mmm 时间轴 + 句文本）；
 *  - 音频：core/audio/wav-encoder.ts 生成低音量正弦占位音（每句一个基频、
 *    句间静音），总时长与时间轴一致 —— 导入后播放器可真实逐句 seek；
 *  - taskId：`tts_` + base36 时间戳 + 随机后缀（字幕领取凭据）。
 *
 * 字幕缓存：模块级 Map（LRU 500 条，对齐契约⑦后端内存缓存语义）；
 * getSubtitle 未命中抛 ApiError code 'SUBTITLE_NOT_FOUND'。
 * 纯 TS 零浏览器特有 API（Node 18+ 可测）；AbortSignal 中止抛 ApiError('ABORTED')。
 */

import type { TtsGenerateRequest, TtsGenerateResponseMeta, TtsSubtitleResponse } from '../../types/api'
import type { TtsGenerateResult, TtsService } from '../contracts'
import { abortableDelay, ApiError, throwIfAborted } from '../contracts'
import { encodeWav, TARGET_SAMPLE_RATE } from '../../core/audio/wav-encoder'

/** 契约⑥ text 上限（字符） */
export const TTS_MAX_TEXT_LENGTH = 5000

/** 分句切分符（契约 §3.4：句级时间轴为分句合成真实边界） */
const SENTENCE_SPLIT_RE = /[.!?;:\n]+/

/** 估算参数：英文朗读约 15 字符/秒；句最短 400ms；句间静音 120ms */
const CHARS_PER_SECOND = 15
const MIN_SENTENCE_MS = 400
const GAP_MS = 120

/** 字幕缓存上限（对齐契约⑦ LRU 500 条） */
const SUBTITLE_CACHE_MAX = 500

export interface TtsSentenceTiming {
  index: number
  text: string
  startMs: number
  endMs: number
}

export interface MockTtsOptions {
  /** 各阶段延迟的缩放系数（默认 1；测试可传 0 加速） */
  paceScale?: number
  /** 分句进度回调：已合成句数 / 总句数（generate 内部逐句模拟时调用） */
  onProgress?: (done: number, total: number) => void
  /** 测试钩子：覆盖延迟实现 */
  delayImpl?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * 按 [.!?;:\n] 分句：标点归属前句；空白/纯标点片段丢弃。
 * 无标点时整段作为单句返回。
 */
export function splitTtsSentences(text: string): string[] {
  const out: string[] = []
  let buf = ''
  const push = (raw: string) => {
    const s = raw.trim()
    // 至少含一个字母/数字才算有效句（过滤纯标点碎片）
    if (s && /[\p{L}\p{N}]/u.test(s)) out.push(s)
  }
  for (const ch of text) {
    buf += ch
    if (SENTENCE_SPLIT_RE.test(ch)) {
      push(buf)
      buf = ''
    }
  }
  push(buf)
  return out
}

/** 单句时长估算：按句长等比（chars / 15 秒），下限 MIN_SENTENCE_MS，再按语速缩放 */
export function estimateSentenceMs(text: string, speed: number): number {
  const base = Math.max(MIN_SENTENCE_MS, Math.round((text.length / CHARS_PER_SECOND) * 1000))
  const spd = Math.max(0.5, Math.min(2, speed))
  return Math.max(100, Math.round(base / spd))
}

/** 句级时间轴：逐句累计，句间留 GAP_MS 静音；总时长 = 末句 endMs */
export function buildTtsTimeline(sentences: string[], speed: number): { timings: TtsSentenceTiming[]; durationMs: number } {
  const timings: TtsSentenceTiming[] = []
  let cursor = 0
  sentences.forEach((text, i) => {
    const dur = estimateSentenceMs(text, speed)
    timings.push({ index: i, text, startMs: cursor, endMs: cursor + dur })
    cursor += dur + GAP_MS
  })
  return { timings, durationMs: sentences.length > 0 ? cursor - GAP_MS : 0 }
}

/** 毫秒 → SRT 时间戳 `HH:MM:SS,mmm`（契约⑦格式） */
export function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const ms3 = t % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms3).padStart(3, '0')}`
}

/** 时间轴 → SRT 文本（契约⑦：序号 + 时间轴行 + 句文本，块间空行） */
export function buildSrt(timings: TtsSentenceTiming[]): string {
  return timings
    .map((t) => `${t.index + 1}\n${srtTime(t.startMs)} --> ${srtTime(t.endMs)}\n${t.text}`)
    .join('\n\n')
}

/** 占位音 WAV：每句一个低音量正弦基频（按句序变化），句间静音；时长对齐时间轴 */
function synthesizePlaceholderWav(timings: TtsSentenceTiming[], durationMs: number): Blob {
  const total = Math.max(1, Math.round((durationMs / 1000) * TARGET_SAMPLE_RATE))
  const samples = new Float32Array(total)
  for (const t of timings) {
    const freq = 196 + (t.index % 6) * 55 // G3 起的五度系基频，句序变化便于听辨边界
    const start = Math.floor((t.startMs / 1000) * TARGET_SAMPLE_RATE)
    const end = Math.min(total, Math.floor((t.endMs / 1000) * TARGET_SAMPLE_RATE))
    for (let i = start; i < end; i++) {
      const local = (i - start) / TARGET_SAMPLE_RATE
      const span = Math.max(0.05, (t.endMs - t.startMs) / 1000)
      // 首尾 30ms 淡入淡出，避免爆音；振幅 0.05（低音量提示音）
      const fade = Math.min(1, local / 0.03, (span - local) / 0.03)
      samples[i] = Math.sin(2 * Math.PI * freq * local) * 0.05 * Math.max(0, fade)
    }
  }
  return encodeWav(samples)
}

/** 生成字幕领取凭据 taskId（`tts_` 前缀，对齐契约⑥ X-Tts-Task-Id 示例风格） */
function generateTaskId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `tts_${Date.now().toString(36)}${rand}`
}

/** 字幕缓存（taskId → SRT；FIFO 淘汰到 SUBTITLE_CACHE_MAX 以内） */
const subtitleCache = new Map<string, { srt: string; sentenceCount: number }>()
function cacheSubtitle(taskId: string, srt: string, sentenceCount: number): void {
  if (subtitleCache.size >= SUBTITLE_CACHE_MAX) {
    const first = subtitleCache.keys().next().value as string | undefined
    if (first !== undefined) subtitleCache.delete(first)
  }
  subtitleCache.set(taskId, { srt, sentenceCount })
}

/** 契约⑥⑦ mock 实现（确定性、离线可用、零网络） */
export class MockTtsService implements TtsService {
  constructor(private readonly options: MockTtsOptions = {}) {}

  async generate(request: TtsGenerateRequest, signal?: AbortSignal): Promise<TtsGenerateResult> {
    const pace = this.options.paceScale ?? 1
    const delay = this.options.delayImpl ?? abortableDelay
    throwIfAborted(signal)

    // 契约⑥：text 上限 5000 字符，超限 400 → ApiError 'TEXT_TOO_LONG'
    if (request.text.length > TTS_MAX_TEXT_LENGTH) {
      throw new ApiError('TEXT_TOO_LONG', `文本超过 ${TTS_MAX_TEXT_LENGTH} 字符上限`, { length: request.text.length })
    }
    const sentences = splitTtsSentences(request.text)
    if (sentences.length === 0) {
      throw new ApiError('TEXT_EMPTY', '文本为空，无法合成语音')
    }

    // 排队（模拟模型加载）→ 逐句合成（进度回调）
    await delay(350 * pace, signal)
    for (let i = 0; i < sentences.length; i++) {
      const perSentenceMs = Math.max(60, Math.min(400, estimateSentenceMs(sentences[i]!, request.speed) / 4))
      await delay(perSentenceMs * pace, signal)
      this.options.onProgress?.(i + 1, sentences.length)
    }

    const speed = Math.max(0.5, Math.min(2, request.speed))
    const { timings, durationMs } = buildTtsTimeline(sentences, speed)
    const taskId = generateTaskId()
    if (request.withSubtitle) cacheSubtitle(taskId, buildSrt(timings), sentences.length)

    const meta: TtsGenerateResponseMeta = { taskId, durationMs, sentenceCount: sentences.length }
    return { audio: synthesizePlaceholderWav(timings, durationMs), meta }
  }

  async getSubtitle(taskId: string, signal?: AbortSignal): Promise<TtsSubtitleResponse> {
    throwIfAborted(signal)
    const hit = subtitleCache.get(taskId)
    if (!hit) throw new ApiError('SUBTITLE_NOT_FOUND', '字幕不存在或已过期（缓存 TTL 10 分钟）', { taskId })
    return { srt: hit.srt, sentenceCount: hit.sentenceCount }
  }
}
