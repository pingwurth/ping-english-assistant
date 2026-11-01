/**
 * 最小 ZIP 容器读写 —— 零依赖纯 TS，node 可直接单测。
 *
 * fflate 是 core/ 层首个运行时依赖（纯 JS、node 可跑），仅承担条目数据的
 * deflateSync/inflateSync；容器结构（本地头 / 中央目录 / EOCD / CRC32）手写：
 *  - 写侧：条目即写即出（sink 回调），调用方汇聚分片即可控制内存峰值；
 *  - 读侧：只解析中央目录得到条目偏移，STORE 条目可由调用方对源文件
 *    Blob.slice(dataOffset, +size) 零拷贝读取（几百 MB 媒体也不进 JS 堆），
 *    这是 fflate 的 unzip/unzipSync（整包解进内存）给不了的路径。
 *
 * zip64 不支持：读侧检测到哨兵值（0xFFFF / 0xFFFFFFFF）或 zip64 扩展字段即拒绝，
 * 写侧累计超过 ZIP_MAX_BYTES（4GiB-1）即报错。
 *
 * 导入校验策略：签名 / 长度恒校验；deflate 条目解压后顺手验 CRC（数据已在内存）；
 * STORE 条目不验 CRC——读入 JS 会破坏零拷贝优势（future：分片流式 CRC 钩子）。
 */

import { deflateSync, inflateSync } from 'fflate'

/** 非 zip64 单盘 zip 上限（4GiB-1，u32 偏移上限） */
export const ZIP_MAX_BYTES = 0xFFFFFFFF

/* ─── CRC32（标准反射算法，poly 0xEDB88320，表驱动） ─── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/** 头 4 字节是否为 zip 魔数（本地头 PK\x03\x04 或 EOCD PK\x05\x06） */
export function isZipMagic(head: Uint8Array): boolean {
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) return false
  return (head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06)
}

/* ─── 写 ─── */

export type ZipChunkSink = (chunk: Uint8Array) => void

export interface ZipWriter {
  /** 追加一个条目；store=true → method 0 原样透传（不拷贝），默认 deflate level 6 */
  add(name: string, data: Uint8Array, opts?: { store?: boolean }): void
  /** 写出中央目录 + EOCD；之后不得再 add */
  finish(): void
  readonly bytesWritten: number
}

