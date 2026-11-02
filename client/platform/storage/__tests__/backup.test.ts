import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createZipWriter } from '@/core/backup/zip'
import { parseBackupJson } from '@/core/backup/backup-format'
import type { ParsedBackup } from '@/core/backup/backup-format'

const idbMocks = vi.hoisted(() => ({ putAllAtomic: vi.fn() }))

vi.mock('@/platform/storage/idb', async (importActual) => ({
  ...(await importActual<typeof import('@/platform/storage/idb')>()),
  putAllAtomic: idbMocks.putAllAtomic,
}))

let backup: typeof import('../backup')
let actualIdb: typeof import('@/platform/storage/idb')

function memoryLocalStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  } as Storage
}

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', memoryLocalStorage())
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  idbMocks.putAllAtomic.mockReset()
  actualIdb = await vi.importActual<typeof import('@/platform/storage/idb')>('@/platform/storage/idb')
  idbMocks.putAllAtomic.mockImplementation((args: Parameters<typeof actualIdb.putAllAtomic>[0]) =>
    actualIdb.putAllAtomic(args),
  )
  backup = await import('../backup')
})

function validBackup(): ParsedBackup {
  return {
    formatVersion: 1,
    exportedAt: 1,
    materials: [{ id: 'm-import', value: { material: { id: 'm-import' }, subtitleData: null } }],
    records: { 'progress:m-import': { materialId: 'm-import' } },
    prefs: { 'pref:x': 'new' },
    media: [],
  }
}

describe('备份导入原子性', () => {
  it('IDB 提交失败时回滚本次已写入的 localStorage prefs', async () => {
    localStorage.setItem('ping-english:pref:x', JSON.stringify('old'))
    idbMocks.putAllAtomic.mockRejectedValueOnce(new Error('quota'))

    const source = validBackup()
    const payload = {
      ...source,
      app: 'ping-english-assistant',
      materials: source.materials.map(({ value }) => value),
    }
    await expect(backup.importBackup(JSON.stringify(payload), 'overwrite')).rejects.toThrow('quota')
    expect(localStorage.getItem('ping-english:pref:x')).toBe(JSON.stringify('old'))
  })

  it('zip 缺失媒体只计数一次，且材料/记录/设置在同一原子批次提交', async () => {
    const source = validBackup()
    const parsed = {
      ...source,
      app: 'ping-english-assistant',
      materials: source.materials.map(({ value }) => value),
      media: [{ id: 'm-import', fileName: 'a.mp3', mediaType: 'audio', mime: 'audio/mpeg', size: 3 }],
    }
    const chunks: BlobPart[] = []
    const writer = createZipWriter((chunk) => { chunks.push(chunk) })
    writer.add('backup.json', new TextEncoder().encode(JSON.stringify(parsed)))
    writer.finish()

    const summary = await backup.importZipBackup(new Blob(chunks, { type: 'application/zip' }), 'overwrite')
    expect(summary).toMatchObject({
      materialsWritten: 1,
      recordsWritten: 1,
      prefsWritten: 1,
      mediaWritten: 0,
      mediaMissing: 1,
    })
    expect(idbMocks.putAllAtomic).toHaveBeenCalledWith(expect.objectContaining({
      materials: [['m-import', expect.anything()]],
      records: [['progress:m-import', expect.anything()]],
      blobs: [],
    }))
    expect(await actualIdb.materialsStore.get('m-import')).toBeDefined()
  })
})
