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
    if (!group.some((l) => parseSrtTimingLine(l) != null)) {
      if (group.some((l) => l.trim().length > 0)) throw new SubtitleParseError('时间戳格式无法识别', firstLine)
      group = []
      return
    }
    // 块间缺失空行（手编/拼接错误的 SRT 常见）：文本区再次出现时间轴行
    // （或「序号+时间轴」组合）时按下一块边界切分，而不是把后续块的序号与
    // 时间轴吞进上一块文本后静默丢失（评审 #17）。
    let i = 0
    while (i < group.length) {
      const timing = parseSrtTimingLine(group[i])
      if (timing == null) {
        // 时间轴之前的行只允许是序号（含游离序号，直接忽略）；
        // 报错行号指向真正的杂行，而非块首行
        if (PURE_INDEX_RE.test(group[i].trim())) { i++; continue }
        throw new SubtitleParseError('时间戳前出现无法识别的内容', firstLine + i)
      }
      const blockLine = firstLine + i
      i++
      const textLines: string[] = []
      while (i < group.length) {
        if (parseSrtTimingLine(group[i]) != null) break // 下一块时间轴（缺空行拼接）
        if (
          PURE_INDEX_RE.test(group[i].trim()) &&
          i + 1 < group.length &&
          parseSrtTimingLine(group[i + 1]) != null
        ) break // 下一块的序号+时间轴
        const t = group[i].trim()
        if (t) textLines.push(t)
        i++
      }
      if (textLines.length > 0) blocks.push({ startMs: timing.startMs, endMs: timing.endMs, lines: textLines, lineNo: blockLine })
    }
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
