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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Shell, PageIntro } from '@/components/shared/shell'
import { formatDuration } from '@/components/shared/player-parts'
import { TTS_MAX_TEXT_LENGTH } from '@/services/mock/tts'
import { writeTtsExport } from '@/lib/tts-export'
import { translateTexts, detectDirection, mergeBilingualSrt } from '@/lib/translate'
import { getTranslateEnabled, setTranslateEnabled } from '@/lib/pref-keys'
import { parseSubtitle } from '@/core/subtitle'
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
  const [ttsConfigs, setTtsConfigs] = useState<Array<{ id: string; name: string; ttsModel: string; ttsVoices: ReadonlyArray<{ id: string; label: string }> }>>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string>('')
  const [cloudVoices, setCloudVoices] = useState<ReadonlyArray<{ id: string; label: string }>>(DEFAULT_CLOUD_VOICES)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [kokoroLoad, setKokoroLoad] = useState<KokoroLoadEvent | null>(null)
  const [phase, setPhase] = useState<GenPhase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [err, setErr] = useState('')
  // 翻译开关与翻译模型配置（与生成错误分离的独立降级提示）
  const [translateEnabled, setTranslateEnabledState] = useState<boolean>(() => getTranslateEnabled())
  const [translateConfigs, setTranslateConfigs] = useState<Array<{ id: string; name: string; translateModel: string }>>([])
  const [selectedTranslateConfigId, setSelectedTranslateConfigId] = useState<string>('')
  const [translateErr, setTranslateErr] = useState('')
  const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number } | null>(null)
  const [gen, setGen] = useState<GenResult | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [savedName, setSavedName] = useState('')
  const [goImport, setGoImport] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // 音色列表随引擎切换
  const isKokoro = engine === 'kokoro'
  const voices = isKokoro ? KOKORO_VOICE_LIST : cloudVoices
  const voice = voices[voiceIdx] ?? voices[0]!
  const speed = SPEEDS[speedIdx] ?? 1
  const overLimit = text.length > TTS_MAX_TEXT_LENGTH
  const hasNonEnglish = /[^\u0000-\u007F]/.test(text)

  // 当前选中的 TTS 配置
  const selectedConfig = ttsConfigs.find(c => c.id === selectedConfigId)
  const ttsModelName = selectedConfig?.ttsModel ?? ''

  // 模型下拉选项：所有已配置的 TTS 模型 + kokoro + 添加模型
  const modelOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = ttsConfigs.map(c => ({
      value: c.id,
      label: `${c.ttsModel} · ${c.name}`,
    }))
    opts.push({ value: 'kokoro', label: 'kokoro · 本地离线' })
    if (ttsConfigs.length === 0) {
      opts.push({ value: ADD_MODEL_VALUE, label: '＋ 添加模型' })
    }
    return opts
  }, [ttsConfigs])

  // 字幕预览（基于 gen.srt 缓存）：有 textZh 时中英两行，否则仅英文行。
  // 注意：必须位于 goImport 早返回之前，与其他 hook 一起调用，保证 hook 顺序稳定
  const previewSentences = useMemo(() => {
    if (!gen) return []
    return parseSubtitle(gen.srt).sentences
  }, [gen?.srt])

  useEffect(() => {
    fetch('/api/settings/llm-configs')
      .then(res => res.json())
      .then(data => {
        const configs = (data.configs || []).filter((c: { ttsModel?: string }) => c.ttsModel)
        setTtsConfigs(configs)
        // 同一响应中顺带提取已配置翻译模型的配置（不发第二次请求）
        const translateCfgs = (data.configs || []).filter((c: { translateModel?: string }) => c.translateModel)
        setTranslateConfigs(translateCfgs)
        if (translateCfgs.length > 0) {
          const defaultTranslateCfg = translateCfgs.find((c: { id: string }) => c.id === data.defaultId) || translateCfgs[0]
          setSelectedTranslateConfigId(defaultTranslateCfg.id)
        }
        if (configs.length > 0) {
          const defaultConfig = configs.find((c: { id: string }) => c.id === data.defaultId) || configs[0]
          setSelectedConfigId(defaultConfig.id)
          if (defaultConfig.ttsVoices?.length) setCloudVoices(defaultConfig.ttsVoices)
          setEngine('cloud')
        } else {
          setEngine('kokoro')
        }
      })
      .catch(() => setEngine('kokoro'))
      .finally(() => setSettingsLoaded(true))
  }, [])

  const handleEngineChange = (value: string) => {
    if (value === ADD_MODEL_VALUE) {
      navigate('/settings?tab=model&highlight=tts-model')
      return
    }
    if (value === 'kokoro') {
      setEngine('kokoro')
      setVoiceIdx(0)
    } else {
      // value is a config id
      const cfg = ttsConfigs.find(c => c.id === value)
      if (cfg) {
        setSelectedConfigId(cfg.id)
        if (cfg.ttsVoices?.length) setCloudVoices(cfg.ttsVoices)
        setEngine('cloud')
        setVoiceIdx(0)
      }
    }
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
  // 依赖收窄为 gen?.url：翻译成功后 setGen 仅替换 srt 而复用同一 Object URL，
  // 若依赖整个 gen 对象会在 URL 仍在使用时被提前 revoke，导致试听/下载失效；
  // 仅当 URL 真正变化（新生成）或组件卸载时才释放。
  useEffect(() => {
    return () => { if (gen?.url) URL.revokeObjectURL(gen.url) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen?.url])

  const generateCloud = async (abort: AbortController, estimatedSentences: number): Promise<GenResult> => {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voice.id, speed, configId: selectedConfigId || undefined }),
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

  /** 翻译开关切换：同步持久化到 localStorage */
  const handleTranslateToggle = (v: boolean) => {
    setTranslateEnabledState(v)
    setTranslateEnabled(v)
    setTranslateErr('')
  }

  const startGenerate = async () => {
    stopPreview()
    setPhase('generating')
    setProgress({ done: 0, total: 0 })
    setErr('')
    setTranslateErr('')
    setTranslateProgress(null)
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

      // 先生成后翻译：开关开启且已选翻译配置时，追加双语字幕；失败降级保留单语
      if (translateEnabled && selectedTranslateConfigId) {
        try {
          const { sentences } = parseSubtitle(result.srt)
          const texts = sentences.map(s => s.textEn)
          const direction = detectDirection(texts)
          setTranslateProgress({ done: 0, total: texts.length })
          const translations = await translateTexts(
            texts,
            selectedTranslateConfigId || undefined,
            direction,
            abort.signal,
            (done, total) => setTranslateProgress({ done, total }),
          )
          if (abort.signal.aborted) return
          const bilingual = mergeBilingualSrt(result.srt, translations, direction)
          setGen({ ...result, srt: bilingual })
        } catch (te) {
          if (abort.signal.aborted) return
          if (te instanceof DOMException && te.name === 'AbortError') return
          setTranslateErr('翻译失败，已保留单语字幕：' + (te instanceof Error ? te.message : '未知错误'))
        } finally {
          setTranslateProgress(null)
        }
      }

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
  // 生成按钮：云端需有选中配置；本地 kokoro 随时可用；翻译开启时需已配置翻译模型
  const canGenerate = !overLimit && !!text.trim() && (engine === 'kokoro' || ttsConfigs.length > 0)
    && !(translateEnabled && translateConfigs.length === 0)

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
              : selectedConfig && <Badge variant="outline">{ttsModelName}</Badge>}
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
                  value={isKokoro ? 'kokoro' : selectedConfigId}
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
              <label className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <span className="text-muted-foreground">翻译：</span>
                <Switch
                  checked={translateEnabled}
                  onCheckedChange={handleTranslateToggle}
                  disabled={generating}
                  aria-label="生成后翻译为双语字幕"
                />
              </label>
              {translateEnabled && translateConfigs.length > 0 && (
                <label className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <span className="text-muted-foreground">翻译模型：</span>
                  <select
                    value={selectedTranslateConfigId}
                    onChange={(e) => setSelectedTranslateConfigId(e.target.value)}
                    disabled={generating || !settingsLoaded}
                    aria-label="选择翻译模型"
                    className="bg-transparent text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {translateConfigs.map((c) => (
                      <option key={c.id} value={c.id}>{c.translateModel} · {c.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {generating
                ? <Button variant="secondary" onClick={cancelGenerate}><Square data-icon="inline-start" />取消生成</Button>
                : <Button onClick={() => void startGenerate()} disabled={!canGenerate}><Sparkles data-icon="inline-start" />生成语音</Button>}
            </div>
            {!isKokoro && ttsConfigs.length === 0 && (
              <p className="text-xs text-destructive">请先在「设置 → 模型配置」中配置 TTS 模型</p>
            )}
            {translateEnabled && translateConfigs.length === 0 && (
              <p className="text-xs text-destructive">请先在「设置 → 模型配置」中配置翻译模型</p>
            )}
            {translateErr && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{translateErr}</p>
            )}

            {generating && (
              <div className="rounded-xl bg-muted p-5">
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {kokoroLoad?.phase === 'downloading'
                    ? `下载 Kokoro 模型 ${Math.round(kokoroLoad.percent ?? 0)}%${kokoroLoad.file ? ` · ${kokoroLoad.file}` : ''}`
                    : kokoroLoad?.phase === 'initializing'
                      ? '正在加载 Kokoro 模型…'
                      : translateProgress
                        ? `正在翻译第 ${translateProgress.done}/${translateProgress.total} 句…`
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
                {previewSentences.length > 0 && (
                  <div className="mt-3 max-h-40 space-y-2 overflow-y-auto rounded-lg bg-background p-3 text-sm">
                    {previewSentences.map((s) => (
                      <div key={s.index}>
                        <p>{s.textEn}</p>
                        {s.textZh && <p className="text-muted-foreground">{s.textZh}</p>}
                      </div>
                    ))}
                  </div>
                )}
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
