/**
 * 手写 Promise 化 IndexedDB 封装 —— 真源：docs/系统架构设计.md §4.2 本地持久化
 *
 * 零新增运行时依赖（不引 idb 等库）。三个 object store：
 *  - `materials`：材料元数据 JSON（含解析后 SubtitleData），key = materialId
 *  - `blobs`：媒体 Blob，key = materialId
 *  - `records`：训练记录 / 收藏 / 进度，key 带类型前缀（如 `progress:`、`fav:`、`train:`）
 *
 * SSR / 隐私模式（Safari private 等）打开失败时优雅降级为内存 Map 兜底，绝不抛崩溃。
 */

export type StoreName = 'materials' | 'blobs' | 'records'
const DB_NAME = 'ping-english-assistant'
const DB_VERSION = 1
const STORES: StoreName[] = ['materials', 'blobs', 'records']

/** 内存兜底（SSR、无 indexedDB、或打开失败时启用） */
const memoryFallback = new Map<StoreName, Map<string, unknown>>()
let useMemory = typeof indexedDB === 'undefined'
function mem(store: StoreName): Map<string, unknown> {
  let m = memoryFallback.get(store)
  if (!m) { m = new Map(); memoryFallback.set(store, m) }
  return m
}

let dbPromise: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  if (useMemory) return Promise.resolve(null)
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => { useMemory = true; resolve(null) }
      req.onblocked = () => { useMemory = true; resolve(null) }
    } catch { useMemory = true; resolve(null) }
  })
  return dbPromise
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    if (!db) return reject(new Error('memory'))
    try {
      const req = fn(db.transaction(store, mode).objectStore(store))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error ?? new Error('idb'))
    } catch (e) { reject(e) }
  }))
}

/** 统一兜底：IDB 失败 → 回落内存，保证调用方永不因存储层崩溃 */
async function guarded<T>(store: StoreName, idb: () => Promise<T>, memFn: (m: Map<string, unknown>) => T): Promise<T> {
  if (useMemory) return memFn(mem(store))
  try { return await idb() }
  catch { useMemory = true; return memFn(mem(store)) }
}

/** 单个 object store 的最小 KV API */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  allKeys(): Promise<string[]>
  clear(): Promise<void>
}

function makeStore(store: StoreName): KvStore {
  return {
    get: <T>(key: string) => guarded<T | undefined>(store, () => tx<T | undefined>(store, 'readonly', os => os.get(key)), m => m.get(key) as T | undefined),
    put: (key, value) => guarded<void>(store, () => tx<IDBValidKey>(store, 'readwrite', os => os.put(value, key)).then(() => undefined), m => { m.set(key, value) }),
    delete: (key) => guarded<void>(store, () => tx<undefined>(store, 'readwrite', os => os.delete(key)).then(() => undefined), m => { m.delete(key) }),
    allKeys: () => guarded<string[]>(store, () => tx<IDBValidKey[]>(store, 'readonly', os => os.getAllKeys()).then(ks => ks.map(String)), m => [...m.keys()]),
    clear: () => guarded<void>(store, () => tx<undefined>(store, 'readwrite', os => os.clear()).then(() => undefined), m => { m.clear() }),
  }
}

/** 三个 store 的单例入口 */
export const materialsStore = makeStore('materials')
export const blobsStore = makeStore('blobs')
export const recordsStore = makeStore('records')

/** 磁盘占用查询（不可用时返回 0，不崩溃） */
export async function estimateUsage(): Promise<{ usage: number; quota: number }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate()
      return { usage, quota }
    }
  } catch { /* ignore */ }
  return { usage: 0, quota: 0 }
}

/** 当前是否处于内存降级模式（供 UI 展示提示，可选） */
export function isMemoryFallback(): boolean { return useMemory }
