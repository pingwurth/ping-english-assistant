/**
 * idb.ts 存储层单测 —— fake-indexeddb 提供真实 IndexedDB 语义（升级事务、索引、
 * 键区间），重点验证 v2 → v3 升级路径：存量库无 materialId 索引，升级后自动建索引
 * 并回填存量记录，getEntriesByMaterial / getAllEntriesByPrefix 随即可用。
 * 每个用例 new IDBFactory()（全新数据库宇宙）+ resetModules（dbPromise/useMemory
 * 是模块级单例）。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORES = ['materials', 'blobs', 'records'] as const

let idb: typeof import('@/platform/storage/idb')

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  idb = await import('@/platform/storage/idb')
})

/** 直接用原生 API 造一个 v2 形态的旧库（无索引），模拟升级前用户数据 */
function seedV2Database(rows: Array<[string, unknown]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ping-english-assistant', 2)
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => {
      const db = req.result
      const t = db.transaction('records', 'readwrite')
      const os = t.objectStore('records')
      for (const [key, value] of rows) os.put(value, key)
      t.oncomplete = () => { db.close(); resolve() }
      t.onerror = () => reject(t.error)
    }
    req.onerror = () => reject(req.error)
  })
}

describe('v2 → v3 升级（存量库建 materialId 索引）', () => {
  it('存量 train: 记录升级后即可按材料点查；无 materialId 的记录不进结果', async () => {
    await seedV2Database([
      ['train:old-1', { materialId: 'm-1', mode: 'read-aloud', createdAt: 1 }],
      ['train:old-2', { materialId: 'm-2', mode: 'read-aloud', createdAt: 2 }],
      ['note:m-1:3', { materialId: 'm-1', sentenceIndex: 3 }],
      ['meta:seeded', true], // 无 materialId：索引不收录
      ['vocabbook:default', { id: 'default', createdAt: 1 }],
    ])

    const entries = await idb.recordsStore.getEntriesByMaterial('m-1')
    const keys = entries.map(([k]) => k).sort()
    expect(keys).toEqual(['note:m-1:3', 'train:old-1']) // 索引跨键类型：train: 与 note: 都命中

    expect(await idb.recordsStore.getEntriesByMaterial('m-2')).toHaveLength(1)
    expect(await idb.recordsStore.getEntriesByMaterial('m-404')).toHaveLength(0)
    // 无 materialId 的键不受升级影响，普通读取照常
    expect(await idb.recordsStore.get('meta:seeded')).toBe(true)
  })

  it('升级后新写入的记录也进索引', async () => {
    await seedV2Database([])
    await idb.recordsStore.put('train:new', { materialId: 'm-9', mode: 'puzzle', createdAt: 3 })
    const entries = await idb.recordsStore.getEntriesByMaterial('m-9')
    expect(entries).toHaveLength(1)
    expect(entries[0]![0]).toBe('train:new')
  })
})

describe('getAllEntriesByPrefix 主键前缀区间', () => {
  it('只返回前缀内记录；materialId 互为前缀时（m-1 / m-10）尾随分隔符天然排除', async () => {
    await idb.recordsStore.put('fav:m-1:0', { materialId: 'm-1', sentenceIndex: 0 })
    await idb.recordsStore.put('fav:m-1:7', { materialId: 'm-1', sentenceIndex: 7 })
    await idb.recordsStore.put('fav:m-10:0', { materialId: 'm-10', sentenceIndex: 0 })
    await idb.recordsStore.put('note:m-1:0', { materialId: 'm-1' })
    await idb.recordsStore.put('train:x', { materialId: 'm-1' })

    const favM1 = await idb.recordsStore.getAllEntriesByPrefix('fav:m-1:')
    expect(favM1.map(([k]) => k).sort()).toEqual(['fav:m-1:0', 'fav:m-1:7'])

    const favAll = await idb.recordsStore.getAllEntriesByPrefix('fav:')
    expect(favAll).toHaveLength(3)

    expect(await idb.recordsStore.getAllEntriesByPrefix('nope:')).toEqual([])
  })
})

describe('通用 KV 行为在 v3 schema 上不回归', () => {
  it('put/get/delete/allKeys/getAllEntries 事务收口后照常工作', async () => {
    await idb.recordsStore.put('progress:m-1', { materialId: 'm-1', lastPositionMs: 42 })
    expect(await idb.recordsStore.get<{ lastPositionMs: number }>('progress:m-1')).toEqual({ materialId: 'm-1', lastPositionMs: 42 })
    expect(await idb.recordsStore.allKeys()).toEqual(['progress:m-1'])
    expect(await idb.recordsStore.getAllEntries()).toEqual([['progress:m-1', { materialId: 'm-1', lastPositionMs: 42 }]])
    await idb.recordsStore.delete('progress:m-1')
    expect(await idb.recordsStore.allKeys()).toEqual([])
  })
})

/** 打开并保留一个 v2 连接，用于模拟旧标签页阻塞 v3 升级 */
async function openV2Connection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ping-english-assistant', 2)
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

describe('版本升级 blocked 与跨 store 原子写', () => {
  it('旧标签页长期阻塞 v3 时不能降级内存；关闭旧连接后继续升级', { timeout: 12_000 }, async () => {
    const oldDb = await openV2Connection()
    const opened = idb.materialsStore.allKeys()
    await new Promise((resolve) => setTimeout(resolve, 10_500))

    expect(idb.isMemoryFallback()).toBe(false)
    let settled = false
    void opened.then(() => { settled = true })
    expect(settled).toBe(false)

    oldDb.close()
    await expect(opened).resolves.toEqual([])
    expect(idb.isMemoryFallback()).toBe(false)
  })

  it('putAllAtomic：任一写失败时同事务内其他 store 的写也回滚', async () => {
    const promise = idb.putAllAtomic({
      materials: [['should-rollback', { material: { id: 'should-rollback' } }]],
      records: [['bad', () => 'functions are not cloneable']],
    })
    await expect(promise).rejects.toThrow()
    expect(await idb.materialsStore.get('should-rollback')).toBeUndefined()
    expect(await idb.recordsStore.get('bad')).toBeUndefined()
  })

  it('putAllAtomic：materials/records/blobs 可一次提交', async () => {
    await idb.putAllAtomic({
      materials: [['m-1', { material: { id: 'm-1' } }]],
      records: [['progress:m-1', { materialId: 'm-1' }]],
      blobs: [['m-1', { fake: 'blob' }]],
    })
    expect(await idb.materialsStore.get('m-1')).toBeDefined()
    expect(await idb.recordsStore.get('progress:m-1')).toBeDefined()
    expect(await idb.blobsStore.get('m-1')).toBeDefined()
  })
})
