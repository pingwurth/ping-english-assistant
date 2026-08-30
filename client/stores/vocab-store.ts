/**
 * 生词本 store —— 支持多生词本 + 词条 CRUD
 *
 * 数据存储在 records store 中，使用 vocabbook: / vocabentry: 前缀。
 * 首次初始化时自动创建默认生词本。
 */

import type { VocabBook, VocabEntry } from '@/types/vocabulary'
import { DEFAULT_BOOK_ID } from '@/types/vocabulary'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'
import { createStore } from '@/stores/store'

export interface VocabStoreState {
  ready: boolean
  books: VocabBook[]
  entries: VocabEntry[]
}

export const vocabStore = createStore<VocabStoreState>({ ready: false, books: [], entries: [] })

async function refresh(): Promise<void> {
  const keys = await recordsStore.allKeys()
  const bookKeys = keys.filter((k) => k.startsWith('vocabbook:'))
  const entryKeys = keys.filter((k) => k.startsWith('vocabentry:'))

  const books = (await Promise.all(bookKeys.map((k) => recordsStore.get<VocabBook>(k)))).filter((b): b is VocabBook => !!b)
  const entries = (await Promise.all(entryKeys.map((k) => recordsStore.get<VocabEntry>(k)))).filter((e): e is VocabEntry => !!e)

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
/** 初始化：确保默认生词本 + 首次加载 */
export function initVocab(): Promise<void> {
  initPromise ??= (async () => { await ensureDefaultBook(); await refresh() })()
  return initPromise
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

/** 删除生词本（同时删除该本下所有词条）。不允许删除默认生词本。 */
export async function removeBook(bookId: string): Promise<void> {
  if (bookId === DEFAULT_BOOK_ID) return
  await initVocab()
  await recordsStore.delete(RECORD_KEYS.vocabBook(bookId))
  // 删除该本下所有词条
  const { entries } = vocabStore.get()
  const toDelete = entries.filter((e) => e.bookId === bookId)
  await Promise.all(toDelete.map((e) => recordsStore.delete(RECORD_KEYS.vocabEntry(e.id))))
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
export async function addEntry(entry: Omit<VocabEntry, 'id' | 'addedAt'>): Promise<VocabEntry> {
  await initVocab()
  const newEntry: VocabEntry = {
    ...entry,
    id: crypto.randomUUID(),
    addedAt: Date.now(),
    text: entry.text.trim(),
  }
  await recordsStore.put(RECORD_KEYS.vocabEntry(newEntry.id), newEntry)
  await refresh()
  return newEntry
}

/** 删除词条 */
export async function removeEntry(entryId: string): Promise<void> {
  await initVocab()
  await recordsStore.delete(RECORD_KEYS.vocabEntry(entryId))
  await refresh()
}

/** 获取指定生词本下的所有词条 */
export function getEntriesByBook(bookId: string): VocabEntry[] {
  return vocabStore.get().entries.filter((e) => e.bookId === bookId)
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
