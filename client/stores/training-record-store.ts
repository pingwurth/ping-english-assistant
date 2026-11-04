/**
 * 训练记录 store —— train: 记录的唯一写入口 + 保留策略。
 *
 * 三个写入点（九宫格逐会话 / 单句听写逐句首核 / 跟读评分逐句首评）原先各自
 * 裸 put 且无限累积——重度使用数月后 records store 里 train: 记录线性增长。
 * 现统一走 appendTrainingRecord：每「材料 × 模式」仅保留最近
 * TRAINING_KEEP_PER_MATERIAL_MODE 条（写后即清该材料超额部分），
 * 启动时后台清扫一次（sweepTrainingRetention）兜住升级前存量与备份导入的积压。
 *
 * 消费方不受影响：「上次成绩」（training-center）只读各模式最新一条；
 * 删句平移（material-store）与设置页统计、备份导出读到的都是有界集合。
 */
import { recordsStore, runAtomicOps } from '@/platform/storage/idb'
import { RECORD_KEYS, RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import { reportDetailFromText } from '@/core/training/scoring'
import { makeRecordId } from '@/core/training/session'
import type { TrainingRecord } from '@/types/training'

/** 每「材料 × 模式」保留的最近训练记录条数上限（含刚写入的一条） */
export const TRAINING_KEEP_PER_MATERIAL_MODE = 100

/**
 * prune 扫描的写入门槛：prune 会物化该材料全部家族记录（O(N) 克隆），听写逐句
 * 首评是每句一次写 —— 稳态（远未到 100 条上限）下每次写都扫是纯开销。改为每
 * PRUNE_EVERY_WRITES 次写扫一次；保留数可能短暂超出上限少许，由后续写入与
 * 启动清扫（sweepTrainingRetention）收敛。
 */
const PRUNE_EVERY_WRITES = 10
let writesSincePrune = 0

/**
 * 写入一条训练记录并按写入门槛执行该材料的保留策略。
 * put 失败会上抛（调用方沿用「存储失败不影响训练」的吞掉约定）；
 * 清理失败只告警不打断 —— 下次写入或启动清扫会再收敛。
 */
export async function appendTrainingRecord(record: TrainingRecord): Promise<void> {
  await recordsStore.put(RECORD_KEYS.training(record.id), record)
  writesSincePrune++
  if (writesSincePrune % PRUNE_EVERY_WRITES !== 0) return
  try {
    await pruneTrainingRecords(record.materialId)
  } catch (e) {
    console.warn('[training-record] retention prune failed:', e)
  }
}

/**
 * 影子跟读/全文背诵转写成功后的统一落库入口。
 * 每次录音只由调用方标记一次；重新转写同一段录音不会重复写 train: 记录。
 */
export function appendReportTrainingRecord(
  mode: 'shadowing' | 'recitation',
  materialId: string,
  transcript: string,
  target: string,
): Promise<void> {
  // ASR 空结果代表无效/静音尝试，不应覆盖训练中心的真实“上次成绩”。
  if (!transcript.trim()) return Promise.resolve()
  const detail = reportDetailFromText(transcript, target)
  return appendTrainingRecord({
    id: makeRecordId(),
    materialId,
    mode,
    scope: { type: 'all' },
    score: detail.total,
    detail,
    createdAt: Date.now(),
  })
}

/** 把 [key, value] 记录对按「材料 × 模式」分组，返回超出保留上限、应删除的键 */
function keysBeyondKeep(entries: Array<[string, unknown]>, keep = TRAINING_KEEP_PER_MATERIAL_MODE): string[] {
  const groups = new Map<string, Array<[string, TrainingRecord]>>()
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.training)) continue
    const rec = value as TrainingRecord | null
    // 无法归组（缺 materialId/mode 的畸形或历史形态记录）不动，宁可多留不可误删
    if (!rec || typeof rec.materialId !== 'string' || typeof rec.mode !== 'string') continue
    const groupId = `${rec.materialId}\u0000${rec.mode}`
    const group = groups.get(groupId) ?? []
    group.push([key, rec])
    groups.set(groupId, group)
  }

  const toDelete: string[] = []
  for (const group of groups.values()) {
    // 新记录在前；createdAt 相同（同批毫秒生成）时按 id 字典序倒序，保证删除结果确定
    group.sort(([, a], [, b]) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
    for (const [key] of group.slice(keep)) toDelete.push(key)
  }
  return toDelete
}

/** 清理单个材料的超额训练记录（materialId 索引点查，只物化该材料的记录），返回删除条数 */
export async function pruneTrainingRecords(materialId: string): Promise<number> {
  const toDelete = keysBeyondKeep(await recordsStore.getEntriesByMaterial(materialId))
  if (toDelete.length === 0) return 0
  await Promise.all(toDelete.map((key) => recordsStore.delete(key)))
  return toDelete.length
}

