/**
 * 备份导出/导入编排 —— 校验与合并规则在 core/backup/backup-format.ts（含测试），
 * zip 容器原语在 core/backup/zip.ts（含测试），这里只做 IDB（materials + records + blobs）
 * 与 prefs（localStorage）的读写、zip 组包/解包和文件下载。
 *
 * 两种备份格式（换设备：旧设备导出 → 新设备导入，导入自动识别 .json / .zip）：
 *  - 轻量 JSON：materials + records + prefs，不含音视频（与历史版本逐字节兼容）；
 *  - 完整 zip：backup.json（同上 + media 清单）+ media/{materialId}（STORE 零压缩），
 *    新设备导入后可直接播放。导出只遍历 material ids —— blobs store 里的
 *    tts:/transcribe: 临时产物永远不会进包。
 */

import { BACKUP_APP_ID, BACKUP_FORMAT_VERSION, parseBackupJson, planImport, type ImportStrategy, type MediaManifestEntry, type NoteImageManifestEntry, type ParsedBackup } from '@/core/backup/backup-format'
import { createZipWriter, crc32, indexZip, readEntry, type RangeReader, type ZipEntryInfo, type ZipIndex } from '@/core/backup/zip'
import { blobsStore, estimateUsage, materialsStore, putAllAtomic, recordsStore } from '@/platform/storage/idb'
import { exportAllPrefs, stagePrefs, type StagedPrefs } from '@/platform/storage/prefs'
import type { MaterialRecord } from '@/platform/storage/schema'

/** 笔记图片在 zip 内的条目名（noteImage.key 即 blobs store 键 noteimg:{materialId}:{imageId}） */
const noteImageEntryName = (key: string) => `noteimg/${key}`

export interface ImportSummary {
  materialsWritten: number
  materialsSkipped: number
  recordsWritten: number
  recordsSkipped: number
  prefsWritten: number
  prefsSkipped: number
  /** 仅 zip 导入有值（轻量 JSON 导入恒 0）：按冲突策略实际写入/跳过的媒体数（含笔记图片） */
  mediaWritten: number
  mediaSkipped: number
  /** 清单里有、zip 里没有对应条目的媒体/笔记图片数（对应材料导入后需单独补传媒体） */
  mediaMissing: number
}

/** 日期补零（两条备份文件名共用） */
function pad2(n: number): string { return String(n).padStart(2, '0') }

