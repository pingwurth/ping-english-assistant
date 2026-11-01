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
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import type { TrainingRecord } from '@/types/training'

/** 每「材料 × 模式」保留的最近训练记录条数上限（含刚写入的一条） */
export const TRAINING_KEEP_PER_MATERIAL_MODE = 100

/**
 * 写入一条训练记录并立即执行该材料的保留策略。
 * put 失败会上抛（调用方沿用「存储失败不影响训练」的吞掉约定）；
 * 清理失败只告警不打断 —— 下次写入或启动清扫会再收敛。
 */
export async function appendTrainingRecord(record: TrainingRecord): Promise<void> {
  await recordsStore.put(RECORD_KEYS.training(record.id), record)
  try {
    await pruneTrainingRecords(record.materialId)
  } catch (e) {
    console.warn('[training-record] retention prune failed:', e)
  }
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
