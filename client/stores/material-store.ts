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
import type { Material, MaterialCollection } from '@/types/material'
import type { SubtitleData } from '@/types/subtitle'
import { blobsStore, materialsStore, recordsStore, runAtomicOps } from '@/platform/storage/idb'
import { getPref, removePref } from '@/platform/storage/prefs'
import { MATERIAL_OWNED_RECORD_PREFIXES, RECORD_KEYS, RECORD_KEY_PREFIXES, type MaterialRecord } from '@/platform/storage/schema'
import { seedMaterials, seedSentences } from '@/data/seed'
import { createStore } from '@/stores/store'
import { planFavoritesRemap, shiftFavoritesAfterDeletion } from '@/stores/favorite-store'
import { planNotesRemap, shiftNotesAfterDeletion } from '@/stores/note-store'
import { listNoteImageKeys, sweepNoteImages } from '@/stores/note-image-store'
import { planTrainingRecordsRemap, shiftTrainingRecordsAfterDeletion } from '@/stores/training-record-store'
import { patchEntries as patchVocabEntries, planVocabEntriesRemap, shiftVocabEntriesAfterDeletion, updateFrequencies } from '@/stores/vocab-store'
import type { SubtitleSentence } from '@/types/subtitle'

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
  // 单事务成对读（getAllEntries = getAllKeys+getAll 一次往返）：allKeys+逐键 get 是
  // N+1 个独立事务、逐条 structured-clone 整份记录（含内嵌字幕）——大库启动卡顿的
  // 最后一个 N+1 慢路径（2026-11 全仓复审 c057）
  const entries = await materialsStore.getAllEntries()
  const records = entries
    .map(([, v]) => v as MaterialRecord)
    .filter((r): r is MaterialRecord => !!r && !!r.material)
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

/** seeded 标记（records store）：把「首次启动」与「store 暂时为空」区分开 —— 用户逐个删光材料后刷新，不该复活种子。
 *  key 登记在 schema.ts 的 RECORD_KEYS（键格式单一出处，勿手写字面量） */
const SEEDED_FLAG_KEY = RECORD_KEYS.metaSeeded()

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

/** 学习进度唯一写入口：组件不得绕过 store 直接拼 progress: key */
export function putProgress(progress: LearningProgress): Promise<void> {
  return recordsStore.put(RECORD_KEYS.progress(progress.materialId), progress)
}

/** 删句后统一平移所有按句序号引用的持久化记录，返回平移后的学习进度 */
export async function shiftSentenceReferences(
  materialId: string,
  deletedIndex: number,
): Promise<LearningProgress | undefined> {
  await Promise.all([
    shiftNotesAfterDeletion(materialId, deletedIndex),
    shiftFavoritesAfterDeletion(materialId, deletedIndex),
    shiftTrainingRecordsAfterDeletion(materialId, deletedIndex),
    shiftVocabEntriesAfterDeletion(materialId, deletedIndex),
  ])
  // 被删句笔记的图片孤儿回收：失败只留无害孤儿（下个回收点重试），不影响删句结果
  try { await sweepNoteImages(materialId) } catch { /* 见上 */ }

  const progress = await getProgress(materialId)
  if (!progress) return undefined
  const shifted = {
    ...progress,
    playedSentenceIndexes: progress.playedSentenceIndexes
      .filter((index) => index !== deletedIndex)
      .map((index) => (index > deletedIndex ? index - 1 : index)),
  }
  await putProgress(shifted)
  return shifted
}

/** 整体替换字幕（导入/AI 生成）的原子替换结果 */
export interface SubtitleReplaceResult {
  /** 旧句索引 → 新句索引（未命中的旧句不出现；页面据此迁移内存态） */
  mapping: Map<number, number>
  /** 未能对齐而删除的句级记录数（收藏+笔记+听写明细） */
  droppedRecords: number
  /** 迁移后的学习进度（无进度记录为 undefined） */
  progress: LearningProgress | undefined
  /** 已持久化的新材料记录（页面据此 setRecord） */
  updatedRecord: MaterialRecord
}

/** 文本归一对齐：旧句索引 → 新句索引（同文本多句按序占位；未命中的旧句不出现） */
function buildSentenceTextMapping(
  oldSentences: Array<Pick<SubtitleSentence, 'textEn'>>,
  newSentences: Array<Pick<SubtitleSentence, 'textEn'>>,
): Map<number, number> {
  const normalize = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase()
  const candidatesByText = new Map<string, number[]>()
  newSentences.forEach((s, i) => {
    const key = normalize(s.textEn)
    const queue = candidatesByText.get(key)
    if (queue) queue.push(i)
    else candidatesByText.set(key, [i])
  })
  const mapping = new Map<number, number>()
  oldSentences.forEach((s, oldIndex) => {
    const next = candidatesByText.get(normalize(s.textEn))?.shift()
    if (next !== undefined) mapping.set(oldIndex, next)
  })
  return mapping
}

/**
 * 整体替换字幕（导入/AI 生成）的**原子**入口：新句列表落库 + 五族句级记录迁移
 * （收藏/笔记/听写明细/生词来源句/已播进度）合并进单个 runAtomicOps 提交。
 *
 * - 旧行为①只替换 sentences、句级记录零迁移 —— 重新分句后收藏/笔记/训练历史
 *   静默错位（2026-11 全仓复审 c016）；
 * - 旧行为②先 put 再逐族迁移 —— 两段之间失败留下「新句已存 + 记录持旧索引」
 *   且旧文本不可恢复（quick 复审 c003）。
 * 文本归一后逐句匹配（同文本多句按顺序占位）；未命中的句级记录删除、生词来源句
 * 置 -1、已播句过滤。生词词频（updateFrequencies）是可重算派生态，仍由调用方随后执行。
 *
 * 并发契约（三轮复审 c004，已知限制）：plan 阶段的五族读各在独立只读事务，与提交的
 * readwrite 事务之间**无跨标签页隔离**——另一标签页在窗口（毫秒级）内的写入会基于
 * 陈旧快照被覆盖或以旧索引保留。单用户本地应用下窗口极窄，且「整体替换」本就是重定义
 * 句子世界的 last-write-wins 操作，该语义可接受；若未来需要强一致，须把五族读+提交
 * 收进单个 readwrite 事务（idb.ts 需新增多请求事务原语）。
 */
