/**
 * 句子收藏 store —— records store 中 `fav:{materialId}:{sentenceIndex}` 前缀。
 *
 * 收藏夹页（全局）、播放器（单材料）、训练中心（收藏句范围）都从这里读写，
 * 避免各处自行拼 key 与解析序号；删除材料的级联清理在 stores/material-store.ts。
 */

import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import type { Favorite } from '@/types/progress'

const FAV_PREFIX = RECORD_KEY_PREFIXES.favorite

/**
 * 读取收藏记录。
 * @param materialId 传入则只取该材料，省略则取全部
 * @returns 按收藏时间降序（最新在前）
 */
export async function listFavorites(materialId?: string): Promise<Favorite[]> {
  const prefix = materialId ? `${FAV_PREFIX}${materialId}:` : FAV_PREFIX
  const keys = (await recordsStore.allKeys()).filter((k) => k.startsWith(prefix))
  const entries = await Promise.all(keys.map((k) => recordsStore.get<Favorite>(k)))
  return entries.filter((f): f is Favorite => !!f).sort((a, b) => b.createdAt - a.createdAt)
}

/** 收藏 / 取消收藏（幂等；重复收藏不刷新时间戳） */
export async function setFavorite(materialId: string, sentenceIndex: number, favorited: boolean): Promise<void> {
  const key = RECORD_KEYS.favorite(materialId, sentenceIndex)
  if (!favorited) {
    await recordsStore.delete(key)
    return
  }
  const existing = await recordsStore.get<Favorite>(key)
  if (existing) return
  await recordsStore.put(key, { materialId, sentenceIndex, createdAt: Date.now() } satisfies Favorite)
}

/** 该材料已收藏的句序号（升序，供训练范围过滤） */
export async function favoriteSentenceIndexes(materialId: string): Promise<number[]> {
  const favorites = await listFavorites(materialId)
  return favorites.map((f) => f.sentenceIndex).sort((a, b) => a - b)
}

/**
 * 删句后平移收藏：被删句的收藏移除，其后句序号 -1（与字幕重排后的 index 对齐）。
 * 不平移的话收藏会静默指向错位的句子、被删句的收藏永久残留。
 */
export async function shiftFavoritesAfterDeletion(materialId: string, deletedIndex: number): Promise<void> {
  const favorites = await listFavorites(materialId)
  const after = favorites.filter((f) => f.sentenceIndex > deletedIndex)
  await Promise.all([
    ...favorites
      .filter((f) => f.sentenceIndex >= deletedIndex)
      .map((f) => recordsStore.delete(RECORD_KEYS.favorite(materialId, f.sentenceIndex))),
    ...after.map((f) =>
      recordsStore.put(RECORD_KEYS.favorite(materialId, f.sentenceIndex - 1), { ...f, sentenceIndex: f.sentenceIndex - 1 }),
    ),
  ])
}