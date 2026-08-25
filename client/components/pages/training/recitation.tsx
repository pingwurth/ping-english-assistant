/**
 * P8 全文背诵 —— 不播原音，凭记忆背诵全文并录音：
 * 提示模式三态（显示中文 / 仅首词 / 无提示）→ 全文录音（60s 上限由 recorder 默认）
 * → 分步分析（上传→转写→分析）→ ASR mock 转写 → setReportPayload → 跳 P9 报告页。
 *
 * 说明（原型设计 §4.9）：
 *  - 无中文字幕时"显示中文"不可选；
 *  - 到达录音上限（maxreach）自动收尾进入分析；
 *  - 麦克风权限引导浮层与 P7 相同（§6.3）；
 *  - 会话载荷契约见 lib/report-session.ts（供批次 E 的 P9 报告页消费）。
 */

import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Shell } from '@/components/shared/shell'
import { MicPermissionOverlay } from '@/components/shared/score-panel'
import { RecordButton } from '@/components/shared/record-button'
import { setReportPayload } from '@/lib/report-session'
import { createRecorder, RecorderPermissionError, type WebRecorder } from '@/platform/recorder'
import { useTrainingMaterial } from '@/components/shared/training-session-shell'
import { abortableDelay, ApiError, getMockServices } from '@/services'

type Phase = 'idle' | 'recording' | 'analyzing' | 'report'
/** 提示模式：中文提示 / 首词提示 / 无提示（§4.9） */
type HintMode = 'zh' | 'first' | 'none'

const HINT_MODES: { id: HintMode; label: string }[] = [
  { id: 'zh', label: '显示中文' },
  { id: 'first', label: '仅首词' },
  { id: 'none', label: '无提示' },
]

/** 分析步骤（同 P7：上传→转写→分析） */
const ANALYZE_STEPS = ['上传录音', '语音转写', 'AI 分析']

