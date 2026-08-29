import { useCallback, useEffect, useRef, useState } from 'react'
import { Languages, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translateTexts, detectDirection } from '@/lib/translate'
import type { SubtitleSentence } from '@/types/subtitle'
import type { TranslateDirection } from '@/types/api'

interface TranslateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sentence: SubtitleSentence | null
  onApply: (updated: SubtitleSentence, direction: TranslateDirection) => void
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
  /** 记录上次句子签名，避免关闭再打开时丢失已完成的翻译结果 */
  const prevSentenceSigRef = useRef('')

  // ── 拖拽状态 ──
  const draggingRef = useRef(false)
  const offsetRef = useRef({ x: 0, y: 0 })
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const posInitializedRef = useRef(false)

  // ── 锁定句子：打开时捕获，不再跟随播放进度 ──
  const [lockedSentence, setLockedSentence] = useState<SubtitleSentence | null>(null)

  // 打开时初始化面板位置 + 锁定句子（仅 open 变为 true 时触发一次）
  useEffect(() => {
    if (!open) {
      posInitializedRef.current = false
      return
    }
    if (!posInitializedRef.current) {
      posInitializedRef.current = true
      setPos({ x: (window.innerWidth - 480) / 2, y: (window.innerHeight - 420) / 2 })
    }
  }, [open])

  // 首次打开 + 有 sentence 时锁定句子（不依赖 sentence 后续变化）
  useEffect(() => {
    if (open && sentence && !lockedSentence) {
      setLockedSentence(sentence)
    }
  }, [open, sentence, lockedSentence])

  // 关闭时清除锁定
  useEffect(() => {
    if (!open) setLockedSentence(null)
  }, [open])

  // 拖拽事件绑定
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - offsetRef.current.x))
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offsetRef.current.y))
      setPos({ x, y })
    }
    const onMouseUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Escape 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

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

  // 打开时自动检测语言方向；仅当句子变化时重置翻译状态
  useEffect(() => {
    if (!open || !lockedSentence) return
    const sig = `${lockedSentence.index}:${lockedSentence.textEn}:${lockedSentence.textZh ?? ''}`
    const texts = [lockedSentence.textEn, lockedSentence.textZh].filter(Boolean) as string[]
    setDirection(detectDirection(texts))
    if (sig !== prevSentenceSigRef.current) {
      prevSentenceSigRef.current = sig
      setTranslation('')
      setStatus('idle')
      setError('')
      abortRef.current?.abort()
    }
  }, [open, lockedSentence])

  const handleTranslate = useCallback(async () => {
    if (!lockedSentence) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('translating')
    setError('')
    setTranslation('')

    try {
      const sourceText = direction === 'en2zh' ? lockedSentence.textEn : (lockedSentence.textZh ?? lockedSentence.textEn)
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
  }, [lockedSentence, selectedConfigId, direction])

  const handleApply = useCallback(() => {
    if (!lockedSentence || !translation) return
    const updated: SubtitleSentence = direction === 'en2zh'
      ? { ...lockedSentence, textZh: translation }
      : { ...lockedSentence, textEn: translation }
    onApply(updated, direction)
    onOpenChange(false)
  }, [lockedSentence, translation, direction, onApply, onOpenChange])

  const handleClose = useCallback(() => {
    abortRef.current?.abort()
    onOpenChange(false)
  }, [onOpenChange])

  /** 拖拽开始 */
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true
    offsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
  }, [pos])

  if (!open || !lockedSentence) return null

  const sourceText = direction === 'en2zh' ? lockedSentence.textEn : (lockedSentence.textZh ?? lockedSentence.textEn)

  return (
    <div
      className="fixed z-50 flex flex-col overflow-auto rounded-2xl border bg-card shadow-xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: 480,
        minHeight: 300,
        resize: 'both',
      }}
    >
      {/* 标题栏：拖拽手柄 */}
      <div
        className="flex cursor-grab items-center justify-between border-b px-6 py-4 active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <div>
          <h2 className="text-lg font-semibold">翻译当前句</h2>
          <p className="mt-1 text-sm text-muted-foreground">句子 #{lockedSentence.index + 1}</p>
        </div>
        <button
          onClick={handleClose}
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="关闭"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 p-6">
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

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose}>取消</Button>
            {status !== 'done' ? (
              <Button
                onClick={() => void handleTranslate()}
                disabled={configs.length === 0 || status === 'translating'}
              >
                {status === 'translating' ? '翻译中…' : '翻译'}
              </Button>
            ) : (
              <Button onClick={handleApply}>应用翻译</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
