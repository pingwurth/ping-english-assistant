/**
 * 声波振幅条 —— 录音中的音量可视化（read-aloud / recitation 共用；§5.3"录音中：声波振幅条"）。
 * level 来自 recorder 的 volume 事件（0~1），非录音态退化为最低振幅。
 */
import { useEffect, useState } from 'react'
import type { WebRecorder } from '@/platform/recorder'

export function WaveBars({ level, active }: { level: number; active: boolean }) {
  return (
    <div aria-hidden className="flex h-8 items-center justify-center gap-1">
      {Array.from({ length: 14 }, (_, i) => {
        const shape = 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7 + 0.4))
        const h = active ? Math.max(0.15, Math.min(1, level * 1.4) * shape) : 0.15
        return <span key={i} className="w-1 rounded-full bg-destructive/70 transition-[height] duration-75" style={{ height: `${Math.round(h * 100)}%` }} />
      })}
    </div>
  )
}

/**
 * 录音声波 + 计时状态行（评审 #51）：自订阅 recorder 的 ~30Hz volume 事件与
 * 200ms 计时，高频更新只重渲染本行 —— 不再带动整页（含未 memo 的全句列表）
 * 每秒数千次 DOM reconcile，与音频采集抢主线程。范本同 player.tsx LiveControlBar。
 *
 * @param formatMs 计时文案格式（read-aloud 用 00:03.2 形态，其余用共享 formatDuration）
 * @param idleText 非录音态文案（由调用方按 phase 计算）
 */
export function LiveRecordingWave({
  recorder,
  active,
  formatMs,
  idleText,
  activeText = '录音中',
}: {
  recorder: WebRecorder | null
  active: boolean
  formatMs: (ms: number) => string
  idleText: string
  activeText?: string
}) {
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!recorder) return
    recorder.on('volume', setLevel)
    return () => { recorder.off('volume', setLevel) }
  }, [recorder])

  // 非录音态复位计时与声波（对应旧代码散落各处的 setLevel(0)/setElapsed(0)）
  useEffect(() => {
    if (!active || !recorder) {
      setLevel(0)
      setElapsed(0)
      return
    }
    setElapsed(recorder.getElapsedMs())
    const timer = window.setInterval(() => setElapsed(recorder.getElapsedMs()), 200)
    return () => window.clearInterval(timer)
  }, [active, recorder])

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <WaveBars level={level} active={active} />
      <p className="font-mono text-sm text-muted-foreground">{active ? `${formatMs(elapsed)} · ${activeText}` : idleText}</p>
    </div>
  )
}
