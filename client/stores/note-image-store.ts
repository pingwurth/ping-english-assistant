/**
 * 笔记图片 store —— blobs store 中 `noteimg:{materialId}:{imageId}` 键族。
 *
 * 笔记 Markdown 以 `![alt](idb://noteimg/{materialId}/{imageId})` 引用（与材料媒体
 * `idb://materials/{id}` 的 ref 约定一致）；图片本体不进 records——笔记记录保持轻量，
 * listNotes / 备份 JSON 不被 base64 撑爆，大图也只在渲染时按需取 Blob。
 *
 * 生命周期（孤儿回收以「该材料所有笔记内容引用的 key 集合」为准）：
 *  - 编辑收口点（关抽屉/卸载/字幕替换/删句）调用方先 flush 待落盘笔记再 sweep，
 *    保证刚插入但尚未落盘的引用不被误删；
 *  - 删材料走 deleteNoteImagesByMaterial 前缀级联（removeMaterial 单事务）。
 * 图片键在 blobs store 自成前缀族，与材料媒体（key=materialId）和
 * tts:/transcribe: 临时产物（各有专属前缀清扫）互不干扰。
 */

import { blobsStore } from '@/platform/storage/idb'
import { listNotes } from '@/stores/note-store'

const KEY_PREFIX = 'noteimg:'
export const NOTE_IMAGE_REF_PREFIX = 'idb://noteimg/'

/** 图片的 blobs store 键（材料隔离：级联删除/回收都按材料前缀扫描） */
export function noteImageBlobKey(materialId: string, imageId: string): string {
  return `${KEY_PREFIX}${materialId}:${imageId}`
}

/** 笔记 Markdown 中的图片引用 URL */
export function noteImageRef(materialId: string, imageId: string): string {
  return `${NOTE_IMAGE_REF_PREFIX}${materialId}/${imageId}`
}

export interface NoteImageRef {
  materialId: string
  imageId: string
  /** 对应的 blobs store 键 */
  blobKey: string
}

/**
 * 解析图片引用。只认本应用的 idb://noteimg/ 前缀——外链（http(s):/data: 等）返回
 * null，渲染侧按纯文本处理（不加载外部资源：离线优先 + 防 javascript: 之类注入）。
 */
export function parseNoteImageRef(src: string): NoteImageRef | null {
  if (!src.startsWith(NOTE_IMAGE_REF_PREFIX)) return null
  const rest = src.slice(NOTE_IMAGE_REF_PREFIX.length)
  const slash = rest.lastIndexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  const materialId = rest.slice(0, slash)
  const imageId = rest.slice(slash + 1)
  if (imageId.includes('/')) return null
  return { materialId, imageId, blobKey: noteImageBlobKey(materialId, imageId) }
}

/** 笔记 Markdown 里引用图片的 URL 形态（materialId/imageId 均不含空白、`/`、`)`） */
const REF_IN_MARKDOWN_RE = /idb:\/\/noteimg\/([^/\s)]+)\/([^/\s)]+)/g

/** 从若干笔记内容中收集全部图片引用的 blobs 键（回收对账用） */
export function collectNoteImageBlobKeys(contents: Iterable<string>): Set<string> {
  const keys = new Set<string>()
  for (const content of contents) {
    for (const m of content.matchAll(REF_IN_MARKDOWN_RE)) {
      keys.add(noteImageBlobKey(m[1]!, m[2]!))
    }
  }
  return keys
}

/** 存入一张图片，返回 imageId（uuid） */
export async function putNoteImage(materialId: string, blob: Blob): Promise<string> {
  const imageId = crypto.randomUUID()
  await blobsStore.put(noteImageBlobKey(materialId, imageId), blob)
  return imageId
}

/** 读取图片（不存在返回 undefined，渲染侧按失效占位处理） */
export async function getNoteImage(materialId: string, imageId: string): Promise<Blob | undefined> {
  return blobsStore.get<Blob>(noteImageBlobKey(materialId, imageId))
}

/** 该材料的全部图片键（纯键扫描，不物化多 MB 的 Blob 值；removeMaterial 并入原子删除） */
export async function listNoteImageKeys(materialId: string): Promise<string[]> {
  return blobsStore.getAllKeysByPrefix(`${KEY_PREFIX}${materialId}:`)
}

/**
 * 孤儿回收：删除该材料 blobs 中已不被任何**已落盘**笔记内容引用的图片。
 * 调用方须先收口待落盘笔记（否则刚插入、尚未保存的引用会被当孤儿误删）。
 * 回收失败只留下无害孤儿（下次回收点重试），调用方可吞错。
 */
export async function sweepNoteImages(materialId: string): Promise<void> {
  const [notes, keys] = await Promise.all([listNotes(materialId), listNoteImageKeys(materialId)])
  const referenced = collectNoteImageBlobKeys(notes.map((n) => n.content))
  await Promise.all(keys.filter((k) => !referenced.has(k)).map((k) => blobsStore.delete(k)))
}
