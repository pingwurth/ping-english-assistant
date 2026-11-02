/** ASR 上游与 WhisperX 共用的音频元数据 / 词级时间轴工具 */
import type { AsrSegment } from './types'

export interface WordTimestamp {
  word: string
  /** 秒；WhisperX 使用秒，DashScope 转换后也归一到秒 */
  start: number
  end: number
}

/** 从扩展名推断常见音频 MIME；未知扩展名沿用调用方 fallback（通常是 Blob.type） */
export function inferMimeType(filename: string, fallback: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    webm: 'audio/webm',
  }
  return map[ext || ''] || fallback
}

/** 词级时间戳 → 句子级 segments（DashScope 原生时间戳与 WhisperX 对齐共用） */
export function groupWordsToSegments(words: WordTimestamp[]): AsrSegment[] {
  if (words.length === 0) return []

  const segments: AsrSegment[] = []
  const sentenceEnders = /[.!?]/
  const clauseBreaks = /[,;:]/
  let currentWords: WordTimestamp[] = []

  const flush = () => {
    if (currentWords.length === 0) return
    if (segments.length > 0 && currentWords.length <= 3) {
      const last = segments[segments.length - 1]!
      const merged = buildSegment(currentWords)
      segments[segments.length - 1] = {
        startMs: last.startMs,
        endMs: merged.endMs,
        text: `${last.text} ${merged.text}`,
      }
    } else {
      segments.push(buildSegment(currentWords))
    }
    currentWords = []
  }

  for (const word of words) {
    currentWords.push(word)
    const cleanWord = word.word.trim()
    const isSentenceEnd = sentenceEnders.test(cleanWord)
    const isLongClause = clauseBreaks.test(cleanWord) && currentWords.length >= 8
    if (isSentenceEnd || isLongClause) flush()
  }
  flush()

  return segments
}

function buildSegment(words: WordTimestamp[]): AsrSegment {
  return {
    startMs: Math.round((words[0]?.start ?? 0) * 1000),
    endMs: Math.round((words[words.length - 1]?.end ?? 0) * 1000),
    text: words.map((w) => w.word.trim()).join(' ').trim(),
  }
}
