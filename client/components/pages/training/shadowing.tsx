/**
 * P7 影子跟读 —— 边播边录：耳机提示确认 → 全文连播 + 同步录音 → 结束后
 * 分步分析（上传→转写→分析）→ ASR mock 转写 → setReportPayload → 跳 P9 报告页。
 *
 * 说明（原型设计 §4.8）：
 *  - [暂停/继续] 同步暂停播放与录音（player.pause/play + recorder.pause/resume）；
 *    注意 recorder pause/resume 保留静音段（约定见 platform/recorder.ts），转写结果含暂停间隔；
 *  - 播放自然结束 / 录音到达 60s 上限 / 用户点击 [结束并分析] 三条路径统一走 finish()；
 *  - 耳机提示受 pref:headphoneHint 开关控制（"不再提示"勾选写回 prefs，lib/pref-keys.ts）；
 *  - echoCancellation 已由 recorder 默认开启（getUserMedia 约束）；
 *  - 麦克风权限拒绝渲染引导浮层（§6.3，shared/score-panel.tsx MicPermissionOverlay）；
 *  - 会话载荷契约见 lib/report-session.ts（供批次 E 的 P9 报告页消费）。
 */

import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, Eye, EyeOff, Headphones, Loader2, Pause, Play, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Shell } from '@/components/shared/shell'
import { MicPermissionOverlay } from '@/components/shared/score-panel'
import { setReportPayload } from '@/lib/report-session'
import { getHeadphoneHint, setHeadphoneHint } from '@/lib/pref-keys'
import { SentencePlayer } from '@/core/player/sentence-player'
import { HtmlPlayerController } from '@/platform/html-player'
import { createRecorder, RecorderPermissionError, type WebRecorder } from '@/platform/recorder'
import { getMediaBlob } from '@/stores/material-store'
import { useTrainingMaterial } from '@/components/shared/training-session-shell'
import { abortableDelay, getMockServices, toApiError } from '@/services'

type Phase = 'intro' | 'recording' | 'analyzing' | 'report'

/** 分析步骤（对应 mock 延迟阶段：上传→转写→分析） */
const ANALYZE_STEPS = ['上传录音', '语音转写', 'AI 分析']

