/**
 * material-store 单测 —— node 下 idb 自动走内存兜底（typeof indexedDB === 'undefined'）。
 * 重点覆盖全库唯一级联删除路径 removeMaterial（材料 + blob + 进度/收藏/笔记/训练记录），
 * 特别是 id 互为前缀的边界（m-1 不得连带删掉 m-10 的记录）与 seedIfEmpty 首载注入。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Material, MaterialCollection } from '@/types/material'
import type { MaterialRecord } from '@/platform/storage/schema'
import { RECORD_KEYS } from '@/platform/storage/schema'
import type { TrainingRecord } from '@/types/training'

let idb: typeof import('@/platform/storage/idb')
let ms: typeof import('@/stores/material-store')

/** 每个用例全新模块实例（内存 store 是模块级单例，reset 才能互不串扰） */
beforeEach(async () => {
  vi.resetModules()
  idb = await import('@/platform/storage/idb')
  ms = await import('@/stores/material-store')
})

function makeMaterial(id: string): Material {
  return {
    id,
    name: `material-${id}`,
    mediaType: 'audio',
    mediaRef: `idb:${id}`,
    mediaFileName: `${id}.mp3`,
    mediaSizeBytes: 1024,
    subtitle: null,
    durationMs: 60_000,
    createdAt: 1_000,
    lastOpenedAt: 0,
  }
}

function makeTrain(id: string, materialId: string): TrainingRecord {
  return { id, materialId, mode: 'read-aloud', scope: { type: 'all' }, score: 80, detail: {}, createdAt: 1 } as TrainingRecord
}

describe('removeMaterial 级联删除', () => {
  it('删除 m-1：仅清理 m-1 的材料/blob/进度/收藏/笔记/训练记录，m-10 与无关前缀记录原样保留', async () => {
    await ms.initMaterials()
    await ms.putMaterialRecord({ material: makeMaterial('m-1'), subtitleData: null } satisfies MaterialRecord)
    await ms.putMaterialRecord({ material: makeMaterial('m-10'), subtitleData: null } satisfies MaterialRecord)
    await ms.putMediaBlob('m-1', new Blob(['a']))
    await ms.putMediaBlob('m-10', new Blob(['b']))

    const { recordsStore, materialsStore, blobsStore } = idb
    await recordsStore.put(RECORD_KEYS.progress('m-1'), { lastPositionMs: 0 })
    await recordsStore.put(RECORD_KEYS.progress('m-10'), { lastPositionMs: 0 })
    await recordsStore.put(RECORD_KEYS.favorite('m-1', 0), { sentenceIndex: 0 })
    await recordsStore.put(RECORD_KEYS.favorite('m-10', 0), { sentenceIndex: 0 })
    await recordsStore.put(RECORD_KEYS.note('m-1', 3), { content: 'note m-1' })
    await recordsStore.put(RECORD_KEYS.note('m-10', 3), { content: 'note m-10' })
    await recordsStore.put(RECORD_KEYS.training('r1'), makeTrain('r1', 'm-1'))
    await recordsStore.put(RECORD_KEYS.training('r2'), makeTrain('r2', 'm-10'))
    await recordsStore.put(RECORD_KEYS.training('r3'), makeTrain('r3', 'm-1'))
    await recordsStore.put(RECORD_KEYS.collection('c1'), { id: 'c1', name: '集合', createdAt: 1 } satisfies MaterialCollection)
    await recordsStore.put(RECORD_KEYS.vocabEntry('v1'), { word: 'apple' })

    await ms.removeMaterial('m-1')

    // 材料与媒体：只删 m-1
    expect(await materialsStore.get('m-1')).toBeUndefined()
    expect(await materialsStore.get('m-10')).toBeDefined()
    expect(await blobsStore.get('m-1')).toBeUndefined()
    expect(await blobsStore.get('m-10')).toBeDefined()

    // records：m-1 全清、m-10 全在、无关前缀（collection/vocab/seeded 标记）不受牵连
    const keys = (await recordsStore.allKeys()).sort()
    expect(keys).toEqual([
      'fav:m-10:0',
      'meta:seeded',
      'note:m-10:3',
      'progress:m-10',
      'train:r2',
      'vocabentry:v1',
      'collection:c1',
    ].sort())

    // 内存态列表同步移除（P0 材料库刷新的数据源）
    expect(ms.materialStore.get().records.some((r) => r.material.id === 'm-1')).toBe(false)
    expect(ms.materialStore.get().records.some((r) => r.material.id === 'm-10')).toBe(true)
  })

  it('删除不存在的材料：无异常、不误删任何记录', async () => {
    await ms.initMaterials()
    const { recordsStore } = idb
    await recordsStore.put(RECORD_KEYS.progress('ghost'), { lastPositionMs: 0 })
    await expect(ms.removeMaterial('nonexistent')).resolves.toBeUndefined()
    expect(await recordsStore.get(RECORD_KEYS.progress('ghost'))).toBeDefined()
  })
})

describe('seedIfEmpty 首载注入', () => {
  it('首次 initMaterials 注入种子材料并打 meta:seeded 标记', async () => {
    await ms.initMaterials()
    const records = ms.materialStore.get().records
    expect(records.length).toBeGreaterThanOrEqual(4)
    expect(records.some((r) => r.material.id === 'mock-001')).toBe(true)
    expect(ms.materialStore.get().ready).toBe(true)
    expect(await idb.recordsStore.get('meta:seeded')).toBe(true)
  })

  it('重复调用 initMaterials 幂等（共享同一 Promise，种子不重复注入）', async () => {
    await ms.initMaterials()
    await ms.initMaterials()
    const records = ms.materialStore.get().records.filter((r) => r.material.id === 'mock-001')
    expect(records).toHaveLength(1)
  })

  it('种子材料带解析好的 subtitleData（内联字幕，含双语开关）', async () => {
    await ms.initMaterials()
    const rec = await ms.getMaterialRecord('mock-001')
    expect(rec?.subtitleData?.sentences.length).toBeGreaterThan(0)
    expect(rec?.subtitleData?.isBilingual).toBe(true)
  })
})
