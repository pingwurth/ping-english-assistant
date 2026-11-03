/**
 * LRC 解析 —— 真源：docs/系统架构设计.md §2.4
 *
 * 一行可含多个时间标签（展开为多句）；元数据标签（[ti:] 等）不匹配数字格式自动跳过。
 * LRC 无结束时间：endMs 统一置 -1，由上层按"下一句 startMs / 末句 totalDurationMs"补齐。
 * 容错：行中段的 [xx:yy] 括注（舞台指示/[Chorus: 2] 等）属歌词内容只剥离时间形态标签；
 * 增强型 LRC（A2）逐词时间标签 <mm:ss.xx> 剥离为一个空格，不混入词表。
 */

import { SubtitleParseError } from './errors'
import { extractLrcTimestamp } from './timestamp'
import type { RawBlock } from './srt'

/** 行首可剥离的标签串：时间标签与元数据标签（[ti:] / [offset:] 等）的任意组合，仅限行首 */
const LRC_HEAD_TAGS_RE = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]|\[\w+:[^\]]*\])+/
/** 行内残留的时间形态标签（卡拉OK逐句标签），任何位置都剥离 */
const LRC_INLINE_TS_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g
/** 增强型 LRC（A2）逐词时间标签：剥离并把两侧空白收敛为一个空格 */
const LRC_WORD_TS_RE = /\s*<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>\s*/g
/** [offset:±ms] 全局时间轴平移（LRC 规范标签）：正值提前（有效时间 = 标签时间 − offset），负值延后 */
const LRC_OFFSET_RE = /\[offset:([+-]?\d+(?:\.\d+)?)\]/i

export function parseLrc(text: string): RawBlock[] {
  const lines = text.split(/\r?\n/)
  // [offset:] 预扫描（惯例在文件头部；出现在任意行均生效，首个为准）：
  // 此前该标签被当普通元数据丢弃、数值无人消费，带 offset 的 LRC 全部时间轴错位
  let offsetMs = 0
  for (const raw of lines) {
    const m = raw.trim().match(LRC_OFFSET_RE)
    if (m) {
      const v = Number(m[1])
      if (Number.isFinite(v)) offsetMs = Math.round(v)
      break
    }
  }
  const blocks: RawBlock[] = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const stamps = extractLrcTimestamp(line)
    if (stamps.length === 0) return // 元数据行（[ti:...]）或无时间标签的杂行
    const content = line
      .replace(LRC_INLINE_TS_RE, '')
      .replace(LRC_HEAD_TAGS_RE, '')
      .replace(LRC_WORD_TS_RE, ' ')
      .trim()
    if (!content) return
    for (const startMs of stamps) blocks.push({ startMs: Math.max(0, startMs - offsetMs), endMs: -1, lines: [content], lineNo: i + 1 })
  })
  if (blocks.length === 0) throw new SubtitleParseError('未解析到任何歌词行', 1)
  return blocks
}
