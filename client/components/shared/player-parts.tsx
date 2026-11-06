import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, Download, FileText, Folder, FolderInput, Gauge, Languages, Pause, Pencil, Play, RotateCcw, SkipBack, SkipForward, Sparkles, Star, StickyNote, Subtitles, Trash2, Upload, Volume2, VolumeX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { assignMaterialCollection, createCollection, materialStore } from '@/stores/material-store'
import { useStore } from '@/stores/store'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEY_PREFIXES, type MaterialRecord } from '@/platform/storage/schema'
import type { Material, MaterialCollection } from '@/types/material'
import { formatElapsed } from '@/core/training/scoring'
import type { SubtitleMode, SubtitleSentence } from '@/types/subtitle'

/** 材料展示型字段（封面底色）不进数据模型，由组件按 id 派生；
 *  进度/最近学习是真实数据（MaterialCard props 必传，不再回落演示假值） */
const materialColorById: Record<string, string> = {
  'mock-001': 'bg-primary/10',
  ted: 'bg-accent',
  bbc: 'bg-secondary',
  movie: 'bg-muted',
}
function getMaterialDisplay(id: string) { return { color: materialColorById[id] ?? 'bg-muted' } }
/** mm:ss 格式化：唯一实现在 core/training/scoring.ts（截断到秒，不四舍五入） */
export function formatDuration(durationMs: number) {
  return formatElapsed(durationMs)
}

/** "最近学习"文案（材料库 / 材料集详情共用） */
function lastLabel(lastOpenedAt: number): string {
  if (!lastOpenedAt) return '从未学习'
  const days = Math.floor((Date.now() - lastOpenedAt) / 86400000)
  if (days <= 0) return '今天学过'
  if (days === 1) return '昨天学过'
  return `${days} 天前`
}

/** 进度百分比 = playedSentenceIndexes 去重数 / 总句数（真源：docs/原型设计.md P0 学习进度条） */
async function loadProgressPercents(records: MaterialRecord[]): Promise<Record<string, number>> {
  // records v3 批量读（评审 #57）：原每材料一次独立 getProgress 事务，
  // 50 份材料首屏挂 50 个各自开事务的读；前缀区间单事务即可构建同样映射
  const prefix = RECORD_KEY_PREFIXES.progress
  const progressEntries = await recordsStore.getAllEntriesByPrefix(prefix)
  const playedByMaterial = new Map<string, number>()
  for (const [key, value] of progressEntries) {
    const progress = value as { playedSentenceIndexes?: unknown } | null
    const played = Array.isArray(progress?.playedSentenceIndexes) ? new Set(progress.playedSentenceIndexes).size : 0
    playedByMaterial.set(key.slice(prefix.length), played)
  }
  return Object.fromEntries(records.map((r) => {
    const total = r.material.subtitle?.sentenceCount ?? 0
    const played = playedByMaterial.get(r.material.id) ?? 0
    return [r.material.id, total > 0 ? Math.min(100, Math.round((played / total) * 100)) : 0] as const
  }))
}

/**
 * 材料卡片。进度/最近学习为真实数据（props 必传，由播放过的句数与 lastOpenedAt 派生）。
 * hover 时可选显示删除按钮。
 */
function MaterialCard({ item, progress, lastLabel, onDelete, onMove }: { item: Material; progress: number; lastLabel: string; onDelete?: () => void; onMove?: () => void }) { const display = getMaterialDisplay(item.id); const pct = progress; const last = lastLabel; return <Link to={`/player/${item.id}`} className="group relative block">{(onDelete || onMove) && <div className="absolute right-3 top-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">{onMove && <Button variant="secondary" size="icon" aria-label={`移动材料 ${item.name}`} title="移动到材料集" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMove() }}><FolderInput /></Button>}{onDelete && <Button variant="secondary" size="icon" aria-label={`删除材料 ${item.name}`} title="删除" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}><Trash2 /></Button>}</div>}<Card className="h-full overflow-hidden transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg"><div className={`flex h-32 items-center justify-center ${display.color}`}><span className="text-5xl text-primary/70">{item.mediaType === 'video' ? '▣' : '◉'}</span></div><CardHeader className="gap-2"><div className="flex items-start justify-between gap-2"><CardTitle className="text-lg">{item.name}</CardTitle>{pct === 100 && <Badge variant="secondary"><Check data-icon="inline-start" />已完成</Badge>}</div><CardDescription>{item.mediaType === 'video' ? '视频' : '音频'} · {item.subtitle?.isBilingual ? '双语' : '仅英文'} · {formatDuration(item.durationMs)}</CardDescription></CardHeader><CardContent><Progress value={pct} /><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{pct ? `${pct}% 已完成` : '尚未开始'}</span><span>{last}</span></div></CardContent></Card></Link> }

