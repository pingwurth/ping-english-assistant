/**
 * P7 影子跟读 —— 边播边录：耳机提示确认 → 全文连播 + 同步录音 → 结束后
 * 本页直接呈现结果：录音回放 / 录音转文字（本机 faster-whisper 优先，
 * 云端大模型兜底）/ 与原文逐词对比（黑 = 原文基准，绿 = 读对，
 * 误读词后跟红色括号内为实际读出）。不做发音评分；P9 报告页已随页内
 * 转写对比方案移除（P8 全文背诵同此，报告/评分不再有独立页面）。
 * 录音处理三件套（转写/回听 URL/结果三卡）与 P8 共用 recording-review.tsx。
 *
 * 说明（原型设计 §4.8）：
 *  - 跟读中全程展示原文供对照阅读：当前句高亮并自动滚动居中（仅容器内滚动）；
 *  - [暂停/继续] 同步暂停播放与录音（player.pause/play + recorder.pause/resume），
 *    recorder 暂停段以静音保留在录音中；
 *  - 播放自然结束后延迟 2s（END_GRACE_MS）自动收尾——不能一播完就结束，
 *    给用户读完最后一句的余量；录音到达 60s 上限 / 用户点击 [结束跟读] 则立即收尾；
 *  - echoCancellation 已由 recorder 默认开启（getUserMedia 约束）；
 *  - 麦克风权限拒绝渲染引导浮层（§6.3，shared/score-panel.tsx MicPermissionOverlay）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Headphones, Loader2, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Shell } from '@/components/shared/shell'
import { MicPermissionOverlay } from '@/components/shared/score-panel'
import { diffWords } from '@/core/training/dictation-diff'
import { SentencePlayer } from '@/core/player/sentence-player'
import { HtmlPlayerController } from '@/platform/html-player'
import { createRecorder, RecorderPermissionError, type WebRecorder } from '@/platform/recorder'
import { getMediaBlob } from '@/stores/material-store'
import { useTrainingMaterial } from '@/components/shared/training-session-shell'
import { toApiError } from '@/services'
import type { SubtitleSentence } from '@/types/subtitle'
import { RecordingReview, transcribeRecording, useRecordingReplayUrl } from './recording-review'

type Phase = 'intro' | 'recording' | 'transcribing' | 'result'

/** 播放结束后的收尾延迟：原音播完留 2 秒余量读完最后一句，到点自动结束录音 */
const END_GRACE_MS = 2000

