/**
 * 生词本 store —— 支持多生词本 + 词条 CRUD
 *
 * 数据存储在 records store 中，使用 vocabbook: / vocabentry: 前缀。
 * 首次初始化时自动创建默认生词本。
 */

import type { VocabBook, VocabEntry } from '@/types/vocabulary'
import { DEFAULT_BOOK_ID } from '@/types/vocabulary'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import { createStore } from '@/stores/store'

export interface VocabStoreState {
  ready: boolean
  books: VocabBook[]
  entries: VocabEntry[]
}

export const vocabStore = createStore<VocabStoreState>({ ready: false, books: [], entries: [] })

async function refresh(): Promise<void> {
  // 两段主键前缀区间读：只物化生词本/词条自身的值（原 allKeys 全扫 + 每条一个事务，
  // 后又退化为单事务全库物化——fav:/note:/train: 的无关值不再参与反序列化）
  const [bookEntries, entryEntries] = await Promise.all([
    recordsStore.getAllEntriesByPrefix(RECORD_KEY_PREFIXES.vocabBook),
    recordsStore.getAllEntriesByPrefix(RECORD_KEY_PREFIXES.vocabEntry),
  ])
  const books = bookEntries
    .map(([, v]) => v as VocabBook)
    .filter((b): b is VocabBook => !!b && typeof b.createdAt === 'number')
  const entries = entryEntries
    .map(([, v]) => v as VocabEntry)
    .filter((e): e is VocabEntry => !!e && typeof e.addedAt === 'number')

  books.sort((a, b) => a.createdAt - b.createdAt)
  entries.sort((a, b) => b.addedAt - a.addedAt)

  vocabStore.set({ ready: true, books, entries })
}

/** 确保默认生词本存在 */
async function ensureDefaultBook(): Promise<void> {
  const existing = await recordsStore.get<VocabBook>(RECORD_KEYS.vocabBook(DEFAULT_BOOK_ID))
  if (existing) return
  const now = Date.now()
  const defaultBook: VocabBook = {
    id: DEFAULT_BOOK_ID,
    name: '默认生词本',
    createdAt: now,
    updatedAt: now,
  }
  await recordsStore.put(RECORD_KEYS.vocabBook(DEFAULT_BOOK_ID), defaultBook)
}

let initPromise: Promise<void> | null = null
/** 初始化：确保默认生词本 + 首次加载 + mnemonic 孤儿清扫 */
export function initVocab(): Promise<void> {
  initPromise ??= (async () => { await ensureDefaultBook(); await refresh(); await sweepOrphanMnemonics() })()
  return initPromise
}

/**
 * 启动清扫：词条被删后遗留的 mnemonic:{entryId} 缓存（评审 #20 兜底）。
 * 词条 id 是 UUID 不会复现，孤儿不清理则每次备份导出/导入都搬运死数据。
 */
async function sweepOrphanMnemonics(): Promise<void> {
  const mnemonicEntries = await recordsStore.getAllEntriesByPrefix(RECORD_KEY_PREFIXES.mnemonic)
  if (mnemonicEntries.length === 0) return
  const liveIds = new Set(vocabStore.get().entries.map((e) => e.id))
  const orphans = mnemonicEntries.filter(([key]) => !liveIds.has(key.slice(RECORD_KEY_PREFIXES.mnemonic.length)))
  if (orphans.length === 0) return
  await Promise.all(orphans.map(([key]) => recordsStore.delete(key)))
}

/** 删除词条及其从属记录（mnemonic 缓存），不留下备份反复搬运的孤儿数据 */
function deleteEntryRecords(entry: VocabEntry): Promise<void[]> {
  return Promise.all([
    recordsStore.delete(RECORD_KEYS.vocabEntry(entry.id)),
    recordsStore.delete(RECORD_KEYS.mnemonic(entry.id)),
  ])
}

// ─── 生词本 CRUD ───

