import { useCallback, useEffect, useRef, useState } from 'react'
import { Languages, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TranslateDirectionToggle } from '@/components/shared/translate-direction-toggle'
import { formatSrtTimestamp, parseSrtTimestamp } from '@/core/subtitle'
import { translateTexts, detectDirection } from '@/lib/translate'
import { useTranslateConfigs } from '@/lib/use-translate-configs'
import type { SubtitleSentence } from '@/types/subtitle'
import type { TranslateDirection } from '@/types/api'

interface SubtitleEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sentence: SubtitleSentence | null
  onSave: (updated: SubtitleSentence) => void
}

/** ms → "mm:ss,mmm" 简写格式（供输入框展示） */
function msToInput(ms: number): string {
  const full = formatSrtTimestamp(ms)
  // "00:01:23,456" → "01:23,456"（去掉小时前导零，保留两位分钟）
  return full.replace(/^00:/, '')
}

/**
 * 默认翻译方向：按原文行（textEn）语言判定，双语字幕因此默认「英 → 中」。
 * 若判定出的源栏为空而另一栏有内容，则反向——兼容只有中文的素材。
 */
function pickDirection(s: SubtitleSentence): TranslateDirection {
  const d = detectDirection([s.textEn])
  const sourceEmpty = d === 'en2zh' ? !s.textEn.trim() : !(s.textZh ?? '').trim()
  if (!sourceEmpty) return d
  return d === 'en2zh' ? 'zh2en' : 'en2zh'
}

/** 输入框 "mm:ss,mmm" → ms；不合法返回 null */
function inputToMs(raw: string): number | null {
  const trimmed = raw.trim()
  // 兼容用户输入完整 "hh:mm:ss,mmm"
  if (/^\d{1,2}:\d{2}[,.]\d{1,3}$/.test(trimmed)) {
    return parseSrtTimestamp(`00:${trimmed}`)
  }
  return parseSrtTimestamp(trimmed)
}

/**
 * 字幕编辑弹窗（纠错 + 单句翻译）。
 *
 * 单句翻译由原独立的「翻译当前句」浮窗迁移至此：方向可手动切换（英→中 / 中→英），
 * 译文直接写入对应文本框，随「保存」一并落盘，避免两处入口产生两份译文状态。
 */
