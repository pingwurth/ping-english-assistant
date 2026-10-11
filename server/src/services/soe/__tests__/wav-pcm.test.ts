import { describe, expect, it } from 'vitest'
import { stripWavHeader } from '../wav-pcm'
import { buildWav } from '../../../testing/fixtures'

describe('stripWavHeader', () => {
  it('标准 44 字节头 → 精确返回 PCM 载荷', () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
    const out = stripWavHeader(buildWav(pcm))
    expect(out.equals(pcm)).toBe(true)
  })

  it('data 前有奇数尺寸 LIST chunk（补齐 1 字节）→ 仍能定位 data', () => {
    const pcm = Buffer.from([9, 9, 9, 9])
    const riffHead = Buffer.alloc(12)
    riffHead.write('RIFF', 0, 'latin1')
    riffHead.writeUInt32LE(0, 4) // 尺寸占位，stripWavHeader 不校验
    riffHead.write('WAVE', 8, 'latin1')

    // LIST：8 字节头 + 3 字节数据（奇数）+ 1 字节 pad
    const list = Buffer.alloc(8 + 3 + 1)
    list.write('LIST', 0, 'latin1')
    list.writeUInt32LE(3, 4)
    list[8] = 0xaa
    list[9] = 0xbb
    list[10] = 0xcc
    list[11] = 0x00 // pad

    const dataChunk = Buffer.alloc(8 + pcm.length)
    dataChunk.write('data', 0, 'latin1')
    dataChunk.writeUInt32LE(pcm.length, 4)
    pcm.copy(dataChunk, 8)

    const wav = Buffer.concat([riffHead, list, dataChunk])
    expect(stripWavHeader(wav).equals(pcm)).toBe(true)
  })

  it('非 RIFF/WAVE 输入 → 原样返回（裸 PCM 兜底）', () => {
    const raw = Buffer.from([0xff, 0xfe, 0xfd])
    expect(stripWavHeader(raw)).toBe(raw)
  })

  it('RIFF/WAVE 但无 data chunk → 原样返回', () => {
    const head = Buffer.alloc(12)
    head.write('RIFF', 0, 'latin1')
    head.writeUInt32LE(4, 4)
    head.write('WAVE', 8, 'latin1')
    const fmt = Buffer.from([0, 0, 0, 0])
    const wav = Buffer.concat([head, fmt])
    expect(stripWavHeader(wav)).toBe(wav)
  })
})
