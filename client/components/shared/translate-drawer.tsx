import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Languages, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetHeader, SheetTitle, SheetDescription, SheetContent, SheetFooter } from '@/components/ui/sheet'
import { translateTexts, detectDirection } from '@/lib/translate'
import type { SubtitleSentence } from '@/types/subtitle'
import type { TranslateDirection } from '@/types/api'

interface TranslateDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sentences: SubtitleSentence[]
  onApplyAll: (updated: SubtitleSentence[]) => void
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
  const [configs, setConfigs] = useState<TranslateConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [direction, setDirection] = useState<TranslateDirection>('en2zh')
  const [translations, setTranslations] = useState<string[]>([])
  const [sentenceStatuses, setSentenceStatuses] = useState<SentenceStatus[]>([])
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'translating' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const abortRef = useRef<AbortController | null>(null)

  // 加载翻译模型配置
  useEffect(() => {
    if (!open) return
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

  // 打开时自动检测语言方向、重置状态
  useEffect(() => {
    if (!open || sentences.length === 0) return
    const allTexts = sentences.flatMap(s => [s.textEn, s.textZh].filter(Boolean)) as string[]
    setDirection(detectDirection(allTexts))
    setTranslations(Array(sentences.length).fill(''))
    setSentenceStatuses(Array(sentences.length).fill('pending'))
    setGlobalStatus('idle')
    setError('')
    setProgress({ done: 0, total: 0 })
    abortRef.current?.abort()
  }, [open, sentences])

  const handleTranslateAll = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setGlobalStatus('translating')
    setError('')
    setProgress({ done: 0, total: sentences.length })

    // 重置所有状态为 translating
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
    onApplyAll(updated)
    onOpenChange(false)
  }, [sentences, translations, direction, onApplyAll, onOpenChange])

  const handleClose = useCallback((open: boolean) => {
    if (!open) abortRef.current?.abort()
    onOpenChange(open)
  }, [onOpenChange])

  const doneCount = sentenceStatuses.filter(s => s === 'done').length
  const hasTranslations = doneCount > 0

  return (
    <Sheet open={open} onOpenChange={handleClose}>
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
  )
}

/** ms → "mm:ss" 格式 */
function formatMs(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
