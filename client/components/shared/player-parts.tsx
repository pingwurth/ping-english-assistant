import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Download, FileText, Gauge, Languages, Pause, Pencil, Play, RotateCcw, SkipBack, SkipForward, Sparkles, Subtitles, Trash2, Upload, Volume2, VolumeX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { seedSentences } from '@/data/seed'
import type { Material } from '@/types/material'
import type { SubtitleMode, SubtitleSentence } from '@/types/subtitle'

const sentences = seedSentences

/** 材料展示型字段（color/progress/last）不进数据模型，由组件按 id 派生 */
const materialDisplayById: Record<string, { color: string; progress: number; last: string }> = {
  'mock-001': { color: 'bg-primary/10', progress: 65, last: '昨天学过' },
  'ted': { color: 'bg-accent', progress: 30, last: '2 天前' },
  'bbc': { color: 'bg-secondary', progress: 0, last: '从未学习' },
  'movie': { color: 'bg-muted', progress: 100, last: '已完成' },
}
function getMaterialDisplay(id: string) { return materialDisplayById[id] ?? { color: 'bg-muted', progress: 0, last: '尚未开始' } }
function formatDuration(durationMs: number) { return `${String(Math.floor(durationMs / 60000)).padStart(2, '0')}:${String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}` }

/**
 * 材料卡片。进度/最近学习为真实数据（props 传入，由播放过的句数派生）；
 * 未传时回落静态演示值（materialDisplayById）。hover 时可选显示删除按钮。
 */
