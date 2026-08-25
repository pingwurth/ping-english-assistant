/**
 * P11 文字转语音 —— 真源：docs/原型设计.md §4.12 / docs/系统架构设计.md §3.3 契约⑥⑦
 *
 * 文本输入（上限 5000，实时字数统计，超限红字禁用生成）+ Kokoro 声音选择
 * （af_heart / af_bella / am_michael，标注"模拟声音"）+ 语速 0.5-2.0 循环按钮。
 * [生成] 走 MockTtsService（契约⑥）：分句进度（第 n/N 句）→ 占位 WAV + SRT（契约⑦）；
 * 试听优先 speechSynthesis 朗读（effect/回调内访问，SSR 安全），不可用时播放
 * 占位 WAV 并标注"模拟合成"；[保存到设备] a[download] 下载 WAV；
 * [导入为学习材料] writeTtsExport（lib/tts-export）后 <Navigate replace> 至
 * /import?source=tts&taskId=，导入页自动填充生效。
 */

import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ChevronDown, Download, Loader2, Play, Sparkles, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Shell, PageIntro } from '@/components/shared/shell'
import { formatDuration } from '@/components/shared/player-parts'
import { getMockServices, toApiError } from '@/services'
import { TTS_MAX_TEXT_LENGTH } from '@/services/mock/tts'
import { writeTtsExport } from '@/lib/tts-export'

/** Kokoro 内置声音（原型取三档；真实音色见架构 §3.4，此处为模拟声音） */
const VOICES = [
  { id: 'af_heart', label: 'Heart · 美式女声' },
  { id: 'af_bella', label: 'Bella · 美式女声' },
  { id: 'am_michael', label: 'Michael · 美式男声' },
] as const

/** 语速档位（契约⑥ 0.5 ~ 2.0） */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

type GenPhase = 'idle' | 'generating' | 'ready' | 'error'

interface GenResult {
  taskId: string
  audio: Blob
  url: string
  durationMs: number
  sentenceCount: number
  srt: string
}

