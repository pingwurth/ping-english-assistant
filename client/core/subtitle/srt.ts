/**
 * SRT 解析 —— 真源：docs/系统架构设计.md §2.4
 *
 * 容错（参考 srt-parser-2）：分隔符 ,/. 兼容；块间空行数量不敏感；序号缺失按出现顺序补号；
 * 解析失败抛出带行号的 SubtitleParseError。
 */

import { SubtitleParseError } from './errors'
import { parseSrtTimingLine } from './timestamp'

/** 原始字幕块（未做双语拆分） */
export interface RawBlock {
  startMs: number
  /** LRC 无结束时间时为 -1，由上层补齐 */
  endMs: number
  /** 块内文本行（已去序号行与时间轴行） */
  lines: string[]
  /** 块首行号（1 基），用于错误提示 */
  lineNo: number
}

const PURE_INDEX_RE = /^\d+$/

export function parseSrt(text: string): RawBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: RawBlock[] = []
  let group: string[] = []
  let groupStartLine = 1

  const flush = () => {
    if (group.length === 0) return
    const firstLine = groupStartLine
    const timingIdx = group.findIndex((l) => parseSrtTimingLine(l) != null)
    const content = group.filter((l) => l.trim().length > 0)
    if (timingIdx < 0) {
      if (content.length > 0) throw new SubtitleParseError('时间戳格式无法识别', firstLine)
      group = []
      return
    }
    const timing = parseSrtTimingLine(group[timingIdx])
    if (!timing) throw new SubtitleParseError('时间戳格式无法识别', firstLine + timingIdx)
    // 时间轴之前的行只允许是序号（缺失时按出现顺序补号，此处直接忽略）
    const before = group.slice(0, timingIdx).filter((l) => l.trim().length > 0)
    if (before.some((l) => !PURE_INDEX_RE.test(l.trim()))) throw new SubtitleParseError('时间戳前出现无法识别的内容', firstLine)
    const textLines = group.slice(timingIdx + 1).map((l) => l.trim()).filter(Boolean)
    if (textLines.length > 0) blocks.push({ startMs: timing.startMs, endMs: timing.endMs, lines: textLines, lineNo: firstLine })
    group = []
  }

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    if (line.trim().length === 0) { flush(); groupStartLine = i + 2; return }
    if (group.length === 0) groupStartLine = i + 1
    group.push(line)
  })
  flush()

  if (blocks.length === 0) throw new SubtitleParseError('未解析到任何字幕块', 1)
  return blocks
}
