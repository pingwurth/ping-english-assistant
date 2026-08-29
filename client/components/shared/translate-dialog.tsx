import { useCallback, useEffect, useRef, useState } from 'react'
import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog'
import { translateTexts, detectDirection } from '@/lib/translate'
import type { SubtitleSentence } from '@/types/subtitle'
import type { TranslateDirection } from '@/types/api'

interface TranslateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sentence: SubtitleSentence | null
  onApply: (updated: SubtitleSentence) => void
}

/** 翻译配置项 */
interface TranslateConfig {
  id: string
  name: string
  translateModel: string
}

/** 语言方向标签 */
function directionLabel(d: TranslateDirection): string {
  return d === 'en2zh' ? 'English → 中文' : '中文 → English'
}

export function TranslateDialog({ open, onOpenChange, sentence, onApply }: TranslateDialogProps) {
  const [configs, setConfigs] = useState<TranslateConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [direction, setDirection] = useState<TranslateDirection>('en2zh')
  const [translation, setTranslation] = useState('')
  const [status, setStatus] = useState<'idle' | 'translating' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
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
    if (!open || !sentence) return
    const texts = [sentence.textEn, sentence.textZh].filter(Boolean) as string[]
    setDirection(detectDirection(texts))
    setTranslation('')
    setStatus('idle')
    setError('')
    abortRef.current?.abort()
  }, [open, sentence])

  const handleTranslate = useCallback(async () => {
    if (!sentence) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('translating')
    setError('')
    setTranslation('')

    try {
      const sourceText = direction === 'en2zh' ? sentence.textEn : (sentence.textZh ?? sentence.textEn)
      const results = await translateTexts(
        [sourceText],
        selectedConfigId || undefined,
        direction,
        ctrl.signal,
      )
      setTranslation(results[0] ?? '')
      setStatus('done')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '翻译失败')
      setStatus('error')
    }
  }, [sentence, selectedConfigId, direction])

  const handleApply = useCallback(() => {
    if (!sentence || !translation) return
    const updated: SubtitleSentence = direction === 'en2zh'
      ? { ...sentence, textZh: translation }
      : { ...sentence, textEn: translation }
    onApply(updated)
    onOpenChange(false)
  }, [sentence, translation, direction, onApply, onOpenChange])

  const handleClose = useCallback((open: boolean) => {
    if (!open) abortRef.current?.abort()
    onOpenChange(open)
  }, [onOpenChange])

  const sourceText = direction === 'en2zh' ? sentence?.textEn : (sentence?.textZh ?? sentence?.textEn)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogHeader>
        <DialogTitle>翻译当前句</DialogTitle>
        <DialogDescription>
          {sentence ? `句子 #${sentence.index + 1}` : '选择一条字幕进行翻译'}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="flex flex-col gap-4">
          {/* 模型选择 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">翻译模型</label>
            {configs.length === 0 ? (
              <p className="text-sm text-destructive">请先在「设置 → 模型配置」中配置翻译模型</p>
            ) : (
              <select
                value={selectedConfigId}
                onChange={e => setSelectedConfigId(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {configs.map(c => (
                  <option key={c.id} value={c.id}>{c.translateModel} · {c.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* 语言方向 */}
          <div className="flex items-center gap-2 text-sm">
            <Languages className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">方向：</span>
            <span className="font-medium">{directionLabel(direction)}</span>
            <span className="text-xs text-muted-foreground">（自动检测）</span>
          </div>

          {/* 原文 ↔ 译文对照 */}
          {sentence && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {direction === 'en2zh' ? '英文原文' : '中文原文'}
                </label>
                <div className="min-h-[5rem] rounded-xl bg-muted p-3 text-sm leading-relaxed">
                  {sourceText || '—'}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {direction === 'en2zh' ? '中文译文' : '英文译文'}
                </label>
                <div className="min-h-[5rem] rounded-xl bg-muted p-3 text-sm leading-relaxed">
                  {status === 'translating' ? (
                    <span className="animate-pulse text-muted-foreground">翻译中…</span>
                  ) : status === 'done' && translation ? (
                    translation
                  ) : status === 'error' ? (
                    <span className="text-destructive">{error}</span>
                  ) : (
                    <span className="text-muted-foreground">点击「翻译」获取译文</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            {status !== 'done' ? (
              <Button
                onClick={() => void handleTranslate()}
                disabled={!sentence || configs.length === 0 || status === 'translating'}
              >
                {status === 'translating' ? '翻译中…' : '翻译'}
              </Button>
            ) : (
              <Button onClick={handleApply}>应用翻译</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