function MaterialCard({ item, progress, lastLabel, onDelete }: { item: Material; progress?: number; lastLabel?: string; onDelete?: () => void }) { const display = getMaterialDisplay(item.id); const pct = progress ?? display.progress; const last = lastLabel ?? display.last; return <Link to={`/player/${item.id}`} className="group relative block">{onDelete && <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"><Button variant="secondary" size="icon" aria-label={`删除材料 ${item.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}><Trash2 /></Button></div>}<Card className="h-full overflow-hidden transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg"><div className={`flex h-32 items-center justify-center ${display.color}`}><span className="text-5xl text-primary/70">{item.mediaType === 'video' ? '▣' : '◉'}</span></div><CardHeader className="gap-2"><div className="flex items-start justify-between gap-2"><CardTitle className="text-lg">{item.name}</CardTitle>{pct === 100 && <Badge variant="secondary"><Check data-icon="inline-start" />已完成</Badge>}</div><CardDescription>{item.mediaType === 'video' ? '视频' : '音频'} · {item.subtitle?.isBilingual ? '双语' : '仅英文'} · {formatDuration(item.durationMs)}</CardDescription></CardHeader><CardContent><Progress value={pct} /><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{pct ? `${pct}% 已完成` : '尚未开始'}</span><span>{last}</span></div></CardContent></Card></Link> }

/**
 * 播放控制条。布局与视觉冻结，数据增强：
 *  - 进度条读真实 currentMs/durationMs，支持指针拖拽 seek（保持 h-2 圆角视觉）；
 *  - 倍速循环按钮（0.75/1.0/1.25）；A-B 单句循环 关→1→3→∞；
 *  - disabled（演示材料无音频）时全部置灰。
 */
function PlayerControlBar({ playing, setPlaying, mode, setMode, loop, setLoop, sentenceIndex, setSentenceIndex, items = sentences, currentMs = 0, durationMs = 0, onSeek, rate = 1, onRateCycle, volume = 1, onVolumeChange, disabled = false, isBilingual = true }: { playing:boolean; setPlaying:(v:boolean)=>void; mode:SubtitleMode; setMode:(v:SubtitleMode)=>void; loop:number; setLoop:(v:number)=>void; sentenceIndex:number; setSentenceIndex:(v:number)=>void; items?: SubtitleSentence[]; currentMs?: number; durationMs?: number; onSeek?: (ms:number)=>void; rate?: number; onRateCycle?: ()=>void; volume?: number; onVolumeChange?: (v:number)=>void; disabled?: boolean; isBilingual?: boolean }) { const modeLabel = !isBilingual ? (mode === 'chinese' ? '关' : '开') : mode === 'bilingual' ? '双语' : mode === 'english' ? '仅英文' : '仅中文'; const toggleMode = () => { if (!isBilingual) { setMode(mode === 'chinese' ? 'english' : 'chinese'); return } setMode(mode === 'bilingual' ? 'english' : mode === 'english' ? 'chinese' : 'bilingual') }; const next = () => setSentenceIndex(Math.min(items.length - 1, sentenceIndex + 1)); const prev = () => setSentenceIndex(Math.max(0, sentenceIndex - 1)); const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0; const loopLabel = loop === Number.POSITIVE_INFINITY ? '∞' : loop > 0 ? `${loop}次` : ''; const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => { if (disabled || !onSeek || durationMs <= 0) return; const rect = e.currentTarget.getBoundingClientRect(); const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)); onSeek(Math.round(ratio * durationMs)) }; const volumeFromPointer = (e: React.PointerEvent<HTMLDivElement>) => { if (disabled || !onVolumeChange) return; const rect = e.currentTarget.getBoundingClientRect(); const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)); onVolumeChange(Math.round(ratio * 100) / 100) }; const toggleMute = () => { if (!onVolumeChange) return; onVolumeChange(volume > 0 ? 0 : 1) }; return <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/75 p-4 backdrop-blur-xl"><div className="flex items-center gap-3"><span className="text-xs text-white/70 tabular-nums">{formatDuration(currentMs)}</span><div role="slider" aria-label="播放进度" aria-valuemin={0} aria-valuemax={durationMs} aria-valuenow={currentMs} tabIndex={disabled ? -1 : 0} className="h-2 flex-1 cursor-pointer rounded-full bg-white/20" style={{ touchAction: 'none' }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromPointer(e) }} onPointerMove={(e) => { if (e.buttons > 0) seekFromPointer(e) }}><div className="h-full rounded-full bg-white/85" style={{ width: `${pct}%` }} /></div><span className="text-xs text-white/70 tabular-nums">{formatDuration(durationMs)}</span></div><div className="flex flex-wrap items-center justify-center gap-2 [&_button]:text-white/80 [&_button]:border-white/20 [&_button]:bg-transparent [&_button:hover]:text-white [&_button:hover]:bg-white/15 [&_button:hover]:border-white/30"><Button variant="outline" size="icon" onClick={prev} disabled={disabled || sentenceIndex === 0} aria-label="上一句"><SkipBack /></Button><Button size="icon" className="size-12 rounded-full !bg-primary !text-primary-foreground hover:!bg-primary/90" onClick={() => setPlaying(!playing)} disabled={disabled} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" onClick={next} disabled={disabled || items.length === 0 || sentenceIndex === items.length - 1} aria-label="下一句"><SkipForward /></Button><Button variant={loop ? 'secondary' : 'ghost'} onClick={() => setLoop(loop === 0 ? 1 : loop === 1 ? 3 : loop === 3 ? Number.POSITIVE_INFINITY : 0)} disabled={disabled || items.length === 0}><RotateCcw data-icon="inline-start" />循环{loop ? ` ${loopLabel}` : ''}</Button><Button variant="outline" onClick={onRateCycle} disabled={disabled}><Gauge data-icon="inline-start" />倍速 {rate}x</Button><div className="flex items-center gap-2"><Button variant="ghost" size="icon" onClick={toggleMute} disabled={disabled || !onVolumeChange} aria-label={volume > 0 ? '静音' : '取消静音'}>{volume > 0 ? <Volume2 /> : <VolumeX />}</Button><div role="slider" aria-label="音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(volume * 100)} tabIndex={disabled || !onVolumeChange ? -1 : 0} className="h-2 w-20 cursor-pointer rounded-full bg-white/20" style={{ touchAction: 'none' }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); volumeFromPointer(e) }} onPointerMove={(e) => { if (e.buttons > 0) volumeFromPointer(e) }}><div className="h-full rounded-full bg-white/85" style={{ width: `${volume * 100}%` }} /></div></div><Button variant="outline" onClick={toggleMode}><Subtitles data-icon="inline-start" />字幕：{modeLabel}</Button></div></div> }

/**
 * 字幕列表。数据由 items 驱动；当前句高亮跟随：
 *  - active 变化时 scrollIntoView({block:'nearest'}) 自动滚动；
 *  - 用户手动滚动（wheel/touch/键盘）后暂停自动跟随 5s；
 *  - favoriteIndexes 中的句子显示 ★ 收藏标记。
 */
