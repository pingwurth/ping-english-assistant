/**
 * 材料库 store —— 真源：docs/系统架构设计.md §2.6 useMaterialStore / §4.2
 *
 * 职责：
 *  - 首次启动（materials store 为空）注入 data/seed.ts 种子；
 *  - 材料列表 CRUD 后广播变更（供 P0 材料库刷新）；
 *  - "最近学习"排序（lastOpenedAt 降序，从未学习按 createdAt 靠后）；
 *  - 删除材料时级联清理 blob 与相关 records（进度/收藏/训练记录）；
 *  - 材料集 CRUD（records store，collection: 前缀）；成员关系存 material.collectionId，
 *    删除集合仅解除归属（collectionId 置 null），材料本身保留。
 *
 * 所有浏览器 API（IndexedDB）仅在异步函数内访问，由调用方在 useEffect/事件回调触发，SSR 安全。
 */

import type { LearningProgress } from '@/types/progress'
import type { TrainingRecord } from '@/types/training'
import type { Material, MaterialCollection } from '@/types/material'
import type { SubtitleData } from '@/types/subtitle'
import { blobsStore, materialsStore, recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, RECORD_KEY_PREFIXES, type MaterialRecord } from '@/platform/storage/schema'
import { seedMaterials, seedSentences } from '@/data/seed'
import { createStore } from '@/stores/store'
import { updateFrequencies } from '@/stores/vocab-store'

export interface MaterialStoreState {
  ready: boolean
  records: MaterialRecord[]
  collections: MaterialCollection[]
}

export const materialStore = createStore<MaterialStoreState>({ ready: false, records: [], collections: [] })

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
  // collection: 主键前缀区间读：只物化集合自身的值，不再全库物化
  const collectionEntries = await recordsStore.getAllEntriesByPrefix(RECORD_KEY_PREFIXES.collection)
  const collections = collectionEntries
    .map(([, v]) => v as MaterialCollection)
    .filter((c): c is MaterialCollection => !!c && typeof c.createdAt === 'number')
  collections.sort((a, b) => a.createdAt - b.createdAt) // 与生词本一致：创建时间升序
  materialStore.set({ ready: true, records, collections })
}

/* ─── 增量补丁：CRUD 不再全量重读 IDB ───
 * refresh() 要把所有材料记录（内嵌完整 subtitleData）结构化克隆一遍，
 * 50 材料 × 2000 句的库打开任意材料仅 bump lastOpenedAt 也要付一次全量代价。
 * CRUD 就地补丁内存态并保持排序；全量 refresh 只留给初始化。
 */

/** 就地更新/插入单条材料记录并按"最近学习"重排 */
function patchRecord(record: MaterialRecord): void {
  const state = materialStore.get()
  const exists = state.records.some((r) => r.material.id === record.material.id)
  const records = (exists
    ? state.records.map((r) => (r.material.id === record.material.id ? record : r))
    : [...state.records, record]
  ).sort(sortByRecent)
  materialStore.set({ ...state, ready: true, records })
}

/** 移除单条材料记录（不动排序） */
function dropRecord(materialId: string): void {
  const state = materialStore.get()
  materialStore.set({ ...state, records: state.records.filter((r) => r.material.id !== materialId) })
}

/** 就地更新 collections（保持创建时间升序） */
function patchCollections(next: MaterialCollection[], removedId?: string): void {
  const state = materialStore.get()
  const kept = removedId ? next.filter((c) => c.id !== removedId) : next
  kept.sort((a, b) => a.createdAt - b.createdAt)
  materialStore.set({ ...state, ready: true, collections: kept })
}

/** 种子字幕 → SubtitleData（内联进 material 记录，避免每次启动重复解析） */
function buildSeedSubtitle(material: Material): SubtitleData {
  const isBilingual = material.subtitle?.isBilingual ?? false
  const sentences = seedSentences.map((s) => (isBilingual ? s : { ...s, textZh: null }))
  return { format: 'srt', isBilingual, sentences, totalDurationMs: material.durationMs }
}

/** seeded 标记（records store）：把「首次启动」与「store 暂时为空」区分开 —— 用户逐个删光材料后刷新，不该复活种子 */
const SEEDED_FLAG_KEY = 'meta:seeded'

/** 首次启动种子注入：仅未打过标记时执行（设置页"清空全部数据"会连标记一起清，恢复示例内容） */
async function seedIfEmpty(): Promise<void> {
  if (await recordsStore.get(SEEDED_FLAG_KEY)) return
  await Promise.all(seedMaterials.map((m) => materialsStore.put(m.id, { material: m, subtitleData: buildSeedSubtitle(m) } satisfies MaterialRecord)))
  await recordsStore.put(SEEDED_FLAG_KEY, true)
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
  await initMaterials()
  await materialsStore.put(record.material.id, record)
  patchRecord(record)
}