function timestamp(now: Date): string {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`
}

/** 轻量备份文件名：ping-english-backup-YYYYMMDD-HHmm.json */
export function backupFilename(now: Date = new Date()): string {
  return `ping-english-backup-${timestamp(now)}.json`
}

/** 完整备份文件名：ping-english-full-backup-YYYYMMDD-HHmm.zip */
export function fullBackupFilename(now: Date = new Date()): string {
  return `ping-english-full-backup-${timestamp(now)}.zip`
}

/** materials + records + prefs 全量收集（两条导出链共用，防漂移） */
async function collectBackupParts(): Promise<{ materials: MaterialRecord[]; records: Record<string, unknown>; prefs: Record<string, unknown> }> {
  // materials 同样走单事务快照（与下方 records 同模式）：原 allKeys + 逐键 get 的 N+1
  // 在 50 材料导出时要开 51 个事务、各自克隆整份 MaterialRecord（含 subtitleData）
  const materialEntries = await materialsStore.getAllEntries()
  const materials = materialEntries
    .map(([, v]) => v as MaterialRecord | undefined)
    .filter((m): m is MaterialRecord => !!m)
  // 全量导出确实需要所有记录：单事务快照（原 allKeys 全扫 + 每键一个读事务的 N+1）
  const recordEntries = await recordsStore.getAllEntries()
  const records = Object.fromEntries(recordEntries.filter(([, v]) => v !== undefined))
  return { materials, records, prefs: exportAllPrefs() }
}

/** 让出主线程一帧（长任务分片用） */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 分片序列化的批大小（一批 ~几 ms，批间让出主线程保交互） */
const SERIALIZE_BATCH = 25

/**
 * 备份 payload → JSON 字符串（分片版）：大数组/大对象逐批 JSON.stringify 并在批间
 * 让出主线程 —— 整段同步 stringify 数十 MB（材料内嵌完整 subtitleData）会把 UI
 * 卡死数秒且无任何反馈（2026-11 全仓复审）。产物与 JSON.stringify(payload)
 * 字节一致（同键序、undefined 值键同样跳过），等价性由测试钉死。
 */
export async function stringifyBackupJson(payload: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(payload).filter((k) => payload[k] !== undefined)
  const out: string[] = ['{']
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]!
    const value = payload[key]
    if (k > 0) out.push(',')
    out.push(JSON.stringify(key), ':')
    if (Array.isArray(value)) {
      out.push('[')
      for (let i = 0; i < value.length; i += SERIALIZE_BATCH) {
        if (i > 0) out.push(',')
        out.push(value.slice(i, i + SERIALIZE_BATCH).map((item) => JSON.stringify(item)).join(','))
        await yieldToMain()
      }
      out.push(']')
    } else if (value !== null && typeof value === 'object') {
      const sub = value as Record<string, unknown>
      const subKeys = Object.keys(sub).filter((sk) => sub[sk] !== undefined)
      out.push('{')
      for (let i = 0; i < subKeys.length; i++) {
        if (i > 0) out.push(',')
        const sk = subKeys[i]!
        out.push(JSON.stringify(sk), ':', JSON.stringify(sub[sk]))
        if (i % SERIALIZE_BATCH === SERIALIZE_BATCH - 1) await yieldToMain()
      }
      out.push('}')
    } else {
      out.push(JSON.stringify(value))
    }
  }
  out.push('}')
  return out.join('')
}

/** 组装轻量备份（不含媒体）：materials + records 全量，prefs 从 localStorage 导出 */
export async function buildBackup(): Promise<{ filename: string; json: string }> {
  const parts = await collectBackupParts()
  const payload = {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    ...parts,
  }
  return { filename: backupFilename(), json: await stringifyBackupJson(payload) }
}

/**
 * 组装完整备份 zip（含媒体与笔记图片）。内存有界：sink 定期把已完成分片合并为 Blob
 * （浏览器落盘），JS 堆峰值 ≈ 单个最大媒体文件 + 32MB 合并缓冲。
 */
export async function buildFullBackupZip(): Promise<{ filename: string; blob: Blob }> {
  const parts = await collectBackupParts()

  // 清单阶段：只遍历 material ids（tts:/transcribe: 临时 blob 永不进包）；
  // 只保留 Blob 句柄不读内容，清单元信息取自 material 元数据 + blob.type。
  // 句柄并发获取替代逐条串行事务（评审 #56）
  const blobs = await Promise.all(parts.materials.map((m) => blobsStore.get<Blob>(m.material.id)))
  const collected: Array<{ id: string; blob: Blob; entry: MediaManifestEntry }> = []
  parts.materials.forEach((m, i) => {
    const b = blobs[i]
    if (!b) return // 无媒体材料（如轻量导入而来）只走元数据，不进清单
    collected.push({
      id: m.material.id,
      blob: b,
      entry: {
        id: m.material.id,
        fileName: m.material.mediaFileName || `${m.material.id}.bin`,
        mediaType: m.material.mediaType === 'video' ? 'video' : 'audio',
        mime: b.type || (m.material.mediaType === 'video' ? 'video/mp4' : 'audio/mpeg'),
        size: b.size,
      },
    })
  })
  // 笔记图片（blobs store 的 noteimg: 前缀族；与材料媒体、tts:/transcribe: 临时键不同形）
  const imageEntries = await blobsStore.getAllEntriesByPrefix('noteimg:')
  const images: Array<{ key: string; blob: Blob; entry: NoteImageManifestEntry }> = []
  for (const [key, value] of imageEntries) {
    if (!(value instanceof Blob)) continue
    images.push({ key, blob: value, entry: { key, mime: value.type || 'image/webp', size: value.size } })
  }

  const payload = {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    ...parts,
    media: collected.map((c) => c.entry),
    noteImages: images.map((c) => c.entry),
  }

  let chunks: BlobPart[] = []
  let buffered = 0
  const sink = (chunk: Uint8Array): void => {
    chunks.push(chunk)
    buffered += chunk.byteLength
    if (buffered >= 32 * 1024 * 1024) { chunks = [new Blob(chunks)]; buffered = 0 } // 定期合并：已写内容转出 JS 堆
  }
  const writer = createZipWriter(sink)
  // backup.json 分片序列化（主线程让出）+ 异步 deflate（浏览器下压缩走 Worker）
  await writer.addCompressed('backup.json', new TextEncoder().encode(await stringifyBackupJson(payload)))
  for (const c of collected) {
    // 流式写入：媒体分块喂 writer（增量 CRC + data descriptor），峰值堆 ≈ 单块 + 32MB sink，
    // 不再把整个文件（数百 MB 视频）一次性读进 JS 堆
    await writer.addStream(`media/${c.id}`, c.blob.size, blobChunks(c.blob))
  }
  for (const c of images) {
    // 笔记图片同款流式（单张压缩后几百 KB，但数量可多，逐张过 writer 保持内存有界）
    await writer.addStream(noteImageEntryName(c.key), c.blob.size, blobChunks(c.blob))
  }
  writer.finish()
  return { filename: fullBackupFilename(), blob: new Blob(chunks, { type: 'application/zip' }) }
}

/** Blob → 异步块序列（供 zip writer 流式写入；块大小由浏览器 stream 实现决定） */
async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  const reader = blob.stream().getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/** 触发浏览器下载文件 —— 统一实现见 lib/download.ts（历史四份拷贝收敛） */
export { downloadBlob } from '@/lib/download'
import { downloadBlob } from '@/lib/download'

/** 触发浏览器下载 JSON 备份文件（轻量链路沿用） */
export function downloadJsonBackup(filename: string, json: string): void {
  downloadBlob(filename, new Blob([json], { type: 'application/json;charset=utf-8' }))
}

/** 备份中三个 IDB store 的写入计划（同一事务提交，避免半导入） */
interface IdbImportPlan {
  materials: ReadonlyArray<readonly [string, unknown]>
  records: ReadonlyArray<readonly [string, unknown]>
  blobs: ReadonlyArray<readonly [string, unknown]>
  materialsSkipped: number
  recordsSkipped: number
}

async function planIdbImport(
  backup: ParsedBackup,
  strategy: ImportStrategy,
  mediaWrites?: ReadonlyArray<readonly [string, Blob]>,
  mediaSkipped = 0,
): Promise<IdbImportPlan & { mediaSkipped: number }> {
  const [existingMaterialIds, existingRecordKeys] = await Promise.all([
    materialsStore.allKeys(),
    recordsStore.allKeys(),
  ])
  const matPlan = planImport(
    backup.materials.map((m) => ({ key: m.id, value: m.value })),
    new Set(existingMaterialIds),
    strategy,
  )
  const recPlan = planImport(
    Object.entries(backup.records).map(([key, value]) => ({ key, value })),
    new Set(existingRecordKeys),
    strategy,
  )
  return {
    materials: matPlan.toWrite.map((e) => [e.key, e.value] as const),
    records: recPlan.toWrite.map((e) => [e.key, e.value] as const),
    blobs: mediaWrites ?? [],
    materialsSkipped: matPlan.skipped,
    recordsSkipped: recPlan.skipped,
    mediaSkipped,
  }
}

/**
 * localStorage prefs 先写入并保留恢复点，随后 IDB 三个 store 单事务提交；
 * IDB 失败时恢复 prefs，尽量逼近跨存储原子导入。
 */
async function applyParsedBackup(
  backup: ParsedBackup,
  strategy: ImportStrategy,
  mediaWrites?: ReadonlyArray<readonly [string, Blob]>,
  mediaSkipped = 0,
): Promise<Pick<ImportSummary, 'materialsWritten' | 'materialsSkipped' | 'recordsWritten' | 'recordsSkipped' | 'prefsWritten' | 'prefsSkipped' | 'mediaSkipped'>> {
  const plan = await planIdbImport(backup, strategy, mediaWrites, mediaSkipped)
  // 先同步写 prefs 并保留恢复点，再提交 IDB。IDB 失败时恢复 prefs；
  // 两边没有跨 API 事务，这是进程内可做到的最接近原子提交。
  const prefs = stagePrefs(backup.prefs, strategy === 'skipExisting')
  try {
    await putAllAtomic({
      materials: plan.materials,
      records: plan.records,
      blobs: plan.blobs,
    })
  } catch (err) {
    prefs.rollback()
    throw err
  }
  return {
    materialsWritten: plan.materials.length,
    materialsSkipped: plan.materialsSkipped,
    recordsWritten: plan.records.length,
    recordsSkipped: plan.recordsSkipped,
    prefsWritten: prefs.written,
    prefsSkipped: prefs.skipped,
    mediaSkipped: plan.mediaSkipped,
  }
}

/**
 * 导入轻量 JSON 备份：按冲突策略写回 materials / records / prefs，返回分类计数。
 * 校验失败抛 Error（message 可直接展示）。导入后调用方应刷新页面让各 store 重新加载。
 */
export async function importBackup(json: string, strategy: ImportStrategy): Promise<ImportSummary> {
  const parsed = parseBackupJson(json)
  if (!parsed.ok) throw new Error(parsed.error)
  return { ...(await applyParsedBackup(parsed.backup, strategy)), mediaWritten: 0, mediaMissing: 0 }
}

/** Blob → RangeReader（slice 惰性读取，zip 索引只需几次小切片） */
function readerFromBlob(file: Blob): RangeReader {
  return { size: file.size, read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()) }
}

/**
 * STORE 条目流式 CRC 校验：零拷贝 slice 只保证长度，内容完整性必须另读一遍算 CRC
 * （分块流过，内存有界；损坏媒体静默入库只会在播放时才暴露，且无法区分来源）。
 */
async function verifyStoreEntryCrc(file: Blob, info: ZipEntryInfo, name: string): Promise<void> {
  const reader = file.slice(info.dataOffset, info.dataOffset + info.uncompressedSize).stream().getReader()
  let crc = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) crc = crc32(value, crc)
    }
  } finally {
    reader.releaseLock()
  }
  if (crc !== info.crc32) throw new Error(`备份 zip 已损坏（${name} 校验失败）`)
}

/** 打开完整备份 zip：索引 + 解析 backup.json + 媒体预检（预览与正式导入共用；含笔记图片） */
async function openBackupZip(file: Blob): Promise<{ reader: RangeReader; index: ZipIndex; parsed: ParsedBackup; mediaBytes: number; mediaMissing: number }> {
  const reader = readerFromBlob(file)
  const index = await indexZip(reader)
  const jsonEntry = index.byName.get('backup.json')
  if (!jsonEntry) throw new Error('备份 zip 中缺少 backup.json，不是本应用导出的完整备份')
  const parsed = parseBackupJson(new TextDecoder().decode(await readEntry(reader, jsonEntry)))
  if (!parsed.ok) throw new Error(parsed.error)
  const { media, noteImages } = parsed.backup
  const mediaMissing = media.filter((m) => !index.byName.has(`media/${m.id}`)).length
    + noteImages.filter((n) => !index.byName.has(noteImageEntryName(n.key))).length
  const mediaBytes = media.reduce((sum, m) => sum + m.size, 0) + noteImages.reduce((sum, n) => sum + n.size, 0)
  return { reader, index, parsed: parsed.backup, mediaBytes, mediaMissing }
}

/** zip 导入预览（设置页确认弹窗用）：解析结果 + 媒体体积 + 缺失数 */
export async function prepareZipImport(file: Blob): Promise<{ parsed: ParsedBackup; mediaBytes: number; mediaMissing: number }> {
  const { parsed, mediaBytes, mediaMissing } = await openBackupZip(file)
  return { parsed, mediaBytes, mediaMissing }
}

/**
 * 导入完整备份 zip：材料/记录/设置走与轻量导入相同的合并策略，媒体额外写回 blobs store。
 * 配额预检在任何写入之前（含材料写入）。导入后调用方应刷新页面让各 store 重新加载。
 */
export async function importZipBackup(file: Blob, strategy: ImportStrategy): Promise<ImportSummary> {
  const { reader, index, parsed, mediaMissing: missingInIndex } = await openBackupZip(file)

  // 媒体合并计划（与材料/记录同一策略；blobs store 里的 tts:/transcribe: 键与 material id 不可能同形，无碰撞）
  const existingBlobKeys = new Set(await blobsStore.allKeys())
  const mediaPlan = planImport(parsed.media.map((m) => ({ key: m.id, value: m })), existingBlobKeys, strategy)
  // 笔记图片同款计划（键为 noteimg: 前缀族，与 material id / tts: 键不同形，无碰撞）
  const imagePlan = planImport(parsed.noteImages.map((n) => ({ key: n.key, value: n })), existingBlobKeys, strategy)

  // 配额预检：按 zip 中央目录的实际大小估算（×1.2 余量，同导入页写入前检查）
  const entryBytes = (name: string, fallback: number) => index.byName.get(name)?.uncompressedSize ?? fallback
  const plannedBytes = mediaPlan.toWrite.reduce((sum, e) => sum + entryBytes(`media/${e.key}`, e.value.size), 0)
    + imagePlan.toWrite.reduce((sum, e) => sum + entryBytes(noteImageEntryName(e.key), e.value.size), 0)
  const { usage, quota } = await estimateUsage()
  if (quota > 0 && usage + plannedBytes * 1.2 > quota) {
    throw new Error(`存储空间不足：需写入约 ${Math.round(plannedBytes / 1048576)} MB 媒体，请先清理空间或改用轻量备份导入`)
  }

  // 完整性预检 + Blob 构造全部发生在任何 IDB 写入之前；deflate 条目 readEntry 内已校验 CRC。
  // 随后 materials/records/blobs 走同一个 IndexedDB 事务，任一写失败整体回滚。
  const mediaWrites: Array<[string, Blob]> = []
  const pushZipBlob = async (key: string, info: ZipEntryInfo | undefined, mime: string, name: string): Promise<void> => {
    if (!info) return // openBackupZip 已统计缺失条目；这里不做重复计数
    if (info.method === 0) {
      await verifyStoreEntryCrc(file, info, name)
      mediaWrites.push([key, file.slice(info.dataOffset, info.dataOffset + info.uncompressedSize, mime)])
    } else {
      mediaWrites.push([key, new Blob([await readEntry(reader, info)], { type: mime })])
    }
  }
  for (const e of mediaPlan.toWrite) {
    const mime = e.value.mime || (e.value.mediaType === 'video' ? 'video/mp4' : 'audio/mpeg')
    await pushZipBlob(e.key, index.byName.get(`media/${e.key}`), mime, `media/${e.key}`)
  }
  for (const e of imagePlan.toWrite) {
    await pushZipBlob(e.key, index.byName.get(noteImageEntryName(e.key)), e.value.mime || 'image/webp', noteImageEntryName(e.key))
  }

  const base = await applyParsedBackup(parsed, strategy, mediaWrites, mediaPlan.skipped + imagePlan.skipped)
  return { ...base, mediaWritten: mediaWrites.length, mediaMissing: missingInIndex }
}