function SubtitleList({ mode, active, onSelect, items = sentences, favoriteIndexes, onImportSubtitle, onAiConvert, onDeleteSentence, onEditSentence, onExportSubtitle, onTranslate }: { mode: SubtitleMode; active:number; onSelect:(i:number)=>void; items?: SubtitleSentence[]; favoriteIndexes?: Set<number>; onImportSubtitle?: (file: File) => void; onAiConvert?: () => void; onDeleteSentence?: (index: number) => void; onEditSentence?: (index: number, sentence: SubtitleSentence) => void; onExportSubtitle?: () => void; onTranslate?: (scope: 'current' | 'all') => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const manualUntilRef = useRef(0)
  const programmaticRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const translateMenuRef = useRef<HTMLDivElement | null>(null)
  const [showTranslateMenu, setShowTranslateMenu] = useState(false)

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

  // 点击外部关闭翻译菜单
  useEffect(() => {
    if (!showTranslateMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (translateMenuRef.current && !translateMenuRef.current.contains(e.target as Node)) {
        setShowTranslateMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTranslateMenu])

  const markManual = () => { if (!programmaticRef.current) manualUntilRef.current = Date.now() + 5000 }

  const handleTranslateSelect = useCallback((scope: 'current' | 'all') => {
    setShowTranslateMenu(false)
    onTranslate?.(scope)
  }, [onTranslate])

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-serif text-xl">字幕</h2>
        <div className="flex items-center gap-1">
          {onExportSubtitle && (
            <Button variant="ghost" size="icon" title="导出字幕" onClick={onExportSubtitle}>
              <Download className="size-4" />
            </Button>
          )}
          {onImportSubtitle && (
            <>
              <input ref={fileInputRef} type="file" accept=".srt,.lrc" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { onImportSubtitle(f); e.target.value = '' } }} />
              <Button variant="ghost" size="icon" title="导入字幕文件" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" />
              </Button>
            </>
          )}
          {onAiConvert && (
            <Button variant="ghost" size="sm" title="AI音频转字幕" onClick={onAiConvert}>
              AI
            </Button>
          )}
          {onTranslate && (
            <div className="relative" ref={translateMenuRef}>
              <Button
                variant="ghost"
                size="icon"
                title="翻译字幕"
                onClick={() => setShowTranslateMenu(!showTranslateMenu)}
              >
                <Languages className="size-4" />
              </Button>
              {showTranslateMenu && (
                <div className="absolute right-0 z-50 mt-1 w-40 rounded-lg border bg-background shadow-lg">
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onMouseDown={(e) => { e.preventDefault(); handleTranslateSelect('current') }}
                  >
                    翻译当前句
                  </button>
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onMouseDown={(e) => { e.preventDefault(); handleTranslateSelect('all') }}
                  >
                    翻译全部字幕
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div ref={containerRef} onWheel={markManual} onTouchMove={markManual} className="flex-1 overflow-auto p-2">
        {items.length ? items.map((s, i) => (
          <div
            key={s.index}
            role="button"
            tabIndex={0}
            ref={(el) => { if (el) itemRefs.current.set(i, el); else itemRefs.current.delete(i) }}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) } }}
            className={`group/sentence relative w-full cursor-pointer rounded-xl p-4 text-left transition-colors ${active === i ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted'}`}
          >
            {(onDeleteSentence || onEditSentence) && (
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
                {onEditSentence && (
                  <Button variant="secondary" size="icon" className="size-7" aria-label={`纠错句子 ${s.index + 1}`} title="纠错" onClick={(e) => { e.stopPropagation(); onEditSentence(i, s) }}>
                    <Pencil className="size-3.5" />
                  </Button>
                )}
                {onDeleteSentence && (
                  <Button variant="secondary" size="icon" className="size-7" aria-label={`删除句子 ${s.index + 1}`} title="删除" onClick={(e) => { e.stopPropagation(); onDeleteSentence(i) }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            )}
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>{active === i ? '▶' : s.index + 1}</span>
              <span>{formatDuration(s.startMs)}</span>
              {favoriteIndexes?.has(s.index) && <span aria-label="已收藏" className="text-primary">★</span>}
            </div>
            {(mode === 'bilingual' || mode === 'english') && <p className="leading-relaxed">{s.textEn}</p>}
            {(mode === 'bilingual' || mode === 'chinese') && <p className="mt-1 leading-relaxed text-muted-foreground">{s.textZh}</p>}
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

export { MaterialCard, PlayerControlBar, SubtitleList, formatDuration }
