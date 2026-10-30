import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Shell, PageIntro } from '@/components/shared/shell'
import { MaterialCard, MaterialMoveDialog, lastLabel, loadProgressPercents } from '@/components/shared/player-parts'
import { initMaterials, materialStore, removeCollection, removeMaterial, renameCollection } from '@/stores/material-store'
import { useStore } from '@/stores/store'
import type { MaterialRecord } from '@/platform/storage/schema'

/**
 * 材料集详情（P0 材料库二级页）：列出集内材料，支持添加/移动/移出、重命名与删除材料集。
 * 删除集合仅解除归属（材料回到未分组），材料本身与其数据不动。
 */
function CollectionDetail() {
  const { collectionId = '' } = useParams()
  const navigate = useNavigate()
  const { ready, records, collections } = useStore(materialStore)
  const [percents, setPercents] = useState<Record<string, number>>({})
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [moveTarget, setMoveTarget] = useState<MaterialRecord | null>(null)

  useEffect(() => { initMaterials().catch(() => { /* 存储层已内存兜底，不会 reject 到此处之外 */ }) }, [])
  useEffect(() => {
    if (!ready) return
    let alive = true
    loadProgressPercents(records).then((p) => { if (alive) setPercents(p) }).catch(() => { /* ignore */ })
    return () => { alive = false }
  }, [ready, records])

  const collection = collections.find((c) => c.id === collectionId)
  // records 已按最近学习排序，成员保持该顺序
  const members = records.filter((r) => r.material.collectionId === collectionId)

  const renameTrimmed = renameValue.trim()
  const renameDuplicate = collections.some((c) => c.id !== collectionId && c.name === renameTrimmed)
  const openRename = () => { setRenameValue(collection?.name ?? ''); setRenameOpen(true) }
  const handleRename = async () => {
    if (!collection || !renameTrimmed || renameDuplicate) return
    await renameCollection(collection.id, renameTrimmed)
    setRenameOpen(false)
  }
  const handleDeleteCollection = async () => {
    if (!collection) return
    if (!window.confirm(`确定删除材料集「${collection.name}」？材料不会删除，将移回「未分组」。`)) return
    navigate('/', { replace: true }) // 先离开，避免集合消失后本页闪现"不存在"空态
    await removeCollection(collection.id)
  }
  const handleDeleteMaterial = async (id: string, name: string) => {
    if (!window.confirm(`确认删除「${name}」？媒体文件与相关学习记录将一并删除。`)) return
    await removeMaterial(id)
  }
  const openMove = (r: MaterialRecord) => { setMoveTarget(r) }

  if (!ready) {
    return <Shell><div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8"><Card className="flex min-h-64 items-center justify-center"><p className="text-muted-foreground">正在加载材料集…</p></Card></div></Shell>
  }
  if (!collection) {
    return <Shell><div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8"><Card className="flex min-h-64 items-center justify-center"><div className="text-center"><p className="font-serif text-2xl">材料集不存在或已被删除</p><p className="mt-2 text-muted-foreground">它可能已在其他页面被删除。</p><Link to="/"><Button variant="outline" className="mt-6">返回材料库</Button></Link></div></Card></div></Shell>
  }

  return (
    <Shell back>
      <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8">
        <PageIntro title={collection.name} eyebrow="MATERIAL COLLECTION">
          <div className="flex gap-2">
            <Link to={`/import?collection=${collectionId}`}><Button><Plus data-icon="inline-start" />添加材料</Button></Link>
            <Button variant="outline" onClick={openRename}>重命名</Button>
            <Button variant="outline" onClick={() => void handleDeleteCollection()}>删除材料集</Button>
          </div>
        </PageIntro>
        {members.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {members.map((r) => (
              <MaterialCard
                key={r.material.id}
                item={r.material}
                progress={percents[r.material.id] ?? 0}
                lastLabel={lastLabel(r.material.lastOpenedAt)}
                onDelete={() => void handleDeleteMaterial(r.material.id, r.material.name)}
                onMove={() => openMove(r)}
              />
            ))}
          </div>
        ) : (
          <Card className="flex min-h-64 items-center justify-center"><div className="text-center"><p className="font-serif text-2xl">这个材料集还是空的</p><p className="mt-2 text-muted-foreground">从材料库导入，或把已有材料移动进来。</p><Link to={`/import?collection=${collectionId}`}><Button className="mt-6"><Plus data-icon="inline-start" />去导入材料</Button></Link></div></Card>
        )}

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogHeader>
            <DialogTitle>重命名材料集</DialogTitle>
            <DialogDescription>修改「{collection.name}」的名称。</DialogDescription>
          </DialogHeader>
          <DialogContent>
            <div className="flex flex-col gap-3">
              <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={30} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleRename() }} />
              {renameTrimmed && renameDuplicate && <p className="text-sm text-destructive">已存在同名材料集</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
                <Button onClick={() => void handleRename()} disabled={!renameTrimmed || renameDuplicate}>保存</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <MaterialMoveDialog target={moveTarget} onClose={() => setMoveTarget(null)} />
      </div>
    </Shell>
  )
}

export { CollectionDetail }
