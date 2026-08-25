/**
 * 录音按钮 —— P6 跟读评分 / P8 全文背诵共用。
 * 交互方式消费 P10 设置的 pref:recordMode（lib/pref-keys.ts，默认 hold 与设置页一致）：
 *  - tap（点击录音）：单击切换开始/停止，文案"开始录音/停止录音"；
 *  - hold（按住录音）：pointerdown 开始，pointerup/pointerleave/pointercancel 结束，
 *    文案"按住说话/松开结束"（touch-none 保证触屏 pointer 事件不被滚动抢占）。
 * SSR 安全：getRecordMode 内部在无 localStorage 时降级返回默认值。
 */

import { useState } from 'react'
import { getRecordMode } from '@/lib/pref-keys'

function RecordButton({ recording, setRecording }: { recording:boolean; setRecording:(v:boolean)=>void }) {
  const [mode] = useState(() => getRecordMode())
  const hold = mode === 'hold'
  const label = hold ? (recording ? '松开结束' : '按住说话') : (recording ? '停止录音' : '开始录音')
  const stop = () => { if (recording) setRecording(false) }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={hold ? undefined : () => setRecording(!recording)}
      onPointerDown={hold ? (e) => { e.preventDefault(); if (!recording) setRecording(true) } : undefined}
      onPointerUp={hold ? stop : undefined}
      onPointerLeave={hold ? stop : undefined}
      onPointerCancel={hold ? stop : undefined}
      className={`flex size-32 flex-col items-center justify-center rounded-full border-8 transition-all ${hold ? 'touch-none select-none' : ''} ${recording ? 'border-destructive/20 bg-destructive text-destructive-foreground' : 'border-primary/15 bg-primary text-primary-foreground'}`}
    >
      <span className="text-3xl">{recording ? '■' : '●'}</span>
      <span className="mt-1 text-sm">{label}</span>
    </button>
  )
}

export { RecordButton }
