import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, FileAudio, Plus, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Shell, PageIntro } from '@/components/shared/shell'
import { MaterialCard } from '@/components/shared/player-parts'
import { getProgress, initMaterials, materialStore, removeMaterial } from '@/stores/material-store'
import { useStore } from '@/stores/store'
import type { MaterialRecord } from '@/platform/storage/schema'

/** 进度百分比 = playedSentenceIndexes 去重数 / 总句数（真源：docs/原型设计.md P0 学习进度条） */
async function loadProgressPercents(records: MaterialRecord[]): Promise<Record<string, number>> {
  const entries = await Promise.all(records.map(async (r) => {
    const total = r.material.subtitle?.sentenceCount ?? 0
    const progress = await getProgress(r.material.id)
    const played = progress ? new Set(progress.playedSentenceIndexes).size : 0
    return [r.material.id, total > 0 ? Math.min(100, Math.round((played / total) * 100)) : 0] as const
  }))
  return Object.fromEntries(entries)
}

function lastLabel(lastOpenedAt: number): string {
  if (!lastOpenedAt) return '从未学习'
  const days = Math.floor((Date.now() - lastOpenedAt) / 86400000)
  if (days <= 0) return '今天学过'
  if (days === 1) return '昨天学过'
  return `${days} 天前`
}

function Library() {
  const [query, setQuery] = useState('')
  const { ready, records } = useStore(materialStore)
  const [percents, setPercents] = useState<Record<string, number>>({})
  useEffect(() => { initMaterials().catch(() => { /* 存储层已内存兜底，不会 reject 到此处之外 */ }) }, [])
  useEffect(() => {
    if (!ready) return
    let alive = true
    loadProgressPercents(records).then((p) => { if (alive) setPercents(p) }).catch(() => { /* ignore */ })
    return () => { alive = false }
  }, [ready, records])
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确认删除「${name}」？媒体文件与相关学习记录将一并删除。`)) return
    await removeMaterial(id)
  }
  const list = records.filter(m => m.material.name.includes(query))
  return <Shell><div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8"><PageIntro title="材料库"><div className="flex gap-2"><Link to="/tts"><Button variant="outline"><WandSparkles data-icon="inline-start" />Text‑to‑Speech</Button></Link><Link to="/transcribe"><Button variant="outline"><FileAudio data-icon="inline-start" />Speech‑to‑Text</Button></Link><Link to="/import"><Button><Plus data-icon="inline-start" />导入材料</Button></Link></div></PageIntro><div className="mb-8 flex flex-col gap-4 rounded-2xl border bg-card p-4 md:flex-row md:items-center md:justify-between"><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索材料名称…" className="max-w-md" /><div className="flex items-center gap-2 text-sm text-muted-foreground">最近学习 <ChevronDown /></div></div>{!ready ? <Card className="flex min-h-64 items-center justify-center"><p className="text-muted-foreground">正在加载材料库…</p></Card> : records.length === 0 ? <Card className="flex min-h-64 items-center justify-center"><div className="text-center"><p className="font-serif text-2xl">还没有学习材料</p><p className="mt-2 text-muted-foreground">导入一份音视频 + 字幕，开始逐句精听。</p><Link to="/import"><Button className="mt-6"><Plus data-icon="inline-start" />立即导入</Button></Link></div></Card> : list.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{list.map(r => <MaterialCard item={r.material} key={r.material.id} progress={percents[r.material.id] ?? 0} lastLabel={lastLabel(r.material.lastOpenedAt)} onDelete={() => handleDelete(r.material.id, r.material.name)} />)}</div> : <Card className="flex min-h-64 items-center justify-center"><div className="text-center"><p className="font-serif text-2xl">还没有找到材料</p><p className="mt-2 text-muted-foreground">试试其他关键词，或导入一份新材料。</p></div></Card>}</div></Shell>
}

export { Library }
