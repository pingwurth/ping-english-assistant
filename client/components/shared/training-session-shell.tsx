/**
 * 训练页共享外壳（P4/P5 复用）：
 *  - TrainingSessionShell：页头（eyebrow + 标题 + n/total 徽标）+ 真实进度条；
 *  - SessionSummaryOverlay：完成小结浮层（Card/Badge 组合，不引 dialog）；
 *  - useTrainingMaterial：按 prefs 中最近进入的训练材料加载记录（回落 mock-001）。
 */

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Shell } from '@/components/shared/shell'
import { getMaterialRecord } from '@/stores/material-store'
import { getPref } from '@/platform/storage/prefs'
import type { MaterialRecord } from '@/platform/storage/schema'

/** 训练页外壳：页头 + 逐句真实进度（current = 已完成句数，0-based 游标） */
function TrainingSessionShell({ eyebrow, title, current, total, children }: { eyebrow: string; title: string; current: number; total: number; children: React.ReactNode }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return <Shell back><div className="mx-auto max-w-3xl px-4 py-8 md:px-8"><div className="mb-8 flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{eyebrow}</p><h1 className="font-serif text-3xl font-semibold">{title}</h1></div><Badge>{total ? `${Math.min(current + 1, total)} / ${total}` : '0 / 0'}</Badge></div><Progress value={pct} className="mb-8" />{children}</div></Shell>
}

/** 完成小结浮层：fixed 全屏遮罩 + 居中 Card（复用现有组件，不引 dialog） */
function SessionSummaryOverlay({ open, title, description, children, footer }: { open: boolean; title: string; description?: string; children?: React.ReactNode; footer?: React.ReactNode }) {
  if (!open) return null
  return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"><Card className="w-full max-w-md"><CardHeader><CardTitle className="font-serif text-2xl">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent className="flex flex-col gap-3">{children}{footer && <div className="mt-2 flex flex-wrap justify-end gap-2">{footer}</div>}</CardContent></Card></div>
}

/** 小结统计行（label + value） */
function SummaryStat({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3"><span className="text-sm text-muted-foreground">{label}</span><span className="font-semibold tabular-nums">{value}</span></div>
}

/** 训练材料加载：P3 进入时写入 prefs('training-material')，训练页据此取句 */
function useTrainingMaterial(): { record: MaterialRecord | null; loading: boolean } {
  const [record, setRecord] = useState<MaterialRecord | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const id = getPref<string>('training-material', 'mock-001')
      const rec = (await getMaterialRecord(id)) ?? (await getMaterialRecord('mock-001'))
      if (!cancelled) { setRecord(rec ?? null); setLoading(false) }
    })().catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  return { record, loading }
}

export { SessionSummaryOverlay, SummaryStat, TrainingSessionShell, useTrainingMaterial }
