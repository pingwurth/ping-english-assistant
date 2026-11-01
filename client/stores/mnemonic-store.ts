/**
 * 助记缓存 store —— 将 LLM 生成的助记卡片存入 IndexedDB（records store）。
 *
 * 纯 async CRUD：无内存镜像、无订阅者 —— 同一生词点击"生词助记"时优先读缓存，
 * 避免重复调用 LLM。历史上仿 vocab-store 维护过内存 caches 镜像 + 同步读取函数，
 * 但从无组件订阅该 store，内存副本只会与 IndexedDB 漂移，已移除。
 */

import type { Association, Exercises, MnemonicCache } from '@/types/mnemonic'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'

/** 从 IndexedDB 读取缓存（如果存在） */
export async function loadMnemonic(entryId: string): Promise<MnemonicCache | null> {
  const cached = await recordsStore.get<MnemonicCache>(RECORD_KEYS.mnemonic(entryId))
  return cached ?? null
}

/** 写入缓存到 IndexedDB */
export async function saveMnemonic(cache: MnemonicCache): Promise<void> {
  await recordsStore.put(RECORD_KEYS.mnemonic(cache.id), cache)
}

/** 删除缓存（用于"刷新卡片"） */
export async function clearMnemonic(entryId: string): Promise<void> {
  await recordsStore.delete(RECORD_KEYS.mnemonic(entryId))
}

/** 保存联想记忆到已有缓存 */
export async function saveAssociation(entryId: string, association: Association): Promise<void> {
  const existing = await loadMnemonic(entryId)
  if (!existing) return
  const updated: MnemonicCache = { ...existing, association }
  await saveMnemonic(updated)
}

/** 保存练习题到已有缓存 */
export async function saveExercises(entryId: string, exercises: Exercises): Promise<void> {
  const existing = await loadMnemonic(entryId)
  if (!existing) return
  const updated: MnemonicCache = { ...existing, exercises }
  await saveMnemonic(updated)
}
