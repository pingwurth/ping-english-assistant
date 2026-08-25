/**
 * Mock SOE（契约② POST /api/v1/soe/evaluate）—— 真源：docs/系统架构设计.md §3.3 契约②
 *
 * 确定性伪评分：以 hash(refText + '#' + 音频时长ms) 为种子派生全部分数，
 * 同输入必得同输出（node 可测）。评分策略：
 * - total ∈ [70, 95]；accuracy/fluency/integrity 由 total 叠加维度偏移派生（clamp 0-100）
 * - words 逐词分数：7 分制取模规则使约 1/7 的词 <60（供 ScorePanel 标红规则验证，架构 §2.5）
 * - 每个词附带 2-3 个伪音标 phonemes（分数由词分派生）
 *
 * 延迟：300-800ms 均匀分布（可配置）；failRate（默认 0）概率抛
 * ApiError('SOE_UPSTREAM_ERROR')，供"评分失败降级"路径（原型设计 §6.3）测试。
 */

import type { SoeEvaluateResponse, SoePhonemeScore, SoeWordScore } from '../../types/api'
import { ApiError, abortableDelay, throwIfAborted, type SoeEvalMode, type SoeService } from '../contracts'

export interface MockSoeOptions {
  /** 模拟延迟范围 ms（默认 300-800） */
  latencyMinMs?: number
  latencyMaxMs?: number
  /** 失败概率 0-1（默认 0），用于降级路径测试 */
  failRate?: number
  /** 测试钩子：注入固定延迟（覆盖 latencyMin/Max），node 自测传 0 */
  delayImpl?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 测试钩子：注入固定随机数（覆盖 Math.random），node 自测传 () => 0.5 */
  randomImpl?: () => number
}

/** FNV-1a 32bit 字符串哈希（确定性种子） */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 从标准 WAV 解析时长（ms）；不可得时按 16kHz 单声道 16bit 字节率估算（与 mock/asr.ts 同策略） */
async function estimateDurationMs(audio: Blob): Promise<number> {
  if (audio.size === 0) return 0
  const buf = await audio.arrayBuffer()
  if (buf.byteLength >= 44) {
    const dv = new DataView(buf)
    const tag = (off: number, len: number) => String.fromCharCode(...new Uint8Array(buf, off, len))
    if (tag(0, 4) === 'RIFF' && tag(8, 4) === 'WAVE') {
      const sampleRate = dv.getUint32(24, true)
      const blockAlign = dv.getUint16(32, true)
      let off = 12
      while (sampleRate && blockAlign && off + 8 <= buf.byteLength) {
        const size = dv.getUint32(off + 4, true)
        if (tag(off, 4) === 'data') return Math.round((size / blockAlign / sampleRate) * 1000)
        off += 8 + size + (size & 1)
      }
    }
  }
  return Math.round((audio.size / 32000) * 1000)
}

/** 词形 → 伪音标（取元音字母映射 IPA 元音，辅音原样，最多 3 个） */
function mockPhonemes(word: string, wordScore: number, seed: number): SoePhonemeScore[] {
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

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 按空格切词并剥离首尾标点（保留撇号，如 don't；与架构 §2.4 words 规则一致） */
function tokenize(refText: string): string[] {
  return refText
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ''))
    .filter(Boolean)
}

export class MockSoeService implements SoeService {
  private readonly latencyMinMs: number
  private readonly latencyMaxMs: number
  private readonly failRate: number
  private readonly delayImpl: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly randomImpl: () => number

  constructor(options: MockSoeOptions = {}) {
    this.latencyMinMs = options.latencyMinMs ?? 300
    this.latencyMaxMs = options.latencyMaxMs ?? 800
    this.failRate = Math.max(0, Math.min(1, options.failRate ?? 0))
    this.delayImpl = options.delayImpl ?? abortableDelay
    this.randomImpl = options.randomImpl ?? Math.random
  }

  async evaluate(
    audio: Blob,
    refText: string,
    evalMode: SoeEvalMode,
    signal?: AbortSignal,
  ): Promise<SoeEvaluateResponse> {
    throwIfAborted(signal)
    if (evalMode !== 'sentence') {
      throw new ApiError('BAD_REQUEST', 'SOE 仅支持 evalMode=sentence（契约②）', { evalMode })
    }
    // 可配置失败率：随机命中即抛上游错误（供降级路径测试）
    if (this.failRate > 0 && this.randomImpl() < this.failRate) {
      await this.delayImpl(this.latencyMinMs, signal)
      throw new ApiError('SOE_UPSTREAM_ERROR', '评分服务暂时不可用（mock 注入失败），请稍后重试')
    }
    const durationMs = await estimateDurationMs(audio)
    const latency = this.latencyMinMs + this.randomImpl() * Math.max(0, this.latencyMaxMs - this.latencyMinMs)
    await this.delayImpl(latency, signal)

    const seed = fnv1a(`${refText}#${durationMs}`)
    const total = 70 + (seed % 26) // [70, 95]
    const accuracy = clampScore(total + ((seed >>> 8) % 13) - 6)
    const fluency = clampScore(total + ((seed >>> 16) % 13) - 6)
    const integrity = clampScore(total + ((seed >>> 24) % 11) - 3)

    const tokens = tokenize(refText)
    const words: SoeWordScore[] = tokens.map((text, i) => {
      // 确定性低分规则：约 1/7 的词 <60（标红用）；其余 70-97
      const score = (seed + i * 7) % 11 === 0 ? 35 + ((seed + i) % 25) : 70 + ((seed + i * 13) % 28)
      return { text, score, phonemes: mockPhonemes(text, score, seed + i) }
    })

    return { total, accuracy, fluency, integrity, words }
  }
}
