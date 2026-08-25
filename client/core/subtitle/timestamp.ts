/**
 * 时间戳解析 —— 真源：docs/系统架构设计.md §2.4
 * SRT "hh:mm:ss,mmm"（兼容 "." 分隔）与 LRC "[mm:ss.xx]" → 毫秒。
 * 纯函数、零依赖、node 可测。
 */

const SRT_TS_RE = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/
const SRT_TIMING_RE = /^(\d{1,2}:\d{1,2}:\d{1,2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}:\d{1,2}[,.]\d{1,3})/
const LRC_TS_RE = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]$/
const LRC_TS_ALL_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g

/** "hh:mm:ss,mmm" → ms；无法识别返回 null */
export function parseSrtTimestamp(raw: string): number | null {
  const m = raw.trim().match(SRT_TS_RE)
  if (!m) return null
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0'))
}

/** 解析 SRT 时间轴行 "00:00:02,610 --> 00:00:05,000"；非时间轴行返回 null */
export function parseSrtTimingLine(line: string): { startMs: number; endMs: number } | null {
  const m = line.trim().match(SRT_TIMING_RE)
  if (!m) return null
  const startMs = parseSrtTimestamp(m[1])
  const endMs = parseSrtTimestamp(m[2])
  if (startMs == null || endMs == null) return null
  return { startMs, endMs }
}

/** "[mm:ss.xx]" → ms；无法识别返回 null */
export function parseLrcTimestamp(raw: string): number | null {
  const m = raw.match(LRC_TS_RE)
  if (!m) return null
  const frac = m[3] ?? '0'
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number(frac.padEnd(3, '0'))
}

/** 提取 LRC 行首的全部时间标签（一行多标签如 [00:12.30][01:12.30] 展开为多个起点） */
export function extractLrcTimestamp(line: string): number[] {
  const head = line.match(/^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)/)
  if (!head) return []
  return (head[1].match(LRC_TS_ALL_RE) ?? []).map((t) => parseLrcTimestamp(t)).filter((v): v is number => v != null)
}
