/**
 * note-image-store 单测 —— node 下 idb 自动走内存兜底（typeof indexedDB === 'undefined'）。
 * 覆盖：引用解析约束（只认 idb://noteimg/）、键族按材料隔离、孤儿回收以已落盘笔记为准。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let store: typeof import('@/stores/note-image-store')
let noteStore: typeof import('@/stores/note-store')

/** 每个用例全新模块实例（内存 store 是模块级单例，reset 才能互不串扰） */
beforeEach(async () => {
  vi.resetModules()
  store = await import('@/stores/note-image-store')
  noteStore = await import('@/stores/note-store')
})

describe('parseNoteImageRef', () => {
  it('合法引用解析出材料/图片 id 与 blobs 键', () => {
    expect(store.parseNoteImageRef('idb://noteimg/m-1/abc-123')).toEqual({
      materialId: 'm-1',
      imageId: 'abc-123',
      blobKey: 'noteimg:m-1:abc-123',
    })
  })

  it('非本应用引用返回 null（外链/相对路径/坏形态）', () => {
    expect(store.parseNoteImageRef('https://a.com/x.png')).toBeNull()
    expect(store.parseNoteImageRef('idb://materials/m-1')).toBeNull()
    expect(store.parseNoteImageRef('idb://noteimg/only-id')).toBeNull()
    expect(store.parseNoteImageRef('idb://noteimg//abc')).toBeNull()
    expect(store.parseNoteImageRef('idb://noteimg/m/')).toBeNull()
    expect(store.parseNoteImageRef('')).toBeNull()
  })
})

describe('putNoteImage / getNoteImage / listNoteImageKeys', () => {
  it('存取往返；键按材料隔离（m-1 不带出 m-10 的图片）', async () => {
    const idA = await store.putNoteImage('m-1', new Blob(['a']))
    const idB = await store.putNoteImage('m-10', new Blob(['b']))
    expect(await (await store.getNoteImage('m-1', idA))?.text()).toBe('a')
    expect(await store.listNoteImageKeys('m-1')).toEqual([`noteimg:m-1:${idA}`])
    expect(await store.listNoteImageKeys('m-10')).toEqual([`noteimg:m-10:${idB}`])
    expect(await store.getNoteImage('m-1', 'missing')).toBeUndefined()
  })
})

describe('sweepNoteImages 孤儿回收', () => {
  it('未被任何已落盘笔记引用的图片被删，被引用的保留', async () => {
    const keepId = await store.putNoteImage('m-1', new Blob(['keep']))
    await store.putNoteImage('m-1', new Blob(['orphan']))
    await store.putNoteImage('m-10', new Blob(['other-material']))
    await noteStore.saveSentenceNote('m-1', 0, `看图 ![图](${store.noteImageRef('m-1', keepId)})`)

    await store.sweepNoteImages('m-1')

    expect(await store.listNoteImageKeys('m-1')).toEqual([`noteimg:m-1:${keepId}`])
    // 其它材料不受影响
    const m10 = await store.listNoteImageKeys('m-10')
    expect(m10).toHaveLength(1)
  })

  it('引用随笔记删除后，图片在下次回收时清掉；无笔记则全清', async () => {
    const id = await store.putNoteImage('m-1', new Blob(['x']))
    await noteStore.saveSentenceNote('m-1', 2, `![图](${store.noteImageRef('m-1', id)})`)
    await store.sweepNoteImages('m-1')
    expect(await store.listNoteImageKeys('m-1')).toHaveLength(1)

    await noteStore.deleteSentenceNote('m-1', 2)
    await store.sweepNoteImages('m-1')
    expect(await store.listNoteImageKeys('m-1')).toHaveLength(0)
  })

  it('引用文本散落在多行/多笔记中都能对账', async () => {
    const id1 = await store.putNoteImage('m-1', new Blob(['1']))
    const id2 = await store.putNoteImage('m-1', new Blob(['2']))
    await noteStore.saveSentenceNote('m-1', 0, `前文\n\n![a](${store.noteImageRef('m-1', id1)})\n\n后文`)
    await noteStore.saveSentenceNote('m-1', 5, `![b](${store.noteImageRef('m-1', id2)})`)

    await store.sweepNoteImages('m-1')
    expect(new Set(await store.listNoteImageKeys('m-1'))).toEqual(
      new Set([`noteimg:m-1:${id1}`, `noteimg:m-1:${id2}`]),
    )
  })
})
