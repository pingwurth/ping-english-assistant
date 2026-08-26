/**
 * 字幕解析入口 —— 真源：docs/系统架构设计.md §2.4 core/subtitle
 *
 * parseSubtitle(text, format?)：自动嗅探 SRT/LRC（可显式指定），失败抛出带行号的 SubtitleParseError。
 * 纯 TS、零 React 依赖、node 可测。
 */

import type { SubtitleData, SubtitleSentence } from '../../types/subtitle'
import { SubtitleParseError } from './errors'
import { parseSrt } from './srt'
import { parseLrc } from './lrc'
import { detectBilingual, splitBilingual, splitWords } from './bilingual'
import { formatSrtTimestamp } from './timestamp'
import type { RawBlock } from './srt'

export { SubtitleParseError } from './errors'
export { parseSrtTimestamp, parseLrcTimestamp, formatSrtTimestamp } from './timestamp'
export { parseSrt } from './srt'
export { parseLrc } from './lrc'
export { isCJK, splitBilingual, splitWords, detectBilingual } from './bilingual'

const SRT_SNIFF_RE = /\d{1,2}:\d{1,2}:\d{1,2}[,.]\d{1,3}\s*-->/
const LRC_SNIFF_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/

/** 自动嗅探格式（调用方未指定时） */
function sniffFormat(text: string): 'srt' | 'lrc' {
  if (SRT_SNIFF_RE.test(text)) return 'srt'
  if (LRC_SNIFF_RE.test(text)) return 'lrc'
  throw new SubtitleParseError('无法识别字幕格式（既非 SRT 也非 LRC）', 1)
}

function blockToSentence(block: RawBlock, index: number): SubtitleSentence {
  const { textEn, textZh } = splitBilingual(block.lines)
  return { index, startMs: block.startMs, endMs: block.endMs, textEn, textZh, words: splitWords(textEn) }
}

/**
 * 解析字幕文本为 SubtitleData。
 * @param text            字幕文件全文（允许带 UTF-8 BOM）
 * @param format          显式格式；缺省时自动嗅探
 * @param knownDurationMs 可选：已探测的媒体真实时长（ms）。仅 LRC 生效——
 *                        回填末句 endMs（LRC 无结束时间，末句 endMs=startMs 会
 *                        导致 playRange 立即暂停与 A-B 循环失效）；晚于末句起点时
 *                        才采纳，否则保持退化行为由播放侧兜底
 */
export function parseSubtitle(text: string, format?: 'srt' | 'lrc', knownDurationMs?: number): SubtitleData {
  const clean = text.replace(/^\uFEFF/, '')
  if (!clean.trim()) throw new SubtitleParseError('字幕内容为空', 1)
  const fmt = format ?? sniffFormat(clean)

  if (fmt === 'srt') {
    const blocks = parseSrt(clean).sort((a, b) => a.startMs - b.startMs)
    const sentences = blocks.map((b, i) => blockToSentence(b, i))
    const totalDurationMs = sentences.reduce((max, s) => Math.max(max, s.endMs), 0)
    return { format: 'srt', isBilingual: detectBilingual(sentences), sentences, totalDurationMs }
  }

  // LRC：无结束时间 → endMs = 下一句 startMs；末句 endMs = knownDurationMs（优先）
  // 或末句 startMs（退化；文档 §2.4 规则 5）
  const blocks = parseLrc(clean).sort((a, b) => a.startMs - b.startMs)
  const lastStartMs = blocks[blocks.length - 1].startMs
  const known = knownDurationMs != null && Number.isFinite(knownDurationMs) ? Math.round(knownDurationMs) : undefined
  const totalDurationMs = known != null && known > lastStartMs ? known : lastStartMs
  const sentences = blocks.map((b, i) => {
    const endMs = i < blocks.length - 1 ? blocks[i + 1].startMs : totalDurationMs
    return blockToSentence({ ...b, endMs }, i)
  })
  return { format: 'lrc', isBilingual: detectBilingual(sentences), sentences, totalDurationMs }
}

/** 将 SubtitleSentence[] 导出为 SRT 格式文本 */
export function exportSrt(sentences: SubtitleSentence[]): string {
  return sentences.map((s, i) => {
    const timing = `${formatSrtTimestamp(s.startMs)} --> ${formatSrtTimestamp(s.endMs)}`
    const lines = [s.textEn]
    if (s.textZh) lines.push(s.textZh)
    return `${i + 1}\n${timing}\n${lines.join('\n')}\n`
  }).join('\n')
}
