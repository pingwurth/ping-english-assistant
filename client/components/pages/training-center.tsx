import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AudioLines, BookOpen, Heart, Mic, PenLine, Puzzle, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Shell } from '@/components/shared/shell'
import { getMaterialRecord } from '@/stores/material-store'
import { recordsStore } from '@/platform/storage/idb'
import { getLatestTrainingRecordsByMaterial } from '@/stores/training-record-store'
import { setPref } from '@/platform/storage/prefs'
import { getTrainingScope, setTrainingScope, type PrefTrainingScope } from '@/lib/pref-keys'
import type { MaterialRecord } from '@/platform/storage/schema'
import { RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import type { TrainingMode, TrainingRecord } from '@/types/training'

/** fullTextOnly：影子跟读/全文背诵始终按全文出题，选中「收藏句」时置灰 */
const MODES: Array<{ to: string; mode: TrainingMode; title: string; desc: string; icon: LucideIcon; fullTextOnly?: boolean }> = [
  { to: '/training/puzzle', mode: 'puzzle', title: '九宫格', desc: '选词拼句 · 巩固句型结构', icon: Puzzle },
  { to: '/training/dictation', mode: 'dictation', title: '单句听写', desc: '听音写句 · 提升听辨能力', icon: PenLine },
  { to: '/training/read-aloud', mode: 'read-aloud', title: '跟读评分', desc: '逐句跟读 · AI 发音评分', icon: Mic },
  { to: '/training/shadowing', mode: 'shadowing', title: '影子跟读', desc: '全文同步跟读 · 转写对比', icon: AudioLines, fullTextOnly: true },
  { to: '/training/recitation', mode: 'recitation', title: '全文背诵', desc: '背诵全文 · 转写对比', icon: BookOpen, fullTextOnly: true },
]

/** 各模式"上次成绩"文案（读 records 中该材料最新一条 train: 记录） */
function lastScoreLabel(mode: TrainingMode, rec: TrainingRecord | undefined): string {
  if (!rec) return '尚未练习'
  if (mode === 'puzzle' || mode === 'dictation') return `正确率 ${rec.score}%`
  if (mode === 'read-aloud') return `平均分 ${rec.score}`
  return `综合 ${rec.score} 分`
}

function TrainingCenter() {
  const { materialId = 'mock-001' } = useParams()
  const [record, setRecord] = useState<MaterialRecord | null | undefined>(undefined)
  const [lastByMode, setLastByMode] = useState<Partial<Record<TrainingMode, TrainingRecord>>>({})
  const [favCount, setFavCount] = useState(0)
  const [scope, setScope] = useState<PrefTrainingScope>(() => getTrainingScope())

  const changeScope = useCallback((next: PrefTrainingScope) => {
    setScope(next)
    setTrainingScope(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rec = await getMaterialRecord(materialId)
      if (cancelled) return
      setRecord(rec ?? null)
      if (!rec) return
      // 材料确实存在才写偏好（P4/P5 训练页据此取当前材料）：挂载即写会让悬空 id
      // （已删材料/失效链接）毒化偏好，训练页静默回落演示材料并把成绩记到它名下
      setPref('training-material', materialId)
      const [latest, favorites] = await Promise.all([
        getLatestTrainingRecordsByMaterial(materialId),
        recordsStore.getAllEntriesByPrefix(`${RECORD_KEY_PREFIXES.favorite}${materialId}:`),
      ])
      if (!cancelled) { setLastByMode(latest); setFavCount(favorites.length) }
    })().catch(() => { if (!cancelled) setRecord(null) })
    return () => { cancelled = true }
  }, [materialId])

  if (record === undefined) return <Shell back><div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">正在加载材料…</div></Shell>
  if (record === null) return <Navigate to="/" replace />

  const sentenceCount = record.subtitleData?.sentences.length ?? 0
  /** 收藏句范围是否生效（选了收藏句且确有收藏）——生效时全文类模式置灰 */
  const favoritesScope = scope === 'favorites' && favCount > 0
  const scopeOptions: Array<{ id: PrefTrainingScope; label: string; disabled?: boolean; title?: string }> = [
    { id: 'all', label: `全文 ${sentenceCount} 句` },
    { id: 'favorites', label: `收藏句 ${favCount} 句`, disabled: favCount === 0, title: favCount === 0 ? '先去精听页收藏句子' : undefined },
  ]

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
        <div className="mb-8">
          <p className="text-sm text-muted-foreground">训练中心</p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">选择训练模式</h1>
        </div>
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 p-5">
            <span className="text-muted-foreground">材料：{record.material.name}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">范围</span>
              <div className="flex rounded-lg border bg-background p-0.5">
                {scopeOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => changeScope(o.id)}
                    disabled={o.disabled}
                    title={o.title}
                    aria-pressed={scope === o.id}
                    className={`rounded-md px-2.5 py-1 text-sm transition-colors disabled:opacity-40 ${scope === o.id ? 'bg-ink text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {favoritesScope && <Badge variant="secondary"><Heart data-icon="inline-start" />仅练收藏句</Badge>}
            </div>
            {favCount === 0 && <p className="text-xs text-muted-foreground">还没有收藏句：在精听页点句子的「收藏」，即可按收藏句训练。</p>}
            {favoritesScope && <p className="text-xs text-muted-foreground">影子跟读与全文背诵需完整上下文，始终使用全文范围（已置灰）。</p>}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3">
          {MODES.map((m) => {
            const locked = favoritesScope && !!m.fullTextOnly
            const body = (
              <CardContent className="flex items-center gap-4 p-5">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-ink/10 text-ink"><m.icon className="size-5" /></span>
                <div className="flex-1">
                  <CardTitle className="text-lg">{m.title}</CardTitle>
                  <CardDescription>{m.desc}</CardDescription>
                </div>
                {locked
                  ? <Badge variant="secondary" className="opacity-60">仅全文</Badge>
                  : <span className="hidden text-sm text-muted-foreground sm:block">上次：{lastScoreLabel(m.mode, lastByMode[m.mode])}</span>}
              </CardContent>
            )
            return locked
              ? <Card key={m.to} className="opacity-50">{body}</Card>
              : <Link to={m.to} key={m.to}><Card className="transition-colors hover:border-ink/40">{body}</Card></Link>
          })}
        </div>
      </div>
    </Shell>
  )
}

export { TrainingCenter }
