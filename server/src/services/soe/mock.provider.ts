/**
 * Mock SOE provider —— client/services/mock/soe.ts 的服务端移植（联调与降级用）。
 * 评分算法逐行一致：以 hash(refText + '#' + 时长ms) 为种子的确定性伪评分，同输入必得同输出，
 * 前端 mock 与本 provider 对同一音频/文本产出相同结果，便于端到端比对。
 */

import type { SoeEvaluateResponse, SoeInput, SoeProvider } from './soe-provider'

/** FNV-1a 32bit 字符串哈希（与 client mock 同实现） */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 从标准 WAV 解析时长（ms）；不可得时按 16kHz 单声道 16bit 字节率估算 */
function estimateDurationMs(audio: Buffer): number {
  if (audio.length === 0) return 0
  if (audio.length >= 44) {
    const tag = (off: number, len: number): string => audio.subarray(off, off + len).toString('latin1')
    if (tag(0, 4) === 'RIFF' && tag(8, 4) === 'WAVE') {
      const sampleRate = audio.readUInt32LE(24)
      const blockAlign = audio.readUInt16LE(32)
      let off = 12
      while (sampleRate && blockAlign && off + 8 <= audio.length) {
        const size = audio.readUInt32LE(off + 4)
        if (tag(off, 4) === 'data') return Math.round((size / blockAlign / sampleRate) * 1000)
        off += 8 + size + (size & 1)
      }
    }
  }
  return Math.round((audio.length / 32000) * 1000)
}

const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)))

/** 按空格切词并剥离首尾标点（保留撇号） */
function tokenize(refText: string): string[] {
  return refText
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ''))
    .filter(Boolean)
}

/** 词形 → 伪音标（与 client mock 同实现） */
function mockPhonemes(word: string, wordScore: number, seed: number): Array<{ symbol: string; score: number }> {
  const VOWELS: Record<string, string> = { a: 'æ', e: 'ɛ', i: 'ɪ', o: 'ɑː', u: 'ʌ' }
  const symbols: string[] = []
  for (const ch of word.toLowerCase()) {
    if (VOWELS[ch]) symbols.push(VOWELS[ch])
    else if (/[a-z]/.test(ch)) symbols.push(ch)
    if (symbols.length >= 3) break
  }
  if (symbols.length === 0) symbols.push('ə')
  return symbols.map((symbol, i) => {
    const offset = ((seed >>> (i * 3)) % 15) - 7
    return { symbol, score: clampScore(wordScore + offset) }
  })
}

async function evaluate(input: SoeInput): Promise<SoeEvaluateResponse> {
  const durationMs = estimateDurationMs(input.audio)
  const seed = fnv1a(`${input.refText}#${durationMs}`)
  const total = 70 + (seed % 26) // [70, 95]
  const accuracy = clampScore(total + ((seed >>> 8) % 13) - 6)
  const fluency = clampScore(total + ((seed >>> 16) % 13) - 6)
  const integrity = clampScore(total + ((seed >>> 24) % 11) - 3)

  const words = tokenize(input.refText).map((text, i) => {
    const score = (seed + i * 7) % 11 === 0 ? 35 + ((seed + i) % 25) : 70 + ((seed + i * 13) % 28)
    return { text, score, phonemes: mockPhonemes(text, score, seed + i) }
  })

  return { total, accuracy, fluency, integrity, words }
}

export function createMockSoeProvider(): SoeProvider {
  return { name: 'mock', evaluate }
}
