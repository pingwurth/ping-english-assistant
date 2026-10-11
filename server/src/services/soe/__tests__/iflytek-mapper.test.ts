import { describe, expect, it } from 'vitest'
import { mapIflytekToContract } from '../soe-mapper'
import type { IflytekIseResult } from '../iflytek-xml'

describe('mapIflytekToContract', () => {
  it('0–5 分制 ×20（total 4.3 → 86），dp_message 映射含 64→None，phonemes 恒空', () => {
    const r: IflytekIseResult = {
      isRejected: false,
      total: 4.3,
      accuracy: 4.5,
      fluency: 4.0,
      integrity: 4.6,
      words: [
        { text: 'hello', score: 4.8, dpMessage: 0 },
        { text: 'world', score: 2.1, dpMessage: 16 },
        { text: 'a', score: 4.0, dpMessage: 32 },
        { text: 'b', score: 3.0, dpMessage: 128 },
        { text: 'c', score: 3.5, dpMessage: 64 }, // 回读 → 近似 None
      ],
    }
    const out = mapIflytekToContract(r)
    expect(out.total).toBe(86)
    expect(out.accuracy).toBe(90)
    expect(out.fluency).toBe(80)
    expect(out.integrity).toBe(92)
    expect(out.words.map((w) => w.score)).toEqual([96, 42, 80, 60, 70])
    expect(out.words.map((w) => w.errorType)).toEqual(['None', 'Omission', 'Insertion', 'Mispronunciation', 'None'])
    expect(out.words.every((w) => w.phonemes.length === 0)).toBe(true)
  })

  it('0–100 分制不缩放（total>5 → scale=1）', () => {
    const r: IflytekIseResult = {
      isRejected: false,
      total: 87,
      accuracy: 85,
      fluency: 88,
      integrity: 90,
      words: [{ text: 'hello', score: 92, dpMessage: 0 }],
    }
    const out = mapIflytekToContract(r)
    expect(out.total).toBe(87)
    expect(out.accuracy).toBe(85)
    expect(out.words[0]?.score).toBe(92)
  })

  it('越界 clamp：5.2 ×20 = 104 → 100', () => {
    const r: IflytekIseResult = {
      isRejected: false,
      total: 4.3,
      words: [{ text: 'x', score: 5.2, dpMessage: 0 }],
    }
    const out = mapIflytekToContract(r)
    expect(out.words[0]?.score).toBe(100)
  })
})
