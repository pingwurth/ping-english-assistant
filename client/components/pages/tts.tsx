/**
 * P11 文字转语音 —— 云端 Qwen-Audio-TTS / 本地 Kokoro-82M
 *
 * 模型选择：
 *  - 已配置 ttsModel：云端模型（/api/tts）+ kokoro 本地离线；
 *  - 未配置：仅 kokoro 本地离线 + 「添加模型」（跳转设置页并高亮 TTS 模型输入框）。
 * 文本输入（上限 5000，实时字数统计）+ 音色选择 + 语速 0.5-2.0；
 * [生成] 云端走 /api/tts，本地走 platform/kokoro-tts（浏览器内 ONNX 推理）；
 * 输出统一为 WAV + SRT；试听播放、[保存到设备] 下载 WAV、
 * [导入为学习材料] writeTtsExport 后跳转导入页。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Download, Loader2, Play, Sparkles, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Shell, PageIntro } from '@/components/shared/shell'
import { formatDuration } from '@/components/shared/player-parts'
import { TTS_MAX_TEXT_LENGTH } from '@/services/mock/tts'
import { writeTtsExport } from '@/lib/tts-export'
import { generateKokoroTts, KOKORO_VOICES, type KokoroLoadEvent } from '@/platform/kokoro-tts'

/** 云端 TTS 默认音色（settings 加载前的 fallback） */
const DEFAULT_CLOUD_VOICES = [
  { id: 'longanlingxin', label: 'Lingxin · Female (双语)' },
  { id: 'longanlufeng', label: 'Lufeng · Male (双语)' },
] as const

/** 本地 Kokoro 音色（美式英文） */
const KOKORO_VOICE_LIST = KOKORO_VOICES.map((v) => ({ id: v.id, label: v.label }))

/** 语速档位（0.5 ~ 2.0） */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

/** 合成引擎：云端模型 / 本地 kokoro */
type TtsEngine = 'cloud' | 'kokoro'

/** 「添加模型」下拉项的哨兵值（非真实引擎） */
const ADD_MODEL_VALUE = '__add_model__'

type GenPhase = 'idle' | 'generating' | 'ready' | 'error'

interface GenResult {
  taskId: string
  audio: Blob
  url: string
  durationMs: number
  sentenceCount: number
  srt: string
}

function dateStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function TTS() {
  const navigate = useNavigate()
  const [text, setText] = useState('You should answer the questions as you listen. Repeat each sentence as clearly as you can.')
  const [engine, setEngine] = useState<TtsEngine>('cloud')
  const [voiceIdx, setVoiceIdx] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(2)
  const [ttsModelName, setTtsModelName] = useState('')
  const [cloudVoices, setCloudVoices] = useState<ReadonlyArray<{ id: string; label: string }>>(DEFAULT_CLOUD_VOICES)
  const [configured, setConfigured] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [kokoroLoad, setKokoroLoad] = useState<KokoroLoadEvent | null>(null)
  const [phase, setPhase] = useState<GenPhase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [err, setErr] = useState('')
  const [gen, setGen] = useState<GenResult | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [savedName, setSavedName] = useState('')
  const [goImport, setGoImport] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // 音色列表随引擎切换
  const voices = engine === 'kokoro' ? KOKORO_VOICE_LIST : cloudVoices
  const voice = voices[voiceIdx] ?? voices[0]!
  const speed = SPEEDS[speedIdx] ?? 1
  const overLimit = text.length > TTS_MAX_TEXT_LENGTH
  const hasNonEnglish = /[^\u0000-\u007F]/.test(text)

  // 模型下拉选项：已配置 → 云端模型 + kokoro；未配置 → kokoro + 添加模型
  const modelOptions = useMemo(() => {
    if (configured && ttsModelName) {
      return [
        { value: 'cloud', label: `${ttsModelName} · 云端` },
        { value: 'kokoro', label: 'kokoro · 本地离线' },
      ]
    }
    return [
      { value: 'kokoro', label: 'kokoro · 本地离线' },
      { value: ADD_MODEL_VALUE, label: '＋ 添加模型' },
    ]
  }, [configured, ttsModelName])

  useEffect(() => {
    fetch('/api/settings/llm')
      .then(res => res.json())
      .then(data => {
        const isConfigured = !!data.configured
        setConfigured(isConfigured)
        if (data.ttsModel) setTtsModelName(data.ttsModel)
        if (data.ttsVoices?.length) setCloudVoices(data.ttsVoices)
        // 仅当配置了 ttsModel 时才默认云端，否则选中本地 kokoro
        setEngine(isConfigured && data.ttsModel ? 'cloud' : 'kokoro')
      })
      .catch(() => setEngine('kokoro'))
      .finally(() => setSettingsLoaded(true))
  }, [])

  const handleEngineChange = (value: string) => {
    if (value === ADD_MODEL_VALUE) {
      // 跳转设置页，定位并高亮「模型配置 → TTS 模型」输入框
      navigate('/settings?tab=model&highlight=tts-model')
      return
    }
    const next = value as TtsEngine
    setEngine(next)
    setVoiceIdx(0) // 切换引擎后音色列表变化，重置到第一项
  }

  const stopPreview = () => {
    audioRef.current?.pause()
    setSpeaking(false)
  }

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

  const generateCloud = async (abort: AbortController, estimatedSentences: number): Promise<GenResult> => {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voice.id, speed }),
      signal: abort.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `生成失败 (${res.status})`)
    if (abort.signal.aborted) throw new DOMException('已取消', 'AbortError')

    setProgress({ done: estimatedSentences, total: estimatedSentences })

    const binaryStr = atob(data.audioBase64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
    const audioBlob = new Blob([bytes], { type: 'audio/wav' })

    return {
      taskId: data.taskId,
      audio: audioBlob,
      url: URL.createObjectURL(audioBlob),
      durationMs: data.durationMs,
      sentenceCount: data.sentenceCount,
      srt: data.srt,
    }
  }

  const generateLocal = async (abort: AbortController): Promise<GenResult> => {
    const result = await generateKokoroTts({
      text,
      voice: voice.id,
      speed,
      signal: abort.signal,
      onSentenceProgress: (done, total) => setProgress({ done, total }),
      onLoad: (e) => setKokoroLoad(e),
    })
    if (abort.signal.aborted) throw new DOMException('已取消', 'AbortError')
    return {
      taskId: result.taskId,
      audio: result.blob,
      url: URL.createObjectURL(result.blob),
      durationMs: result.durationMs,
      sentenceCount: result.timings.length,
      srt: result.srt,
    }
  }

  const startGenerate = async () => {
    stopPreview()
    setPhase('generating')
    setProgress({ done: 0, total: 0 })
    setErr('')
    setSavedName('')
    setKokoroLoad(null)
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const estimatedSentences = text.split(/[.!?;:\n]+/).filter(s => s.trim()).length || 1
      setProgress({ done: 0, total: estimatedSentences })

      const result = engine === 'kokoro'
        ? await generateLocal(abort)
        : await generateCloud(abort, estimatedSentences)
      if (abort.signal.aborted) return

      setGen(result)
      setPhase('ready')
    } catch (e) {
      if (abort.signal.aborted) return
      if (e instanceof DOMException && e.name === 'AbortError') return
      setErr(e instanceof Error ? e.message : '生成失败，请重试')
      setPhase('error')
    }
  }

  const cancelGenerate = () => {
    abortRef.current?.abort()
    setPhase('idle')
  }

  const preview = () => {
    if (speaking) { stopPreview(); return }
    if (!gen || !audioRef.current) return
    audioRef.current.currentTime = 0
    setCurrentTime(0)
    audioRef.current.play().then(() => setSpeaking(true)).catch(() => {})
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime * 1000) // ms
    }
  }

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
  // 生成按钮：云端需已配置；本地 kokoro 随时可用
  const canGenerate = !overLimit && !!text.trim() && (engine === 'kokoro' || configured)

  // kokoro 下载/加载中的进度文案
  const kokoroLoading = engine === 'kokoro' && generating && kokoroLoad !== null && progress.done === 0

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <PageIntro title="文字转语音" eyebrow="QWEN-AUDIO-TTS / KOKORO">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">英文学习工具</Badge>
            {engine === 'kokoro'
              ? <Badge variant="outline">kokoro-82m · 本地</Badge>
              : ttsModelName && <Badge variant="outline">{ttsModelName}</Badge>}
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
              <label className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <span className="text-muted-foreground">模型：</span>
                <select
                  value={engine}
                  onChange={(e) => handleEngineChange(e.target.value)}
                  disabled={generating || !settingsLoaded}
                  aria-label="选择语音模型"
                  className="bg-transparent text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {settingsLoaded && modelOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <span className="text-muted-foreground">音色：</span>
                <select
                  value={voiceIdx}
                  onChange={(e) => setVoiceIdx(Number(e.target.value))}
                  disabled={generating}
                  aria-label="选择音色"
                  className="bg-transparent text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {voices.map((v, i) => (
                    <option key={v.id} value={i}>{v.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <span className="text-muted-foreground">语速：</span>
                <select
                  value={speedIdx}
                  onChange={(e) => setSpeedIdx(Number(e.target.value))}
                  disabled={generating}
                  aria-label="选择语速"
                  className="bg-transparent text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {SPEEDS.map((s, i) => (
                    <option key={s} value={i}>{s}x</option>
                  ))}
                </select>
              </label>
              {generating
                ? <Button variant="secondary" onClick={cancelGenerate}><Square data-icon="inline-start" />取消生成</Button>
                : <Button onClick={() => void startGenerate()} disabled={!canGenerate}><Sparkles data-icon="inline-start" />生成语音</Button>}
            </div>
            {!configured && engine === 'cloud' && (
              <p className="text-xs text-destructive">请先在「设置 → 模型配置」中配置 API Key 和 TTS 模型</p>
            )}

            {generating && (
              <div className="rounded-xl bg-muted p-5">
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {kokoroLoad?.phase === 'downloading'
                    ? `下载 Kokoro 模型 ${Math.round(kokoroLoad.percent ?? 0)}%${kokoroLoad.file ? ` · ${kokoroLoad.file}` : ''}`
                    : kokoroLoad?.phase === 'initializing'
                      ? '正在加载 Kokoro 模型…'
                      : progress.total > 0
                        ? `合成第 ${progress.done}/${progress.total} 句…`
                        : engine === 'kokoro' ? '正在本地合成语音…' : '正在调用云端语音合成…'}
                </div>
                <Progress
                  value={kokoroLoading && kokoroLoad?.phase === 'downloading'
                    ? Math.round(kokoroLoad.percent ?? 0)
                    : progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 5}
                />
                {engine === 'kokoro' && <p className="mt-2 text-xs text-muted-foreground">本地合成，无需联网（首次使用需下载约 80MB 模型）</p>}
              </div>
            )}

            {phase === 'error' && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
                <span>{err}</span>
                <Button variant="outline" size="sm" onClick={() => void startGenerate()}>重试</Button>
              </div>
            )}

            {phase === 'ready' && gen && (
              <div className="rounded-xl bg-muted p-5">
                <div className="flex items-center gap-3">
                  <Button size="icon" className="rounded-full" onClick={preview} aria-label={speaking ? '停止试听' : '试听'}>
                    {speaking ? <Square /> : <Play />}
                  </Button>
                  <div className="h-2 flex-1 rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${gen.durationMs > 0 ? (currentTime / gen.durationMs) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDuration(currentTime)} / {formatDuration(gen.durationMs)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{gen.sentenceCount} 句 · SRT 字幕已生成</Badge>
                  {speaking && <Badge variant="outline">播放中</Badge>}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button variant="outline" onClick={saveToDevice}><Download data-icon="inline-start" />保存到设备</Button>
                  <Button onClick={() => void importAsMaterial()}>导入为学习材料</Button>
                </div>
                {savedName && <p className="mt-3 text-xs text-muted-foreground">已保存至浏览器下载目录：{savedName}</p>}
                <p className="mt-3 text-xs text-muted-foreground">导入后可直接逐句精听与训练，字幕已按句自动对齐。</p>
              </div>
            )}

            {gen && <audio ref={audioRef} src={gen.url} preload="metadata" onTimeUpdate={handleTimeUpdate} onEnded={() => { setSpeaking(false); setCurrentTime(0) }} className="hidden" />}
          </CardContent>
        </Card>
      </div>
    </Shell>
  )
}

export { TTS }
