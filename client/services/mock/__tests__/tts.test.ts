/**
 * services/mock/tts 单测：分句 / 时长估算 / 时间轴 / SRT 纯函数 + MockTtsService 行为（确定性、缓存、错误码）。
 */
import { describe, expect, it } from 'vitest'
import {
  splitTtsSentences,
  estimateSentenceMs,
  buildTtsTimeline,
  srtTime,
  buildSrt,
  MockTtsService,
  TTS_MAX_TEXT_LENGTH,
} from '../tts'
import { ApiError } from '../../contracts'

const noDelay = async () => {}

describe('splitTtsSentences', () => {
  it('按 [.!?;:\\n] 切分，标点归属前句', () => {
    expect(splitTtsSentences('Hello world. How are you? Fine!')).toEqual(['Hello world.', 'How are you?', 'Fine!'])
  })

  it('首个分隔符即切分（标点归属前句），后续纯标点碎片丢弃', () => {
    expect(splitTtsSentences('Wait... Really?! Yes.')).toEqual(['Wait.', 'Really?', 'Yes.'])
    expect(splitTtsSentences('...')).toEqual([])
  })

  it('无标点整段为单句；空串为空数组', () => {
    expect(splitTtsSentences('no punctuation here')).toEqual(['no punctuation here'])
    expect(splitTtsSentences('')).toEqual([])
    expect(splitTtsSentences('   ')).toEqual([])
  })

  it('换行作为分句符', () => {
    expect(splitTtsSentences('line one\nline two')).toEqual(['line one', 'line two'])
  })
})

describe('estimateSentenceMs', () => {
  it('按 15 字符/秒估算，短句不低于 400ms', () => {
    expect(estimateSentenceMs('hi', 1)).toBe(400) // 短句 → 下限
    expect(estimateSentenceMs('x'.repeat(150), 1)).toBe(10000) // 150/15 秒
  })

  it('语速缩放（speed 越大时长越短），speed clamp 到 [0.5, 2]', () => {
    const base = estimateSentenceMs('x'.repeat(150), 1)
    expect(estimateSentenceMs('x'.repeat(150), 2)).toBe(base / 2)
    expect(estimateSentenceMs('x'.repeat(150), 10)).toBe(estimateSentenceMs('x'.repeat(150), 2))
    expect(estimateSentenceMs('x'.repeat(150), 0.1)).toBe(estimateSentenceMs('x'.repeat(150), 0.5))
  })
})

describe('buildTtsTimeline', () => {
  it('逐句累计，句间 120ms 间隙；总时长 = 末句 endMs', () => {
    const sentences = ['x'.repeat(150), 'x'.repeat(150)] // 各 10000ms @speed=1
    const { timings, durationMs } = buildTtsTimeline(sentences, 1)
    expect(timings[0]).toEqual({ index: 0, text: sentences[0], startMs: 0, endMs: 10000 })
    expect(timings[1]).toEqual({ index: 1, text: sentences[1], startMs: 10120, endMs: 20120 })
    expect(durationMs).toBe(20120)
  })

  it('空句列表 → 零时长', () => {
    expect(buildTtsTimeline([], 1)).toEqual({ timings: [], durationMs: 0 })
  })
})

describe('srtTime / buildSrt', () => {
  it('毫秒 → HH:MM:SS,mmm 补零格式', () => {
    expect(srtTime(0)).toBe('00:00:00,000')
    expect(srtTime(2610)).toBe('00:00:02,610')
    expect(srtTime(3723005)).toBe('01:02:03,005')
    expect(srtTime(-5)).toBe('00:00:00,000')
  })

  it('buildSrt：序号 + 时间轴行 + 句文本，块间空行（可被 core/subtitle 回读）', () => {
    const srt = buildSrt([
      { index: 0, text: 'Good morning.', startMs: 0, endMs: 2000 },
      { index: 1, text: 'Nice day.', startMs: 2120, endMs: 4000 },
    ])
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:02,000\nGood morning.\n\n2\n00:00:02,120 --> 00:00:04,000\nNice day.')
  })
})

describe('MockTtsService', () => {
  const req = { text: 'Hello world. Nice to meet you.', voice: 'af_bella', speed: 1, format: 'wav' as const, withSubtitle: true }

  it('generate：meta 与 WAV 音频字节数一致（44 头 + 2B/样本 @16kHz）', async () => {
    const svc = new MockTtsService({ delayImpl: noDelay })
    const { audio, meta } = await svc.generate(req)
    expect(meta.sentenceCount).toBe(2)
    expect(meta.taskId).toMatch(/^tts_/)
    const expectedSamples = Math.max(1, Math.round((meta.durationMs / 1000) * 16000))
    expect(audio.size).toBe(44 + expectedSamples * 2)
    expect(audio.type).toBe('audio/wav')
  })

  it('withSubtitle=true → getSubtitle 命中且与 generate 确定性一致', async () => {
    const svc = new MockTtsService({ delayImpl: noDelay })
    const r1 = await svc.generate(req)
    const sub = await svc.getSubtitle(r1.meta.taskId)
    expect(sub.sentenceCount).toBe(2)
    expect(sub.srt).toContain('-->')
    // 同请求再生成一次：时间轴/SRT 完全一致（taskId 除外）
    const r2 = await svc.generate(req)
    const sub2 = await svc.getSubtitle(r2.meta.taskId)
    expect(sub2.srt).toBe(sub.srt)
    expect(r2.meta.durationMs).toBe(r1.meta.durationMs)
  })

  it('withSubtitle=false → getSubtitle 抛 SUBTITLE_NOT_FOUND', async () => {
    const svc = new MockTtsService({ delayImpl: noDelay })
    const { meta } = await svc.generate({ ...req, withSubtitle: false })
    await expect(svc.getSubtitle(meta.taskId)).rejects.toMatchObject({ code: 'SUBTITLE_NOT_FOUND' })
    await expect(svc.getSubtitle('tts_not_exist')).rejects.toBeInstanceOf(ApiError)
  })

  it('onProgress 按句回调（done 递增到 total）', async () => {
    const calls: Array<[number, number]> = []
    const svc = new MockTtsService({ delayImpl: noDelay, onProgress: (d, t) => calls.push([d, t]) })
    await svc.generate(req)
    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('超 5000 字符 → TEXT_TOO_LONG；无有效句 → TEXT_EMPTY', async () => {
    const svc = new MockTtsService({ delayImpl: noDelay })
    await expect(svc.generate({ ...req, text: 'a'.repeat(TTS_MAX_TEXT_LENGTH + 1) })).rejects.toMatchObject({ code: 'TEXT_TOO_LONG' })
    await expect(svc.generate({ ...req, text: '...' })).rejects.toMatchObject({ code: 'TEXT_EMPTY' })
  })
})