/** 时钟文案：03:24（原型 §4.8 跟读中状态） */
function formatClock(ms: number): string {
  const t = Math.max(0, ms)
  const m = Math.floor(t / 60000)
  const s = Math.floor((t % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 原文卡：供跟读时对照阅读；activeIdx ≥ 0 时高亮当前句并自动滚动居中（仅容器内滚动，不劫持页面） */
function OriginalTextCard({ sentences, activeIdx }: { sentences: SubtitleSentence[]; activeIdx: number }) {
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box || activeIdx < 0) return
    const line = box.querySelector<HTMLElement>(`[data-line="${activeIdx}"]`)
    if (!line) return
    const top = line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [activeIdx])

  return (
    <div ref={boxRef} className="relative max-h-72 overflow-y-auto rounded-xl bg-muted p-4">
      <div className="flex flex-col gap-1 text-left">
        {sentences.map((s, i) => (
          <p key={s.index} data-line={i} className={`rounded-lg px-2 py-1 leading-relaxed transition-colors ${i === activeIdx ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground'}`}>
            {s.textEn}
          </p>
        ))}
      </div>
    </div>
  )
}

function Shadowing() {
  const { record, loading } = useTrainingMaterial()

  const [phase, setPhase] = useState<Phase>('intro')
  const [transcript, setTranscript] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [playMs, setPlayMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [recMs, setRecMs] = useState(0)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [paused, setPaused] = useState(false)
  const [permDenied, setPermDenied] = useState(false)
  const [permMessage, setPermMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)
  const recorderRef = useRef<WebRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const finishingRef = useRef(false)
  const finishRef = useRef<() => Promise<void>>(async () => {})
  /** 播放结束 → 自动收尾的延迟计时器（begin/卸载/手动收尾时清除） */
  const endGraceTimerRef = useRef<number | null>(null)
  /** 最近一次录音：供"重新转写"重试（不重新录音） */
  const lastBlobRef = useRef<Blob | null>(null)
  const { recordingUrl, setRecordingUrlFromBlob } = useRecordingReplayUrl()

  const sentences = record?.subtitleData?.sentences ?? []
  const fullEn = useMemo(() => sentences.map((s) => s.textEn).join(' '), [sentences])
  const diffTokens = useMemo(() => diffWords(transcript, fullEn), [transcript, fullEn])

  // 媒体 Blob → ObjectURL（SSR 安全：仅 effect 内；卸载时 revoke）
  useEffect(() => {
    if (!record) return
    let cancelled = false
    let objectUrl: string | null = null
    ;(async () => {
      const blob = await getMediaBlob(record.material.id)
      if (cancelled) return
      if (blob) { objectUrl = URL.createObjectURL(blob); setMediaUrl(objectUrl) }
    })().catch(() => { /* 无媒体：仅录音，无原音跟播 */ })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [record])

  /** 播放结束后自动收尾（延迟 END_GRACE_MS，给用户读完最后一句的余量） */
  const finishAfterGrace = () => {
    if (endGraceTimerRef.current !== null) window.clearTimeout(endGraceTimerRef.current)
    endGraceTimerRef.current = window.setTimeout(() => {
      endGraceTimerRef.current = null
      void finishRef.current()
    }, END_GRACE_MS)
  }

  const clearEndGrace = () => {
    if (endGraceTimerRef.current !== null) window.clearTimeout(endGraceTimerRef.current)
    endGraceTimerRef.current = null
  }

  // 播放引擎装配：全文连播（timeupdate 驱动进度，ended 延迟 2s 触发收尾）
  useEffect(() => {
    if (!record || !mediaUrl) return
    const list = record.subtitleData?.sentences ?? []
    const mediaType = record.material.mediaType
    const controller = mediaType === 'audio' && audioRef.current
      ? new HtmlPlayerController('audio', audioRef.current)
      : new HtmlPlayerController(mediaType)
    const sp = new SentencePlayer(controller, list)
    playerRef.current = sp
    controller.load({ type: mediaType, src: mediaUrl }).then(() => {
      setDurationMs(controller.getDurationMs() || record.material.durationMs)
    }).catch(() => { /* 加载失败：进度按材料元时长展示 */ })
    sp.on('timeupdate', (ms) => setPlayMs(ms))
    sp.on('sentencechange', (i) => setActiveIdx(i))
    sp.on('ended', finishAfterGrace)
    return () => {
      clearEndGrace()
      sp.destroy(); controller.destroy(); playerRef.current = null
    }
  }, [record, mediaUrl])

  // 录音器生命周期：挂载创建；到达 60s 上限自动收尾；卸载 destroy + 中止转写请求
  useEffect(() => {
    if (record) setDurationMs(record.material.durationMs)
    const rec = createRecorder()
    recorderRef.current = rec
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
  }, [record])

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  /** 开始跟读：先起录音（拿麦克风权限），再同步起播放 */
  const begin = async () => {
    const rec = recorderRef.current
    if (!rec || !record) return
    setError(null); setPermDenied(false); setPermMessage(undefined)
    clearEndGrace() // 清掉上一轮播放结束遗留的收尾计时器
    playbackAudioRef.current?.pause() // 开始前停掉上一轮回放，避免回放声混入新录音
    try {
      await rec.start()
    } catch (err) {
      if (err instanceof RecorderPermissionError) { setPermMessage(err.message); setPermDenied(true) }
      else setError(err instanceof Error ? err.message : '录音启动失败')
      return
    }
    setRecMs(0)
    setPlayMs(0)
    setActiveIdx(-1)
    setTranscript('')
    setRecordingUrlFromBlob(null)
    setPaused(false)
    clearTimer()
    timerRef.current = window.setInterval(() => setRecMs(rec.getElapsedMs()), 200)
    const sp = playerRef.current
    if (sp) { sp.seekTo(0); void sp.play() }
    setPhase('recording')
  }

  /** 暂停/继续：播放与录音同步暂停（§4.8）；recorder 暂停段以静音保留 */
  const togglePause = () => {
    const rec = recorderRef.current
    if (!rec || phase !== 'recording') return
    try {
      if (paused) {
        rec.resume()
        void playerRef.current?.play()
        setPaused(false)
      } else {
        rec.pause()
        playerRef.current?.pause()
        setPaused(true)
      }
    } catch { /* 状态不匹配（如已自动收尾）：忽略 */ }
  }

  /** 转写录音（不重新录音）：成功进入结果页；失败也进入结果页（回放可用 + 可重试） */
  const runTranscribe = async (blob: Blob) => {
    setError(null)
    setTranscript('')
    setPhase('transcribing')
    try {
      const text = await transcribeRecording(blob, abortRef.current?.signal)
      setTranscript(text)
      setPhase('result')
    } catch (err) {
      if (toApiError(err).code === 'ABORTED' || abortRef.current?.signal.aborted) return
      setError(err instanceof Error ? err.message : '转写失败，请重试')
      setPhase('result')
    }
  }

  /** 结束录音并转写：停录音 → 保留回放 URL → ASR 转写 */
  const finish = async () => {
    const rec = recorderRef.current
    const recState = rec?.getState()
    if (finishingRef.current || !rec || !record || (recState !== 'recording' && recState !== 'paused')) return
    finishingRef.current = true
    clearEndGrace() // 已在收尾：取消挂起的延迟自动收尾
    clearTimer()
    setPaused(false)
    playerRef.current?.pause()
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
      setPhase('intro')
    } finally {
      finishingRef.current = false
    }
  }
  finishRef.current = finish

  /** 放弃本次录音（不转写） */
  const abandon = () => {
    clearEndGrace()
    clearTimer()
    playerRef.current?.pause()
    recorderRef.current?.cancel()
    setPhase('intro')
  }

  /** 回到引导页（清空上一轮结果） */
  const restart = () => {
    playbackAudioRef.current?.pause()
    setRecordingUrlFromBlob(null)
    setError(null)
    setTranscript('')
    setPhase('intro')
  }

  if (loading) return <Shell back><div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">正在加载材料…</div></Shell>
  if (!record || sentences.length === 0) {
    return <Shell back><div className="mx-auto max-w-3xl px-4 py-8 md:px-8"><Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">该材料暂无字幕，无法进行影子跟读。</p></CardContent></Card></div></Shell>
  }

  const currentSentence = activeIdx >= 0 ? sentences[activeIdx] : undefined
  const playPct = durationMs > 0 ? Math.min(100, Math.round((playMs / durationMs) * 100)) : 0

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">SPEAKING PRACTICE</p>
            <h1 className="font-serif text-3xl font-semibold">影子跟读</h1>
          </div>
          {phase === 'recording' && <Badge variant="destructive">{paused ? '⏸ 已暂停' : '● 录音中'}</Badge>}
        </div>

        {phase === 'intro' && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="flex flex-col gap-5 p-6 md:p-8">
                <div className="rounded-xl bg-muted p-5 text-left">
                  <p className="font-medium">{record.material.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{sentences.length} 句 · 全长 {formatClock(durationMs)} · 录音上限 60 秒（原型）</p>
                </div>
                <div className="flex items-start gap-3 rounded-xl bg-primary/10 p-4 text-left text-primary">
                  <Headphones className="mt-0.5 size-5 shrink-0" />
                  <p className="text-sm leading-relaxed">建议佩戴耳机进行跟读，避免扬声器外放被麦克风拾取产生回声干扰。开始后原音将全文连播，请对照下方原文同步跟读并录音，结束后可回放录音并与原文逐词对比。</p>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button onClick={() => void begin()}>开始跟读</Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-3 p-6 md:p-8">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">原文（可提前预读）</p>
                <OriginalTextCard sentences={sentences} activeIdx={-1} />
              </CardContent>
            </Card>
          </div>
        )}

        {phase === 'recording' && (
          <Card>
            <CardContent className="flex flex-col gap-5 p-6 md:p-8">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{paused ? '⏸ 已暂停' : '▶ 播放中'} {formatClock(playMs)} / {formatClock(durationMs)}</span>
                  <span className={`font-mono ${paused ? 'text-muted-foreground' : 'text-destructive'}`}>{paused ? '⏸ 录音已暂停' : `● 录音中 ${formatClock(recMs)}`}</span>
                </div>
                <Progress value={playPct} />
              </div>
              {!mediaUrl && <p className="rounded-xl bg-muted p-3 text-left text-xs text-muted-foreground">演示材料无音频——仅录音，无原音跟播。导入真实材料后即可边播边录。</p>}
              <div className="flex flex-col gap-2">
                <OriginalTextCard sentences={sentences} activeIdx={activeIdx} />
                {currentSentence?.textZh && <p className="px-2 text-sm text-muted-foreground">当前句：{currentSentence.textZh}</p>}
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={abandon}>放弃</Button>
                <Button variant="outline" onClick={togglePause} aria-pressed={paused}>{paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{paused ? '继续' : '暂停'}</Button>
                <Button onClick={() => void finish()}><Square data-icon="inline-start" />结束跟读</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phase === 'transcribing' && (
          <Card>
            <CardContent className="flex min-h-60 flex-col items-center justify-center gap-4 p-6 text-center md:p-8">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在转写你的跟读…</p>
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
              playbackRef={playbackAudioRef}
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="outline" className="sm:flex-1" onClick={restart}><RotateCcw data-icon="inline-start" />再读一次</Button>
              <Link to={`/training/${record.material.id}`} className="sm:flex-1">
                <Button variant="outline" className="w-full">返回训练中心</Button>
              </Link>
            </div>
          </div>
        )}

        {mediaUrl && record.material.mediaType === 'audio' && <audio ref={audioRef} src={mediaUrl} preload="metadata" className="hidden" />}
      </div>

      <MicPermissionOverlay open={permDenied} message={permMessage} onClose={() => setPermDenied(false)} onRetry={() => { setPermDenied(false); void begin() }} />
    </Shell>
  )
}

export { Shadowing }
