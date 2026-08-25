/**
 * 材料库 store —— 真源：docs/系统架构设计.md §2.6 useMaterialStore / §4.2
 *
 * 职责：
 *  - 首次启动（materials store 为空）注入 data/seed.ts 种子；
 *  - 材料列表 CRUD 后广播变更（供 P0 材料库刷新）；
 *  - "最近学习"排序（lastOpenedAt 降序，从未学习按 createdAt 靠后）；
 *  - 删除材料时级联清理 blob 与相关 records（进度/收藏/训练记录）。
 *
 * 所有浏览器 API（IndexedDB）仅在异步函数内访问，由调用方在 useEffect/事件回调触发，SSR 安全。
 */

import type { LearningProgress } from '@/types/progress'
import type { TrainingRecord } from '@/types/training'
import type { Material } from '@/types/material'
import type { SubtitleData } from '@/types/subtitle'
import { blobsStore, materialsStore, recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, type MaterialRecord } from '@/platform/storage/schema'
import { seedMaterials, seedSentences } from '@/data/seed'
import { createStore } from '@/stores/store'

export interface MaterialStoreState {
  ready: boolean
  records: MaterialRecord[]
}

export const materialStore = createStore<MaterialStoreState>({ ready: false, records: [] })

/** "最近学习"排序：lastOpenedAt 降序；从未学习（0）排后，按创建时间降序 */
function sortByRecent(a: MaterialRecord, b: MaterialRecord): number {
  const la = a.material.lastOpenedAt || 0
  const lb = b.material.lastOpenedAt || 0
  if (lb !== la) return lb - la
  return b.material.createdAt - a.material.createdAt
}

async function refresh(): Promise<void> {
  const keys = await materialsStore.allKeys()
  const loaded = await Promise.all(keys.map((k) => materialsStore.get<MaterialRecord>(k)))
  const records = loaded.filter((r): r is MaterialRecord => !!r && !!r.material)
  records.sort(sortByRecent)
  materialStore.set({ ready: true, records })
}

/** 种子字幕 → SubtitleData（内联进 material 记录，避免每次启动重复解析） */
function buildSeedSubtitle(material: Material): SubtitleData {
  const isBilingual = material.subtitle?.isBilingual ?? false
  const sentences = seedSentences.map((s) => (isBilingual ? s : { ...s, textZh: null }))
  return { format: 'srt', isBilingual, sentences, totalDurationMs: material.durationMs }
}

/** 首次启动种子注入：仅在 materials store 为空时执行 */
async function seedIfEmpty(): Promise<void> {
  const keys = await materialsStore.allKeys()
  if (keys.length > 0) return
  await Promise.all(seedMaterials.map((m) => materialsStore.put(m.id, { material: m, subtitleData: buildSeedSubtitle(m) } satisfies MaterialRecord)))
}

let initPromise: Promise<void> | null = null
/** 初始化：种子注入 + 首次加载（幂等，重复调用共享同一 Promise） */
export function initMaterials(): Promise<void> {
  initPromise ??= (async () => { await seedIfEmpty(); await refresh() })()
  return initPromise
}

/** 读取单条材料记录（不存在返回 undefined） */
export async function getMaterialRecord(id: string): Promise<MaterialRecord | undefined> {
  await initMaterials()
  return materialsStore.get<MaterialRecord>(id)
}

/** 新增/覆盖材料记录并广播列表变更（导入闭环使用） */
export async function putMaterialRecord(record: MaterialRecord): Promise<void> {
  await materialsStore.put(record.material.id, record)
  await refresh()
}

/** 打开材料时更新 lastOpenedAt（驱动"最近学习"排序） */
export async function touchMaterial(id: string): Promise<void> {
  const rec = await materialsStore.get<MaterialRecord>(id)
  if (!rec) return
  rec.material = { ...rec.material, lastOpenedAt: Date.now() }
  await materialsStore.put(id, rec)
  await refresh()
}

/** 媒体 Blob 读写（blobs store，key = materialId） */
export function putMediaBlob(id: string, blob: Blob): Promise<void> { return blobsStore.put(id, blob) }
export function getMediaBlob(id: string): Promise<Blob | undefined> { return blobsStore.get<Blob>(id) }
/** 删除媒体 Blob（导入失败回滚孤儿数据 / 删除材料级联） */
export function deleteMediaBlob(id: string): Promise<void> { return blobsStore.delete(id) }

/** 读取材料学习进度（records store，key 带 progress: 前缀） */
export function getProgress(materialId: string): Promise<LearningProgress | undefined> {
  return recordsStore.get<LearningProgress>(RECORD_KEYS.progress(materialId))
}

/** 删除材料：级联清理 material + blob + 相关 records（进度/收藏/训练记录） */
export async function removeMaterial(id: string): Promise<void> {
  await materialsStore.delete(id)
  await blobsStore.delete(id)
  const keys = await recordsStore.allKeys()
  await Promise.all(keys.map(async (k) => {
    // progress: 键精确匹配（前缀匹配会误删 id 互为前缀的其他材料，如 m-1 与 m-10）
    if (k === RECORD_KEYS.progress(id) || k.startsWith(`fav:${id}:`)) return recordsStore.delete(k)
    if (k.startsWith('train:')) {
      const rec = await recordsStore.get<TrainingRecord>(k)
      if (rec?.materialId === id) return recordsStore.delete(k)
    }
  }))
  await refresh()
}
