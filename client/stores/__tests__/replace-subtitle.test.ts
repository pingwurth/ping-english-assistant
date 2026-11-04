/**
 * replaceSubtitleData 原子替换 + plan 系列迁移回归（三轮复审 c005）：
 * 4cef9cf 重写了全仓最高风险的持久化路径却零测试——runAtomicOps 的 del/put
 * 次序或 ops 合并形状一旦回归，现有测试全绿。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Material } from '@/types/material'
import type { MaterialRecord } from '@/platform/storage/schema'
import { RECORD_KEYS } from '@/platform/storage/schema'
import type { TrainingRecord } from '@/types/training'
import type { SubtitleData } from '@/types/subtitle'
import { planIndexedRecordsRemap } from '@/stores/shift-records'

let idb: typeof import('@/platform/storage/idb')
let ms: typeof import('@/stores/material-store')

beforeEach(async () => {
  vi.resetModules()
  idb = await import('@/platform/storage/idb')
  ms = await import('@/stores/material-store')
})

function makeMaterial(id: string): Material {
  return {
    id, name: `m-${id}`, mediaType: 'audio', mediaRef: `idb:${id}`, mediaFileName: `${id}.mp3`,
    mediaSizeBytes: 1024, subtitle: null, durationMs: 60_000, createdAt: 1_000, lastOpenedAt: 0,
  }
}

/** n 句英文字幕（文本 Hello-<i> 便于构造部分对齐/部分失配） */
function makeSubtitle(n: number, prefix = 'Hello'): SubtitleData {
  return {
    format: 'srt',
    isBilingual: false,
    totalDurationMs: 60_000,
    sentences: Array.from({ length: n }, (_, i) => ({
      index: i, startMs: i * 1000, endMs: i * 1000 + 900,
      textEn: `${prefix} ${i}`, textZh: null, words: [],
    })),
  }
}

function makeRecord(id: string, sub: SubtitleData): MaterialRecord {
  return { material: makeMaterial(id), subtitleData: sub }
}

describe('planIndexedRecordsRemap（纯规划）', () => {
  const keyOf = (mid: string, i: number) => `fav:${mid}:${i}`
  const entries = [
    { sentenceIndex: 0, v: 'a' },
    { sentenceIndex: 1, v: 'b' },
    { sentenceIndex: 3, v: 'd' },
  ]

  it('未命中映射 → 删除并计数；移动 → 同键族 del+put；原地命中 → 零操作', () => {
    const ops = planIndexedRecordsRemap(entries, 'm', new Map([[0, 2], [1, 1]]), keyOf)
    // index0 → 2（移动）；index1 → 1（原地，无操作）；index3 未命中（删除）
    expect(ops.del).toEqual(['fav:m:0', 'fav:m:3'])
    expect(ops.put).toEqual([[keyOf('m', 2), { sentenceIndex: 2, v: 'a' }]])
    expect(ops.dropped).toBe(1)
  })

  it('空映射 → 全删', () => {
    const ops = planIndexedRecordsRemap(entries, 'm', new Map(), keyOf)
    expect(ops.dropped).toBe(3)
    expect(ops.put).toEqual([])
  })
})

describe('replaceSubtitleData（原子替换 + 五族迁移）', () => {
  it('文本对齐迁移收藏/笔记/听写明细/进度；未命中删除；材料与记录一次提交', async () => {
    await idb.recordsStore.put(RECORD_KEYS.favorite('m1', 0), { materialId: 'm1', sentenceIndex: 0, createdAt: 1 })
    await idb.recordsStore.put(RECORD_KEYS.favorite('m1', 3), { materialId: 'm1', sentenceIndex: 3, createdAt: 2 }) // 未命中
    await idb.recordsStore.put(RECORD_KEYS.note('m1', 1), { materialId: 'm1', sentenceIndex: 1, content: 'n', createdAt: 1, updatedAt: 1 })
    await idb.recordsStore.put(RECORD_KEYS.training('t1'), {
      id: 't1', materialId: 'm1', mode: 'dictation', scope: { type: 'all' }, score: 90,
      detail: { accuracy: 90, sentenceIndex: 0 }, createdAt: 1,
    } satisfies TrainingRecord)
    await idb.recordsStore.put(RECORD_KEYS.progress('m1'), {
      materialId: 'm1', lastPositionMs: 5000, playedSentenceIndexes: [0, 3], updatedAt: 1,
    })

    const old = makeSubtitle(4)          // Hello 0..3
    const next = makeSubtitle(3, 'Hello') // Hello 0..2（句 3 消失；0..2 文本对齐）
    // 挪动一句制造非平凡映射：交换 0/1
    next.sentences = [next.sentences[1]!, next.sentences[0]!, next.sentences[2]!]
    const result = await ms.replaceSubtitleData(makeRecord('m1', old), next)

    // 映射：old0(Hello 0)→new1, old1(Hello 1)→new0, old2(Hello 2)→new2, old3 未命中
    expect(result.mapping.get(0)).toBe(1)
    expect(result.mapping.get(1)).toBe(0)
    expect(result.mapping.get(3)).toBeUndefined()
    expect(result.droppedRecords).toBe(1) // 句 3 的收藏

    // 持久层：收藏 0→1 迁移、3 删除；笔记 1→0；听写明细 0→1；进度过滤 [3] 留 [1]
    expect(await idb.recordsStore.get(RECORD_KEYS.favorite('m1', 1))).toMatchObject({ sentenceIndex: 1 })
    expect(await idb.recordsStore.get(RECORD_KEYS.favorite('m1', 3))).toBeUndefined()
    expect(await idb.recordsStore.get(RECORD_KEYS.note('m1', 0))).toMatchObject({ content: 'n' })
    expect(await idb.recordsStore.get(RECORD_KEYS.training('t1'))).toMatchObject({ detail: { sentenceIndex: 1 } })
    expect(await idb.recordsStore.get(RECORD_KEYS.progress('m1'))).toMatchObject({ playedSentenceIndexes: [1] })

    // 材料本体同批提交
    const stored = await idb.materialsStore.get<MaterialRecord>('m1')
    expect(stored?.subtitleData?.sentences).toHaveLength(3)
    expect(stored?.material.subtitle?.sentenceCount).toBe(3)
    // 返回的 updatedRecord 供页面 setRecord
    expect(result.updatedRecord.material.id).toBe('m1')
  })

  it('同文本多句按序占位，不互撞', async () => {
    const old = makeSubtitle(2) // Hello 0 / Hello 1（同前缀不同句号文本不同——构造真·同文本）
    old.sentences = [
      { ...old.sentences[0]!, textEn: 'Same line' },
      { ...old.sentences[1]!, textEn: 'Same line' },
    ]
    const next = makeSubtitle(2)
    next.sentences = [
      { ...next.sentences[0]!, textEn: 'Same line' },
      { ...next.sentences[1]!, textEn: 'Same line' },
    ]
    await idb.recordsStore.put(RECORD_KEYS.favorite('m2', 0), { materialId: 'm2', sentenceIndex: 0, createdAt: 1 })
    await idb.recordsStore.put(RECORD_KEYS.favorite('m2', 1), { materialId: 'm2', sentenceIndex: 1, createdAt: 2 })
    const result = await ms.replaceSubtitleData(makeRecord('m2', old), next)
    // 两条都按序占位（0→0、1→1），不丢
    expect(result.mapping.get(0)).toBe(0)
    expect(result.mapping.get(1)).toBe(1)
    expect(result.droppedRecords).toBe(0)
  })
})
