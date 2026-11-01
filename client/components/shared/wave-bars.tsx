/**
 * 声波振幅条 —— 录音中的音量可视化（read-aloud / recitation 共用；§5.3"录音中：声波振幅条"）。
 * level 来自 recorder 的 volume 事件（0~1），非录音态退化为最低振幅。
 */
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
