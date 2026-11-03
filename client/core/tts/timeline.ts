/** TTS 分句与字幕时间轴 —— 云端 BFF / Kokoro / mock 共用的纯 TS 规则 */
import { exportSrtRows } from '@/core/subtitle'

/** 契约⑥ text 上限（字符） */
export const TTS_MAX_TEXT_LENGTH = 5000

/** 分句切分符（契约 §3.4：句级时间轴为分句合成真实边界） */
const SENTENCE_SPLIT_RE = /[.!?;:\n]+/

/** 估算参数：英文朗读约 15 字符/秒；句最短 400ms；句间静音 120ms */
const CHARS_PER_SECOND = 15
const MIN_SENTENCE_MS = 400
export const TTS_SENTENCE_GAP_MS = 120

export interface TtsSentenceTiming {
  index: number
  text: string
  startMs: number
  endMs: number
}

/** 按 [.!?;:\n] 分句：标点归属前句；空白/纯标点片段丢弃。
 *  数字语境例外：10:30 / $3.50 / 3.5 中的 . : ; 不是句界 —— 切开会让本地 TTS
 *  把一个数字读成多句（句间插 120ms 静音、韵律重置），SRT cue 边界也落在数字中间。 */
export function splitTtsSentences(text: string): string[] {
  const out: string[] = []
  let buf = ''
  const push = (raw: string) => {
    const sentence = raw.trim()
    if (sentence && /[\p{L}\p{N}]/u.test(sentence)) out.push(sentence)
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    buf += ch
    if (SENTENCE_SPLIT_RE.test(ch)) {
      const prev = text[i - 1]
      const next = text[i + 1]
      const betweenDigits = !!prev && !!next && /[0-9]/.test(prev) && /[0-9]/.test(next)
      if (!betweenDigits) {
        push(buf)
        buf = ''
      }
    }
  }
  push(buf)
  return out
}

/** 单句时长估算：按句长等比，下限 400ms，再按语速缩放 */
export function estimateSentenceMs(text: string, speed: number): number {
  const base = Math.max(MIN_SENTENCE_MS, Math.round((text.length / CHARS_PER_SECOND) * 1000))
  const normalizedSpeed = Math.max(0.5, Math.min(2, speed))
  return Math.max(100, Math.round(base / normalizedSpeed))
}

/** 句级时间轴：逐句累计，句间留 120ms 静音 */
export function buildTtsTimeline(sentences: string[], speed: number): { timings: TtsSentenceTiming[]; durationMs: number } {
  const timings: TtsSentenceTiming[] = []
  let cursor = 0
  sentences.forEach((text, index) => {
    const duration = estimateSentenceMs(text, speed)
    timings.push({ index, text, startMs: cursor, endMs: cursor + duration })
    cursor += duration + TTS_SENTENCE_GAP_MS
  })
  return { timings, durationMs: sentences.length > 0 ? cursor - TTS_SENTENCE_GAP_MS : 0 }
}

/** 毫秒 → SRT 时间戳 —— 保留历史兼容导出；唯一实现见 core/subtitle */
export { formatSrtTimestamp as srtTime } from '@/core/subtitle'

/** 时间轴 → SRT 文本 */
export function buildSrt(timings: TtsSentenceTiming[]): string {
  return exportSrtRows(timings.map((timing) => ({
    startMs: timing.startMs,
    endMs: timing.endMs,
    lines: [timing.text],
  })))
}
