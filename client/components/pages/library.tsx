import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, FileAudio, Plus, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Shell, PageIntro } from '@/components/shared/shell'
import { CollectionCard, MaterialCard, MaterialMoveDialog, lastLabel, loadProgressPercents } from '@/components/shared/player-parts'
import { createCollection, initMaterials, materialStore, removeMaterial } from '@/stores/material-store'
import { useStore } from '@/stores/store'
import type { MaterialRecord } from '@/platform/storage/schema'

function Library() {
  const [query, setQuery] = useState('')
  const { ready, records, collections } = useStore(materialStore)
  const [percents, setPercents] = useState<Record<string, number>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [moveTarget, setMoveTarget] = useState<MaterialRecord | null>(null)
  useEffect(() => { initMaterials().catch(() => { /* 存储层已内存兜底，不会 reject 到此处之外 */ }) }, [])
  useEffect(() => {
    if (!ready) return
    let alive = true
    loadProgressPercents(records).then((p) => { if (alive) setPercents(p) }).catch(() => { /* ignore */ })
    return () => { alive = false }
  }, [ready, records])
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确认删除「${name}」？媒体文件与相关学习记录将一并删除。`)) return
    // 失败必须可见（c024）：removeMaterial 上抛（quota/事务 abort）时 UI 零反馈会让
    // 用户以为没点上而反复点击；onClick 还丢过这个 promise（unhandled rejection）
    try {
      await removeMaterial(id)
    } catch (e) {
      console.error('[library] 删除材料失败:', e)
      window.alert(`删除「${name}」失败：存储写入出错，材料未被删除。请检查磁盘空间后重试。`)
    }
  }
  // 分组派生：只按现存集合分组；无归属（旧记录/null）与陈旧 ID 一律归入未分组
  const validIds = new Set(collections.map((c) => c.id))
  const ungrouped = records.filter((r) => !r.material.collectionId || !validIds.has(r.material.collectionId))
  const membersOf = (collectionId: string) => records.filter((r) => r.material.collectionId === collectionId)
  // 搜索态：跨全部集合平铺搜材料 + 集合名匹配
  const searching = query !== ''
  const matchedCollections = searching ? collections.filter((c) => c.name.includes(query)) : []
  const matchedRecords = searching ? records.filter((m) => m.material.name.includes(query)) : []
  // 新建材料集校验：trim 非空 + 不与现存集合重名
  const trimmed = createName.trim()
  const createDuplicate = !!trimmed && collections.some((c) => c.name === trimmed)
  const openCreate = () => { setCreateName(''); setCreateOpen(true) }
  const handleCreate = async () => {
    if (!trimmed || createDuplicate) return
    await createCollection(trimmed)
    setCreateOpen(false)
    setCreateName('')
  }
  const collectionCards = (list: typeof collections) => list.map((c) => {
    const members = membersOf(c.id)
    return <CollectionCard key={c.id} collection={c} count={members.length} lastLabel={members.length ? lastLabel(members[0].material.lastOpenedAt) : '尚未使用'} />
  })
  const materialCards = (list: typeof records) => list.map((r) => (
    <MaterialCard item={r.material} key={r.material.id} progress={percents[r.material.id] ?? 0} lastLabel={lastLabel(r.material.lastOpenedAt)} onDelete={() => handleDelete(r.material.id, r.material.name)} onMove={() => setMoveTarget(r)} />
  ))
  return (
    <Shell>
      <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8">
        <PageIntro title="材料库">
          <div className="flex gap-2">
            <Link to="/tts"><Button variant="outline"><WandSparkles data-icon="inline-start" />TTS</Button></Link>
            <Link to="/transcribe"><Button variant="outline"><FileAudio data-icon="inline-start" />STT</Button></Link>
            <Link to="/import"><Button><Plus data-icon="inline-start" />导入材料</Button></Link>
          </div>
        </PageIntro>
        <div className="mb-8 flex flex-col gap-4 rounded-2xl border bg-card p-4 md:flex-row md:items-center md:justify-between">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索材料名称…" className="max-w-md" />
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">最近学习 <ChevronDown /></span>
            <Button variant="outline" size="sm" onClick={openCreate}><Plus data-icon="inline-start" />新建材料集</Button>
          </div>
        </div>
        {!ready ? (
          <Card className="flex min-h-64 items-center justify-center"><p className="text-muted-foreground">正在加载材料库…</p></Card>
        ) : records.length === 0 && collections.length === 0 ? (
          <Card className="flex min-h-64 items-center justify-center"><div className="text-center"><p className="font-serif text-2xl">还没有学习材料</p><p className="mt-2 text-muted-foreground">导入一份音视频 + 字幕，开始逐句精听。</p><Link to="/import"><Button className="mt-6"><Plus data-icon="inline-start" />立即导入</Button></Link></div></Card>
        ) : searching ? (
          matchedCollections.length === 0 && matchedRecords.length === 0 ? (
            <Card className="flex min-h-64 items-center justify-center"><div className="text-center"><p className="font-serif text-2xl">还没有找到材料</p><p className="mt-2 text-muted-foreground">试试其他关键词，或导入一份新材料。</p></div></Card>
          ) : (
            <>
              {matchedCollections.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-sm font-medium">材料集</h2>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{collectionCards(matchedCollections)}</div>
                </section>
              )}
              {matchedRecords.length > 0 && (
                <section>
                  {matchedCollections.length > 0 && <h2 className="mb-3 text-sm font-medium">材料</h2>}
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{materialCards(matchedRecords)}</div>
                </section>
              )}
            </>
          )
        ) : (
          <>
            {collections.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-sm font-medium">材料集</h2>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  {collectionCards(collections)}
                  <button type="button" onClick={openCreate} className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                    <Plus className="size-6" />
                    <span className="text-sm">新建材料集</span>
                  </button>
                </div>
              </section>
            )}
            {collections.length > 0 && <h2 className="mb-3 text-sm font-medium">未分组（{ungrouped.length}）</h2>}
            {ungrouped.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{materialCards(ungrouped)}</div>
            ) : collections.length > 0 ? (
              <p className="text-sm text-muted-foreground">没有未分组材料</p>
            ) : null}
          </>
        )}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogHeader>
            <DialogTitle>新建材料集</DialogTitle>
            <DialogDescription>为材料建立分组，方便整理与查找。</DialogDescription>
          </DialogHeader>
          <DialogContent>
            <div className="flex flex-col gap-3">
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} maxLength={30} placeholder="材料集名称" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }} />
              {createDuplicate && <p className="text-sm text-destructive">已存在同名材料集</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button onClick={() => void handleCreate()} disabled={!trimmed || createDuplicate}>创建</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <MaterialMoveDialog target={moveTarget} onClose={() => setMoveTarget(null)} />
      </div>
    </Shell>
  )
}

export { Library }
