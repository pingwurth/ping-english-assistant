/**
 * 手写 Promise 化 IndexedDB 封装 —— 真源：docs/系统架构设计.md §4.2 本地持久化
 *
 * 零新增运行时依赖（不引 idb 等库）。三个 object store：
 *  - `materials`：材料元数据 JSON（含解析后 SubtitleData），key = materialId
 *  - `blobs`：媒体 Blob，key = materialId
 *  - `records`：训练记录 / 收藏 / 进度，key 带类型前缀（如 `progress:`、`fav:`、`train:`）
 *
 * 降级策略（A3 修复）：
 *  - 只有「打开数据库彻底不可用」（SSR、无 indexedDB、隐私模式、open 失败/长时间 blocked）
 *    才整体降级为内存 Map；
 *  - 运行期单次操作失败（配额满、事务 abort 等瞬时错误）只影响当次：
 *    读操作返回空结果，写操作抛出让调用方感知 —— 绝不静默切换，
 *    否则后续所有写入只进内存、刷新即丢，用户全程无感知。
 */

export type StoreName = 'materials' | 'blobs' | 'records'
const DB_NAME = 'ping-english-assistant'
const DB_VERSION = 2
const STORES: StoreName[] = ['materials', 'blobs', 'records']

/** onblocked 后等待旧版本连接释放的上限，超时才降级内存 */
const BLOCKED_TIMEOUT_MS = 10_000

/** 内存兜底（SSR、无 indexedDB、或打开彻底失败时启用） */
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
    let settled = false
    const fallbackToMemory = (reason: string, e?: unknown) => {
      if (settled) return
      settled = true
      console.error(`[IDB] ${reason}, falling back to memory:`, e ?? '')
      useMemory = true
      resolve(null)
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
      }
      req.onsuccess = () => { settled = true; resolve(req.result) }
      req.onerror = () => fallbackToMemory('open failed', req.error)
      // blocked = 另一标签页持旧版本连接：先等它退出而不是立刻放弃
      // （立刻降级会让本页"丢库"并在内存里积累永远不会落盘的写入）
      req.onblocked = () => {
        console.warn(`[IDB] open blocked by another tab; waiting up to ${BLOCKED_TIMEOUT_MS / 1000}s`)
        setTimeout(() => fallbackToMemory('open still blocked after timeout'), BLOCKED_TIMEOUT_MS)
      }
    } catch (e) {
      fallbackToMemory('open threw', e)
    }
  })
  return dbPromise
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    if (!db) return reject(new Error('memory'))
    try {
      const req = fn(db.transaction(store, mode).objectStore(store))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => {
        console.error(`[IDB] transaction error on "${store}" (${mode}):`, req.error)
        reject(req.error ?? new Error('idb'))
      }
    } catch (e) {
      console.error(`[IDB] transaction threw on "${store}" (${mode}):`, e)
      reject(e)
    }
  }))
}

/** 单个 object store 的最小 KV API */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  allKeys(): Promise<string[]>
  clear(): Promise<void>
  /**
   * 单事务取全部 [key, value] 对 —— 列表/统计场景用它替代「allKeys 全扫 + 每键一个
   * 独立事务」的 N+1（打开播放器页要为一份笔记开几十次事务的问题由此消除）。
   */
  getAllEntries(): Promise<Array<[string, unknown]>>
}

function makeStore(store: StoreName): KvStore {
  // 读失败 → 空结果（界面按"无数据"渲染，不崩）；写失败 → 抛出（调用方必须知道没存上）。
  // 两种都只影响当次操作，绝不把整个模块切到内存（那会让后续写入静默丢失）。
  const wrapRead = async <T>(p: Promise<T>, empty: T): Promise<T> => {
    try { return await p } catch (e) { console.error(`[IDB] read failed on "${store}":`, e); return empty }
  }
  const wrapWrite = async (p: Promise<unknown>): Promise<void> => {
    try { await p } catch (e) { console.error(`[IDB] write failed on "${store}" (NOT persisted):`, e); throw e }
  }
  return {
    get: <T>(key: string) =>
      useMemory
        ? Promise.resolve(mem(store).get(key) as T | undefined)
        : wrapRead<T | undefined>(tx<T | undefined>(store, 'readonly', os => os.get(key)), undefined),
    put: (key, value) =>
      useMemory
        ? (mem(store).set(key, value), Promise.resolve())
        : wrapWrite(tx<IDBValidKey>(store, 'readwrite', os => os.put(value, key))),
    delete: (key) =>
      useMemory
        ? (mem(store).delete(key), Promise.resolve())
        : wrapWrite(tx<undefined>(store, 'readwrite', os => os.delete(key))),
    allKeys: () =>
      useMemory
        ? Promise.resolve([...mem(store).keys()])
        : wrapRead(tx<IDBValidKey[]>(store, 'readonly', os => os.getAllKeys()).then(ks => ks.map(String)), [] as string[]),
    clear: () =>
      useMemory
        ? (mem(store).clear(), Promise.resolve())
        : wrapWrite(tx<undefined>(store, 'readwrite', os => os.clear())),
    getAllEntries: () =>
      useMemory
        ? Promise.resolve([...mem(store).entries()])
        : wrapRead(
            openDb().then(
              (db) =>
                new Promise<Array<[string, unknown]>>((resolve, reject) => {
                  if (!db) return resolve([])
                  try {
                    // 同一 readonly 事务发 getAllKeys + getAll：快照一致，且均按主键序返回，可直接 zip
                    const os = db.transaction(store, 'readonly').objectStore(store)
                    const keysReq = os.getAllKeys()
                    const valuesReq = os.getAll()
                    keysReq.onsuccess = () => {
                      valuesReq.onsuccess = () => {
                        const keys = keysReq.result
                        const values = valuesReq.result
                        resolve(keys.map((k, i) => [String(k), values[i]] as [string, unknown]))
                      }
                    }
                    keysReq.onerror = () => reject(keysReq.error ?? new Error('idb'))
                    valuesReq.onerror = () => reject(valuesReq.error ?? new Error('idb'))
                  } catch (e) {
                    reject(e)
                  }
                }),
            ),
            [] as Array<[string, unknown]>,
          ),
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
