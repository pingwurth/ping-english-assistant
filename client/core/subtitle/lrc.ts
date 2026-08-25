/**
 * LRC 解析 —— 真源：docs/系统架构设计.md §2.4
 *
 * 一行可含多个时间标签（展开为多句）；元数据标签（[ti:] 等）不匹配数字格式自动跳过。
 * LRC 无结束时间：endMs 统一置 -1，由上层按"下一句 startMs / 末句 totalDurationMs"补齐。
 */

import { SubtitleParseError } from './errors'
import { extractLrcTimestamp } from './timestamp'
import type { RawBlock } from './srt'

const LRC_TS_HEAD_RE = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+|\[\w+:[^\]]*\]/g

export function parseLrc(text: string): RawBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: RawBlock[] = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const stamps = extractLrcTimestamp(line)
    if (stamps.length === 0) return // 元数据行（[ti:...]）或无时间标签的杂行
    const content = line.replace(LRC_TS_HEAD_RE, '').trim()
    if (!content) return
    for (const startMs of stamps) blocks.push({ startMs, endMs: -1, lines: [content], lineNo: i + 1 })
  })
  if (blocks.length === 0) throw new SubtitleParseError('未解析到任何歌词行', 1)
  return blocks
}