interface CdRecord {
  nameBytes: Uint8Array
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

/** 创建流式 writer：每个本地头 + 名字 + 数据立即推给 sink，finish 时补中央目录与 EOCD */
export function createZipWriter(sink: ZipChunkSink, opts?: { limit?: number }): ZipWriter {
  const limit = opts?.limit ?? ZIP_MAX_BYTES
  const encoder = new TextEncoder()
  const records: CdRecord[] = []
  let offset = 0
  let finished = false

  const push = (chunk: Uint8Array): void => {
    if (offset + chunk.length > limit) {
      throw new Error('备份内容超过 4GB，暂不支持打包为单个 zip，请减少材料或改用轻量备份')
    }
    sink(chunk)
    offset += chunk.length
  }

  return {
    get bytesWritten() { return offset },
    add(name, data, addOpts) {
      if (finished) throw new Error('zip writer 已 finish，不能再 add')
      if (records.length >= 0xFFFF) throw new Error('备份条目过多（超过 65535），暂不支持')
      const nameBytes = encoder.encode(name)
      if (nameBytes.length > 0xFFFF) throw new Error(`条目名过长：${name}`)
      const method = addOpts?.store ? 0 : 8
      const compressed = method === 0 ? data : deflateSync(data, { level: 6 })
      const crc = crc32(data)
      const localOffset = offset

      const h = new DataView(new ArrayBuffer(30))
      h.setUint32(0, 0x04034b50, true) // 本地头签名
      h.setUint16(4, 20, true) // 版本
      h.setUint16(6, 0x0800, true) // UTF-8 名
      h.setUint16(8, method, true)
      h.setUint16(10, 0, true) // time
      h.setUint16(12, 0x0021, true) // date = 1980-01-01
      h.setUint32(14, crc, true)
      h.setUint32(18, compressed.length, true)
      h.setUint32(22, data.length, true)
      h.setUint16(26, nameBytes.length, true)
      h.setUint16(28, 0, true) // extraLen
      push(new Uint8Array(h.buffer))
      push(nameBytes)
      push(compressed)

      records.push({ nameBytes, method, crc, compressedSize: compressed.length, uncompressedSize: data.length, localOffset })
    },
    finish() {
      if (finished) throw new Error('zip writer 已 finish')
      finished = true
      const cdOffset = offset
      for (const r of records) {
        const c = new DataView(new ArrayBuffer(46))
        c.setUint32(0, 0x02014b50, true) // 中央目录签名
        c.setUint16(4, 20, true) // 制作版本
        c.setUint16(6, 20, true) // 需要版本
        c.setUint16(8, 0x0800, true)
        c.setUint16(10, r.method, true)
        c.setUint16(12, 0, true)
        c.setUint16(14, 0x0021, true)
        c.setUint32(16, r.crc, true)
        c.setUint32(20, r.compressedSize, true)
        c.setUint32(24, r.uncompressedSize, true)
        c.setUint16(28, r.nameBytes.length, true)
        c.setUint16(30, 0, true) // extraLen
        c.setUint16(32, 0, true) // commentLen
        c.setUint16(34, 0, true) // diskStart
        c.setUint16(36, 0, true) // internalAttr
        c.setUint32(38, 0, true) // externalAttr
        c.setUint32(42, r.localOffset, true)
        push(new Uint8Array(c.buffer))
        push(r.nameBytes)
      }
      const cdSize = offset - cdOffset
      const e = new DataView(new ArrayBuffer(22))
      e.setUint32(0, 0x06054b50, true) // EOCD 签名
      e.setUint16(4, 0, true)
      e.setUint16(6, 0, true)
      e.setUint16(8, records.length, true)
      e.setUint16(10, records.length, true)
      e.setUint32(12, cdSize, true)
      e.setUint32(16, cdOffset, true)
      e.setUint16(20, 0, true) // commentLen
      push(new Uint8Array(e.buffer))
    },
  }
}

/* ─── 读 ─── */

/** 随机读适配器：[start, end) 半开区间 */
export interface RangeReader {
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

export interface ZipEntryInfo {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  crc32: number
  /** 本地头之后数据的绝对起点（STORE 条目可据此对源文件零拷贝切片） */
  dataOffset: number
}

export interface ZipIndex {
  entries: ZipEntryInfo[]
  byName: Map<string, ZipEntryInfo>
}

const ZIP64_ERROR = '备份 zip 超过 4GB（zip64 格式），本应用暂不支持导入'

async function readChecked(reader: RangeReader, start: number, end: number): Promise<Uint8Array> {
  const buf = await reader.read(start, end)
  if (buf.length !== end - start) throw new Error('备份 zip 文件不完整')
  return buf
}

/**
 * 解析中央目录（EOCD 倒序扫描 → CD 逐条 → 每条目另读本地头算 dataOffset）。
 * zip64（哨兵值或 0x0001 扩展字段）直接拒绝。
 */
export async function indexZip(reader: RangeReader): Promise<ZipIndex> {
  if (reader.size < 22) throw new Error('不是有效的 zip 备份文件（缺少结束记录）')
  // 尾部窗口 = EOCD(22) + 最大注释(65535)；倒序找"签名 + 注释长度恰好补齐文件尾"的候选，
  // 防止 zip 注释里出现的假签名干扰
  const winStart = Math.max(0, reader.size - 65557)
  const win = await readChecked(reader, winStart, reader.size)
  const wv = new DataView(win.buffer, win.byteOffset, win.byteLength)
  let eocd = -1
  for (let i = win.length - 22; i >= 0; i--) {
    if (wv.getUint32(i, true) !== 0x06054b50) continue
    if (winStart + i + 22 + wv.getUint16(i + 20, true) === reader.size) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 备份文件（缺少结束记录）')

  const totalEntries = wv.getUint16(eocd + 10, true)
  const cdSize = wv.getUint32(eocd + 12, true)
  const cdOffset = wv.getUint32(eocd + 16, true)
  if (totalEntries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) throw new Error(ZIP64_ERROR)
  if (totalEntries === 0) return { entries: [], byName: new Map() }
  if (cdOffset + cdSize > reader.size) throw new Error('备份 zip 文件已损坏')

  const cd = await readChecked(reader, cdOffset, cdOffset + cdSize)
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const decoder = new TextDecoder()
  const entries: ZipEntryInfo[] = []
  const byName = new Map<string, ZipEntryInfo>()
  let p = 0
  while (p < cd.length) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== 0x02014b50) throw new Error('备份 zip 文件已损坏')
    const method = cv.getUint16(p + 10, true)
    const crc = cv.getUint32(p + 16, true)
    const csize = cv.getUint32(p + 20, true)
    const usize = cv.getUint32(p + 24, true)
    const nameLen = cv.getUint16(p + 28, true)
    const extraLen = cv.getUint16(p + 30, true)
    const commentLen = cv.getUint16(p + 32, true)
    const localOffset = cv.getUint32(p + 42, true)
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) throw new Error(ZIP64_ERROR)
    // extra 链按 (id u16, size u16) 对遍历，出现 zip64 扩展字段（0x0001）即拒绝
    let q = p + 46 + nameLen
    const extraEnd = q + extraLen
    while (q + 4 <= extraEnd) {
      if (cv.getUint16(q, true) === 0x0001) throw new Error(ZIP64_ERROR)
      q += 4 + cv.getUint16(q + 2, true)
    }
    if (p + 46 + nameLen + extraLen + commentLen > cd.length) throw new Error('备份 zip 文件已损坏')
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen))

    // 本地头的 extra 长度可能与中央目录不同，dataOffset 必须按本地头现算
    const lh = await readChecked(reader, localOffset, localOffset + 30)
    if (new DataView(lh.buffer, lh.byteOffset, lh.byteLength).getUint32(0, true) !== 0x04034b50) {
      throw new Error(`备份 zip 已损坏（${name} 本地头缺失）`)
    }
    const lhView = new DataView(lh.buffer, lh.byteOffset, lh.byteLength)
    const dataOffset = localOffset + 30 + lhView.getUint16(26, true) + lhView.getUint16(28, true)
    if (dataOffset + csize > reader.size) throw new Error('备份 zip 文件已损坏')

    const info: ZipEntryInfo = { name, method, compressedSize: csize, uncompressedSize: usize, crc32: crc, dataOffset }
    entries.push(info)
    if (!byName.has(name)) byName.set(name, info) // 重名取先出现者
    p += 46 + nameLen + extraLen + commentLen
  }
  return { entries, byName }
}