export async function replaceSubtitleData(record: MaterialRecord, data: SubtitleData): Promise<SubtitleReplaceResult> {
  const materialId = record.material.id
  const mapping = buildSentenceTextMapping(record.subtitleData?.sentences ?? [], data.sentences)

  const [favOps, noteOps, trainOps, vocabPlan] = await Promise.all([
    planFavoritesRemap(materialId, mapping),
    planNotesRemap(materialId, mapping),
    planTrainingRecordsRemap(materialId, mapping),
    planVocabEntriesRemap(materialId, mapping),
  ])

  const progress = await getProgress(materialId)
  const remapped: LearningProgress | undefined = progress
    ? {
        ...progress,
        playedSentenceIndexes: progress.playedSentenceIndexes
          .map((index) => mapping.get(index))
          .filter((index): index is number => index !== undefined)
          .sort((a, b) => a - b),
      }
    : undefined

  const updatedRecord: MaterialRecord = {
    ...record,
    material: {
      ...record.material,
      subtitle: { ref: `idb://materials/${materialId}`, format: data.format, isBilingual: data.isBilingual, sentenceCount: data.sentences.length },
    },
    subtitleData: data,
  }

  // 材料 put 与全部句级记录迁移一次提交：任一失败整体回滚（IDB 保持替换前一致态）
  await runAtomicOps({
    put: {
      materials: [[materialId, updatedRecord] as const],
      records: [
        ...favOps.put,
        ...noteOps.put,
        ...trainOps.put,
        ...vocabPlan.ops.put,
        ...(remapped ? [[RECORD_KEYS.progress(materialId), remapped] as const] : []),
      ],
    },
    del: { records: [...favOps.del, ...noteOps.del, ...trainOps.del, ...vocabPlan.ops.del] },
  })

  patchRecord(updatedRecord)
  // 未对齐而删除的笔记可能持有图片引用：孤儿回收（失败只留无害孤儿，不影响替换结果）
  try { await sweepNoteImages(materialId) } catch { /* 见上 */ }
  if (vocabPlan.entries.length > 0) patchVocabEntries(vocabPlan.entries)
  return {
    mapping,
    droppedRecords: favOps.dropped + noteOps.dropped + trainOps.dropped,
    progress: remapped,
    updatedRecord,
  }
}

/** 删除材料：级联清理 material + blob + 笔记图片 + 相关 records（进度/收藏/笔记/训练记录） */
export async function removeMaterial(id: string): Promise<void> {
  await initMaterials()
  // MATERIAL_OWNED_RECORD_PREFIXES 是“哪些记录随材料删除”的唯一清单：遍历它派生待删 key，
  // 新增材料属主记录族只需在清单登记（不同前缀的 key 派生策略在此集中映射）。
  //   - training：键不含 materialId，走 materialId 值索引；
  //   - progress：精确键 progress:{id}（无尾分隔符，必须精确匹配否则 m-1 会命中 m-10）；
  //   - favorite/note：键本身含 materialId，用带尾部分隔符的前缀区间（天然排除 m-1 / m-10）。
  const ownedKeys = new Set<string>()
  // 笔记图片键单独收集（blobs store 的 noteimg:{id}: 前缀族；纯键扫描不物化图片值）
  const [noteImageKeys, ...scans] = await Promise.all([
    listNoteImageKeys(id),
    ...MATERIAL_OWNED_RECORD_PREFIXES.map(async (prefix) => {
      if (prefix === RECORD_KEY_PREFIXES.training) {
        return (await recordsStore.getEntriesByMaterial(id))
          .filter(([key]) => key.startsWith(prefix))
          .map(([key]) => key)
      }
      if (prefix === RECORD_KEY_PREFIXES.progress) {
        return [RECORD_KEYS.progress(id)]
      }
      return (await recordsStore.getAllEntriesByPrefix(`${prefix}${id}:`)).map(([key]) => key)
    }),
  ])
  for (const keys of scans) for (const key of keys) ownedKeys.add(key)
  // 级联删除收进单事务：material / blob（媒体 + 笔记图片）/ records 三 store 一次提交，
  // 任一失败整体回滚 —— 旧写法 materials.delete 与 blobs.delete 先各自提交，records
  // 事务失败时回滚覆盖不了它们，留下「材料没了、孤儿记录永存」的半删状态（2026-11 复审 c037/c023）
  await runAtomicOps({
    del: { materials: [id], blobs: [id, ...noteImageKeys], records: [...ownedKeys] },
  })
  // 生词词频撤账：回收该材料对 frequency 的贡献（评审 #19，否则删除材料后词频永久虚高，
  // 违反 types/vocabulary.ts「frequency = materialCounts 各值之和」不变量）
  await updateFrequencies([], id)
  // 训练材料偏好若指向被删材料则一并清除：否则训练页下次静默回落演示材料 mock-001，
  // 后续训练成绩会被记到演示材料名下（2026-11 全仓复审）
  if (getPref<string>('training-material', '') === id) removePref('training-material')
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
