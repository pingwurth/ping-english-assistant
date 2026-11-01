/**
 * 训练记录保留策略单测 —— node 下 idb 走内存兜底，逻辑与浏览器路径一致。
 * 覆盖：每「材料 × 模式」保留上限、跨材料/模式互不牵连、写后即清、
 * 启动清扫兜存量、畸形记录不误删、无关前缀（fav:/note:）不动。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECORD_KEYS, RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import type { TrainingMode, TrainingRecord } from '@/types/training'

let store: typeof import('@/stores/training-record-store')
let idb: typeof import('@/platform/storage/idb')

beforeEach(async () => {
  vi.resetModules()
  idb = await import('@/platform/storage/idb')
  store = await import('@/stores/training-record-store')
})

let seq = 0
function makeTrain(materialId: string, mode: TrainingMode, createdAt: number): TrainingRecord {
  return { id: `r${seq++}`, materialId, mode, scope: { type: 'all' }, score: 80, detail: {} as TrainingRecord['detail'], createdAt }
}

async function trainKeys(): Promise<string[]> {
  return (await idb.recordsStore.allKeys()).filter((k) => k.startsWith(RECORD_KEY_PREFIXES.training)).sort()
}

describe('appendTrainingRecord 写后即清', () => {
  it(`同材料同模式累积到 ${100} 条即止，保留最新；其他材料/模式不受牵连`, async () => {
    // m-1/read-aloud 写到超限；m-2/read-aloud 与 m-1/dictation 各写几条
    for (let i = 0; i < 130; i++) await store.appendTrainingRecord(makeTrain('m-1', 'read-aloud', i))
    for (let i = 0; i < 3; i++) await store.appendTrainingRecord(makeTrain('m-2', 'read-aloud', 1000 + i))
    for (let i = 0; i < 3; i++) await store.appendTrainingRecord(makeTrain('m-1', 'dictation', 2000 + i))

    const entries = await idb.recordsStore.getAllEntriesByPrefix('train:')
    const m1Ra = entries.filter(([, v]) => (v as TrainingRecord).materialId === 'm-1' && (v as TrainingRecord).mode === 'read-aloud')
    expect(m1Ra).toHaveLength(100)
    // 留下的是最新的 100 条（createdAt 30..129），最旧的 30 条已清
    const created = m1Ra.map(([, v]) => (v as TrainingRecord).createdAt)
    expect(Math.min(...created)).toBe(30)
    expect(Math.max(...created)).toBe(129)
    // 其他组原样
    expect(entries.filter(([, v]) => (v as TrainingRecord).materialId === 'm-2')).toHaveLength(3)
    expect(entries.filter(([, v]) => (v as TrainingRecord).mode === 'dictation')).toHaveLength(3)
  })

  it('单组未超限时清理零删除（无额外写放大）', async () => {
    for (let i = 0; i < 10; i++) await store.appendTrainingRecord(makeTrain('m-1', 'puzzle', i))
    expect(await store.pruneTrainingRecords('m-1')).toBe(0)
    expect(await trainKeys()).toHaveLength(10)
  })
})

describe('sweepTrainingRetention 启动清扫', () => {
  it('裸 put 积压的历史记录（升级前存量/导入）被压回上限', async () => {
    // 模拟旧版本裸 put 的 150 条（不经 append，无写后清理）
    for (let i = 0; i < 150; i++) {
      const rec = makeTrain('legacy', 'read-aloud', i)
      await idb.recordsStore.put(RECORD_KEYS.training(rec.id), rec)
    }
    await idb.recordsStore.put(RECORD_KEYS.favorite('legacy', 0), { materialId: 'legacy', sentenceIndex: 0, createdAt: 1 })

    const deleted = await store.sweepTrainingRetention()
    expect(deleted).toBe(50)
    const entries = await idb.recordsStore.getAllEntriesByPrefix('train:')
    expect(entries).toHaveLength(100)
    expect(Math.max(...entries.map(([, v]) => (v as TrainingRecord).createdAt))).toBe(149)

    // 无关前缀不动
    expect(await idb.recordsStore.get(RECORD_KEYS.favorite('legacy', 0))).toBeDefined()
    // 再扫一遍：幂等，零删除
    expect(await store.sweepTrainingRetention()).toBe(0)
  })

  it('缺 materialId/mode 的畸形 train: 记录不参与清理（宁可多留不误删）', async () => {
    await idb.recordsStore.put('train:broken-1', { createdAt: 1 })
    await idb.recordsStore.put('train:broken-2', null)
    expect(await store.sweepTrainingRetention()).toBe(0)
    expect(await idb.recordsStore.get('train:broken-1')).toBeDefined()
    expect(await idb.recordsStore.get('train:broken-2')).toBeNull()
  })

  it('createdAt 相同（同批毫秒）时按 id 字典序确定性保留', async () => {
    for (let i = 0; i < 105; i++) {
      const rec = { ...makeTrain('m', 'puzzle', 42), id: `id-${String(i).padStart(3, '0')}` }
      await idb.recordsStore.put(RECORD_KEYS.training(rec.id), rec)
    }
    await store.sweepTrainingRetention()
    const entries = await idb.recordsStore.getAllEntriesByPrefix('train:')
    expect(entries).toHaveLength(100)
    // id-105 个里保留字典序最大的 100 个（id-005..id-104）
    const ids = entries.map(([k]) => k.slice('train:'.length)).sort()
    expect(ids[0]).toBe('id-005')
    expect(ids[ids.length - 1]).toBe('id-104')
  })
})
