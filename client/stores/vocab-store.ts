/**
 * 生词本 store —— 支持多生词本 + 词条 CRUD
 *
 * 数据存储在 records store 中，使用 vocabbook: / vocabentry: 前缀。
 * 首次初始化时自动创建默认生词本。
 */

import type { VocabBook, VocabEntry } from '@/types/vocabulary'
import { DEFAULT_BOOK_ID } from '@/types/vocabulary'
import { recordsStore, runAtomicOps } from '@/platform/storage/idb'
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

/* ─── 增量补丁：CRUD 不再全量重读 IDB（与 material-store 同模式）───
 * refresh() 会把全部词条（各带完整来源句与 LLM 释义，数百字节/条）重新反序列化并
 * 安装全新 state 身份；useStore 无 selector，所有订阅者随之重渲染——重度用户
 * 每点一次加词都付 O(N)。CRUD 就地补丁内存态并保持排序；全量 refresh 留给初始化。
 */

/** 就地替换一批同 id 词条（addedAt 不变，位置不动） */
function patchEntries(updated: VocabEntry[]): void {
  if (updated.length === 0) return
  const byId = new Map(updated.map((e) => [e.id, e]))
  const state = vocabStore.get()
  vocabStore.set({ ...state, ready: true, entries: state.entries.map((e) => byId.get(e.id) ?? e) })
}

/** 就地更新/插入单条词条：新增（addedAt 最新）置顶，更新原位替换 */
function patchEntry(entry: VocabEntry): void {
  const state = vocabStore.get()
  if (!state.entries.some((e) => e.id === entry.id)) {
    vocabStore.set({ ...state, ready: true, entries: [entry, ...state.entries] })
    return
  }
  patchEntries([entry])
}

/** 就地移除若干词条（按 id 集合） */
function dropEntries(ids: Set<string>): void {
  if (ids.size === 0) return
  const state = vocabStore.get()
  vocabStore.set({ ...state, entries: state.entries.filter((e) => !ids.has(e.id)) })
}

/** 就地更新/插入生词本（保持 createdAt 升序） */
function patchBook(book: VocabBook): void {
  const state = vocabStore.get()
  const exists = state.books.some((b) => b.id === book.id)
  const books = (exists ? state.books.map((b) => (b.id === book.id ? book : b)) : [...state.books, book])
    .sort((a, b) => a.createdAt - b.createdAt)
  vocabStore.set({ ...state, ready: true, books })
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
  patchBook(book)
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
  // 就地补丁：移除本与旗下词条
  const state = vocabStore.get()
  vocabStore.set({
    ...state,
    books: state.books.filter((b) => b.id !== bookId),
    entries: state.entries.filter((e) => e.bookId !== bookId),
  })
}

/** 重命名生词本 */
export async function renameBook(bookId: string, name: string): Promise<void> {
  await initVocab()
  const book = await recordsStore.get<VocabBook>(RECORD_KEYS.vocabBook(bookId))
  if (!book) return
  const updated: VocabBook = { ...book, name: name.trim(), updatedAt: Date.now() }
  await recordsStore.put(RECORD_KEYS.vocabBook(bookId), updated)
  patchBook(updated)
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
  patchEntry(newEntry)
  return newEntry
}

/** 删除词条（连带清理其 mnemonic 缓存，评审 #20） */
export async function removeEntry(entryId: string): Promise<void> {
  await initVocab()
  const entry = vocabStore.get().entries.find((e) => e.id === entryId)
  if (entry) await deleteEntryRecords(entry)
  else await recordsStore.delete(RECORD_KEYS.vocabEntry(entryId))
  dropEntries(new Set([entryId]))
}

/** 更新词条 */
export async function updateEntry(entryId: string, updates: Partial<Pick<VocabEntry, 'note'>>): Promise<void> {
  await initVocab()
  const entry = await recordsStore.get<VocabEntry>(RECORD_KEYS.vocabEntry(entryId))
  if (!entry) return
  const updated: VocabEntry = { ...entry, ...updates }
  await recordsStore.put(RECORD_KEYS.vocabEntry(entryId), updated)
  patchEntry(updated)
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
  dropEntries(new Set(toDelete.map((e) => e.id)))
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
  const put: Array<readonly [string, unknown]> = []
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.vocabEntry)) continue
    const entry = value as VocabEntry | undefined
    if (!entry || typeof entry.sentenceIndex !== 'number') continue

    if (entry.sentenceIndex === deletedIndex) {
      put.push([key, { ...entry, sentenceIndex: -1 } satisfies VocabEntry])
    } else if (entry.sentenceIndex > deletedIndex) {
      put.push([key, { ...entry, sentenceIndex: entry.sentenceIndex - 1 } satisfies VocabEntry])
    }
  }
  // 单事务提交：逐条 put 中途失败（崩溃/关页）会留下部分平移的永久错位（2026-11 全仓复审）
  if (put.length > 0) {
    await runAtomicOps({ put: { records: put } })
    patchEntries(put.map(([, v]) => v as VocabEntry))
  }
}

/**
 * 整体替换字幕后按映射迁移词条来源句序号；对应句已不存在的置 -1
 * （与删句同语义：保留词条与上下文，只是不再指向现存句）。
 */
export async function remapVocabEntriesAfterReplace(materialId: string, mapping: Map<number, number>): Promise<void> {
  await initVocab()
  const entries = await recordsStore.getEntriesByMaterial(materialId)
  const put: Array<readonly [string, unknown]> = []
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.vocabEntry)) continue
    const entry = value as VocabEntry | undefined
    if (!entry || typeof entry.sentenceIndex !== 'number') continue
    const next = mapping.get(entry.sentenceIndex)
    if (next === entry.sentenceIndex) continue
    put.push([key, { ...entry, sentenceIndex: next ?? -1 } satisfies VocabEntry])
  }
  if (put.length > 0) {
    await runAtomicOps({ put: { records: put } })
    patchEntries(put.map(([, v]) => v as VocabEntry))
  }
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

  // 单事务提交（与平移路径同一原子性纪律）：逐条 put 中途失败（quota/abort/关页）会
  // 留下部分应用的频次，永久破坏「frequency === materialCounts 各值之和」不变量
  //（2026-11 全仓复审 c013）
  await runAtomicOps({
    put: { records: toUpdate.map((e) => [RECORD_KEYS.vocabEntry(e.id), e] as const) },
  })
  patchEntries(toUpdate)
}
