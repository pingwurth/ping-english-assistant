/**
 * 助记缓存 store —— 将 LLM 生成的助记卡片存入 IndexedDB
 *
 * 遵循 vocab-store.ts 的模式：recordsStore + createStore。
 * 同一生词点击"生词助记"时优先读缓存，避免重复调用 LLM。
 */

import type { Association, Exercises, MnemonicCache, MnemonicCard } from '@/types/mnemonic'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'
import { createStore } from '@/stores/store'

export interface MnemonicState {
  /** 当前加载的缓存（key = entryId） */
  caches: Record<string, MnemonicCache>
}

export const mnemonicStore = createStore<MnemonicState>({ caches: {} })

/** 从 IndexedDB 读取缓存（如果存在） */
export async function loadMnemonic(entryId: string): Promise<MnemonicCache | null> {
  const cached = await recordsStore.get<MnemonicCache>(RECORD_KEYS.mnemonic(entryId))
  if (cached) {
    mnemonicStore.set((prev) => ({
      ...prev,
      caches: { ...prev.caches, [entryId]: cached },
    }))
  }
  return cached ?? null
}

/** 写入缓存到 IndexedDB + 更新内存 */
export async function saveMnemonic(cache: MnemonicCache): Promise<void> {
  await recordsStore.put(RECORD_KEYS.mnemonic(cache.id), cache)
  mnemonicStore.set((prev) => ({
    ...prev,
    caches: { ...prev.caches, [cache.id]: cache },
  }))
}

/** 删除缓存（用于"刷新卡片"） */
export async function clearMnemonic(entryId: string): Promise<void> {
  await recordsStore.delete(RECORD_KEYS.mnemonic(entryId))
  mnemonicStore.set((prev) => {
    const { [entryId]: _, ...rest } = prev.caches
    return { ...prev, caches: rest }
  })
}

/** 内存中获取缓存（同步，不触发 IndexedDB） */
export function getMnemonicFromMemory(entryId: string): MnemonicCache | null {
  return mnemonicStore.get().caches[entryId] ?? null
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
