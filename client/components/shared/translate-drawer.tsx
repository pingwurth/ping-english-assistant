import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Languages, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetHeader, SheetTitle, SheetDescription, SheetContent, SheetFooter } from '@/components/ui/sheet'
import { translateTexts, detectDirection } from '@/lib/translate'
import type { SubtitleSentence } from '@/types/subtitle'
import type { TranslateDirection } from '@/types/api'

interface TranslateDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sentences: SubtitleSentence[]
  onApplyAll: (updated: SubtitleSentence[], direction: TranslateDirection) => void
}

/** 翻译配置项 */
interface TranslateConfig {
  id: string
  name: string
  translateModel: string
}

/** 单句翻译状态 */
type SentenceStatus = 'pending' | 'translating' | 'done' | 'error'

/** 语言方向标签 */
function directionLabel(d: TranslateDirection): string {
  return d === 'en2zh' ? 'English → 中文' : '中文 → English'
}

export function TranslateDrawer({ open, onOpenChange, sentences, onApplyAll }: TranslateDrawerProps) {
  // ── 所有状态在组件顶层声明，不依赖 open ──
  // 这样 Sheet 关闭（子树卸载）时状态仍然存活
  const [configs, setConfigs] = useState<TranslateConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [direction, setDirection] = useState<TranslateDirection>('en2zh')
  const [translations, setTranslations] = useState<string[]>([])
  const [sentenceStatuses, setSentenceStatuses] = useState<SentenceStatus[]>([])
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'translating' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const abortRef = useRef<AbortController | null>(null)
  /** 上一次句子列表签名，用于判断 sentences 内容是否真正变化 */
  const prevSentencesSigRef = useRef('')
  /** configs 是否已加载过（避免重复请求） */
  const configsLoadedRef = useRef(false)
  /** 上一次 globalStatus，用于检测 translating → done/error 转变 */
  const prevGlobalStatusRef = useRef<'idle' | 'translating' | 'done' | 'error'>('idle')
  /** toast 可见性 */
  const [toastVisible, setToastVisible] = useState(false)
  /** toast 正在淡出 */
  const [toastFading, setToastFading] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // ── 翻译模型配置：首次打开时加载一次，之后复用 ──
  useEffect(() => {
    if (!open || configsLoadedRef.current) return
    configsLoadedRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/settings/llm-configs')
        const data = await res.json()
        if (cancelled) return
        const tConfigs = (data.configs || [])
          .filter((c: { translateModel?: string }) => c.translateModel)
          .map((c: { id: string; name: string; translateModel: string }) => ({
            id: c.id,
            name: c.name,
            translateModel: c.translateModel,
          }))
        setConfigs(tConfigs)
        if (tConfigs.length > 0) {
          const defaultCfg = tConfigs.find((c: TranslateConfig) => c.id === data.defaultId) || tConfigs[0]
          setSelectedConfigId(defaultCfg.id)
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [open])

  // ── 检测语言方向；仅当句子列表内容真正变化时才重置翻译状态 ──
  useEffect(() => {
    if (sentences.length === 0) return
    const sig = sentences.map(s => `${s.index}:${s.textEn}:${s.textZh ?? ''}`).join('|')
    if (sig !== prevSentencesSigRef.current) {
      prevSentencesSigRef.current = sig
      const allTexts = sentences.flatMap(s => [s.textEn, s.textZh].filter(Boolean)) as string[]
      setDirection(detectDirection(allTexts))
      setTranslations(Array(sentences.length).fill(''))
      setSentenceStatuses(Array(sentences.length).fill('pending'))
      setGlobalStatus('idle')
      setError('')
      setProgress({ done: 0, total: 0 })
      abortRef.current?.abort()
    }
  }, [sentences])

  // ── 组件卸载时清理进行中的请求和定时器 ──
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      toastTimerRef.current.forEach(clearTimeout)
    }
  }, [])

  // ── 上一次 open 状态，用于检测 open false→true→false 的关闭动作 ──
  const prevOpenRef = useRef(open)

  // ── 检测翻译完成/出错：抽屉关闭时弹出 toast 提示 ──
  // 触发时机：
  //   1. 翻译刚好完成（translating→done/error）且抽屉已关闭
  //   2. 抽屉从打开变为关闭，且翻译已处于完成/出错状态
  useEffect(() => {
    const prevStatus = prevGlobalStatusRef.current
    const prevOpen = prevOpenRef.current
    prevGlobalStatusRef.current = globalStatus
    prevOpenRef.current = open

    const justFinished = prevStatus === 'translating' && (globalStatus === 'done' || globalStatus === 'error')
    const justClosed = prevOpen && !open
    const alreadyDone = globalStatus === 'done' || globalStatus === 'error'

    const shouldNotify = (justFinished && !open) || (justClosed && alreadyDone)
    if (!shouldNotify) return

    setToastVisible(true)
    setToastFading(false)

    // 清理旧定时器
    toastTimerRef.current.forEach(clearTimeout)
    toastTimerRef.current = []

    // 3s 后开始淡出
    const fadeTimer = setTimeout(() => setToastFading(true), 3000)
    // 淡出动画 300ms 后彻底隐藏
    const hideTimer = setTimeout(() => { setToastVisible(false); setToastFading(false) }, 3300)
    toastTimerRef.current = [fadeTimer, hideTimer]
  }, [globalStatus, open])

  /** 点击 toast → 打开抽屉并关闭 toast */
  const handleToastClick = useCallback(() => {
    toastTimerRef.current.forEach(clearTimeout)
    toastTimerRef.current = []
    setToastVisible(false)
    setToastFading(false)
    onOpenChange(true)
  }, [onOpenChange])

  /** 手动关闭 toast */
  const dismissToast = useCallback(() => {
    toastTimerRef.current.forEach(clearTimeout)
    toastTimerRef.current = []
    setToastVisible(false)
    setToastFading(false)
  }, [])

  // ── 全部翻译：启动后台翻译任务，不绑定 open 状态 ──
  const handleTranslateAll = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setGlobalStatus('translating')
    setError('')
    setProgress({ done: 0, total: sentences.length })
    setSentenceStatuses(Array(sentences.length).fill('translating'))
    setTranslations(Array(sentences.length).fill(''))

    try {
      const sourceTexts = sentences.map(s =>
        direction === 'en2zh' ? s.textEn : (s.textZh ?? s.textEn)
      )

      const results = await translateTexts(
        sourceTexts,
        selectedConfigId || undefined,
        direction,
        ctrl.signal,
        (done, total) => setProgress({ done, total }),
      )

      setTranslations(results)
      setSentenceStatuses(Array(sentences.length).fill('done'))
      setGlobalStatus('done')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '翻译失败')
      setGlobalStatus('error')
    }
  }, [sentences, selectedConfigId, direction])

  const handleApplyAll = useCallback(() => {
    const updated = sentences.map((s, i) => {
      if (!translations[i]) return s
      return direction === 'en2zh'
        ? { ...s, textZh: translations[i] }
        : { ...s, textEn: translations[i] }
    })
    onApplyAll(updated, direction)
    onOpenChange(false)
  }, [sentences, translations, direction, onApplyAll, onOpenChange])

  // ── 关闭时不中断翻译，仅通知父组件 ──
  const handleClose = useCallback((nextOpen: boolean) => {
    onOpenChange(nextOpen)
  }, [onOpenChange])

  const doneCount = sentenceStatuses.filter(s => s === 'done').length
  const hasTranslations = doneCount > 0
  const isToastError = globalStatus === 'error'

  return (
    <>
    {/* ── toast 通知：抽屉关闭期间翻译完成/出错时显示 ── */}
    <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    {toastVisible && (
      <button
        type="button"
        onClick={handleToastClick}
        className="fixed left-4 top-4 z-[100] flex max-w-sm items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-lg transition-opacity duration-300 hover:shadow-xl cursor-pointer"
        style={{ opacity: toastFading ? 0 : 1, animation: toastFading ? undefined : 'fadeIn 300ms ease-out' }}
      >
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${isToastError ? 'bg-destructive/15 text-destructive' : 'bg-green-500/15 text-green-600'}`}>
          {isToastError ? '!' : <Check className="size-4" />}
        </span>
        <span className="flex-1 text-sm font-medium">
          {isToastError ? '翻译出错' : `翻译完成（${sentences.length} 条字幕）`}
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="关闭"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
          onClick={(e) => { e.stopPropagation(); dismissToast() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); dismissToast() } }}
        >
          <X className="size-4" />
        </span>
      </button>
    )}

    {/* ── Sheet 仅在 open 时渲染 UI，状态由外层组件持有 ── */}
    {open && (
    <Sheet open onOpenChange={handleClose}>
      <SheetHeader>
        <SheetTitle>翻译全部字幕</SheetTitle>
        <SheetDescription>
          {sentences.length} 条字幕 · {directionLabel(direction)}
        </SheetDescription>
      </SheetHeader>

      <SheetContent>
        <div className="flex flex-col gap-4">
          {/* 控制区 */}
          <div className="flex flex-col gap-3 rounded-xl bg-muted p-4">
            <div className="flex items-center gap-3">
              <Languages className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">翻译设置</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedConfigId}
                onChange={e => setSelectedConfigId(e.target.value)}
                disabled={configs.length === 0}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              >
                {configs.length === 0 ? (
                  <option value="">未配置翻译模型</option>
                ) : (
                  configs.map(c => (
                    <option key={c.id} value={c.id}>{c.translateModel} · {c.name}</option>
                  ))
                )}
              </select>
              <span className="text-xs text-muted-foreground">{directionLabel(direction)}</span>
            </div>
            {configs.length === 0 && (
              <p className="text-xs text-destructive">请先在「设置 → 模型配置」中配置翻译模型</p>
            )}
            <Button
              size="sm"
              onClick={() => void handleTranslateAll()}
              disabled={configs.length === 0 || globalStatus === 'translating'}
            >
              {globalStatus === 'translating' ? (
                <><Loader2 className="mr-1 size-3 animate-spin" />翻译中… {progress.done}/{progress.total}</>
              ) : (
                '全部翻译'
              )}
            </Button>
          </div>

          {/* 错误提示 */}
          {globalStatus === 'error' && error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* 字幕镜像列表 */}
          <div className="flex flex-col gap-2">
            {sentences.map((s, i) => {
              const st = sentenceStatuses[i]
              const sourceText = direction === 'en2zh' ? s.textEn : (s.textZh ?? s.textEn)
              const translatedText = translations[i]
              return (
                <div key={s.index} className="rounded-xl border p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{s.index + 1}</span>
                    <span>{formatMs(s.startMs)}</span>
                    {st === 'done' && <Check className="size-3 text-green-500" />}
                    {st === 'translating' && <Loader2 className="size-3 animate-spin text-primary" />}
                    {st === 'error' && <span className="text-destructive">失败</span>}
                  </div>
                  <p className="text-sm leading-relaxed">{sourceText}</p>
                  {st === 'done' && translatedText && (
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{translatedText}</p>
                  )}
                  {st === 'translating' && (
                    <p className="mt-1 text-sm text-muted-foreground animate-pulse">翻译中…</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </SheetContent>

      <SheetFooter>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={handleApplyAll}
            disabled={!hasTranslations}
          >
            全部应用 {hasTranslations ? `(${doneCount}/${sentences.length})` : ''}
          </Button>
        </div>
      </SheetFooter>
    </Sheet>
    )}
    </>
  )
}

/** ms → "mm:ss" 格式 */
function formatMs(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
