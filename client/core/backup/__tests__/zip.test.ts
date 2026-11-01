import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { createZipWriter, crc32, indexZip, isZipMagic, readEntry, readerFromBytes } from '../zip'

const enc = new TextEncoder()
const dec = new TextDecoder()

/** 用自写 writer 打包（sink 分片收集后拼回单 buffer，方便断言） */
function buildZip(entries: Array<{ name: string; data: Uint8Array; store?: boolean }>): Uint8Array {
  const chunks: Uint8Array[] = []
  const w = createZipWriter((c) => chunks.push(c))
  for (const e of entries) w.add(e.name, e.data, { store: e.store })
  w.finish()
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

/** 确定性伪随机 buffer（LCG），模拟不可压缩的媒体数据 */
function seededBytes(n: number, seed = 42): Uint8Array {
  const b = new Uint8Array(n)
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    b[i] = s & 0xFF
  }
  return b
}

describe('crc32', () => {
  it('标准测试向量：空数据 → 0，"123456789" → 0xCBF43926', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
    expect(crc32(enc.encode('123456789'))).toBe(0xCBF43926)
  })
})

describe('isZipMagic', () => {
  it('识别本地头 / EOCD 魔数，拒绝其他', () => {
    expect(isZipMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
    expect(isZipMagic(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe(true)
    expect(isZipMagic(new Uint8Array([0x50, 0x4b, 0x01, 0x02]))).toBe(false)
    expect(isZipMagic(enc.encode('{"ap'))).toBe(false)
    expect(isZipMagic(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false)
  })
})

describe('writer round-trip（自写自读）', () => {
  it('deflate + store 混合条目：索引字段与数据一致，STORE 条目可按 dataOffset 零拷贝切片', async () => {
    const json = enc.encode('ping-english-assistant '.repeat(100))
    const nanoid = seededBytes(1024)
    const uuid = seededBytes(512, 7)
    const zip = buildZip([
      { name: 'backup.json', data: json },
      { name: 'media/V1StGXR8_Z5jdHi6B-myT', data: nanoid, store: true },
      { name: 'media/f81d4fae-7dec-11d0-a765-00a0c91e6bf6', data: uuid, store: true },
    ])
    const reader = readerFromBytes(zip)
    const idx = await indexZip(reader)
    expect(idx.entries.map((e) => e.name)).toEqual([
      'backup.json',
      'media/V1StGXR8_Z5jdHi6B-myT',
      'media/f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
    ])

    const j = idx.byName.get('backup.json')!
    expect(j.method).toBe(8)
    expect(j.uncompressedSize).toBe(json.length)
    expect(j.compressedSize).toBeLessThan(json.length) // 重复文本应明显可压缩
    expect(await readEntry(reader, j)).toEqual(json)

    const m = idx.byName.get('media/V1StGXR8_Z5jdHi6B-myT')!
    expect(m.method).toBe(0)
    expect(m.compressedSize).toBe(nanoid.length) // STORE 不压缩
    expect(zip.subarray(m.dataOffset, m.dataOffset + m.uncompressedSize)).toEqual(nanoid) // 零拷贝路径
    expect(await readEntry(reader, m)).toEqual(nanoid)

    const u = idx.byName.get('media/f81d4fae-7dec-11d0-a765-00a0c91e6bf6')!
    expect(zip.subarray(u.dataOffset, u.dataOffset + u.uncompressedSize)).toEqual(uuid)
  })

  it('空 zip（0 条目）返回空索引', async () => {
    const idx = await indexZip(readerFromBytes(buildZip([])))
    expect(idx.entries).toEqual([])
    expect(idx.byName.size).toBe(0)
  })

  it('重名条目：entries 全保留，byName 取先出现者', async () => {
    const zip = buildZip([
      { name: 'a', data: enc.encode('first'), store: true },
      { name: 'a', data: enc.encode('second'), store: true },
    ])
    const idx = await indexZip(readerFromBytes(zip))
    expect(idx.entries.length).toBe(2)
    expect(idx.byName.size).toBe(1)
    expect(await readEntry(readerFromBytes(zip), idx.byName.get('a')!)).toEqual(enc.encode('first'))
  })
})

describe('与 fflate 的双向互操作', () => {
  it('A：自写 zip 可被 fflate.unzipSync 解开（含中文名与 STORE 条目）', () => {
    const text = enc.encode('备份 backup.json 内容 '.repeat(80))
    const media = seededBytes(2048)
    const zip = buildZip([
      { name: 'backup.json', data: text },
      { name: 'media/材料_1.bin', data: media, store: true },
    ])
    const out = unzipSync(zip)
    expect(out['backup.json']).toEqual(text)
    expect(out['media/材料_1.bin']).toEqual(media)
  })

  it('B：fflate.zipSync 产物可用 indexZip + readEntry 读取', async () => {
    const a = enc.encode('x'.repeat(3000))
    const b = seededBytes(500)
    const zip = zipSync({ 'backup.json': a, 'media/uuid-01': b })
    const reader = readerFromBytes(zip)
    const idx = await indexZip(reader)
    const j = idx.byName.get('backup.json')!
    expect(j.method).toBe(8)
    expect(await readEntry(reader, j)).toEqual(a)
    expect(await readEntry(reader, idx.byName.get('media/uuid-01')!)).toEqual(b)
  })
})

describe('损坏与异常路径', () => {
  it('截尾（EOCD 缺失）给出 zip 相关错误', async () => {
    const zip = buildZip([{ name: 'a', data: enc.encode('hello'), store: true }])
    const cut = zip.subarray(0, zip.length - 5)
    await expect(indexZip(readerFromBytes(cut))).rejects.toThrow(/zip/)
  })

  it('中央目录 offset 越界 → 已损坏', async () => {
    const zip = buildZip([{ name: 'a', data: enc.encode('hello'), store: true }])
    const bad = new Uint8Array(zip)
    new DataView(bad.buffer).setUint32(bad.length - 22 + 16, 0x7ffffff0, true) // EOCD 的 cdOffset
    await expect(indexZip(readerFromBytes(bad))).rejects.toThrow('备份 zip 文件已损坏')
  })

  it('本地头签名被篡改 → 报本地头缺失', async () => {
    const zip = buildZip([{ name: 'a', data: enc.encode('hello'), store: true }])
    const bad = new Uint8Array(zip)
    new DataView(bad.buffer).setUint32(0, 0x11223344, true)
    await expect(indexZip(readerFromBytes(bad))).rejects.toThrow(/本地头/)
  })

  it('中央目录 usize 被篡改 → readEntry 报大小不符', async () => {
    const data = enc.encode('hello')
    const zip = buildZip([{ name: 'a', data }])
    const reader = readerFromBytes(zip)
    const idx = await indexZip(reader)
    const e = idx.byName.get('a')!
    const bad = new Uint8Array(zip)
    const cdStart = bad.length - 22 - (46 + 1) // EOCD(22) + CD 条目(46+nameLen)
    new DataView(bad.buffer).setUint32(cdStart + 24, e.uncompressedSize + 1, true) // CD 的 usize
    const badIdx = await indexZip(readerFromBytes(bad))
    await expect(readEntry(readerFromBytes(bad), badIdx.byName.get('a')!)).rejects.toThrow('大小不符')
  })

  it('读取短于请求长度 → 文件不完整', async () => {
    const badReader = { size: 100, read: async () => new Uint8Array(1) }
    await expect(indexZip(badReader)).rejects.toThrow('备份 zip 文件不完整')
  })

  it('zip64 哨兵值（cdOffset=0xFFFFFFFF）→ 拒绝并提示 4GB/zip64', async () => {
    const eocd = new Uint8Array(22)
    const dv = new DataView(eocd.buffer)
    dv.setUint32(0, 0x06054b50, true)
    dv.setUint16(8, 1, true) // totalEntries
    dv.setUint32(16, 0xFFFFFFFF, true) // cdOffset 哨兵
    await expect(indexZip(readerFromBytes(eocd))).rejects.toThrow(/4GB|zip64/)
  })
})

describe('写限制', () => {
  it('累计字节超过 limit → 中文上限错误', () => {
    const w = createZipWriter(() => { /* 丢弃 */ }, { limit: 100 })
    w.add('a', new Uint8Array(10), { store: true }) // 30+1+10 = 41 字节
    expect(() => w.add('b', new Uint8Array(200), { store: true })).toThrow('超过 4GB')
  })

  it('finish 之后不得再 add / finish', () => {
    const w = createZipWriter(() => { /* 丢弃 */ })
    w.add('a', new Uint8Array(1), { store: true })
    w.finish()
    expect(() => w.add('b', new Uint8Array(1), { store: true })).toThrow()
    expect(() => w.finish()).toThrow()
  })
})
