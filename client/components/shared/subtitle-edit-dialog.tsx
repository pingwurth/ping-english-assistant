import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatSrtTimestamp, parseSrtTimestamp } from '@/core/subtitle'
import type { SubtitleSentence } from '@/types/subtitle'

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

/** 输入框 "mm:ss,mmm" → ms；不合法返回 null */
function inputToMs(raw: string): number | null {
  const trimmed = raw.trim()
  // 兼容用户输入完整 "hh:mm:ss,mmm"
  if (/^\d{1,2}:\d{2}[,.]\d{1,3}$/.test(trimmed)) {
    return parseSrtTimestamp(`00:${trimmed}`)
  }
  return parseSrtTimestamp(trimmed)
}

export function SubtitleEditDialog({ open, onOpenChange, sentence, onSave }: SubtitleEditDialogProps) {
  const [textEn, setTextEn] = useState('')
  const [textZh, setTextZh] = useState('')
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [timeError, setTimeError] = useState(false)

  // sentence 变化时同步表单
  useEffect(() => {
    if (sentence) {
      setTextEn(sentence.textEn)
      setTextZh(sentence.textZh ?? '')
      setStartInput(msToInput(sentence.startMs))
      setEndInput(msToInput(sentence.endMs))
      setTimeError(false)
    }
  }, [sentence])

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
          <div>
            <label className="mb-1 block text-sm font-medium">英文原文</label>
            <Textarea
              value={textEn}
              onChange={(e) => setTextEn(e.target.value)}
              rows={3}
              placeholder="英文原文"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">中文译文</label>
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