/**
 * 材料集卡片。count/lastLabel 由调用方按成员派生（records 已按最近学习排序，取首个成员）。
 */
function CollectionCard({ collection, count, lastLabel }: { collection: MaterialCollection; count: number; lastLabel: string }) { return <Link to={`/collection/${collection.id}`} className="group block"><Card className="h-full overflow-hidden transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg"><div className="flex h-32 items-center justify-center bg-accent"><Folder className="size-10 text-primary/70" /></div><CardHeader className="gap-2"><CardTitle className="text-lg">{collection.name}</CardTitle><CardDescription>{count} 个材料</CardDescription></CardHeader><CardContent><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{lastLabel}</span><ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" /></div></CardContent></Card></Link> }

/** 选择器中「＋ 新建材料集…」选项的哨兵值 */
const NEW_COLLECTION = '__new__'
/** 选择器中「未分组（移出材料集）」选项的哨兵值 —— 不能用 ''：'' 同时是"未选择"，会被守卫拦下 */
const UNGROUPED = '__ungrouped__'

/**
 * 移动材料弹窗（材料库未分组区/搜索结果、材料集详情共用）：
 * 目标 = 其他集合 / 未分组（仅当材料已在集合内，显示"移出"）/ 现场新建集合。
 * 未选目标时确定禁用；目标集合已被删（陈旧 ID）时 store 侧静默不写。
 */
function MaterialMoveDialog({ target, onClose }: { target: MaterialRecord | null; onClose: () => void }) {
  const { collections } = useStore(materialStore)
  const [choice, setChoice] = useState('')
  const [newName, setNewName] = useState('')
  useEffect(() => { setChoice(''); setNewName('') }, [target])
  if (!target) return null
  const currentId = target.material.collectionId ?? null
  const confirmMove = async () => {
    if (!choice || (choice === NEW_COLLECTION && !newName.trim())) return
    const materialId = target.material.id
    onClose()
    if (choice === NEW_COLLECTION) {
      const created = await createCollection(newName.trim())
      await assignMaterialCollection(materialId, created.id)
    } else if (choice === UNGROUPED) {
      await assignMaterialCollection(materialId, null) // 哨兵 → 移出到未分组（store 契约：null 才是移出）
    } else {
      await assignMaterialCollection(materialId, choice)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogHeader>
        <DialogTitle>移动材料</DialogTitle>
        <DialogDescription>「{target.material.name}」移动到…</DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="flex flex-col gap-3">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {currentId !== null && <option value={UNGROUPED}>未分组（移出材料集）</option>}
            {collections.filter((c) => c.id !== currentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW_COLLECTION}>＋ 新建材料集…</option>
          </select>
          {choice === NEW_COLLECTION && (
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={30} placeholder="材料集名称" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) void confirmMove() }} />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={() => void confirmMove()} disabled={!choice || (choice === NEW_COLLECTION && !newName.trim())}>确定</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 播放控制条。布局与视觉冻结，数据增强：
 *  - 进度条读真实 currentMs/durationMs，支持指针拖拽 seek（保持 h-2 圆角视觉）；
 *  - 倍速循环按钮（0.5/0.75/1.0/1.25/1.5/2.0）；A-B 单句循环 关→1→3→∞；
 *  - disabled（演示材料无音频）时全部置灰。
 *  - 音量：竖向滑条面板向上弹出，三种入口——点按喇叭图标开关（移动端主入口）、
 *    悬停音量区跟随显示（PC）、按住图标上下拖动直调（拖动松开后不触发开关）；
 *    面板内含滑条（↑↓/Home/End 键盘可调）与静音按钮，点面板外自动关闭。
 *    注意：滑条面板 wrapper 的 pb-2 是 hover 桥接（垫住图标与面板间的空隙），勿改回 mb-2。
 *  - 字幕模式：点按弹「上拉菜单」直接勾选（双语材料：双语/仅英文/仅中文；纯英文
 *    字幕：开/关），点面板外或按 Esc 关闭 —— 取代原先的循环点按切换。
 */
function PlayerControlBar({ playing, setPlaying, mode, setMode, loop, setLoop, sentenceIndex, setSentenceIndex, items, currentMs = 0, durationMs = 0, onSeek, rate = 1, onRateCycle, volume = 1, onVolumeChange, disabled = false, isBilingual = true }: { playing:boolean; setPlaying:(v:boolean)=>void; mode:SubtitleMode; setMode:(v:SubtitleMode)=>void; loop:number; setLoop:(v:number)=>void; sentenceIndex:number; setSentenceIndex:(v:number)=>void; items: SubtitleSentence[]; currentMs?: number; durationMs?: number; onSeek?: (ms:number)=>void; rate?: number; onRateCycle?: ()=>void; volume?: number; onVolumeChange?: (v:number)=>void; disabled?: boolean; isBilingual?: boolean }) { const [volumeDragOpen, setVolumeDragOpen] = useState(false); const [volumePanelOpen, setVolumePanelOpen] = useState(false); const [modeMenuOpen, setModeMenuOpen] = useState(false); const modeAreaRef = useRef<HTMLDivElement | null>(null); const volumeDragRef = useRef<{ startY: number; startVolume: number; moved: boolean } | null>(null); const volumeClickSkipRef = useRef(false); const volumeAreaRef = useRef<HTMLDivElement | null>(null); useEffect(() => { if (!volumePanelOpen) return; const closeOnOutsidePointerDown = (ev: PointerEvent) => { if (!volumeAreaRef.current?.contains(ev.target as Node)) setVolumePanelOpen(false) }; document.addEventListener('pointerdown', closeOnOutsidePointerDown, true); return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true) }, [volumePanelOpen]); useEffect(() => { if (!modeMenuOpen) return; const closeModeMenu = (ev: PointerEvent) => { if (!modeAreaRef.current?.contains(ev.target as Node)) setModeMenuOpen(false) }; const closeModeMenuOnKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModeMenuOpen(false) }; document.addEventListener('pointerdown', closeModeMenu, true); document.addEventListener('keydown', closeModeMenuOnKey); return () => { document.removeEventListener('pointerdown', closeModeMenu, true); document.removeEventListener('keydown', closeModeMenuOnKey) } }, [modeMenuOpen]); const modeOptions: { value: SubtitleMode; label: string }[] = isBilingual ? [{ value: 'bilingual', label: '双语' }, { value: 'english', label: '仅英文' }, { value: 'chinese', label: '仅中文' }] : [{ value: 'english', label: '开' }, { value: 'chinese', label: '关' }]; const activeMode = !isBilingual && mode === 'bilingual' ? 'english' : mode; const modeLabel = modeOptions.find((o) => o.value === activeMode)?.label ?? '双语'; const next = () => setSentenceIndex(Math.min(items.length - 1, sentenceIndex + 1)); const prev = () => setSentenceIndex(Math.max(0, sentenceIndex - 1)); const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0; const loopLabel = loop === Number.POSITIVE_INFINITY ? '∞' : loop > 0 ? `${loop}次` : ''; const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => { if (disabled || !onSeek || durationMs <= 0) return; const rect = e.currentTarget.getBoundingClientRect(); const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)); onSeek(Math.round(ratio * durationMs)) }; const VOLUME_TRACK_PX = 112; const volumeFromPointer = (e: React.PointerEvent<HTMLDivElement>) => { if (disabled || !onVolumeChange) return; const rect = e.currentTarget.getBoundingClientRect(); const ratio = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)); onVolumeChange(Math.round(ratio * 100) / 100) }; const toggleMute = () => { if (!onVolumeChange) return; onVolumeChange(volume > 0 ? 0 : 1) }; const onVolumeButtonPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => { if (disabled || !onVolumeChange) return; volumeDragRef.current = { startY: e.clientY, startVolume: volume, moved: false }; e.currentTarget.setPointerCapture(e.pointerId) }; const onVolumeButtonPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => { const drag = volumeDragRef.current; if (!drag || disabled || !onVolumeChange) return; const dy = drag.startY - e.clientY; if (!drag.moved) { if (Math.abs(dy) < 6) return; drag.moved = true; setVolumeDragOpen(true) } const next = Math.min(1, Math.max(0, drag.startVolume + dy / VOLUME_TRACK_PX)); onVolumeChange(Math.round(next * 100) / 100) }; const onVolumeButtonPointerUp = () => { if (volumeDragRef.current?.moved) volumeClickSkipRef.current = true; volumeDragRef.current = null; setVolumeDragOpen(false) }; const onVolumeButtonPointerCancel = () => { volumeDragRef.current = null; setVolumeDragOpen(false) }; const handleVolumeButtonClick = () => { if (volumeClickSkipRef.current) { volumeClickSkipRef.current = false; return } setVolumePanelOpen(v => !v) }; const nudgeVolume = (delta: number) => { if (!onVolumeChange) return; onVolumeChange(Math.round(Math.min(1, Math.max(0, volume + delta)) * 100) / 100) }; return <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/75 p-4 backdrop-blur-xl"><div className="flex items-center gap-3"><span className="text-xs text-white/70 tabular-nums">{formatDuration(currentMs)}</span><div role="slider" aria-label="播放进度" aria-valuemin={0} aria-valuemax={durationMs} aria-valuenow={currentMs} tabIndex={disabled ? -1 : 0} className="h-2 flex-1 cursor-pointer rounded-full bg-white/20" style={{ touchAction: 'none' }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromPointer(e) }} onPointerMove={(e) => { if (e.buttons > 0) seekFromPointer(e) }}><div className="h-full rounded-full bg-white/85" style={{ width: `${pct}%` }} /></div><span className="text-xs text-white/70 tabular-nums">{formatDuration(durationMs)}</span></div><div className="flex flex-wrap items-center justify-center gap-2 [&_button]:text-white/80 [&_button]:border-white/20 [&_button]:bg-transparent [&_button:hover]:text-white [&_button:hover]:bg-white/15 [&_button:hover]:border-white/30"><Button variant="outline" size="icon" onClick={prev} disabled={disabled || sentenceIndex === 0} aria-label="上一句"><SkipBack /></Button><Button size="icon" className="size-12 rounded-full !bg-white !text-black hover:!bg-white/90" onClick={() => setPlaying(!playing)} disabled={disabled} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" onClick={next} disabled={disabled || items.length === 0 || sentenceIndex === items.length - 1} aria-label="下一句"><SkipForward /></Button><Button variant={loop ? 'secondary' : 'ghost'} onClick={() => setLoop(loop === 0 ? 1 : loop === 1 ? 3 : loop === 3 ? Number.POSITIVE_INFINITY : 0)} disabled={disabled || items.length === 0}><RotateCcw data-icon="inline-start" />单句循环{loop ? ` ${loopLabel}` : ''}</Button><Button variant="outline" onClick={onRateCycle} disabled={disabled} aria-label={`倍速 ${rate}x`}><Gauge data-icon="inline-start" />{rate}x</Button><div className="group/vol relative flex items-center" ref={volumeAreaRef}><Button variant="ghost" size="icon" onClick={handleVolumeButtonClick} onPointerDown={onVolumeButtonPointerDown} onPointerMove={onVolumeButtonPointerMove} onPointerUp={onVolumeButtonPointerUp} onPointerCancel={onVolumeButtonPointerCancel} disabled={disabled || !onVolumeChange} aria-label={`音量 ${Math.round(volume * 100)}%`} aria-expanded={volumePanelOpen} title="音量（点按展开，上下拖动调节）" style={{ touchAction: 'none' }}>{volume > 0 ? <Volume2 /> : <VolumeX />}</Button>{onVolumeChange && !disabled && <div className={`absolute bottom-full left-1/2 z-10 -translate-x-1/2 pb-2 transition-opacity group-hover/vol:pointer-events-auto group-hover/vol:opacity-100 ${volumePanelOpen || volumeDragOpen ? 'pointer-events-auto opacity-100' : 'opacity-0 pointer-events-none'}`}><div className="flex w-10 flex-col items-center gap-1 rounded-2xl border border-white/10 bg-black/75 p-2 shadow-lg backdrop-blur-xl"><div role="slider" aria-label="音量" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(volume * 100)} tabIndex={0} className="relative h-28 w-1.5 cursor-pointer rounded-full bg-white/20" style={{ touchAction: 'none' }} onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); nudgeVolume(0.05) } else if (e.key === 'ArrowDown') { e.preventDefault(); nudgeVolume(-0.05) } else if (e.key === 'Home') { e.preventDefault(); onVolumeChange(0) } else if (e.key === 'End') { e.preventDefault(); onVolumeChange(1) } }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); volumeFromPointer(e) }} onPointerMove={(e) => { if (e.buttons > 0) volumeFromPointer(e) }}><div className="absolute bottom-0 w-full rounded-full bg-white/85" style={{ height: `${volume * 100}%` }} /></div><button type="button" onClick={toggleMute} className="flex size-6 shrink-0 items-center justify-center rounded-full" aria-label={volume > 0 ? '静音' : '取消静音'} title={volume > 0 ? '静音' : '取消静音'}>{volume > 0 ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}</button></div></div>}</div><div className="relative flex items-center" ref={modeAreaRef}><Button variant="outline" onClick={() => setModeMenuOpen(v => !v)} aria-haspopup="menu" aria-expanded={modeMenuOpen} title="字幕显示模式（点按选择）"><Subtitles data-icon="inline-start" />字幕：{modeLabel}</Button>{modeMenuOpen && <div className="absolute bottom-full right-0 z-10"><div role="menu" aria-label="字幕显示模式" className="flex w-32 flex-col gap-0.5 rounded-2xl border border-white/10 bg-black/75 p-1.5 shadow-lg backdrop-blur-xl">{modeOptions.map((opt) => <button key={opt.value} type="button" role="menuitemradio" aria-checked={activeMode === opt.value} onClick={() => { setMode(opt.value); setModeMenuOpen(false) }} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-sm ${activeMode === opt.value ? 'font-medium !bg-white/15 !text-white' : ''}`}>{opt.label}{activeMode === opt.value && <Check className="size-3.5 shrink-0" />}</button>)}</div></div>}</div></div></div> }

/**
 * 字幕列表。数据由 items 驱动；当前句高亮跟随：
 *  - active 变化时 scrollIntoView({block:'nearest'}) 自动滚动；
 *  - 用户手动滚动（wheel/touch/键盘）后暂停自动跟随 5s；
 *  - favoriteIndexes 中的句子显示 ★ 收藏标记。
 *  - onTranslate 为整篇翻译入口（单句翻译在字幕编辑弹窗内）。
 */
function SubtitleListImpl({ mode, active, onSelect, items, favoriteIndexes, noteIndexes, onOpenNote, onImportSubtitle, onAiConvert, onDeleteSentence, onEditSentence, onExportSubtitle, onTranslate, sentenceBusy = false }: { mode: SubtitleMode; active:number; onSelect:(i:number)=>void; items: SubtitleSentence[]; favoriteIndexes?: Set<number>; noteIndexes?: Set<number>; onOpenNote?: (index: number) => void; onImportSubtitle?: (file: File) => void; onAiConvert?: () => void; onDeleteSentence?: (index: number) => void; onEditSentence?: (index: number, sentence: SubtitleSentence) => void; onExportSubtitle?: () => void; onTranslate?: () => void; sentenceBusy?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const manualUntilRef = useRef(0)
  const programmaticRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (active < 0) return
    const el = itemRefs.current.get(active)
    const container = containerRef.current
    if (!el || !container) return
    if (Date.now() < manualUntilRef.current) return
    programmaticRef.current = true
    const elRect = el.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const elCenterInContainer = elRect.top - containerRect.top + container.scrollTop + elRect.height / 2
    const targetScrollTop = elCenterInContainer - containerRect.height / 2
    const maxScrollTop = container.scrollHeight - containerRect.height
    const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop))
    container.scrollTo({ top: clampedScrollTop, behavior: 'smooth' })
    window.setTimeout(() => { programmaticRef.current = false }, 300)
  }, [active])

  const markManual = () => { if (!programmaticRef.current) manualUntilRef.current = Date.now() + 5000 }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card max-lg:max-h-[80vh]">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="font-serif text-xl">字幕</h2>
        <div className="flex items-center gap-1">
          {onExportSubtitle && (
            <Button variant="ghost" size="icon-sm" title="导出字幕" onClick={onExportSubtitle}>
              <Download className="size-4" />
            </Button>
          )}
          {onImportSubtitle && (
            <>
              <input ref={fileInputRef} type="file" accept=".srt,.lrc" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { onImportSubtitle(f); e.target.value = '' } }} />
              <Button variant="ghost" size="icon-sm" title="导入字幕文件" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" />
              </Button>
            </>
          )}
          {onAiConvert && (
            <Button variant="ghost" size="icon-sm" title="AI音频转字幕" aria-label="AI音频转字幕" onClick={onAiConvert}>
              <Sparkles className="size-4" />
            </Button>
          )}
          {onTranslate && (
            <Button variant="ghost" size="icon-sm" title="翻译全部字幕" onClick={onTranslate}>
              <Languages className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <div ref={containerRef} onWheel={markManual} onTouchMove={markManual} className="relative flex-1 overflow-auto p-2">
        {items.length ? items.map((s, i) => (
          <div
            key={s.index}
            role="button"
            tabIndex={0}
            data-sentence-index={s.index}
            ref={(el) => { if (el) itemRefs.current.set(i, el); else itemRefs.current.delete(i) }}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) } }}
            className={`group/sentence relative w-full cursor-pointer rounded-xl p-4 text-left transition-colors ${active === i ? 'bg-ink/10 ring-1 ring-ink/25 dark:bg-ink/20 dark:ring-ink/35' : 'hover:bg-muted'}`}
          >
            {(onDeleteSentence || onEditSentence) && (
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/sentence:opacity-100 group-hover/sentence:opacity-100 pointer-coarse:opacity-100">
                {onEditSentence && (
                  <Button variant="secondary" size="icon" className="size-7" aria-label={`纠错句子 ${s.index + 1}`} title="纠错" disabled={sentenceBusy} onClick={(e) => { e.stopPropagation(); onEditSentence(i, s) }}>
                    <Pencil className="size-3.5" />
                  </Button>
                )}
                {onDeleteSentence && (
                  <Button variant="secondary" size="icon" className="size-7" aria-label={`删除句子 ${s.index + 1}`} title="删除" disabled={sentenceBusy} onClick={(e) => { e.stopPropagation(); onDeleteSentence(i) }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            )}
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground tabular-nums">
              <span className={`inline-flex w-4 justify-center ${active === i ? 'text-ink' : ''}`} aria-hidden={active === i}>
                {active === i ? <Play className="size-3 fill-current" /> : s.index + 1}
              </span>
              <span className={active === i ? 'text-ink' : ''}>{formatDuration(s.startMs)}</span>
              {favoriteIndexes?.has(s.index) && <Star aria-label="已收藏" className="size-3 fill-ink text-ink" />}
              {noteIndexes?.has(s.index) && onOpenNote && (
                <Button variant="secondary" size="icon" className="size-6" aria-label={`查看句子 ${s.index + 1} 的笔记`} title="查看笔记" onClick={(e) => { e.stopPropagation(); onOpenNote(s.index) }}>
                  <StickyNote className="size-3 text-ink" />
                </Button>
              )}
            </div>
            {(mode === 'bilingual' || mode === 'english') && <p className="whitespace-pre-line leading-relaxed">{s.textEn}</p>}
            {(mode === 'bilingual' || mode === 'chinese') && <p className="mt-1 whitespace-pre-line leading-relaxed text-muted-foreground">{s.textZh}</p>}
          </div>
        )) : (
          <div className="flex min-h-40 flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-sm text-muted-foreground">该材料暂无字幕</p>
          </div>
        )}
      </div>
    </section>
  )
}

/** 千句列表浅比较 memo：active/收藏/笔记/模式之外的渲染（如播放器其它 state）不再触发全列表 diff */
const SubtitleList = memo(SubtitleListImpl)

export { MaterialCard, CollectionCard, MaterialMoveDialog, PlayerControlBar, SubtitleList, lastLabel, loadProgressPercents }
