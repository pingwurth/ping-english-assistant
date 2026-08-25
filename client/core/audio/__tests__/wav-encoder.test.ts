/**
 * core/audio/wav-encoder 单测：44 字节头字段、时长计算、同输入字节级一致。
 */
import { describe, expect, it } from 'vitest'
import { encodeWav, wavDurationMs, WAV_MIME, TARGET_SAMPLE_RATE } from '../wav-encoder'

async function toBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function readDv(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

const tag = (bytes: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...Array.from(bytes.slice(off, off + len)))

describe('encodeWav 头部字段', () => {
  it('标准 44 字节 RIFF/WAVE/fmt/data 头（16kHz 单声道 16bit PCM）', async () => {
    const samples = new Float32Array(1600).fill(0.25) // 100ms @16kHz
    const blob = encodeWav(samples)
    expect(blob.type).toBe(WAV_MIME)
    const bytes = await toBytes(blob)
    expect(bytes.byteLength).toBe(44 + samples.length * 2)

    const dv = readDv(bytes)
    expect(tag(bytes, 0, 4)).toBe('RIFF')
    expect(dv.getUint32(4, true)).toBe(36 + samples.length * 2) // ChunkSize
    expect(tag(bytes, 8, 4)).toBe('WAVE')
    expect(tag(bytes, 12, 4)).toBe('fmt ')
    expect(dv.getUint32(16, true)).toBe(16) // fmt 块大小
    expect(dv.getUint16(20, true)).toBe(1) // PCM
    expect(dv.getUint16(22, true)).toBe(1) // 单声道
    expect(dv.getUint32(24, true)).toBe(16000) // 采样率
    expect(dv.getUint32(28, true)).toBe(32000) // ByteRate
    expect(dv.getUint16(32, true)).toBe(2) // BlockAlign
    expect(dv.getUint16(34, true)).toBe(16) // BitsPerSample
    expect(tag(bytes, 36, 4)).toBe('data')
    expect(dv.getUint32(40, true)).toBe(samples.length * 2) // dataSize
  })

  it('自定义采样率写入头部', async () => {
    const bytes = await toBytes(encodeWav(new Float32Array(10), 8000))
    const dv = readDv(bytes)
    expect(dv.getUint32(24, true)).toBe(8000)
    expect(dv.getUint32(28, true)).toBe(16000)
  })

  it('PCM 数据：float→int16 换算（四舍五入）与越界 clamp', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 2, -2])
    const bytes = await toBytes(encodeWav(samples, 16000))
    const dv = readDv(bytes)
    expect(dv.getInt16(44, true)).toBe(0)
    expect(dv.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff))
    expect(dv.getInt16(48, true)).toBe(Math.round(-0.5 * 0x8000))
    expect(dv.getInt16(50, true)).toBe(0x7fff) // clamp 上限
    expect(dv.getInt16(52, true)).toBe(-0x8000) // clamp 下限
  })

  it('溢出防护：边界值精确落在 int16 范围，NaN 归零不产生非法字节', async () => {
    const samples = new Float32Array([1, -1, Number.NaN, 1.5, -1.5, 0.9999999])
    const bytes = await toBytes(encodeWav(samples, 16000))
    const dv = readDv(bytes)
    expect(dv.getInt16(44, true)).toBe(32767) // 满幅正值 → 0x7fff
    expect(dv.getInt16(46, true)).toBe(-32768) // 满幅负值 → -0x8000
    expect(dv.getInt16(48, true)).toBe(0) // NaN → 0
    expect(dv.getInt16(50, true)).toBe(32767) // 越上界 clamp
    expect(dv.getInt16(52, true)).toBe(-32768) // 越下界 clamp
    const edge = dv.getInt16(54, true)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThanOrEqual(32767)
  })
})

describe('确定性', () => {
  it('同输入字节级一致', async () => {
    const samples = new Float32Array(1000).map((_, i) => Math.sin(i / 10))
    const a = await toBytes(encodeWav(samples))
    const b = await toBytes(encodeWav(samples))
    expect(a).toEqual(b)
  })

  it('空样本仍产出合法 44 字节头', async () => {
    const bytes = await toBytes(encodeWav(new Float32Array(0)))
    expect(bytes.byteLength).toBe(44)
    expect(tag(bytes, 0, 4)).toBe('RIFF')
    expect(readDv(bytes).getUint32(40, true)).toBe(0)
  })
})

describe('wavDurationMs', () => {
  it('按采样率换算毫秒（四舍五入）', () => {
    expect(wavDurationMs(16000)).toBe(1000)
    expect(wavDurationMs(8000)).toBe(500)
    expect(wavDurationMs(800, 8000)).toBe(100)
    expect(wavDurationMs(0)).toBe(0)
    expect(TARGET_SAMPLE_RATE).toBe(16000)
  })
})
