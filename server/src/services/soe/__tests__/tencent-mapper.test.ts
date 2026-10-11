import { describe, expect, it } from 'vitest'
import { mapTencentToContract, type TencentSoeResponse } from '../soe-mapper'

const base: TencentSoeResponse['Response'] = {
  PronAccuracy: 84.2,
  PronFluency: 0.889,
  PronCompletion: 0.8,
  SuggestedScore: 85.6,
  Words: [
    {
      Word: 'hello',
      PronAccuracy: 90.4,
      MatchTag: 0,
      PhoneInfos: [
        { Phone: 'h', PronAccuracy: 92 },
        { Phone: 'ə', PronAccuracy: 87.6 },
      ],
    },
    { Word: 'world', PronAccuracy: 78.2, MatchTag: 1 },
    { Word: 'extra', PronAccuracy: 60, MatchTag: 2 },
    { Word: 'wrld', PronAccuracy: 55.5, MatchTag: 3 },
    { Word: 'plain' },
  ],
  RequestId: 'req-1',
}

describe('mapTencentToContract', () => {
  it('百分制取整 + [0,1] 小数 ×100（85.6/84.2/0.889/0.8 → 86/84/89/80）', () => {
    const r = mapTencentToContract(base)
    expect(r.total).toBe(86)
    expect(r.accuracy).toBe(84)
    expect(r.fluency).toBe(89)
    expect(r.integrity).toBe(80)
  })

  it('PronAccuracy=-1 → 0', () => {
    const r = mapTencentToContract({ ...base, PronAccuracy: -1, SuggestedScore: -1 })
    expect(r.accuracy).toBe(0)
    expect(r.total).toBe(0)
  })

  it('SuggestedScore 缺失 → total 回退 PronAccuracy', () => {
    const r = mapTencentToContract({ ...base, SuggestedScore: undefined })
    expect(r.total).toBe(84)
  })

  it('MatchTag 0/1/2/3 → None/Omission/Insertion/Mispronunciation，缺失 → undefined', () => {
    const r = mapTencentToContract(base)
    const types = r.words.map((w) => w.errorType)
    expect(types).toEqual(['None', 'Omission', 'Insertion', 'Mispronunciation', undefined])
  })

  it('PhoneInfos 映射为 phonemes', () => {
    const r = mapTencentToContract(base)
    expect(r.words[0]?.phonemes).toEqual([
      { symbol: 'h', score: 92 },
      { symbol: 'ə', score: 88 },
    ])
  })

  it('Words 缺失 → []', () => {
    const r = mapTencentToContract({ PronAccuracy: 50, PronFluency: 0.5, PronCompletion: 0.5 })
    expect(r.words).toEqual([])
  })
})