/** 创建生词本 */
export async function createBook(name: string): Promise<VocabBook> {
  await initVocab()
  const now = Date.now()
  const book: VocabBook = {
    id: crypto.randomUUID(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
  }
  await recordsStore.put(RECORD_KEYS.vocabBook(book.id), book)
  await refresh()
  return book
}

/** 删除生词本（同时删除该本下所有词条及其 mnemonic 缓存）。不允许删除默认生词本。 */
export async function removeBook(bookId: string): Promise<void> {
  if (bookId === DEFAULT_BOOK_ID) return
  await initVocab()
  await recordsStore.delete(RECORD_KEYS.vocabBook(bookId))
  // 删除该本下所有词条
  const { entries } = vocabStore.get()
  const toDelete = entries.filter((e) => e.bookId === bookId)
  await Promise.all(toDelete.map(deleteEntryRecords))
  await refresh()
}

/** 重命名生词本 */
export async function renameBook(bookId: string, name: string): Promise<void> {
  await initVocab()
  const book = await recordsStore.get<VocabBook>(RECORD_KEYS.vocabBook(bookId))
  if (!book) return
  const updated: VocabBook = { ...book, name: name.trim(), updatedAt: Date.now() }
  await recordsStore.put(RECORD_KEYS.vocabBook(bookId), updated)
  await refresh()
}

/** 获取所有生词本 */
export function getAllBooks(): VocabBook[] {
  return vocabStore.get().books
}

// ─── 词条 CRUD ───

/** 添加词条 */
export async function addEntry(entry: Omit<VocabEntry, 'id' | 'addedAt' | 'frequency'>): Promise<VocabEntry> {
  await initVocab()
  const newEntry: VocabEntry = {
    ...entry,
    id: crypto.randomUUID(),
    addedAt: Date.now(),
    frequency: 0,
    text: entry.text.trim(),
  }
  await recordsStore.put(RECORD_KEYS.vocabEntry(newEntry.id), newEntry)
  await refresh()
  return newEntry
}

/** 删除词条（连带清理其 mnemonic 缓存，评审 #20） */
export async function removeEntry(entryId: string): Promise<void> {
  await initVocab()
  const entry = vocabStore.get().entries.find((e) => e.id === entryId)
  if (entry) await deleteEntryRecords(entry)
  else await recordsStore.delete(RECORD_KEYS.vocabEntry(entryId))
  await refresh()
}

/** 更新词条 */
export async function updateEntry(entryId: string, updates: Partial<Pick<VocabEntry, 'note'>>): Promise<void> {
  await initVocab()
  const entry = await recordsStore.get<VocabEntry>(RECORD_KEYS.vocabEntry(entryId))
  if (!entry) return
  const updated: VocabEntry = { ...entry, ...updates }
  await recordsStore.put(RECORD_KEYS.vocabEntry(entryId), updated)
  await refresh()
}

/** 获取指定生词本下的所有词条 */
export function getEntriesByBook(bookId: string): VocabEntry[] {
  return vocabStore.get().entries.filter((e) => e.bookId === bookId)
}

/** 清空指定生词本下的所有词条（连带 mnemonic 缓存） */
export async function clearEntriesByBook(bookId: string): Promise<void> {
  await initVocab()
  const { entries } = vocabStore.get()
  const toDelete = entries.filter((e) => e.bookId === bookId)
  if (toDelete.length === 0) return
  await Promise.all(toDelete.map(deleteEntryRecords))
  await refresh()
}

/**
 * 检查文本是否已收录（大小写不敏感）。
 * bookId 可选：指定时仅在该生词本内检查，否则全局检查。
 */
export function hasText(text: string, bookId?: string): boolean {
  const normalized = text.trim().toLowerCase()
  const { entries } = vocabStore.get()
  return entries.some((e) => {
    if (bookId && e.bookId !== bookId) return false
    return e.text.toLowerCase() === normalized
  })
}

/**
 * 删句后平移该材料词条的来源句序号；被删句来源置为 -1（保留词条与上下文，但不再指向现存句）。
 */
export async function shiftVocabEntriesAfterDeletion(materialId: string, deletedIndex: number): Promise<void> {
  await initVocab()
  // materialId 索引点查：只物化该材料的记录（词条键 vocabentry:{entryId} 不含材料 id，
  // 原先只能全库物化后逐条比对）
  const entries = await recordsStore.getEntriesByMaterial(materialId)
  let changed = false
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.vocabEntry)) continue
    const entry = value as VocabEntry | undefined
    if (!entry || typeof entry.sentenceIndex !== 'number') continue

    if (entry.sentenceIndex === deletedIndex) {
      await recordsStore.put(key, { ...entry, sentenceIndex: -1 } satisfies VocabEntry)
      changed = true
    } else if (entry.sentenceIndex > deletedIndex) {
      await recordsStore.put(key, { ...entry, sentenceIndex: entry.sentenceIndex - 1 } satisfies VocabEntry)
      changed = true
    }
  }
  if (changed) await refresh()
}

/**
 * 导入/重导入材料字幕后调用：扫描字幕单词与生词本词条匹配，按材料记账更新出现次数。
 * 幂等：同一材料重复应用（重导入 SRT / 重跑 AI 转写）先减去该材料的旧贡献再累加新值，
 * 频次不会翻倍；词条在此材料中不再出现时回落。
 * @param words      字幕中所有句子的单词扁平数组（建议已 toLowerCase）
 * @param materialId 来源材料 id（记账粒度）
 */
export async function updateFrequencies(words: string[], materialId: string): Promise<void> {
  await initVocab()
  if (!materialId) return

  // 构建 word → 出现次数 Map
  const wordCount = new Map<string, number>()
  for (const w of words) {
    const key = w.toLowerCase()
    wordCount.set(key, (wordCount.get(key) ?? 0) + 1)
  }

  const { entries } = vocabStore.get()
  const toUpdate: VocabEntry[] = []
  for (const entry of entries) {
    const oldCount = entry.materialCounts?.[materialId] ?? 0
    const newCount = wordCount.get(entry.text.toLowerCase()) ?? 0
    if (oldCount === newCount) continue
    const materialCounts = { ...(entry.materialCounts ?? {}) }
    if (newCount > 0) materialCounts[materialId] = newCount
    else delete materialCounts[materialId]
    toUpdate.push({ ...entry, frequency: Math.max(0, entry.frequency - oldCount + newCount), materialCounts })
  }

  if (toUpdate.length === 0) return

  // 批量写入
  await Promise.all(toUpdate.map((e) => recordsStore.put(RECORD_KEYS.vocabEntry(e.id), e)))
  await refresh()
}
