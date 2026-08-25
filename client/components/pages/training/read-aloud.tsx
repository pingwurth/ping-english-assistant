/**
 * P6 跟读评分 —— 逐句流程：听原音（句段播放）→ 录音跟读 → SOE 评分 → 逐句推进 → 小结。
 *
 * 链路（原型设计 §4.7）：
 *  - 听原音：播放引擎 SentencePlayer.playRange（句段 [startMs, endMs] 播一遍自动停）；
 *  - 录音：platform/recorder WebRecorder（WAV 16kHz mono；60s 上限自动停止）；
 *    录音中展示声波振幅条（volume 事件驱动）与实时时长（§5.3）；
 *  - 评分：契约② SOE mock → ScorePanel（综合分 + 三维条形 + 单词级标色，§5.4）；
 *  - 成绩：每句首评写一条 train: 记录（批次 C 类型与 key 约定）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MicPermissionOverlay, ScorePanel } from '@/components/shared/score-panel'
import { RecordButton } from '@/components/shared/record-button'
import { SessionSummaryOverlay, SummaryStat, TrainingSessionShell, useTrainingMaterial } from '@/components/shared/training-session-shell'
import { makeRecordId } from '@/core/training/session'
import { SentencePlayer } from '@/core/player/sentence-player'
import { HtmlPlayerController } from '@/platform/html-player'
import { createRecorder, RecorderPermissionError, type WebRecorder } from '@/platform/recorder'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'
import { getMediaBlob } from '@/stores/material-store'
import { ApiError, getMockServices } from '@/services'
import type { SoeEvaluateResponse } from '@/types/api'
import type { ReadAloudDetail, TrainingRecord } from '@/types/training'

/** 单句阶段：空闲 → 录音中 → 评分中 → 已出分 */
type Phase = 'idle' | 'recording' | 'scoring' | 'scored'

