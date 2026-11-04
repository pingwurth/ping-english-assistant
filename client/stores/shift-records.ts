/**
 * 删句后平移「{prefix}:{materialId}:{sentenceIndex}」形态的句序号记录族 —— 共享实现
 * （收藏 favorite-store / 笔记 note-store 使用；训练记录与生词平移因记录结构不同
 * 各自实现，但同样必须走 runAtomicOps 单事务提交）。
 *
 * 语义：被删句（sentenceIndex === deletedIndex）的记录删除；其后（> deletedIndex）序号 -1。
 *
 * 为什么单事务（runAtomicOps）而不是逐条 await：旧写法「先删循环、再写循环」中，
 *  a) 同一 key 的 delete/put 分属不同事务，提交顺序不可预测，后提交的 delete 会
 *     吞掉平移写入（丢收藏/丢笔记）；
 *  b) 中途失败（崩溃/关页）留下「前半已删、后半残留」的永久错位状态。
 */
import { runAtomicOps } from '@/platform/storage/idb'

export async function shiftIndexedRecordsAfterDeletion<T extends { sentenceIndex: number }>(
  entries: T[],
  materialId: string,
  deletedIndex: number,
  keyOf: (materialId: string, sentenceIndex: number) => string,
): Promise<void> {
  const affected = entries.filter((e) => e.sentenceIndex >= deletedIndex)
  const after = affected.filter((e) => e.sentenceIndex > deletedIndex)
  await runAtomicOps({
    del: { records: affected.map((e) => keyOf(materialId, e.sentenceIndex)) },
    put: {
      records: after.map((e) => [
        keyOf(materialId, e.sentenceIndex - 1),
        { ...e, sentenceIndex: e.sentenceIndex - 1 },
      ] as const),
    },
  })
}

/**
 * 单族迁移的待提交操作：只规划不执行 —— 由 material-store 的 replaceSubtitleData
 * 把各族 ops 与材料 put 合并进同一个 runAtomicOps（quick 复审 c003：先 put 材料
 * 再逐族迁移的两段写,中间失败会留下「新句已存 + 记录持旧索引」且旧文本不可恢复）。
 */
export interface SentenceRecordOps {
  del: string[]
  put: Array<readonly [string, unknown]>
  /** 因未命中映射而被删除的记录数 */
  dropped: number
}

/**
 * 按任意索引映射规划「{prefix}:{materialId}:{sentenceIndex}」形态记录族的迁移
 * （整体替换字幕后用；映射由 material-store 按句文本对齐生成）。
 * 语义：mapping 无该索引 → 删除（对应的句子已不存在）；有 → 移到新索引。
 */
export function planIndexedRecordsRemap<T extends { sentenceIndex: number }>(
  entries: T[],
  materialId: string,
  mapping: Map<number, number>,
  keyOf: (materialId: string, sentenceIndex: number) => string,
): SentenceRecordOps {
  const del: string[] = []
  const put: Array<readonly [string, unknown]> = []
  let dropped = 0
  for (const e of entries) {
    const next = mapping.get(e.sentenceIndex)
    if (next === undefined) {
      del.push(keyOf(materialId, e.sentenceIndex))
      dropped++
      continue
    }
    if (next !== e.sentenceIndex) {
      del.push(keyOf(materialId, e.sentenceIndex))
      put.push([keyOf(materialId, next), { ...e, sentenceIndex: next }] as const)
    }
  }
  return { del, put, dropped }
}