/** 文件名时间戳：20260825-1530 */
function dateStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function TTS() {
  const [text, setText] = useState('You should answer the questions as you listen. Repeat each sentence as clearly as you can.')
  const [voiceIdx, setVoiceIdx] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(2)
  const [phase, setPhase] = useState<GenPhase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [err, setErr] = useState('')
  const [gen, setGen] = useState<GenResult | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [previewMode, setPreviewMode] = useState<'speech' | 'wav'>('speech')
  const [savedName, setSavedName] = useState('')
  const [goImport, setGoImport] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const voice = VOICES[voiceIdx] ?? VOICES[0]!
  const speed = SPEEDS[speedIdx] ?? 1
  const overLimit = text.length > TTS_MAX_TEXT_LENGTH
  const hasNonEnglish = /[^\u0000-\u007F]/.test(text)

  /** 停止试听（speechSynthesis 与占位 WAV 两路） */
  const stopPreview = () => {
    try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel() } catch { /* ignore */ }
    audioRef.current?.pause()
    setSpeaking(false)
  }

  // 卸载清理：中止生成请求、停止试听、释放 ObjectURL（SSR 安全：仅 effect 内）
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      stopPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    return () => { if (gen?.url) URL.revokeObjectURL(gen.url) }
  }, [gen])

  /** 生成（契约⑥）：分句进度回调 → 占位 WAV + SRT（契约⑦领取） */
  const startGenerate = async () => {
    stopPreview()
    setPhase('generating')
    setProgress({ done: 0, total: 0 })
    setErr('')
    setSavedName('')
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const { tts } = getMockServices({ tts: { onProgress: (done, total) => setProgress({ done, total }) } })
      const res = await tts.generate(
        { text, voice: voice.id, speed, format: 'wav', withSubtitle: true },
        abort.signal,
      )
      const sub = await tts.getSubtitle(res.meta.taskId, abort.signal)
      if (abort.signal.aborted) return
      setGen({
        taskId: res.meta.taskId,
        audio: res.audio,
        url: URL.createObjectURL(res.audio),
        durationMs: res.meta.durationMs,
        sentenceCount: res.meta.sentenceCount,
        srt: sub.srt,
      })
      setPhase('ready')
    } catch (e) {
      if (abort.signal.aborted) return
      const apiErr = toApiError(e)
      if (apiErr.code === 'ABORTED') return
      setErr(apiErr.message || '生成失败，请重试')
      setPhase('error')
    }
  }

  const cancelGenerate = () => {
    abortRef.current?.abort()
    setPhase('idle')
  }

  /** 试听：优先 speechSynthesis 朗读文本；不可用时播放占位 WAV（标注"模拟合成"） */
  const preview = () => {
    if (speaking) { stopPreview(); return }
    if (!gen) return
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      u.rate = speed
      u.onend = () => setSpeaking(false)
      u.onerror = () => setSpeaking(false)
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
      setPreviewMode('speech')
      setSpeaking(true)
    } else if (audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.play().then(() => setSpeaking(true)).catch(() => { /* 播放被拒：保持静默 */ })
      setPreviewMode('wav')
    }
  }

  /** 保存到设备：a[download] 下载 WAV */
  const saveToDevice = () => {
    if (!gen) return
    const fileName = `ping-tts-${voice.id}-${dateStamp()}.wav`
    const a = document.createElement('a')
    a.href = gen.url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setSavedName(fileName)
  }

  /** 导入为学习材料：writeTtsExport（IDB 音频 + sessionStorage 索引）→ 声明式跳转 */
  const importAsMaterial = async () => {
    if (!gen) return
    await writeTtsExport(gen.taskId, gen.audio, {
      name: `TTS · ${text.trim().slice(0, 40) || '语音合成'}`.slice(0, 50),
      audioFileName: `ping-tts-${gen.taskId}.wav`,
      subtitleText: gen.srt,
      subtitleFormat: 'srt',
      createdAt: Date.now(),
    })
    setGoImport(`/import?source=tts&taskId=${gen.taskId}`)
  }

  if (goImport) return <Navigate to={goImport} replace />

  const generating = phase === 'generating'

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <PageIntro title="文字转语音" eyebrow="KOKORO VOICE">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">英文学习工具</Badge>
            <Badge variant="outline">模拟声音</Badge>
          </div>
        </PageIntro>
        <Card>
          <CardContent className="flex flex-col gap-6 p-6">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-48 text-lg"
              placeholder="输入英文文本…"
              disabled={generating}
              aria-label="待合成英文文本"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className={overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                {text.length} / {TTS_MAX_TEXT_LENGTH} 字{overLimit && '，已超出上限，请删减后再生成'}
              </span>
              {hasNonEnglish && !overLimit && <span className="text-muted-foreground">当前语音模型针对英文优化</span>}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" disabled={generating} onClick={() => setVoiceIdx((voiceIdx + 1) % VOICES.length)} aria-label="切换声音">
                声音：{voice.label} <ChevronDown />
              </Button>
              <Button variant="outline" disabled={generating} onClick={() => setSpeedIdx((speedIdx + 1) % SPEEDS.length)} aria-label="切换语速">
                语速：{speed}x <ChevronDown />
              </Button>
              {generating
                ? <Button variant="secondary" onClick={cancelGenerate}><Square data-icon="inline-start" />取消生成</Button>
                : <Button onClick={() => void startGenerate()} disabled={overLimit || !text.trim()}><Sparkles data-icon="inline-start" />生成语音</Button>}
            </div>

            {/* 生成中：分句进度（第 n/N 句） */}
            {generating && (
              <div className="rounded-xl bg-muted p-5">
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {progress.total > 0 ? `合成第 ${progress.done}/${progress.total} 句…` : '排队中，正在加载声音模型…'}
                </div>
                <Progress value={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 5} />
              </div>
            )}

            {/* 失败态：文本保留，可重试 */}
            {phase === 'error' && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
                <span>{err}</span>
                <Button variant="outline" size="sm" onClick={() => void startGenerate()}>重试</Button>
              </div>
            )}

            {/* 生成完成：试听 + 保存 + 导入 */}
            {phase === 'ready' && gen && (
              <div className="rounded-xl bg-muted p-5">
                <div className="flex items-center gap-3">
                  <Button size="icon" className="rounded-full" onClick={preview} aria-label={speaking ? '停止试听' : '试听'}>
                    {speaking ? <Square /> : <Play />}
                  </Button>
                  <div className="h-2 flex-1 rounded-full bg-background">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: speaking ? '100%' : '0%' }} />
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">{formatDuration(gen.durationMs)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{gen.sentenceCount} 句 · SRT 字幕已生成</Badge>
                  {speaking && previewMode === 'speech' && <Badge variant="outline">浏览器语音朗读试听</Badge>}
                  {previewMode === 'wav' && <Badge variant="outline">模拟合成 · 占位音</Badge>}
                  {!speaking && <span>试听优先使用浏览器语音朗读，音频文件为模拟合成占位音</span>}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button variant="outline" onClick={saveToDevice}><Download data-icon="inline-start" />保存到设备</Button>
                  <Button onClick={() => void importAsMaterial()}>导入为学习材料</Button>
                </div>
                {savedName && <p className="mt-3 text-xs text-muted-foreground">已保存至浏览器下载目录：{savedName}（字幕随导入自动带入）</p>}
                <p className="mt-3 text-xs text-muted-foreground">导入后可直接逐句精听与训练，字幕已按句自动对齐。</p>
              </div>
            )}

            {gen && <audio ref={audioRef} src={gen.url} preload="metadata" onEnded={() => setSpeaking(false)} className="hidden" />}
          </CardContent>
        </Card>
      </div>
    </Shell>
  )
}

export { TTS }