function formatClock(ms: number): string {
  const t = Math.max(0, ms)
  const m = Math.floor(t / 60000)
  const s = Math.floor((t % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 声波振幅条：volume 事件驱动（§5.3） */
function WaveBars({ level, active }: { level: number; active: boolean }) {
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

/** 单句提示文案（随提示模式渲染） */
function hintText(mode: HintMode, textEn: string, textZh: string | null, firstWord: string): string {
  if (mode === 'zh') return textZh ?? ''
  if (mode === 'first') return firstWord ? `${firstWord}…` : '…'
  return '······'
}

function Recitation() {
  const { record, loading } = useTrainingMaterial()

  const [phase, setPhase] = useState<Phase>('idle')
  const [hintMode, setHintMode] = useState<HintMode>('zh')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [stage, setStage] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [permDenied, setPermDenied] = useState(false)
  const [permMessage, setPermMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<WebRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startedAtRef = useRef(0)
  const finishingRef = useRef(false)
  const finishRef = useRef<() => Promise<void>>(async () => {})

  const sentences = record?.subtitleData?.sentences ?? []
  const hasZh = sentences.some((s) => !!s.textZh && s.textZh.trim().length > 0)

  // 无中文字幕：中文提示不可选，回落首词提示
  useEffect(() => {
    if (record && !hasZh) setHintMode((m) => (m === 'zh' ? 'first' : m))
  }, [record, hasZh])

  // 录音器生命周期：挂载创建 + volume 监听 + 60s 上限自动收尾；卸载 destroy + 中止请求
  useEffect(() => {
    const rec = createRecorder()
    recorderRef.current = rec
    rec.on('volume', (l) => setLevel(l))
    rec.on('maxreach', () => { void finishRef.current() })
    const abort = new AbortController()
    abortRef.current = abort
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      timerRef.current = null
      abort.abort()
      rec.destroy()
      recorderRef.current = null
    }
  }, [])

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  const startRecording = async () => {
    const rec = recorderRef.current
    if (!rec || phase !== 'idle') return
    setError(null); setPermDenied(false); setPermMessage(undefined)
    try {
      await rec.start()
    } catch (err) {
      if (err instanceof RecorderPermissionError) { setPermMessage(err.message); setPermDenied(true) }
      else setError(err instanceof Error ? err.message : '录音启动失败')
      return
    }
    startedAtRef.current = Date.now()
    setElapsed(0)
    setTranscript('')
    clearTimer()
    timerRef.current = window.setInterval(() => setElapsed(rec.getElapsedMs()), 200)
    setPhase('recording')
  }

  /** 完成背诵：停止录音并分步分析（上传→转写→分析） */
  const finish = async () => {
    const rec = recorderRef.current
    if (finishingRef.current || !rec || rec.getState() !== 'recording' || !record) return
    finishingRef.current = true
    clearTimer()
    setPhase('analyzing')
    setStage(0)
    try {
      const audio = await rec.stop()
      const signal = abortRef.current?.signal
      await abortableDelay(500, signal) // ① 上传录音（mock 延迟）
      setStage(1)
      const fullEn = sentences.map((s) => s.textEn).join(' ')
      const { asr } = getMockServices({ asr: { refText: fullEn } })
      const res = await asr.transcribe(audio.blob, 'en', signal) // ② 语音转写（契约①）
      setTranscript(res.text)
      setStage(2)
      await abortableDelay(700, signal) // ③ AI 分析（移交 P9 报告页生成）
      setStage(3)
      setReportPayload({
        mode: 'recitation',
        materialId: record.material.id,
        materialTitle: record.material.name,
        transcript: res.text,
        sentences: sentences.map((s) => ({ index: s.index, textEn: s.textEn, textZh: s.textZh ?? '' })),
        recordingBlob: audio.blob,
        startedAt: startedAtRef.current,
      })
      setPhase('report')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ABORTED') return // 卸载中止：静默
      setError(err instanceof Error ? err.message : '分析失败，请重试')
      setPhase('idle')
    } finally {
      finishingRef.current = false
    }
  }
  finishRef.current = finish

  /** 放弃本次录音（不分析） */
  const abandon = () => {
    clearTimer()
    recorderRef.current?.cancel()
    setLevel(0)
    setPhase('idle')
  }

  if (loading) return <Shell back><div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">正在加载材料…</div></Shell>
  if (!record || sentences.length === 0) {
    return <Shell back><div className="mx-auto max-w-3xl px-4 py-8 md:px-8"><Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">该材料暂无字幕，无法进行背诵训练。</p></CardContent></Card></div></Shell>
  }

  if (phase === 'report') return <Navigate to="/training/report" replace />

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">SPEAKING PRACTICE</p>
            <h1 className="font-serif text-3xl font-semibold">全文背诵</h1>
          </div>
          <div className="flex gap-2" role="group" aria-label="提示模式">
            {HINT_MODES.map((m) => (
              <Button key={m.id} size="sm" variant={hintMode === m.id ? 'default' : 'outline'} disabled={m.id === 'zh' && !hasZh} onClick={() => setHintMode(m.id)}>{m.label}</Button>
            ))}
          </div>
        </div>

        {(phase === 'idle' || phase === 'recording') && (
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="flex flex-col gap-2 p-6">
                {sentences.map((s) => (
                  <div key={s.index} className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 text-left">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{String(s.index + 1).padStart(2, '0')}</span>
                    <span className={hintMode === 'none' ? 'tracking-widest text-muted-foreground/60' : ''}>{hintText(hintMode, s.textEn, s.textZh, s.words[0] ?? '')}</span>
                  </div>
                ))}
                {!hasZh && hintMode === 'zh' && <p className="text-xs text-muted-foreground">该材料无中文字幕，中文提示不可用。</p>}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col items-center gap-5 p-6 text-center md:p-8">
                {phase === 'recording' ? (
                  <RecordButton recording setRecording={() => void finish()} />
                ) : (
                  <RecordButton recording={false} setRecording={() => void startRecording()} />
                )}
                <div className="flex w-full flex-col items-center gap-2">
                  <WaveBars level={level} active={phase === 'recording'} />
                  <p className="font-mono text-sm text-muted-foreground">{phase === 'recording' ? `${formatClock(elapsed)} · 录音中` : '凭记忆背诵全文，准备好后开始录音'}</p>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {phase === 'recording' && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" onClick={abandon}>放弃</Button>
                    <Button onClick={() => void finish()}><Check data-icon="inline-start" />完成背诵</Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">说明：背诵完成后将转写录音并与原文对比，评估完整度。录音上限 60 秒（原型），到达上限自动提交。</p>
              </CardContent>
            </Card>
          </div>
        )}

        {phase === 'analyzing' && (
          <Card>
            <CardContent className="flex flex-col gap-3 p-6 md:p-8">
              <p className="mb-1 text-sm text-muted-foreground">正在分析你的背诵…</p>
              {ANALYZE_STEPS.map((label, i) => {
                const doneStep = i < stage
                const activeStep = i === stage
                return (
                  <div key={label} className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                    <span className="text-sm">{['①', '②', '③'][i]} {label}</span>
                    {doneStep ? <span className="flex items-center gap-1 text-sm text-primary"><Check className="size-4" />完成</span>
                      : activeStep ? <span className="flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />进行中…</span>
                      : <span className="text-sm text-muted-foreground/60">等待</span>}
                  </div>
                )
              })}
              {stage >= 2 && transcript && (
                <div className="rounded-xl border p-4 text-left">
                  <p className="mb-1 text-xs text-muted-foreground">已识别（ASR 转写）</p>
                  <p className="text-sm leading-relaxed">{transcript}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <MicPermissionOverlay open={permDenied} message={permMessage} onClose={() => setPermDenied(false)} onRetry={() => { setPermDenied(false); void startRecording() }} />
    </Shell>
  )
}

export { Recitation }
