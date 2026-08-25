/**
 * services/mock/soe 单测：确定性评分（同输入同输出）、分数区间、词级结构、降级与参数校验。
 */
import { describe, expect, it } from 'vitest'
import { MockSoeService } from '../soe'
import { ApiError } from '../../contracts'
import { encodeWav } from '@/core/audio/wav-encoder'

const noDelay = async () => {}
const half = () => 0.5

/** 1 秒静音 WAV（16kHz 单声道），保证 estimateDurationMs 走 RIFF 解析路径 */
function oneSecondWav(): Blob {
  return encodeWav(new Float32Array(16000))
}

function makeService() {
  return new MockSoeService({ delayImpl: noDelay, randomImpl: half })
}

describe('MockSoeService.evaluate 确定性', () => {
  it('同输入（音频+refText）两次调用结果完全一致', async () => {
    const svc = makeService()
    const audio = oneSecondWav()
    const a = await svc.evaluate(audio, "Good morning, my friend!", 'sentence')
    const b = await svc.evaluate(oneSecondWav(), "Good morning, my friend!", 'sentence')
    expect(b).toEqual(a)
  })

  it('不同 refText → 不同种子派生不同分（结构不变）', async () => {
    const svc = makeService()
    const a = await svc.evaluate(oneSecondWav(), 'Hello world', 'sentence')
    const b = await svc.evaluate(oneSecondWav(), 'Another sentence entirely', 'sentence')
    expect(a).not.toEqual(b)
  })
})

describe('MockSoeService.evaluate 结构约束', () => {
  it('total ∈ [70,95]；各维度 ∈ [0,100]', async () => {
    const svc = makeService()
    const r = await svc.evaluate(oneSecondWav(), 'Practice makes perfect', 'sentence')
    expect(r.total).toBeGreaterThanOrEqual(70)
    expect(r.total).toBeLessThanOrEqual(95)
    for (const v of [r.accuracy, r.fluency, r.integrity]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('words 与 refText 分词一致（剥首尾标点），每词 0-100 且带 1-3 个 phonemes', async () => {
    const svc = makeService()
    const r = await svc.evaluate(oneSecondWav(), '"Hello," don\'t stop!', 'sentence')
    expect(r.words.map((w) => w.text)).toEqual(['Hello', "don't", 'stop'])
    for (const w of r.words) {
      expect(w.score).toBeGreaterThanOrEqual(0)
      expect(w.score).toBeLessThanOrEqual(100)
      expect(w.phonemes.length).toBeGreaterThanOrEqual(1)
      expect(w.phonemes.length).toBeLessThanOrEqual(3)
      for (const p of w.phonemes) {
        expect(p.score).toBeGreaterThanOrEqual(0)
        expect(p.score).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('MockSoeService.evaluate 错误路径', () => {
  it('evalMode 非 sentence → ApiError BAD_REQUEST', async () => {
    const svc = makeService()
    // @ts-expect-error 故意传入非法模式验证运行时校验
    await expect(svc.evaluate(oneSecondWav(), 'x', 'paragraph')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('failRate=1 → 必抛 SOE_UPSTREAM_ERROR（降级路径）', async () => {
    const svc = new MockSoeService({ delayImpl: noDelay, randomImpl: half, failRate: 1 })
    await expect(svc.evaluate(oneSecondWav(), 'x', 'sentence')).rejects.toMatchObject({ code: 'SOE_UPSTREAM_ERROR' })
  })

  it('已中止的 signal → ApiError ABORTED', async () => {
    const svc = makeService()
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(svc.evaluate(oneSecondWav(), 'x', 'sentence', ctrl.signal)).rejects.toBeInstanceOf(ApiError)
    await expect(svc.evaluate(oneSecondWav(), 'x', 'sentence', ctrl.signal)).rejects.toMatchObject({ code: 'ABORTED' })
  })
})