/** 录音时长文案：00:03.2（与原型 AudioTraining 展示一致） */
function formatMs(ms: number): string {
  const t = Math.max(0, ms)
  const m = Math.floor(t / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const d = Math.floor((t % 1000) / 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}

/** 声波振幅条：volume 事件驱动（§5.3"录音中：声波振幅条"） */
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

function ReadAloud() {
  const { record, loading } = useTrainingMaterial()
  const soe = useMemo(() => getMockServices().soe, [])

  const [cursor, setCursor] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<SoeEvaluateResponse | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [permDenied, setPermDenied] = useState(false)
  const [permMessage, setPermMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [totals, setTotals] = useState<number[]>([])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)
  const recorderRef = useRef<WebRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** 每句只写一条 train: 记录（首次评分时），沿用批次 C 约定 */
  const writtenRef = useRef<Set<number>>(new Set())
  /** maxreach/卸载场景调用最新 stopRecording 闭包 */
  const stopRef = useRef<() => Promise<void>>(async () => {})

  const sentences = record?.subtitleData?.sentences ?? []
  const sentence = sentences[cursor]

  // 媒体 Blob → ObjectURL（SSR 安全：仅 effect 内；卸载时 revoke）
  useEffect(() => {
    if (!record) return
    let cancelled = false
    let objectUrl: string | null = null
    ;(async () => {
      const blob = await getMediaBlob(record.material.id)
      if (cancelled) return
      if (blob) { objectUrl = URL.createObjectURL(blob); setMediaUrl(objectUrl) }
    })().catch(() => { /* 无媒体：听原音按钮置灰 */ })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [record])

  // 播放引擎装配：句段播放（playRange 播一遍自动暂停）
  useEffect(() => {
    if (!record || !mediaUrl) return
    const list = record.subtitleData?.sentences ?? []
    const mediaType = record.material.mediaType
    const controller = mediaType === 'audio' && audioRef.current
      ? new HtmlPlayerController('audio', audioRef.current)
      : new HtmlPlayerController(mediaType)
    const sp = new SentencePlayer(controller, list)
    playerRef.current = sp
    controller.load({ type: mediaType, src: mediaUrl }).catch(() => { /* 加载失败 → 播放置灰 */ })
    return () => { sp.destroy(); controller.destroy(); playerRef.current = null }
  }, [record, mediaUrl])

  // 录音器生命周期：挂载创建 + volume 监听 + 到达 60s 上限自动收尾；卸载 destroy + 中止评分请求
  useEffect(() => {
    const rec = createRecorder()
    recorderRef.current = rec
    rec.on('volume', (l) => setLevel(l))
    rec.on('maxreach', () => { void stopRef.current() })
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

  // 切换句子：重置本句阶段与展示
  useEffect(() => {
    setPhase('idle'); setResult(null); setError(null); setElapsed(0); setLevel(0)
  }, [cursor])

  const playOriginal = () => {
    if (!sentence) return
    playerRef.current?.playRange(sentence.startMs, sentence.endMs)
  }

  const startRecording = async () => {
    const rec = recorderRef.current
    if (!rec || phase === 'recording' || phase === 'scoring') return
    setError(null); setPermDenied(false); setPermMessage(undefined)
    playerRef.current?.pause() // 录音前先停原音，避免盖过跟读
    try {
      await rec.start()
    } catch (err) {
      if (err instanceof RecorderPermissionError) { setPermMessage(err.message); setPermDenied(true) }
      else setError(err instanceof Error ? err.message : '录音启动失败')
      return
    }
    setResult(null)
    setPhase('recording')
    setElapsed(0)
    timerRef.current = window.setInterval(() => setElapsed(rec.getElapsedMs()), 100)
  }

  const stopRecording = async () => {
    const rec = recorderRef.current
    if (!rec || rec.getState() !== 'recording' || !sentence || !record) return
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null }
    setPhase('scoring')
    try {
      const audio = await rec.stop()
      const res = await soe.evaluate(audio.blob, sentence.textEn, 'sentence', abortRef.current?.signal)
      setResult(res)
      setPhase('scored')
      setLevel(0)
      // 每句首评写一条 train: 记录（批次 C 类型与 key 约定）
      if (!writtenRef.current.has(sentence.index)) {
        writtenRef.current.add(sentence.index)
        setTotals((t) => [...t, res.total])
        const detail: ReadAloudDetail = { total: res.total, accuracy: res.accuracy, fluency: res.fluency, integrity: res.integrity }
        const tr: TrainingRecord = {
          id: makeRecordId(),
          materialId: record.material.id,
          mode: 'read-aloud',
          scope: { type: 'all' },
          score: res.total,
          detail,
          createdAt: Date.now(),
        }
        void recordsStore.put(RECORD_KEYS.training(tr.id), tr).catch(() => { /* 存储失败不影响训练 */ })
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ABORTED') return // 卸载中止：静默
      setError(err instanceof Error ? err.message : '评分失败，请重试')
      setPhase('idle')
    }
  }
  stopRef.current = stopRecording

  const onRecordToggle = (v: boolean) => { if (v) void startRecording(); else void stopRecording() }
  const onNext = () => { if (cursor >= sentences.length - 1) setDone(true); else setCursor(cursor + 1) }
  const restart = () => {
    writtenRef.current = new Set()
    setTotals([])
    setDone(false)
    setCursor(0)
  }

  if (loading) return <TrainingSessionShell eyebrow="跟读评分" title="听原音，录下你的跟读" current={0} total={0}><div className="flex min-h-40 items-center justify-center text-muted-foreground">正在加载材料…</div></TrainingSessionShell>
  if (!record || sentences.length === 0) {
    return <TrainingSessionShell eyebrow="跟读评分" title="听原音，录下你的跟读" current={0} total={0}><Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">该材料暂无字幕，无法进行跟读训练。</p><Link to="/"><Button variant="outline">返回材料库</Button></Link></CardContent></Card></TrainingSessionShell>
  }

  const avgTotal = totals.length ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length) : 0
  const weakCount = totals.filter((n) => n < 75).length

  return (
    <TrainingSessionShell eyebrow="跟读评分" title="听原音，录下你的跟读" current={done ? sentences.length : cursor} total={sentences.length}>
      <Card>
        <CardContent className="flex flex-col items-center gap-7 p-6 text-center md:p-8">
          <div className="w-full rounded-xl bg-muted p-5 text-left">
            <p className="leading-relaxed">{sentence.textEn}</p>
            {sentence.textZh && <p className="mt-1 text-muted-foreground">{sentence.textZh}</p>}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="outline" onClick={playOriginal} disabled={!mediaUrl || phase === 'recording' || phase === 'scoring'}>
              <Play data-icon="inline-start" />听原音
            </Button>
            {!mediaUrl && <p className="text-xs text-muted-foreground">演示材料无音频——导入真实材料后即可播放句段</p>}
          </div>

          {phase === 'scoring' ? (
            <div className="flex size-32 flex-col items-center justify-center rounded-full border-8 border-primary/15 bg-muted text-muted-foreground">
              <Loader2 className="size-7 animate-spin" />
              <span className="mt-1 text-sm">评分中…</span>
            </div>
          ) : (
            <RecordButton recording={phase === 'recording'} setRecording={onRecordToggle} />
          )}

          <div className="flex w-full flex-col items-center gap-2">
            <WaveBars level={level} active={phase === 'recording'} />
            <p className="font-mono text-sm text-muted-foreground">{phase === 'recording' ? `${formatMs(elapsed)} · 录音中` : phase === 'scored' ? '查看评分，或再读一次' : '准备好后开始录音'}</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && <ScorePanel result={result} />}

          {phase === 'scored' && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => { setResult(null); setPhase('idle') }}><RotateCcw data-icon="inline-start" />再读一次</Button>
              <Button onClick={onNext}>{cursor === sentences.length - 1 ? '查看小结' : '下一句'}<ArrowRight data-icon="inline-end" /></Button>
            </div>
          )}
        </CardContent>
      </Card>
      {mediaUrl && record.material.mediaType === 'audio' && <audio ref={audioRef} src={mediaUrl} preload="metadata" className="hidden" />}

      <MicPermissionOverlay open={permDenied} message={permMessage} onClose={() => setPermDenied(false)} onRetry={() => { setPermDenied(false); void startRecording() }} />

      <SessionSummaryOverlay open={done} title="本轮跟读完成" description={record.material.name} footer={<><Link to={`/training/${record.material.id}`}><Button variant="outline">返回训练中心</Button></Link><Button onClick={restart}>再来一轮</Button></>}>
        <SummaryStat label="平均综合分" value={`${avgTotal} 分（${totals.length} 句）`} />
        <SummaryStat label="薄弱句（<75 分）" value={`${weakCount} 句`} />
      </SessionSummaryOverlay>
    </TrainingSessionShell>
  )
}

export { ReadAloud }
