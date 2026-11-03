/**
 * 句子收藏 store —— records store 中 `fav:{materialId}:{sentenceIndex}` 前缀。
 *
 * 收藏夹页（全局）、播放器（单材料）、训练中心（收藏句范围）都从这里读写，
 * 避免各处自行拼 key 与解析序号；删除材料的级联清理在 stores/material-store.ts。
 */

import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import { shiftIndexedRecordsAfterDeletion } from '@/stores/shift-records'
import type { Favorite } from '@/types/progress'

const FAV_PREFIX = RECORD_KEY_PREFIXES.favorite

/**
 * 读取收藏记录。
 * @param materialId 传入则只取该材料，省略则取全部
 * @returns 按收藏时间降序（最新在前）
 */
export async function listFavorites(materialId?: string): Promise<Favorite[]> {
  const prefix = materialId ? `${FAV_PREFIX}${materialId}:` : FAV_PREFIX
  // 主键前缀区间读：只物化收藏自身的值，不再为一份收藏扫整个 records store
  const entries = await recordsStore.getAllEntriesByPrefix(prefix)
  return entries
    .map(([, v]) => v as Favorite)
    .filter((f): f is Favorite => !!f && typeof f.createdAt === 'number')
    .sort((a, b) => b.createdAt - a.createdAt)
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
 * 原子性（单事务删+写）见共享实现 shift-records.ts 的说明。
 */
export async function shiftFavoritesAfterDeletion(materialId: string, deletedIndex: number): Promise<void> {
  await shiftIndexedRecordsAfterDeletion(await listFavorites(materialId), materialId, deletedIndex, RECORD_KEYS.favorite)
}