/** 时钟文案：03:24（原型 §4.8 跟读中状态） */
function formatClock(ms: number): string {
  const t = Math.max(0, ms)
  const m = Math.floor(t / 60000)
  const s = Math.floor((t % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function Shadowing() {
  const { record, loading } = useTrainingMaterial()

  const [phase, setPhase] = useState<Phase>('intro')
  const [stage, setStage] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [playMs, setPlayMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [recMs, setRecMs] = useState(0)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [showSub, setShowSub] = useState(false)
  const [paused, setPaused] = useState(false)
  /** 耳机提示开关：读 pref:headphoneHint（false 时跳过提示卡直接进入就绪） */
  const [headphoneHint, setHeadphoneHintOn] = useState(() => getHeadphoneHint())
  const [permDenied, setPermDenied] = useState(false)
  const [permMessage, setPermMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)
  const recorderRef = useRef<WebRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startedAtRef = useRef(0)
  const finishingRef = useRef(false)
  const finishRef = useRef<() => Promise<void>>(async () => {})

  const sentences = record?.subtitleData?.sentences ?? []

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

  // 播放引擎装配：全文连播（timeupdate 驱动进度，ended 触发收尾）
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
    sp.on('ended', () => { void finishRef.current() })
    return () => { sp.destroy(); controller.destroy(); playerRef.current = null }
  }, [record, mediaUrl])

  // 录音器生命周期：挂载创建；到达 60s 上限自动收尾；卸载 destroy + 中止分析请求
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
    try {
      await rec.start()
    } catch (err) {
      if (err instanceof RecorderPermissionError) { setPermMessage(err.message); setPermDenied(true) }
      else setError(err instanceof Error ? err.message : '录音启动失败')
      return
    }
    startedAtRef.current = Date.now()
    setRecMs(0)
    setPlayMs(0)
    setTranscript('')
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

  /** 结束录音并分步分析：上传（模拟延迟）→ 转写（ASR mock）→ 分析（移交 P9） */
  const finish = async () => {
    const rec = recorderRef.current
    const recState = rec?.getState()
    if (finishingRef.current || !rec || !record || (recState !== 'recording' && recState !== 'paused')) return
    finishingRef.current = true
    clearTimer()
    setPaused(false)
    playerRef.current?.pause()
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
      // 会话载荷（契约见 lib/report-session.ts）→ P9 报告页消费
      setReportPayload({
        mode: 'shadowing',
        materialId: record.material.id,
        materialTitle: record.material.name,
        transcript: res.text,
        sentences: sentences.map((s) => ({ index: s.index, textEn: s.textEn, textZh: s.textZh ?? '' })),
        recordingBlob: audio.blob,
        startedAt: startedAtRef.current,
      })
      setPhase('report')
    } catch (err) {
      // 中止区分：卸载/主动放弃的 abort 静默，仅真实异常展示错误条
      if (toApiError(err).code === 'ABORTED' || abortRef.current?.signal.aborted) return
      setError(err instanceof Error ? err.message : '分析失败，请重试')
      setPhase('intro')
    } finally {
      finishingRef.current = false
    }
  }
  finishRef.current = finish

  /** 放弃本次录音（不分析） */
  const abandon = () => {
    clearTimer()
    playerRef.current?.pause()
    recorderRef.current?.cancel()
    setPhase('intro')
  }

  if (loading) return <Shell back><div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">正在加载材料…</div></Shell>
  if (!record || sentences.length === 0) {
    return <Shell back><div className="mx-auto max-w-3xl px-4 py-8 md:px-8"><Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">该材料暂无字幕，无法进行影子跟读。</p></CardContent></Card></div></Shell>
  }

  if (phase === 'report') return <Navigate to="/training/report" replace />

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
          <Card>
            <CardContent className="flex flex-col gap-5 p-6 md:p-8">
              <div className="rounded-xl bg-muted p-5 text-left">
                <p className="font-medium">{record.material.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{sentences.length} 句 · 全长 {formatClock(durationMs)} · 录音上限 60 秒（原型）</p>
              </div>
              {headphoneHint && (
                <div className="flex flex-col gap-2 rounded-xl bg-primary/10 p-4 text-left text-primary">
                  <div className="flex items-start gap-3">
                    <Headphones className="mt-0.5 size-5 shrink-0" />
                    <p className="text-sm leading-relaxed">建议佩戴耳机进行跟读，避免扬声器外放被麦克风拾取产生回声干扰。开始后原音将全文连播，请同步跟读并录音。</p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 pl-8 text-xs text-primary/80">
                    <input type="checkbox" className="size-3.5 accent-current" onChange={(e) => { setHeadphoneHint(!e.target.checked); setHeadphoneHintOn(!e.target.checked) }} />
                    不再提示
                  </label>
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={() => void begin()}>开始跟读</Button>
            </CardContent>
          </Card>
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
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setShowSub(!showSub)} aria-pressed={showSub}>
                  {showSub ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}{showSub ? '隐藏当前句' : '显示当前句'}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={abandon}>放弃</Button>
                  <Button variant="outline" onClick={togglePause} aria-pressed={paused}>{paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{paused ? '继续' : '暂停'}</Button>
                  <Button onClick={() => void finish()}><Square data-icon="inline-start" />结束并分析</Button>
                </div>
              </div>
              {showSub && (
                <div className="rounded-xl bg-muted p-4 text-left">
                  <p className="leading-relaxed">{currentSentence?.textEn ?? '等待播放开始…'}</p>
                  {currentSentence?.textZh && <p className="mt-1 text-sm text-muted-foreground">{currentSentence.textZh}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {phase === 'analyzing' && (
          <Card>
            <CardContent className="flex flex-col gap-3 p-6 md:p-8">
              <p className="mb-1 text-sm text-muted-foreground">正在分析你的跟读…</p>
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
                  <p className="mt-2 text-xs text-muted-foreground">录音中的暂停段以静音保留，转写结果可能包含相应间隔。</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {mediaUrl && record.material.mediaType === 'audio' && <audio ref={audioRef} src={mediaUrl} preload="metadata" className="hidden" />}
      </div>

      <MicPermissionOverlay open={permDenied} message={permMessage} onClose={() => setPermDenied(false)} onRetry={() => { setPermDenied(false); void begin() }} />
    </Shell>
  )
}

export { Shadowing }
