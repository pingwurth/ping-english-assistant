/**
 * parseWavDurationMs 单测 —— 评审 #22 回归：
 * fmt 与 data 之间夹 LIST/INFO chunk 的 WAV 必须按 chunk 遍历定位 data，
 * 固定偏移 40 读出的是 LIST 大小（实测 1000ms 音频算出 1ms）。
 */
import { describe, expect, it } from 'vitest'
import { parseWavDurationMs } from '../wav-duration'

/** 构造最小 WAV：支持在 fmt 与 data 之间插入任意 chunk */
function buildWav(opts: { sampleRate?: number; dataMs?: number; midChunk?: { id: string; size: number } }): ArrayBuffer {
  const { sampleRate = 24_000, dataMs = 1000, midChunk } = opts
  const bytesPerFrame = 2 // 16-bit mono
  const dataSize = Math.round((dataMs / 1000) * sampleRate) * bytesPerFrame
  const mid = midChunk ? 8 + midChunk.size : 0
  const total = 12 + 24 + mid + 8 + dataSize

  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  const writeTag = (off: number, s: string) => { for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i) }

  writeTag(0, 'RIFF')
  dv.setUint32(4, total - 8, true)
  writeTag(8, 'WAVE')

  // fmt chunk（16 字节 PCM）
  writeTag(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * bytesPerFrame, true) // byteRate
  dv.setUint16(32, bytesPerFrame, true) // blockAlign
  dv.setUint16(34, 16, true) // bitsPerSample

  let off = 36
  if (midChunk) {
    writeTag(off, midChunk.id)
    dv.setUint32(off + 4, midChunk.size, true)
    off += 8 + midChunk.size + (midChunk.size & 1)
  }
  writeTag(off, 'data')
  dv.setUint32(off + 4, dataSize, true)
  return buf
}

describe('parseWavDurationMs（评审 #22）', () => {
  it('标准 WAV：按 blockAlign/sampleRate 精确计算', () => {
    expect(parseWavDurationMs(buildWav({ dataMs: 1000 }))).toBe(1000)
    expect(parseWavDurationMs(buildWav({ sampleRate: 16_000, dataMs: 250 }))).toBe(250)
  })

  it('fmt 与 data 之间夹 LIST chunk：仍读到正确 data 大小（旧固定偏移实现会算出 1ms）', () => {
    const wav = buildWav({ dataMs: 1000, midChunk: { id: 'LIST', size: 26 } })
    expect(parseWavDurationMs(wav)).toBe(1000)
  })

  it('奇数大小 chunk 的 1 字节对齐 padding 后仍能定位 data', () => {
    const wav = buildWav({ dataMs: 500, midChunk: { id: 'INFO', size: 5 } })
    expect(parseWavDurationMs(wav)).toBe(500)
  })

  it('非 RIFF 输入返回 null（调用方自行回退，不产出误导性时长）', () => {
    expect(parseWavDurationMs(new ArrayBuffer(100))).toBeNull()
    const notRiff = new Uint8Array(100)
    notRiff.set([1, 2, 3, 4])
    expect(parseWavDurationMs(notRiff.buffer)).toBeNull()
    expect(parseWavDurationMs(new ArrayBuffer(10))).toBeNull()
  })
})
