/**
 * 训练页共享组件 —— 评分面板（原型设计 §5.4）与麦克风权限引导浮层（§6.3）。
 * 视觉对齐现有评分卡（AudioTraining 时代的 Card bg-primary/5 + font-serif 大分 + Progress 条形）。
 */

import { MicOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { SoeEvaluateResponse } from '@/types/api'

/** 单词级标红阈值：低于 60 分标红（契约② words[].score，架构 §2.5） */
export const LOW_SCORE_THRESHOLD = 60

/**
 * 评分面板（§5.4）：综合分大字 + 准确度/流利度/完整度三维条形（Progress）
 * + 单词级 Badge 标色（<60 标红）。三训练模式复用。
 */
function ScorePanel({ result, className }: { result: SoeEvaluateResponse; className?: string }) {
  const dims = [
    { label: '准确度', value: result.accuracy },
    { label: '流利度', value: result.fluency },
    { label: '完整度', value: result.integrity },
  ]
  return (
    <Card className={cn('w-full bg-primary/5', className)}>
      <CardContent className="p-5">
        <p className="font-serif text-3xl font-semibold text-primary">综合 {result.total} 分</p>
        <div className="mt-4 flex flex-col gap-3 text-left">
          {dims.map((d) => (
            <Progress key={d.label} value={d.value}>
              <ProgressLabel>{d.label}</ProgressLabel>
              <ProgressValue>{() => d.value}</ProgressValue>
            </Progress>
          ))}
        </div>
        {result.words.length > 0 && (
          <div className="mt-5 text-left">
            <p className="mb-2 text-xs text-muted-foreground">单词得分（低于 {LOW_SCORE_THRESHOLD} 标红）</p>
            <div className="flex flex-wrap gap-1.5">
              {result.words.map((w, i) => (
                <Badge key={`${w.text}-${i}`} variant={w.score < LOW_SCORE_THRESHOLD ? 'destructive' : 'secondary'}>
                  {w.text}
                  <span className="opacity-60">{w.score}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * 麦克风权限引导浮层（§6.3"麦克风权限拒绝 → 浮层说明 + [去设置]"）：
 * RecorderPermissionError 时渲染；说明用途 + 浏览器设置指引 + [去设置并重试]。
 * （H5 无法直接打开系统设置，重试即重新触发 getUserMedia 授权流程。）
 */
function MicPermissionOverlay({ open, message, onRetry, onClose }: { open: boolean; message?: string; onRetry: () => void; onClose: () => void }) {
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label="需要麦克风权限" className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive"><MicOff className="size-7" /></span>
          <div>
            <h2 className="font-serif text-2xl font-semibold">需要麦克风权限</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              录音用于采集你的发音进行评分与转写。请点击浏览器地址栏左侧的站点图标，在"麦克风"中选择"允许"，然后重试。
            </p>
            {message && <p className="mt-2 text-sm text-destructive">{message}</p>}
          </div>
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={onRetry}>去设置并重试</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { MicPermissionOverlay, ScorePanel }
