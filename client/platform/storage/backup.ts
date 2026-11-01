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

import { BACKUP_APP_ID, BACKUP_FORMAT_VERSION, parseBackupJson, planImport, type ImportStrategy, type MediaManifestEntry, type ParsedBackup } from '@/core/backup/backup-format'
import { createZipWriter, indexZip, readEntry, type RangeReader, type ZipIndex } from '@/core/backup/zip'
import { blobsStore, estimateUsage, materialsStore, recordsStore } from '@/platform/storage/idb'
import { exportAllPrefs, hasPref, setPref } from '@/platform/storage/prefs'
import type { MaterialRecord } from '@/platform/storage/schema'

export interface ImportSummary {
  materialsWritten: number
  materialsSkipped: number
  recordsWritten: number
  recordsSkipped: number
  prefsWritten: number
  prefsSkipped: number
  /** 仅 zip 导入有值（轻量 JSON 导入恒 0）：按冲突策略实际写入/跳过的媒体数 */
  mediaWritten: number
  mediaSkipped: number
  /** 清单里有、zip 里没有对应条目的媒体数（对应材料导入后需单独补传媒体） */
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
  const materialKeys = await materialsStore.allKeys()
  const materials = (await Promise.all(materialKeys.map((k) => materialsStore.get<MaterialRecord>(k))))
    .filter((m): m is MaterialRecord => !!m)
  const recordKeys = await recordsStore.allKeys()
  const recordEntries = await Promise.all(recordKeys.map(async (k) => [k, await recordsStore.get(k)] as const))
  const records = Object.fromEntries(recordEntries.filter(([, v]) => v !== undefined))
  return { materials, records, prefs: exportAllPrefs() }
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
  return { filename: backupFilename(), json: JSON.stringify(payload) }
}

/**
 * 组装完整备份 zip（含媒体）。内存有界：sink 定期把已完成分片合并为 Blob（浏览器落盘），
 * JS 堆峰值 ≈ 单个最大媒体文件 + 32MB 合并缓冲。
 */
export async function buildFullBackupZip(): Promise<{ filename: string; blob: Blob }> {
  const parts = await collectBackupParts()

  // 清单阶段：只遍历 material ids（tts:/transcribe: 临时 blob 永不进包）；
  // 只保留 Blob 句柄不读内容，清单元信息取自 material 元数据 + blob.type
  const collected: Array<{ id: string; blob: Blob; entry: MediaManifestEntry }> = []
  for (const m of parts.materials) {
    const b = await blobsStore.get<Blob>(m.material.id)
    if (!b) continue // 无媒体材料（如轻量导入而来）只走元数据，不进清单
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
  }

  const payload = {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    ...parts,
    media: collected.map((c) => c.entry),
  }

  let chunks: BlobPart[] = []
  let buffered = 0
  const sink = (chunk: Uint8Array): void => {
    chunks.push(chunk)
    buffered += chunk.byteLength
    if (buffered >= 32 * 1024 * 1024) { chunks = [new Blob(chunks)]; buffered = 0 } // 定期合并：已写内容转出 JS 堆
  }
  const writer = createZipWriter(sink)
  writer.add('backup.json', new TextEncoder().encode(JSON.stringify(payload)))
  for (const c of collected) {
    writer.add(`media/${c.id}`, new Uint8Array(await c.blob.arrayBuffer()), { store: true }) // 一次仅一个媒体进堆
  }
  writer.finish()
  return { filename: fullBackupFilename(), blob: new Blob(chunks, { type: 'application/zip' }) }
}

/** 触发浏览器下载文件 —— 统一实现见 lib/download.ts（历史四份拷贝收敛） */
export { downloadBlob } from '@/lib/download'
import { downloadBlob } from '@/lib/download'

/** 触发浏览器下载 JSON 备份文件（轻量链路沿用） */
export function downloadJsonBackup(filename: string, json: string): void {
  downloadBlob(filename, new Blob([json], { type: 'application/json;charset=utf-8' }))
}

