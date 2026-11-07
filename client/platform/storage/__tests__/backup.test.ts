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
    formatVersion: 2,
    exportedAt: 1,
    materials: [{ id: 'm-import', value: { material: { id: 'm-import' }, subtitleData: null } }],
    records: { 'progress:m-import': { materialId: 'm-import' } },
    prefs: { 'pref:x': 'new' },
    media: [],
    noteImages: [],
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

  it('笔记图片随 zip 恢复进 blobs store（缺失条目计入 mediaMissing）', async () => {
    const source = validBackup()
    const imageBytes = new TextEncoder().encode('fake-webp-bytes')
    const payload = {
      ...source,
      app: 'ping-english-assistant',
      materials: source.materials.map(({ value }) => value),
      noteImages: [
        { key: 'noteimg:m-import:img-1', mime: 'image/webp', size: imageBytes.byteLength },
        { key: 'noteimg:m-import:img-missing', mime: 'image/webp', size: 5 },
      ],
    }
    const chunks: BlobPart[] = []
    const writer = createZipWriter((chunk) => { chunks.push(chunk) })
    writer.add('backup.json', new TextEncoder().encode(JSON.stringify(payload)))
    writer.add('noteimg/noteimg:m-import:img-1', imageBytes)
    writer.finish()

    const summary = await backup.importZipBackup(new Blob(chunks, { type: 'application/zip' }), 'overwrite')
    expect(summary.mediaWritten).toBe(1)
    expect(summary.mediaMissing).toBe(1)
    const restored = await actualIdb.blobsStore.get<Blob>('noteimg:m-import:img-1')
    expect(restored).toBeDefined()
    expect(restored?.type).toBe('image/webp')
    expect(await restored?.text()).toBe('fake-webp-bytes')
  })
})

describe('buildFullBackupZip ↔ importZipBackup 完整回路', () => {
  it('媒体与笔记图片随包导出并恢复；tts: 临时键永不进包', async () => {
    // 写入须走 backup.ts 静态导入所见的同一 idb 实例（mock 工厂里的 importActual
    // 不随 resetModules 重估，actualIdb 是每用例的新实例——经它写、经 backup 读会互相看不见）
    const idbViaBackup = await import('@/platform/storage/idb')
    await idbViaBackup.materialsStore.put('m-full', { material: { id: 'm-full', name: 'M' }, subtitleData: null })
    await idbViaBackup.blobsStore.put('m-full', new Blob(['media-bytes'], { type: 'audio/mpeg' }))
    await idbViaBackup.blobsStore.put('noteimg:m-full:i1', new Blob(['img-bytes'], { type: 'image/webp' }))
    await idbViaBackup.blobsStore.put('tts:tmp-1', new Blob(['tmp']))

    const { blob } = await backup.buildFullBackupZip()
    const preview = await backup.prepareZipImport(blob)
    expect(preview.parsed.materials.map((m) => m.id)).toEqual(['m-full'])
    expect(preview.parsed.media).toHaveLength(1)
    expect(preview.parsed.noteImages).toEqual([{ key: 'noteimg:m-full:i1', mime: 'image/webp', size: 9 }])
    expect(preview.mediaMissing).toBe(0)

    const summary = await backup.importZipBackup(blob, 'overwrite')
    expect(summary.mediaWritten).toBe(2) // 媒体 1 + 笔记图片 1
    // 导入经 putAllAtomic mock 落在 actualIdb 的连接上
    expect(await (await actualIdb.blobsStore.get<Blob>('noteimg:m-full:i1'))?.text()).toBe('img-bytes')
  })
})

describe('stringifyBackupJson 分片序列化', () => {
  it('与 JSON.stringify 整体序列化字节一致（unicode/引号/嵌套/空容器/跳过 undefined 键）', async () => {
    const payload = {
      app: 'ping-english-assistant',
      formatVersion: 3,
      exportedAt: 1730000000000,
      materials: [
        { id: 'm-1', name: 'Ted "Talk"', subtitleData: { sentences: [{ textEn: 'naïve café', textZh: '中文“引号”' }] } },
        ...Array.from({ length: 60 }, (_, i) => ({ id: `m-${i + 2}`, rows: [i, null, true, 'x,y'] })),
      ],
      records: Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [`train:${i}`, { score: i, note: i % 2 ? 'a' : null }]),
      ),
      prefs: { 'a:b': '1', empty: {} },
      emptyList: [] as unknown[],
      skipped: undefined,
    }
    const mod = await import('../backup')
    expect(await mod.stringifyBackupJson(payload)).toBe(JSON.stringify(payload))
  })
})
