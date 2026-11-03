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
