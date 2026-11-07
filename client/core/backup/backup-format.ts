/**
 * 备份文件格式与导入合并计划 —— 零依赖纯 TS，node 可直接单测。
 *
 * 备份 JSON 结构（轻量导出不含媒体；完整备份 zip 内的 backup.json 额外带可选清单）：
 *   { app, formatVersion, exportedAt, materials: MaterialRecord[], records: {key→value},
 *     prefs: {key→value}, media?: MediaManifestEntry[], noteImages?: NoteImageManifestEntry[] }
 *
 * 解析与合并规则在这里集中维护（校验失败给出可读错误；materials 按 material.id 归一化为
 * {id, value}；冲突策略 skipExisting=保留本机已有 / overwrite=以备份为准），
 * platform/storage/backup.ts 只做 IDB/prefs 读写与 zip 组包/解包编排。
 */

export const BACKUP_APP_ID = 'ping-english-assistant'
/** v2：完整备份新增笔记图片清单（zip 内 noteimg/{blobKey} 条目）；v1 备份仍可导入 */
export const BACKUP_FORMAT_VERSION = 2

/** 完整备份 zip 内 media/{materialId} 条目的清单项（媒体本体在 zip 内，JSON 里只有元信息） */
export interface MediaManifestEntry {
  /** = material.id，即 zip 内条目名 media/{id} */
  id: string
  /** 展示用文件名（不用于 zip 条目名） */
  fileName: string
  mediaType: 'audio' | 'video'
  /** 导出时 blob.type；恢复时作为新 Blob 的 MIME（播放器复播依赖） */
  mime: string
  /** 字节数（展示/预检用；导入时以 zip 中央目录的 uncompressedSize 为准） */
  size: number
}

/** 完整备份 zip 内 noteimg/{blobKey} 条目的清单项（句子笔记里的图片，本体在 zip 内） */
export interface NoteImageManifestEntry {
  /** blobs store 键（noteimg:{materialId}:{imageId}），即 zip 内条目名 noteimg/{key} */
  key: string
  /** 导出时 blob.type；恢复时作为新 Blob 的 MIME */
  mime: string
  /** 字节数（展示/预检用；导入时以 zip 中央目录的 uncompressedSize 为准） */
  size: number
}

/** 解析成功的备份（materials 已归一化并剔除无 id 项） */
export interface ParsedBackup {
  formatVersion: number
  exportedAt: number
  materials: Array<{ id: string; value: unknown }>
  records: Record<string, unknown>
  prefs: Record<string, unknown>
  /** 轻量 JSON 导出恒为 []；完整备份 zip 的 backup.json 可携带 */
  media: MediaManifestEntry[]
  /** v2 起完整备份携带；轻量导出与 v1 备份恒为 [] */
  noteImages: NoteImageManifestEntry[]
}

export type ParseResult = { ok: true; backup: ParsedBackup } | { ok: false; error: string }

/** 导入冲突策略：skipExisting 保留本机已有项；overwrite 以备份覆盖 */
export type ImportStrategy = 'skipExisting' | 'overwrite'

/** 解析并校验备份 JSON；错误信息面向用户（可直接展示） */
export function parseBackupJson(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '备份文件结构不正确' }
  const r = raw as Record<string, unknown>

  if (r.app !== BACKUP_APP_ID) return { ok: false, error: '不是本应用导出的备份文件' }
  const version = r.formatVersion
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1) {
    return { ok: false, error: '备份缺少有效的格式版本号' }
  }
  if (version > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `备份来自更新版本的应用（v${version}，本机支持 v${BACKUP_FORMAT_VERSION}），请先升级应用` }
  }

  if (!Array.isArray(r.materials)) return { ok: false, error: '备份的 materials 字段不正确' }
  if (!r.records || typeof r.records !== 'object' || Array.isArray(r.records)) return { ok: false, error: '备份的 records 字段不正确' }
  if (!r.prefs || typeof r.prefs !== 'object' || Array.isArray(r.prefs)) return { ok: false, error: '备份的 prefs 字段不正确' }
  // media 可选（轻量导出无此字段）；存在则必须是数组
  if (r.media !== undefined && !Array.isArray(r.media)) return { ok: false, error: '备份的 media 字段不正确' }
  // noteImages 可选（v2 起完整备份携带）
  if (r.noteImages !== undefined && !Array.isArray(r.noteImages)) return { ok: false, error: '备份的 noteImages 字段不正确' }

  // records 值形状守卫：store 里的每条记录都必须是普通对象（TrainingRecord/favorite/note/progress
  // 皆为对象）。原样透传任意 JSON 会让脏数据（null/数组/基元）绕过 types 层必填约束直落 IndexedDB，
  // 进而在 stores 读取处抛 TypeError。按容错策略剔除不合格项，而非拒绝整份备份。
  const records: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(r.records as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    records[key] = value
  }
  // prefs 同样收敛为字符串键的基元值（localStorage 只接受字符串；对象/数组按剔除处理）
  const prefs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(r.prefs as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key) continue
    if (value !== null && typeof value === 'object') continue
    prefs[key] = value
  }

  // materials 按 material.id 归一化；没有有效 id 的项剔除（不因个别脏数据拒绝整份备份）
  const materials: ParsedBackup['materials'] = []
  for (const entry of r.materials) {
    if (!entry || typeof entry !== 'object') continue
    const id = (entry as { material?: { id?: unknown } }).material?.id
    if (typeof id !== 'string' || !id) continue
    materials.push({ id, value: entry })
  }

  // media 清单同样容错归一化：无有效 id / size 非法的项剔除，按 id 去重取先出现
  const media: MediaManifestEntry[] = []
  const seenMediaIds = new Set<string>()
  for (const entry of r.media ?? []) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = e.id
    const size = e.size
    if (typeof id !== 'string' || !id) continue
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) continue
    if (seenMediaIds.has(id)) continue
    seenMediaIds.add(id)
    media.push({
      id,
      fileName: typeof e.fileName === 'string' ? e.fileName : '',
      mediaType: e.mediaType === 'video' ? 'video' : 'audio',
      mime: typeof e.mime === 'string' ? e.mime : '',
      size,
    })
  }

  // 笔记图片清单容错归一化：键必须是本应用 noteimg: 前缀、size 合法，按键去重取先出现
  const noteImages: NoteImageManifestEntry[] = []
  const seenImageKeys = new Set<string>()
  for (const entry of r.noteImages ?? []) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const key = e.key
    const size = e.size
    if (typeof key !== 'string' || !key.startsWith('noteimg:')) continue
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) continue
    if (seenImageKeys.has(key)) continue
    seenImageKeys.add(key)
    noteImages.push({ key, mime: typeof e.mime === 'string' ? e.mime : '', size })
  }

  return {
    ok: true,
    backup: {
      formatVersion: version,
      exportedAt: typeof r.exportedAt === 'number' ? r.exportedAt : 0,
      materials,
      records,
      prefs,
      media,
      noteImages,
    },
  }
}

/**
 * 合并计划：给定备份条目与本机已有 key 集合，算出待写入项与跳过数。
 * overwrite 全写；skipExisting 只写本机没有的。
 */
export function planImport<T>(entries: ReadonlyArray<{ key: string; value: T }>, existingKeys: ReadonlySet<string>, strategy: ImportStrategy): { toWrite: Array<{ key: string; value: T }>; skipped: number } {
  const toWrite: Array<{ key: string; value: T }> = []
  let skipped = 0
  for (const e of entries) {
    if (strategy === 'skipExisting' && existingKeys.has(e.key)) { skipped++; continue }
    toWrite.push(e)
  }
  return { toWrite, skipped }
}