/** 读出一个条目的完整数据（STORE 原样 / deflate 解压 + CRC 校验） */
export async function readEntry(reader: RangeReader, e: ZipEntryInfo): Promise<Uint8Array> {
  if (e.method !== 0 && e.method !== 8) {
    throw new Error(`备份 zip 中 ${e.name} 使用了不支持的压缩方式`)
  }
  const raw = await readChecked(reader, e.dataOffset, e.dataOffset + e.compressedSize)
  if (e.method === 0) {
    if (raw.length !== e.uncompressedSize) throw new Error(`备份 zip 已损坏（${e.name} 大小不符）`)
    return raw
  }
  let out: Uint8Array
  try {
    out = inflateSync(raw)
  } catch {
    throw new Error(`备份 zip 已损坏（${e.name} 解压失败）`)
  }
  if (out.length !== e.uncompressedSize) throw new Error(`备份 zip 已损坏（${e.name} 大小不符）`)
  if (crc32(out) !== e.crc32) throw new Error(`备份 zip 已损坏（${e.name} 校验失败）`)
  return out
}

/** 测试适配器：内存 buffer → RangeReader */
export function readerFromBytes(data: Uint8Array): RangeReader {
  return {
    size: data.length,
    read: async (start, end) => data.subarray(start, end),
  }
}