/**
 * 启动清扫：对全部材料执行保留策略（兜住 v3 升级前的存量与备份导入的积压）。
 * 只物化 train: 前缀的记录（主键区间读，fav:/note: 等无关值不参与）；
 * 由 study-app 挂载时后台触发，失败静默 —— 下次启动自然重试。
 */
export async function sweepTrainingRetention(): Promise<number> {
  const entries = await recordsStore.getAllEntriesByPrefix(RECORD_KEY_PREFIXES.training)
  const toDelete = keysBeyondKeep(entries)
  if (toDelete.length === 0) return 0
  await Promise.all(toDelete.map((key) => recordsStore.delete(key)))
  console.info(`[training-record] retention sweep deleted ${toDelete.length} stale train: records`)
  return toDelete.length
}

/** 全局训练统计（设置页学习统计使用；不反序列化无关 records） */
export interface TrainingStats {
  count: number
  averageScore: number
}

export async function getTrainingStats(): Promise<TrainingStats> {
  const entries = await recordsStore.getAllEntriesByPrefix(RECORD_KEY_PREFIXES.training)
  let scoreSum = 0
  let scoreCount = 0
  for (const [, value] of entries) {
    const score = (value as TrainingRecord | null)?.score
    if (typeof score === 'number') {
      scoreSum += score
      scoreCount++
    }
  }
  return {
    count: entries.length,
    averageScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
  }
}

/** 每个训练模式在该材料下的最新一条记录（训练中心“上次成绩”） */
export async function getLatestTrainingRecordsByMaterial(
  materialId: string,
): Promise<Partial<Record<TrainingRecord['mode'], TrainingRecord>>> {
  const entries = await recordsStore.getEntriesByMaterial(materialId)
  const latest: Partial<Record<TrainingRecord['mode'], TrainingRecord>> = {}
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.training)) continue
    const record = value as TrainingRecord | undefined
    if (!record || record.materialId !== materialId) continue
    const previous = latest[record.mode]
    if (!previous || record.createdAt > previous.createdAt) latest[record.mode] = record
  }
  return latest
}

/** 删句后平移单句听写明细中的 sentenceIndex；被删句的记录删除。
 * 先收集全部变更再一次性提交（runAtomicOps），避免逐条 await 中途失败留下
 * 「前半已删/已平移、后半未处理」的永久错位状态。 */
export async function shiftTrainingRecordsAfterDeletion(materialId: string, deletedIndex: number): Promise<void> {
  const entries = await recordsStore.getEntriesByMaterial(materialId)
  const del: string[] = []
  const put: Array<readonly [string, unknown]> = []
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.training)) continue
    const record = value as TrainingRecord | undefined
    if (!record || record.mode !== 'dictation') continue

    // detail 可能缺失/非对象（导入的外来数据、历史版本遗留）：未判空直接取 .sentenceIndex 会抛 TypeError
    const detail = record.detail as { sentenceIndex?: unknown } | undefined
    if (!detail || typeof detail.sentenceIndex !== 'number') continue
    if (detail.sentenceIndex === deletedIndex) {
      del.push(key)
      continue
    }
    if (detail.sentenceIndex > deletedIndex) {
      put.push([key, {
        ...record,
        detail: { ...record.detail, sentenceIndex: detail.sentenceIndex - 1 },
      } satisfies TrainingRecord])
    }
  }
  await runAtomicOps({ del: { records: del }, put: { records: put } })
}

/**
 * 整体替换字幕后按映射迁移单句听写明细的 sentenceIndex；对应句已不存在的记录删除。
 * @returns 被删除的训练记录数
 */
export async function remapTrainingRecordsAfterReplace(materialId: string, mapping: Map<number, number>): Promise<number> {
  const entries = await recordsStore.getEntriesByMaterial(materialId)
  const del: string[] = []
  const put: Array<readonly [string, unknown]> = []
  for (const [key, value] of entries) {
    if (!key.startsWith(RECORD_KEY_PREFIXES.training)) continue
    const record = value as TrainingRecord | undefined
    if (!record || record.mode !== 'dictation') continue
    const detail = record.detail as { sentenceIndex?: unknown } | undefined
    if (!detail || typeof detail.sentenceIndex !== 'number') continue
    const next = mapping.get(detail.sentenceIndex)
    if (next === undefined) {
      del.push(key)
      continue
    }
    if (next !== detail.sentenceIndex) {
      put.push([key, {
        ...record,
        detail: { ...record.detail, sentenceIndex: next },
      } satisfies TrainingRecord])
    }
  }
  await runAtomicOps({ del: { records: del }, put: { records: put } })
  return del.length
}
