/**
 * 句子收藏夹（/favorites）—— 跨材料汇总所有收藏句。
 *
 * 数据：records store 中 fav:{materialId}:{sentenceIndex}（stores/favorite-store.ts）。
 * 分组：按材料聚合（组间按该材料最近一次收藏时间降序），组内按句序号升序。
 * 交互：点句子 → /player/:materialId?s=N 定位到该句（播放器据 ?s= seek，不自动播放）；
 *       行内可取消收藏，取消后该组为空则整组消失。
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Shell, PageIntro } from '@/components/shared/shell'
import { getMaterialRecord } from '@/stores/material-store'
import { listFavorites, setFavorite } from '@/stores/favorite-store'
import type { Favorite } from '@/types/progress'
import type { SubtitleSentence } from '@/types/subtitle'

interface FavoriteRow {
  favorite: Favorite
  /** 字幕里对应的句子；材料被删除或字幕被替换后可能取不到 */
  sentence: SubtitleSentence | undefined
}

interface FavoriteGroup {
  materialId: string
  materialName: string
  rows: FavoriteRow[]
}

/** 收藏时间文案：今天 / 昨天 / N 天前（与材料库 lastLabel 同口径） */
function createdLabel(createdAt: number): string {
  const days = Math.floor((Date.now() - createdAt) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

/** ms → "mm:ss"（句首时间，与字幕列表展示一致） */
function formatMs(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 读取全部收藏并按材料聚合成分组（listFavorites 已按收藏时间降序，故组序即最近收藏序） */
async function loadGroups(): Promise<FavoriteGroup[]> {
  const byMaterial = new Map<string, Favorite[]>()
  for (const favorite of await listFavorites()) {
    const list = byMaterial.get(favorite.materialId)
    if (list) list.push(favorite)
    else byMaterial.set(favorite.materialId, [favorite])
  }
  const groups: FavoriteGroup[] = []
  for (const [materialId, favorites] of byMaterial) {
    const record = await getMaterialRecord(materialId)
    const sentences = record?.subtitleData?.sentences ?? []
    groups.push({
      materialId,
      materialName: record?.material.name ?? materialId,
      rows: favorites
        .map((favorite) => ({ favorite, sentence: sentences[favorite.sentenceIndex] }))
        .sort((a, b) => a.favorite.sentenceIndex - b.favorite.sentenceIndex),
    })
  }
  return groups
}

function Favorites() {
  const navigate = useNavigate()
  /** null = 加载中 */
  const [groups, setGroups] = useState<FavoriteGroup[] | null>(null)

  useEffect(() => {
    let cancelled = false
    loadGroups()
      .then((g) => { if (!cancelled) setGroups(g) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [])

  /** 取消收藏：落盘后本地移除该行（组内空了则移除整组），无需整表重载 */
  const removeFavorite = useCallback(async (materialId: string, sentenceIndex: number) => {
    await setFavorite(materialId, sentenceIndex, false)
    setGroups((prev) => {
      if (!prev) return prev
      return prev
        .map((g) => (g.materialId === materialId ? { ...g, rows: g.rows.filter((r) => r.favorite.sentenceIndex !== sentenceIndex) } : g))
        .filter((g) => g.rows.length > 0)
    })
  }, [])

  const total = groups?.reduce((n, g) => n + g.rows.length, 0) ?? 0

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
        <PageIntro title="句子收藏" eyebrow="FAVORITES">
          <p className="text-sm text-muted-foreground">
            {groups === null ? '正在加载…' : total > 0 ? `共 ${total} 句 · 分属 ${groups.length} 份材料` : '精听页收藏的句子会汇总到这里'}
          </p>
        </PageIntro>

        {groups === null ? (
          <Card className="flex min-h-64 items-center justify-center"><p className="text-muted-foreground">正在加载收藏…</p></Card>
        ) : groups.length === 0 ? (
          <Card className="flex min-h-64 items-center justify-center">
            <div className="text-center">
              <Heart className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="font-serif text-2xl">还没有收藏句子</p>
              <p className="mt-2 text-muted-foreground">在精听页把想反复听的句子点「收藏」，就会出现在这里。</p>
              <Link to="/"><Button className="mt-6" variant="outline">去材料库</Button></Link>
            </div>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <section key={g.materialId} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/player/${g.materialId}`} className="truncate font-serif text-lg hover:text-primary">{g.materialName}</Link>
                  <Badge variant="secondary">{g.rows.length} 句</Badge>
                </div>
                {g.rows.map((r) => (
                  <div key={r.favorite.sentenceIndex} className="flex items-start gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => navigate(`/player/${g.materialId}?s=${r.favorite.sentenceIndex}`)}
                      aria-label={`到播放器精听第 ${r.favorite.sentenceIndex + 1} 句`}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Star className="size-3 fill-primary text-primary" />
                        <span>{r.favorite.sentenceIndex + 1}</span>
                        {r.sentence && <span>{formatMs(r.sentence.startMs)}</span>}
                        <span>{createdLabel(r.favorite.createdAt)}收藏</span>
                      </div>
                      {r.sentence ? (
                        <>
                          <p className="whitespace-pre-line leading-relaxed">{r.sentence.textEn}</p>
                          {r.sentence.textZh && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{r.sentence.textZh}</p>}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">该句已不在字幕中（材料字幕被替换或删除）</p>
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground"
                      title="取消收藏"
                      aria-label={`取消收藏第 ${r.favorite.sentenceIndex + 1} 句`}
                      onClick={() => void removeFavorite(g.materialId, r.favorite.sentenceIndex)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

export { Favorites }