export function SubtitleEditDialog({ open, onOpenChange, sentence, onSave }: SubtitleEditDialogProps) {
  const [textEn, setTextEn] = useState('')
  const [textZh, setTextZh] = useState('')
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [timeError, setTimeError] = useState(false)
  // ── 单句翻译 ──
  const [direction, setDirection] = useState<TranslateDirection>('en2zh')
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const { configs, configId, setConfigId } = useTranslateConfigs(open)

  // sentence 变化时同步表单，并自动判定翻译方向（用户可再手动切换）
  useEffect(() => {
    if (sentence) {
      setTextEn(sentence.textEn)
      setTextZh(sentence.textZh ?? '')
      setStartInput(msToInput(sentence.startMs))
      setEndInput(msToInput(sentence.endMs))
      setTimeError(false)
      setTranslateError('')
      setDirection(pickDirection(sentence))
    }
  }, [sentence])

  // 关闭时取消进行中的翻译；重新打开时清掉上一次的残留状态
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      return
    }
    setTranslating(false)
    setTranslateError('')
  }, [open])

  // 卸载时取消进行中的翻译
  useEffect(() => () => abortRef.current?.abort(), [])

  const startMs = inputToMs(startInput)
  const endMs = inputToMs(endInput)
  const timeValid = startMs != null && endMs != null && startMs < endMs

  // 时间输入变化时校验
  const handleStartChange = useCallback((v: string) => {
    setStartInput(v)
    const s = inputToMs(v)
    const e = inputToMs(endInput)
    setTimeError(s != null && e != null && s >= e)
  }, [endInput])

  const handleEndChange = useCallback((v: string) => {
    setEndInput(v)
    const s = inputToMs(startInput)
    const e = inputToMs(v)
    setTimeError(s != null && e != null && s >= e)
  }, [startInput])

  // 当前方向下的源文本与字段角色（标签后缀提示译文会写到哪里）
  const sourceText = direction === 'en2zh' ? textEn : textZh
  const enRole = direction === 'en2zh' ? '翻译源' : '译文写入此栏'
  const zhRole = direction === 'en2zh' ? '译文写入此栏' : '翻译源'
  const canTranslate = sourceText.trim().length > 0 && configs.length > 0 && !translating

  /** 单句翻译：结果写入目标文本框，用户可继续修改后随「保存」落盘 */
  const handleTranslate = useCallback(async () => {
    const src = sourceText.trim()
    if (!src || translating) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setTranslating(true)
    setTranslateError('')
    try {
      const results = await translateTexts([src], configId || undefined, direction, ctrl.signal)
      if (direction === 'en2zh') setTextZh(results[0] ?? '')
      else setTextEn(results[0] ?? '')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setTranslateError(err instanceof Error ? err.message : '翻译失败')
    } finally {
      setTranslating(false)
    }
  }, [sourceText, translating, configId, direction])

  const handleSave = useCallback(() => {
    if (!sentence || !timeValid) return
    onSave({
      ...sentence,
      textEn: textEn.trim(),
      textZh: textZh.trim() || null,
      startMs: startMs!,
      endMs: endMs!,
    })
    onOpenChange(false)
  }, [sentence, timeValid, textEn, textZh, startMs, endMs, onSave, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>纠错 — 句子 #{(sentence?.index ?? 0) + 1}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="grid gap-4">
          {/* 翻译工具条：方向切换 + 模型选择 + 翻译 */}
          <div className="rounded-xl border bg-muted/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Languages className="size-4 shrink-0 text-muted-foreground" />
              <TranslateDirectionToggle value={direction} onChange={setDirection} />
              <select
                value={configId}
                onChange={(e) => setConfigId(e.target.value)}
                disabled={configs.length === 0}
                className="h-9 min-w-40 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              >
                {configs.length === 0 ? (
                  <option value="">未配置翻译模型</option>
                ) : (
                  configs.map((c) => (
                    <option key={c.id} value={c.id}>{c.translateModel} · {c.name}</option>
                  ))
                )}
              </select>
              <Button
                size="sm"
                onClick={() => void handleTranslate()}
                disabled={!canTranslate}
                title={sourceText.trim() ? undefined : '请先填写翻译源文本'}
              >
                {translating ? <><Loader2 className="mr-1 size-3 animate-spin" />翻译中…</> : '翻译'}
              </Button>
            </div>
            {configs.length === 0 && (
              <p className="mt-2 text-xs text-destructive">请先在「设置 → 模型配置」中配置翻译模型</p>
            )}
            {translateError && <p className="mt-2 text-xs text-destructive">{translateError}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              英文原文<span className="ml-2 text-xs font-normal text-muted-foreground">{enRole}</span>
            </label>
            <Textarea
              value={textEn}
              onChange={(e) => setTextEn(e.target.value)}
              rows={3}
              placeholder="英文原文"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              中文译文<span className="ml-2 text-xs font-normal text-muted-foreground">{zhRole}</span>
            </label>
            <Textarea
              value={textZh}
              onChange={(e) => setTextZh(e.target.value)}
              rows={2}
              placeholder="中文译文（可留空）"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">开始时间</label>
              <Input
                value={startInput}
                onChange={(e) => handleStartChange(e.target.value)}
                placeholder="mm:ss,mmm"
                className={timeError ? 'border-destructive' : ''}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">结束时间</label>
              <Input
                value={endInput}
                onChange={(e) => handleEndChange(e.target.value)}
                placeholder="mm:ss,mmm"
                className={timeError ? 'border-destructive' : ''}
              />
            </div>
          </div>
          {timeError && <p className="text-sm text-destructive">开始时间必须早于结束时间</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleSave} disabled={!textEn.trim() || !timeValid}>保存</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}