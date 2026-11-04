/**
 * 句子笔记 store —— records store 中 `note:{materialId}:{sentenceIndex}` 前缀。
 *
 * 播放器（边听边记）从这里读写；删除材料的级联清理在 stores/material-store.ts；
 * 删句后的序号平移用 shiftNotesAfterDeletion（字幕句 index 会重排，笔记 key 必须跟随）。
 */

import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import { planIndexedRecordsRemap, shiftIndexedRecordsAfterDeletion, type SentenceRecordOps } from '@/stores/shift-records'
import type { SentenceNote } from '@/types/note'

const NOTE_PREFIX = RECORD_KEY_PREFIXES.note

/**
 * 读取笔记记录。
 * @param materialId 传入则只取该材料，省略则取全部
 * @returns 按句序号升序
 */
export async function listNotes(materialId?: string): Promise<SentenceNote[]> {
  const prefix = materialId ? `${NOTE_PREFIX}${materialId}:` : NOTE_PREFIX
  // 主键前缀区间读：只物化笔记自身的值，不再为一份笔记扫整个 records store
  const entries = await recordsStore.getAllEntriesByPrefix(prefix)
  return entries
    .map(([, v]) => v as SentenceNote)
    .filter((n): n is SentenceNote => !!n && typeof n.sentenceIndex === 'number')
    .sort((a, b) => a.sentenceIndex - b.sentenceIndex)
}

/** 读取指定句的笔记（无则 null） */
export async function getSentenceNote(materialId: string, sentenceIndex: number): Promise<SentenceNote | null> {
  return (await recordsStore.get<SentenceNote>(RECORD_KEYS.note(materialId, sentenceIndex))) ?? null
}

/**
 * 保存指定句的笔记。content 为空（去空白后）视同删除，保证"清空即无笔记"。
 * createdAt 在首次创建时固定，后续编辑只刷新 updatedAt。
 */
export async function saveSentenceNote(materialId: string, sentenceIndex: number, content: string): Promise<void> {
  const key = RECORD_KEYS.note(materialId, sentenceIndex)
  if (!content.trim()) {
    await recordsStore.delete(key)
    return
  }
  const existing = await recordsStore.get<SentenceNote>(key)
  const now = Date.now()
  await recordsStore.put(key, {
    materialId,
    sentenceIndex,
    content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } satisfies SentenceNote)
}

/** 删除指定句的笔记 */
export async function deleteSentenceNote(materialId: string, sentenceIndex: number): Promise<void> {
  await recordsStore.delete(RECORD_KEYS.note(materialId, sentenceIndex))
}

/**
 * 删句后平移笔记：被删句的笔记移除，其后所有笔记句序号 -1（与字幕重排后的 index 对齐）。
 * 受影响区间（被删句及其后）的旧 key 在单事务内删除后重写——被删句自己的 key 也必须删，
 * 否则残留的笔记会附到"顶替它位置的那句"上（幽灵笔记）。原子性见共享实现 shift-records.ts。
 */
export async function shiftNotesAfterDeletion(materialId: string, deletedIndex: number): Promise<void> {
  await shiftIndexedRecordsAfterDeletion(await listNotes(materialId), materialId, deletedIndex, RECORD_KEYS.note)
}

/**
 * 整体替换字幕前规划笔记迁移 ops（由 replaceSubtitleData 合并提交）；
 * 对应句已不存在的笔记删除。
 */
export async function planNotesRemap(materialId: string, mapping: Map<number, number>): Promise<SentenceRecordOps> {
  return planIndexedRecordsRemap(await listNotes(materialId), materialId, mapping, RECORD_KEYS.note)
}
