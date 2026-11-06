/**
 * P8 全文背诵 —— 不播原音，凭记忆背诵全文并录音：
 * 提示模式三态（显示中文 / 仅首词 / 无提示）→ 全文录音（60s 上限由 recorder 默认）
 * → 结束后本页直接呈现结果：录音回放 / 录音转文字 / 与原文逐词对比。
 * 录音处理与 P7 影子跟读完全一致（共用 recording-review.tsx：本机 faster-whisper
 * 优先、云端大模型兜底，转写失败可重试）；训练记录按文本 diff 计分，P9 独立报告页已移除。
 *
 * 说明（原型设计 §4.9）：
 *  - 无中文字幕时"显示中文"不可选；
 *  - 到达录音上限（maxreach）自动收尾进入转写；
 *  - 麦克风权限引导浮层与 P7 相同（§6.3）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Shell } from '@/components/shared/shell'
import { MicPermissionOverlay } from '@/components/shared/score-panel'
import { RecordButton } from '@/components/shared/record-button'
import { LiveRecordingWave } from '@/components/shared/wave-bars'
import { formatDuration } from '@/components/shared/player-parts'
import { diffWords } from '@/core/training/dictation-diff'
import { RecorderPermissionError } from '@/platform/recorder'
import { useTrainingMaterial } from '@/components/shared/training-session-shell'
import { appendReportTrainingRecord } from '@/stores/training-record-store'
import { toApiError } from '@/services'
import { RecordingReview, transcribeRecording, useRecordingReplayUrl, useRecorderSession } from './recording-review'

type Phase = 'idle' | 'recording' | 'transcribing' | 'result'
/** 提示模式：中文提示 / 首词提示 / 无提示（§4.9） */
type HintMode = 'zh' | 'first' | 'none'

const HINT_MODES: { id: HintMode; label: string }[] = [
  { id: 'zh', label: '显示中文' },
  { id: 'first', label: '仅首词' },
  { id: 'none', label: '无提示' },
]

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
  const [transcript, setTranscript] = useState('')
  const [permDenied, setPermDenied] = useState(false)
  const [permMessage, setPermMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const finishingRef = useRef(false)
  const finishRef = useRef<() => Promise<void>>(async () => {})
  /** 最近一次录音：供"重新转写"重试（不重新录音） */
  const lastBlobRef = useRef<Blob | null>(null)
  /** 同一段录音转写/重试成功后只写一条训练记录 */
  const reportSavedRef = useRef(false)
  /** 录音器会话（挂载创建/卸载销毁 + maxreach 自动收尾；三训练页共用 hook），
   *  recorder 实例同步给 LiveRecordingWave 自订阅（评审 #51：volume/计时不再进本组件 state） */
  const { recorder, recorderRef, abortRef } = useRecorderSession(() => finishRef.current())
  const { recordingUrl, setRecordingUrlFromBlob } = useRecordingReplayUrl()

  const sentences = record?.subtitleData?.sentences ?? []
  const fullEn = useMemo(() => sentences.map((s) => s.textEn).join(' '), [sentences])
  const diffTokens = useMemo(() => diffWords(transcript, fullEn), [transcript, fullEn])
  const hasZh = sentences.some((s) => !!s.textZh && s.textZh.trim().length > 0)

  // 无中文字幕：中文提示不可选，回落首词提示
  useEffect(() => {
    if (record && !hasZh) setHintMode((m) => (m === 'zh' ? 'first' : m))
  }, [record, hasZh])

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
    setTranscript('')
    setRecordingUrlFromBlob(null)
    reportSavedRef.current = false
    setPhase('recording')
  }

  /** 转写录音（不重新录音）：成功进入结果页；失败也进入结果页（回放可用 + 可重试） */
  const runTranscribe = async (blob: Blob) => {
    setError(null)
    setTranscript('')
    setPhase('transcribing')
    try {
      const text = await transcribeRecording(blob, abortRef.current?.signal)
      setTranscript(text)
      if (!reportSavedRef.current && record && text.trim()) {
        reportSavedRef.current = true
        void appendReportTrainingRecord('recitation', record.material.id, text, fullEn)
          .catch((err) => console.warn('[recitation] 训练记录保存失败:', err))
      }
      setPhase('result')
    } catch (err) {
      if (toApiError(err).code === 'ABORTED' || abortRef.current?.signal.aborted) return
      setError(err instanceof Error ? err.message : '转写失败，请重试')
      setPhase('result')
    }
  }

  /** 结束背诵并转写：停录音 → 保留回放 URL → ASR 转写 */
  const finish = async () => {
    const rec = recorderRef.current
    if (finishingRef.current || !rec || rec.getState() !== 'recording' || !record) return
    finishingRef.current = true
    setPhase('transcribing')
    try {
      const audio = await rec.stop()
      setRecordingUrlFromBlob(audio.blob)
      lastBlobRef.current = audio.blob
      await runTranscribe(audio.blob) // 内部已兜错：失败进结果页（可重试），不向上抛
    } catch (err) {
      // 仅 rec.stop() 失败会走到这里（runTranscribe 自吞错误）：回引导页重录
      if (toApiError(err).code === 'ABORTED' || abortRef.current?.signal.aborted) return
      setError(err instanceof Error ? err.message : '录音收尾失败，请重试')
      setPhase('idle')
    } finally {
      finishingRef.current = false
    }
  }
  finishRef.current = finish

  /** 放弃本次录音（不转写） */
  const abandon = () => {
    recorderRef.current?.cancel()
    setPhase('idle')
  }

  /** 回到引导页（清空上一轮结果） */
  const restart = () => {
    setRecordingUrlFromBlob(null)
    setError(null)
    setTranscript('')
    setPhase('idle')
  }

  if (loading) return <Shell back><div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">正在加载材料…</div></Shell>
  if (!record || sentences.length === 0) {
    return <Shell back><div className="mx-auto max-w-3xl px-4 py-8 md:px-8"><Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">该材料暂无字幕，无法进行背诵训练。</p></CardContent></Card></div></Shell>
  }

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">口语练习</p>
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
                <LiveRecordingWave recorder={recorder} active={phase === 'recording'} formatMs={formatDuration} idleText="凭记忆背诵全文，准备好后开始录音" />
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

        {phase === 'transcribing' && (
          <Card>
            <CardContent className="flex min-h-60 flex-col items-center justify-center gap-4 p-6 text-center md:p-8">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在转写你的背诵…</p>
            </CardContent>
          </Card>
        )}

        {phase === 'result' && (
          <div className="flex flex-col gap-4">
            <RecordingReview
              recordingUrl={recordingUrl}
              transcript={transcript}
              error={error}
              diffTokens={diffTokens}
              onRetry={() => { if (lastBlobRef.current) void runTranscribe(lastBlobRef.current) }}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="outline" className="sm:flex-1" onClick={restart}><RotateCcw data-icon="inline-start" />再背一次</Button>
              <Link to={`/training/${record.material.id}`} className="sm:flex-1">
                <Button variant="outline" className="w-full">返回训练中心</Button>
              </Link>
            </div>
          </div>
        )}
      </div>

      <MicPermissionOverlay open={permDenied} message={permMessage} onClose={() => setPermDenied(false)} onRetry={() => { setPermDenied(false); void startRecording() }} />
    </Shell>
  )
}

export { Recitation }