/** materials / records / prefs 按冲突策略写回，返回分类计数（两条导入链共用） */
async function applyParsedBackup(
  backup: ParsedBackup,
  strategy: ImportStrategy,
): Promise<Pick<ImportSummary, 'materialsWritten' | 'materialsSkipped' | 'recordsWritten' | 'recordsSkipped' | 'prefsWritten' | 'prefsSkipped'>> {
  const { materials, records, prefs } = backup

  const existingMaterialIds = new Set(await materialsStore.allKeys())
  const existingRecordKeys = new Set(await recordsStore.allKeys())

  const matPlan = planImport(materials.map((m) => ({ key: m.id, value: m.value })), existingMaterialIds, strategy)
  const recPlan = planImport(Object.entries(records).map(([key, value]) => ({ key, value })), existingRecordKeys, strategy)

  await Promise.all(matPlan.toWrite.map((e) => materialsStore.put(e.key, e.value)))
  await Promise.all(recPlan.toWrite.map((e) => recordsStore.put(e.key, e.value)))

  let prefsWritten = 0
  let prefsSkipped = 0
  for (const [key, value] of Object.entries(prefs)) {
    if (strategy === 'skipExisting' && hasPref(key)) { prefsSkipped++; continue }
    setPref(key, value)
    prefsWritten++
  }

  return {
    materialsWritten: matPlan.toWrite.length,
    materialsSkipped: matPlan.skipped,
    recordsWritten: recPlan.toWrite.length,
    recordsSkipped: recPlan.skipped,
    prefsWritten,
    prefsSkipped,
  }
}

/**
 * 导入轻量 JSON 备份：按冲突策略写回 materials / records / prefs，返回分类计数。
 * 校验失败抛 Error（message 可直接展示）。导入后调用方应刷新页面让各 store 重新加载。
 */
export async function importBackup(json: string, strategy: ImportStrategy): Promise<ImportSummary> {
  const parsed = parseBackupJson(json)
  if (!parsed.ok) throw new Error(parsed.error)
  return { ...(await applyParsedBackup(parsed.backup, strategy)), mediaWritten: 0, mediaSkipped: 0, mediaMissing: 0 }
}

/** Blob → RangeReader（slice 惰性读取，zip 索引只需几次小切片） */
function readerFromBlob(file: Blob): RangeReader {
  return { size: file.size, read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()) }
}

/** 打开完整备份 zip：索引 + 解析 backup.json + 媒体预检（预览与正式导入共用） */
async function openBackupZip(file: Blob): Promise<{ reader: RangeReader; index: ZipIndex; parsed: ParsedBackup; mediaBytes: number; mediaMissing: number }> {
  const reader = readerFromBlob(file)
  const index = await indexZip(reader)
  const jsonEntry = index.byName.get('backup.json')
  if (!jsonEntry) throw new Error('备份 zip 中缺少 backup.json，不是本应用导出的完整备份')
  const parsed = parseBackupJson(new TextDecoder().decode(await readEntry(reader, jsonEntry)))
  if (!parsed.ok) throw new Error(parsed.error)
  const media = parsed.backup.media
  const mediaMissing = media.filter((m) => !index.byName.has(`media/${m.id}`)).length
  const mediaBytes = media.reduce((sum, m) => sum + m.size, 0)
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

  // 配额预检：按 zip 中央目录的实际大小估算（×1.2 余量，同导入页写入前检查）
  const plannedBytes = mediaPlan.toWrite.reduce((sum, e) => sum + (index.byName.get(`media/${e.key}`)?.uncompressedSize ?? e.value.size), 0)
  const { usage, quota } = await estimateUsage()
  if (quota > 0 && usage + plannedBytes * 1.2 > quota) {
    throw new Error(`存储空间不足：需写入约 ${Math.round(plannedBytes / 1048576)} MB 媒体，请先清理空间或改用轻量备份导入`)
  }

  // 先写材料/记录/设置，再写媒体（媒体永不落单）
  const base = await applyParsedBackup(parsed, strategy)

  let mediaWritten = 0
  let mediaMissing = missingInIndex
  for (const e of mediaPlan.toWrite) {
    const info = index.byName.get(`media/${e.key}`)
    if (!info) { mediaMissing++; continue } // 清单有而 zip 无对应条目：计数跳过
    const mime = e.value.mime || (e.value.mediaType === 'video' ? 'video/mp4' : 'audio/mpeg')
    const blob = info.method === 0
      ? file.slice(info.dataOffset, info.dataOffset + info.uncompressedSize, mime) // STORE 零拷贝主路径（slice 第 3 参保 MIME，播放器复播依赖 blob.type）
      : new Blob([await readEntry(reader, info)], { type: mime }) // 外部工具重打包的 deflate 条目兜底
    await blobsStore.put(e.key, blob)
    mediaWritten++
  }

  return { ...base, mediaWritten, mediaSkipped: mediaPlan.skipped, mediaMissing }
}