/** 打开材料时更新 lastOpenedAt（驱动"最近学习"排序；单记录补丁，不全量重读） */
export async function touchMaterial(id: string): Promise<void> {
  await initMaterials()
  const rec = await materialsStore.get<MaterialRecord>(id)
  if (!rec) return
  const updated: MaterialRecord = { ...rec, material: { ...rec.material, lastOpenedAt: Date.now() } }
  await materialsStore.put(id, updated)
  patchRecord(updated)
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

/** 删句后平移单句训练明细中的 sentenceIndex；被删句的记录删除。 */
export async function shiftTrainingRecordsAfterDeletion(materialId: string, deletedIndex: number): Promise<void> {
  await initMaterials()
  // materialId 索引点查：train: 记录键不含 materialId（原全库物化后逐条比对）
  const entries = await recordsStore.getEntriesByMaterial(materialId)
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.training)) continue
    const record = value as TrainingRecord | undefined
    if (!record || record.mode !== 'dictation') continue

    const detail = record.detail as { sentenceIndex?: unknown }
    if (typeof detail.sentenceIndex !== 'number') continue
    if (detail.sentenceIndex === deletedIndex) {
      await recordsStore.delete(key)
      continue
    }
    if (detail.sentenceIndex > deletedIndex) {
      await recordsStore.put(key, {
        ...record,
        detail: { ...record.detail, sentenceIndex: detail.sentenceIndex - 1 },
      } satisfies TrainingRecord)
    }
  }
}

/** 删除材料：级联清理 material + blob + 相关 records（进度/收藏/笔记/训练记录） */
export async function removeMaterial(id: string): Promise<void> {
  await initMaterials()
  await materialsStore.delete(id)
  await blobsStore.delete(id)
  // 精确清理，不再全库物化：
  //  - progress: 键精确匹配（前缀匹配会误删 id 互为前缀的其他材料，如 m-1 与 m-10）；
  //  - fav:/note: 材料前缀区间（尾随 ':' 使 m-1 的区间天然排除 m-10 的键）；
  //  - train: 键不含 materialId，按值上的 materialId 索引点查（索引结果里的
  //    note:/fav:/vocabentry: 由前缀过滤排除，vocab 词条按设计不随材料删除）。
  const [favEntries, noteEntries, materialEntries] = await Promise.all([
    recordsStore.getAllEntriesByPrefix(`${RECORD_KEY_PREFIXES.favorite}${id}:`),
    recordsStore.getAllEntriesByPrefix(`${RECORD_KEY_PREFIXES.note}${id}:`),
    recordsStore.getEntriesByMaterial(id),
  ])
  const trainKeys = materialEntries
    .filter(([k]) => k.startsWith(RECORD_KEY_PREFIXES.training))
    .map(([k]) => k)
  const keys = [...favEntries.map(([k]) => k), ...noteEntries.map(([k]) => k), ...trainKeys]
  await Promise.all([
    recordsStore.delete(RECORD_KEYS.progress(id)), // 不存在时 delete 为幂等 no-op
    ...keys.map((k) => recordsStore.delete(k)),
  ])
  // 生词词频撤账：回收该材料对 frequency 的贡献（评审 #19，否则删除材料后词频永久虚高，
  // 违反 types/vocabulary.ts「frequency = materialCounts 各值之和」不变量）
  await updateFrequencies([], id)
  dropRecord(id)
}

/* ─── 材料集 CRUD（存 records store；成员关系在 material.collectionId 上，无悬挂引用） ─── */

/** 创建材料集（名称去空白） */
export async function createCollection(name: string): Promise<MaterialCollection> {
  await initMaterials()
  const collection: MaterialCollection = { id: crypto.randomUUID(), name: name.trim(), createdAt: Date.now() }
  await recordsStore.put(RECORD_KEYS.collection(collection.id), collection)
  patchCollections([...materialStore.get().collections, collection])
  return collection
}

/** 重命名材料集（不存在或空名则静默返回） */
export async function renameCollection(collectionId: string, name: string): Promise<void> {
  await initMaterials()
  if (!name.trim()) return
  const collection = await recordsStore.get<MaterialCollection>(RECORD_KEYS.collection(collectionId))
  if (!collection) return
  const updated: MaterialCollection = { ...collection, name: name.trim() }
  await recordsStore.put(RECORD_KEYS.collection(collectionId), updated)
  patchCollections(materialStore.get().collections.map((c) => (c.id === collectionId ? updated : c)))
}

/** 删除材料集：仅删集合本身；成员材料 collectionId 置 null（材料与其数据不动，回到未分组） */
export async function removeCollection(collectionId: string): Promise<void> {
  await initMaterials()
  await recordsStore.delete(RECORD_KEYS.collection(collectionId))
  const state = materialStore.get()
  const members = state.records.filter((r) => r.material.collectionId === collectionId)
  await Promise.all(members.map((m) => {
    const updated: MaterialRecord = { ...m, material: { ...m.material, collectionId: null } }
    return materialsStore.put(m.material.id, updated).then(() => patchRecord(updated))
  }))
  patchCollections(state.collections, collectionId)
}

/** 移动材料到材料集；collectionId 传 null 表示移出到未分组（材料或目标集合不存在时静默返回） */
export async function assignMaterialCollection(materialId: string, collectionId: string | null): Promise<void> {
  await initMaterials()
  // 陈旧 ID 防护：目标集合已被删（如另一标签页操作）时不写入
  if (collectionId !== null && !materialStore.get().collections.some((c) => c.id === collectionId)) return
  const rec = await materialsStore.get<MaterialRecord>(materialId)
  if (!rec) return
  const updated: MaterialRecord = { ...rec, material: { ...rec.material, collectionId } } satisfies MaterialRecord
  await materialsStore.put(materialId, updated)
  patchRecord(updated)
}
