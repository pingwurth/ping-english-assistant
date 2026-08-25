import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronDown, Heart } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Shell, PageIntro } from '@/components/shared/shell'
import { getMaterialRecord } from '@/stores/material-store'
import { recordsStore } from '@/platform/storage/idb'
import { setPref } from '@/platform/storage/prefs'
import type { MaterialRecord } from '@/platform/storage/schema'
import type { TrainingMode, TrainingRecord } from '@/types/training'

const MODES: Array<{ to: string; mode: TrainingMode; title: string; desc: string; icon: string }> = [
  { to: '/training/puzzle', mode: 'puzzle', title: '九宫格', desc: '选词拼句 · 巩固句型结构', icon: '▦' },
  { to: '/training/dictation', mode: 'dictation', title: '单句听写', desc: '听音写句 · 提升听辨能力', icon: '✎' },
  { to: '/training/read-aloud', mode: 'read-aloud', title: '跟读评分', desc: '逐句跟读 · AI 发音评分', icon: '◉' },
  { to: '/training/shadowing', mode: 'shadowing', title: '影子跟读', desc: '全文同步跟读 · 分析报告', icon: '◌' },
  { to: '/training/recitation', mode: 'recitation', title: '全文背诵', desc: '背诵全文 · 获得评估建议', icon: '▤' },
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

  // 训练页（P4/P5）据此读取当前材料
  useEffect(() => { setPref('training-material', materialId) }, [materialId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rec = await getMaterialRecord(materialId)
      if (cancelled) return
      setRecord(rec ?? null)
      if (!rec) return
      // 上次成绩：train: 记录中该材料各模式最新一条（createdAt 最大）
      const keys = await recordsStore.allKeys()
      const trainKeys = keys.filter((k) => k.startsWith('train:'))
      const entries = (await Promise.all(trainKeys.map((k) => recordsStore.get<TrainingRecord>(k)))).filter((r): r is TrainingRecord => !!r && r.materialId === materialId)
      const latest: Partial<Record<TrainingMode, TrainingRecord>> = {}
      for (const e of entries) {
        const prev = latest[e.mode]
        if (!prev || e.createdAt > prev.createdAt) latest[e.mode] = e
      }
      // 收藏句数量：fav:{materialId}: 前缀
      const prefix = `fav:${materialId}:`
      if (!cancelled) { setLastByMode(latest); setFavCount(keys.filter((k) => k.startsWith(prefix)).length) }
    })().catch(() => { if (!cancelled) setRecord(null) })
    return () => { cancelled = true }
  }, [materialId])

  if (record === undefined) return <Shell back><div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">正在加载材料…</div></Shell>
  if (record === null) return <Navigate to="/" replace />

  const sentenceCount = record.subtitleData?.sentences.length ?? 0

  return <Shell back><div className="mx-auto max-w-3xl px-4 py-10 md:px-8"><PageIntro title="选择训练模式" eyebrow="TRAINING CENTER" /><Card className="mb-6"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5"><span className="text-muted-foreground">材料：{record.material.name}</span><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">全文 {sentenceCount} 句 <ChevronDown /></Badge><Badge variant="secondary" className="opacity-60" title="原型阶段范围选择仅支持全文，先去精听页收藏句子"><Heart data-icon="inline-start" />收藏句 {favCount} 句（暂不可选）</Badge></div>{favCount === 0 && <p className="w-full text-xs text-muted-foreground">范围暂仅支持全文；可先在精听页收藏句子（收藏句范围规划中）。</p>}</CardContent></Card><div className="flex flex-col gap-3">{MODES.map((m) => <Link to={m.to} key={m.to}><Card className="transition-colors hover:border-primary"><CardContent className="flex items-center gap-4 p-5"><span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-xl text-primary">{m.icon}</span><div className="flex-1"><CardTitle className="text-lg">{m.title}</CardTitle><CardDescription>{m.desc}</CardDescription></div><span className="hidden text-sm text-muted-foreground sm:block">上次：{lastScoreLabel(m.mode, lastByMode[m.mode])}</span></CardContent></Card></Link>)}</div></div></Shell>
}

export { TrainingCenter }
