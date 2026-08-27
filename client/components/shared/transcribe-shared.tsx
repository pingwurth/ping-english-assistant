import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Cpu, ExternalLink, FileAudio } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, toApiError } from '@/services'
import { splitWords } from '@/core/subtitle'
import { detectDirection, translateTexts, mergeBilingualSrt, buildBilingualPreview } from '@/lib/translate'
import type { SubtitleSentence } from '@/types/subtitle'
import type { AsrTranscribeSegment } from '@/types/api'

/* ── SRT 工具 ── */

export function formatSrtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1_000)
  const msRemainder = ms % 1_000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msRemainder).padStart(3, '0')}`
}

export function segmentsToSrt(segments: AsrTranscribeSegment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${formatSrtTime(seg.startMs)} --> ${formatSrtTime(seg.endMs)}\n${seg.text}`)
    .join('\n\n')
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ── 类型 ── */

export type Method = 'local' | 'model' | 'third-party'
export type Status = 'idle' | 'running' | 'done' | 'error'

/* ── 配置 ── */

export const methodData: { id: Method; icon: typeof Cpu; title: string; desc: string; meta: string }[] = [
  { id: 'third-party', icon: ExternalLink, title: '第三方工具', desc: '跳转通义听悟、飞书妙记、讯飞听见处理', meta: '适合长音频' },
  { id: 'model', icon: Brain, title: '调用大模型', desc: '云端高精度识别与智能断句', meta: '需要 API Key' },
  { id: 'local', icon: Cpu, title: 'faster-whisper', desc: '本机 GPU 推理，隐私优先', meta: '推荐 · 支持 CUDA' },
]

/* ── LLM API 调用 ── */

async function callLlmTranscribe(file: File, signal?: AbortSignal, configId?: string): Promise<{ text: string; segments: AsrTranscribeSegment[] }> {
  const formData = new FormData()
  formData.append('audio', file)
  formData.append('lang', 'en')
  if (configId) formData.append('configId', configId)

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
    signal,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Transcription failed (${res.status})`)
  }

  return res.json()
}

async function checkLlmConfigured(): Promise<boolean> {
  try {
    const res = await fetch('/api/settings/llm')
    const data = await res.json()
    return data.configured === true
  } catch {
    return false
  }
}

/* ── Local faster-whisper API 调用 ── */

async function callLocalTranscribe(file: File, signal?: AbortSignal): Promise<{ text: string; segments: AsrTranscribeSegment[] }> {
  const formData = new FormData()
  formData.append('audio', file)
  formData.append('lang', 'en')

  const res = await fetch('/api/transcribe/local', {
    method: 'POST',
    body: formData,
    signal,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Local transcription failed (${res.status})`)
  }

  return res.json()
}

async function checkLocalServerReady(): Promise<{ connected: boolean; error?: string }> {
  try {
    const res = await fetch('/api/transcribe/local')
    const data = await res.json()
    return data
  } catch {
    return { connected: false, error: '无法连接到转写服务' }
  }
}

/* ── Hook ── */

export function useTranscribe() {
  const [method, setMethod] = useState<Method>('third-party')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState('')
  const [srt, setSrt] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ASR configs for multi-model selection
  const [asrConfigs, setAsrConfigs] = useState<Array<{ id: string; name: string; asrModel: string }>>([])
  const [selectedAsrConfigId, setSelectedAsrConfigId] = useState<string>('')

  // 翻译开关与翻译模型配置（默认关闭，ai-transcribe-dialog 不渲染开关即永远单语）
  const [translateEnabled, setTranslateEnabled] = useState(false)
  const [translateConfigs, setTranslateConfigs] = useState<Array<{ id: string; name: string; translateModel: string }>>([])
  const [selectedTranslateConfigId, setSelectedTranslateConfigId] = useState<string>('')
  const [translateWarning, setTranslateWarning] = useState('')
  // 用 ref 保证转写回调闭包读取到最新的开关/配置值
  const translateEnabledRef = useRef(false)
  const translateConfigIdRef = useRef('')

  const loadAsrConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/llm-configs')
      const data = await res.json()
      const configs = (data.configs || []).filter((c: { asrModel?: string }) => c.asrModel)
      setAsrConfigs(configs)
      if (configs.length > 0) {
        const defaultCfg = configs.find((c: { id: string }) => c.id === data.defaultId) || configs[0]
        setSelectedAsrConfigId(defaultCfg.id)
      }
      const tConfigs = (data.configs || []).filter((c: { translateModel?: string }) => c.translateModel)
      setTranslateConfigs(tConfigs)
      if (tConfigs.length > 0) {
        const defaultTCfg = tConfigs.find((c: { id: string }) => c.id === data.defaultId) || tConfigs[0]
        setSelectedTranslateConfigId(defaultTCfg.id)
      }
    } catch {}
  }, [])

  useEffect(() => { void loadAsrConfigs() }, [loadAsrConfigs])

  // 用 useEffect 派生同步 ref：任何 state 变化（含配置加载时的默认值赋值）都自动同步，
  // 避免手工包装 setter 遗漏导致转写回调闭包读取过期值（如 translateConfigIdRef 恒为 ''）
  useEffect(() => { translateEnabledRef.current = translateEnabled }, [translateEnabled])
  useEffect(() => { translateConfigIdRef.current = selectedTranslateConfigId }, [selectedTranslateConfigId])

  /**
   * 在单语转写产物之上尝试翻译，生成双语 SRT 与双语预览。
   * 翻译失败（非取消）时降级：保留单语产物并设置警告，不抛出。
   */
  const applyTranslation = useCallback(async (
    segments: AsrTranscribeSegment[],
    srtText: string,
    monoResult: string,
    signal?: AbortSignal,
  ): Promise<{ srt: string; result: string }> => {
    if (!translateEnabledRef.current || segments.length === 0) {
      return { srt: srtText, result: monoResult }
    }
    if (!translateConfigIdRef.current) {
      // 翻译开关开启但未配置翻译模型：不静默跳过，提示后降级保留单语产物（覆盖 model 与 local 两条路径）
      setTranslateWarning('未配置翻译模型，本次未翻译')
      return { srt: srtText, result: monoResult }
    }

    try {
      const texts = segments.map(s => s.text)
      const direction = detectDirection(texts)
      const translations = await translateTexts(texts, translateConfigIdRef.current || undefined, direction, signal)

      // 双语 SRT：复用既有单语 SRT + mergeBilingualSrt（英上中下）
      const bilingualSrt = mergeBilingualSrt(srtText, translations, direction)

      // 双语预览：英文行 + 中文行构造轻量句子列表，时间轴取自 segments
      const sentences: SubtitleSentence[] = segments.map((seg, i) => {
        const textEn = direction === 'en2zh' ? seg.text : translations[i]
        const textZh = direction === 'en2zh' ? translations[i] : seg.text
        return {
          index: i,
          startMs: seg.startMs,
          endMs: seg.endMs,
          textEn,
          textZh,
          words: splitWords(textEn),
        }
      })

      return { srt: bilingualSrt, result: buildBilingualPreview(sentences) }
    } catch (err) {
      // 取消路径统一抛 ApiError('ABORTED')，由外层 catch 静默返回（含 translateTexts 的“翻译已取消”）
      if (signal?.aborted) throw new ApiError('ABORTED', '操作已取消', err)
      if (err instanceof Error && err.name === 'AbortError') throw err
      const apiErr = toApiError(err)
      if (apiErr.code === 'ABORTED') throw err
      // 降级：保留单语产物，仅提示警告，转写本身仍视为成功
      setTranslateWarning('翻译失败，已保留单语字幕：' + apiErr.message)
      return { srt: srtText, result: monoResult }
    }
  }, [])

  const executeTranscribe = useCallback(async (file: File, signal?: AbortSignal) => {
    setStatus('running')
    setError('')
    setTranslateWarning('')
    setEditing(false)

    try {
      const res = await callLlmTranscribe(file, signal, selectedAsrConfigId || undefined)
      const srtText = segmentsToSrt(res.segments)
      const { srt: finalSrt, result: finalResult } = await applyTranslation(res.segments, srtText, res.text, signal)
      setResult(finalResult)
      setSrt(finalSrt)
      setStatus('done')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const apiErr = toApiError(err)
      if (apiErr.code === 'ABORTED') return
      setError(apiErr.message)
      setStatus('error')
    }
  }, [selectedAsrConfigId, applyTranslation])

  const start = useCallback(async (file: File | null) => {
    if (!file) return
    if (method === 'third-party') return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // For 'model' method, check if ASR config exists
    if (method === 'model') {
      if (asrConfigs.length === 0) {
        setPendingFile(file)
        setShowModelConfig(true)
        return
      }

      await executeTranscribe(file, ctrl.signal)
      return
    }

    // For 'local' method, call faster-whisper via API proxy
    setStatus('running')
    setError('')
    setTranslateWarning('')
    setEditing(false)

    try {
      // Health check: verify the server is running
      const health = await checkLocalServerReady()
      if (!health.connected) {
        throw new Error(
          'faster-whisper 服务未启动。请先运行:\n' +
          '  cd server && ./start.sh --server transcribe\n\n' +
          '或在设置中配置转写服务地址。',
        )
      }

      const res = await callLocalTranscribe(file, ctrl.signal)
      const srtText = segmentsToSrt(res.segments)
      const { srt: finalSrt, result: finalResult } = await applyTranslation(res.segments, srtText, res.text, ctrl.signal)
      setResult(finalResult)
      setSrt(finalSrt)
      setStatus('done')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const apiErr = toApiError(err)
      if (apiErr.code === 'ABORTED') return
      setError(apiErr.message)
      setStatus('error')
    }
  }, [method, executeTranscribe, asrConfigs, applyTranslation])

  const handleModelConfigSaved = useCallback(() => {
    setShowModelConfig(false)
    // Retry transcription with the pending file
    if (pendingFile) {
      const file = pendingFile
      setPendingFile(null)
      start(file)
    }
  }, [pendingFile, start])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
    setResult('')
    setSrt('')
    setError('')
    setTranslateWarning('')
    setPendingFile(null)
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
    setResult('')
    setSrt('')
    setError('')
    setEditing(false)
    setTranslateWarning('')
    setPendingFile(null)
  }, [])

  const handleSrtChange = useCallback((value: string) => {
    setSrt(value)
  }, [])

  return {
    method,
    setMethod,
    status,
    setStatus,
    result,
    srt,
    editing,
    setEditing,
    error,
    start,
    cancel,
    reset,
    handleSrtChange,
    showModelConfig,
    setShowModelConfig,
    handleModelConfigSaved,
    refreshConfigs: loadAsrConfigs,
    asrConfigs,
    selectedAsrConfigId,
    setSelectedAsrConfigId,
    translateEnabled,
    setTranslateEnabled,
    translateConfigs,
    selectedTranslateConfigId,
    setSelectedTranslateConfigId,
    translateWarning,
  }
}

/* ── 共享 UI 组件 ── */

export function MethodSelector({ method, setMethod }: { method: Method; setMethod: (m: Method) => void }) {
  return (
    <>
      <p className="text-sm font-medium">选择转换方式</p>
      {methodData.map(item => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() => setMethod(item.id)}
            className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
              method === item.id
                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                : 'hover:bg-muted'
            }`}
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon />
            </span>
            <span className="flex-1">
              <span className="block font-medium">{item.title}</span>
              <span className="block text-sm text-muted-foreground">{item.desc}</span>
            </span>
            <Badge variant={method === item.id ? 'default' : 'outline'}>{item.meta}</Badge>
          </button>
        )
      })}
    </>
  )
}

export function MethodHint({ method, onConfigureLlm, asrConfigs, selectedAsrConfigId, onAsrConfigChange }: {
  method: Method
  onConfigureLlm?: () => void
  asrConfigs?: Array<{ id: string; name: string; asrModel: string }>
  selectedAsrConfigId?: string
  onAsrConfigChange?: (id: string) => void
}) {
  if (method === 'local') {
    return (
      <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">faster-whisper 本地转写</p>
        <p className="mt-1">使用 faster-whisper large-v3 模型，优先 GPU (CUDA)，自动回退 CPU。</p>
        <p className="mt-1 text-xs opacity-70">需要先启动服务：cd server && ./start.sh --server transcribe</p>
      </div>
    )
  }

  if (method === 'model') {
    return (
      <div className="rounded-xl bg-primary/10 p-4 text-sm text-primary">
        <p className="font-medium">大模型转写设置</p>
        <p className="mt-1">自动识别语言、断句并生成时间轴字幕。音频会发送到云端模型处理。</p>
        {asrConfigs && asrConfigs.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-primary/70">ASR 模型：</span>
            <select
              value={selectedAsrConfigId || ''}
              onChange={e => onAsrConfigChange?.(e.target.value)}
              className="rounded-md border border-primary/20 bg-background px-2 py-1 text-xs"
            >
              {asrConfigs.map(c => (
                <option key={c.id} value={c.id}>{c.asrModel} · {c.name}</option>
              ))}
            </select>
          </div>
        )}
        {onConfigureLlm && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onConfigureLlm}
          >
            配置模型
          </Button>
        )}
      </div>
    )
  }

  if (method === 'third-party') {
    return (
      <div className="flex flex-wrap gap-2 rounded-xl bg-muted p-4">
        <a
          href="https://tingwu.aliyun.com/"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          打开通义听悟 <ExternalLink data-icon="inline-end" />
        </a>
        <a
          href="https://www.feishu.cn/product/minutes"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          打开飞书妙记 <ExternalLink data-icon="inline-end" />
        </a>
        <a
          href="https://www.iflyrec.com/home"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          打开讯飞听见 <ExternalLink data-icon="inline-end" />
        </a>
      </div>
    )
  }

  return null
}

interface TranscribeResultProps {
  status: Status
  method: Method
  result: string
  srt: string
  editing: boolean
  error: string
  onRetry: () => void
  onToggleEdit: () => void
  onSrtChange: (value: string) => void
}

export function TranscribeResult({
  status,
  method,
  result,
  srt,
  editing,
  error,
  onRetry,
  onToggleEdit,
  onSrtChange,
}: TranscribeResultProps) {
  return (
    <div className="flex min-h-60 flex-col gap-4">
      <p className="text-sm font-medium">
        {status === 'idle'
          ? '转换结果'
          : status === 'running'
            ? '正在分析音频并生成时间轴…'
            : status === 'error'
              ? '转换失败'
              : editing
                ? '编辑完成后可导入'
                : '已生成字幕，可继续编辑'}
      </p>

      {status === 'idle' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <FileAudio className="text-primary" />
          <p>选择转换方式并开始</p>
        </div>
      )}

      {status === 'running' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="size-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <p className="text-sm text-muted-foreground">
            {method === 'local' ? 'faster-whisper 正在本机 GPU 推理' : '大模型正在生成字幕'}
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-destructive">{error || '转换过程中出现错误'}</p>
          <Button variant="outline" onClick={onRetry}>
            重试
          </Button>
        </div>
      )}

      {status === 'done' && (
        <>
          {editing ? (
            <Textarea
              value={srt}
              onChange={e => onSrtChange(e.target.value)}
              className="min-h-48 font-mono text-sm"
            />
          ) : (
            <pre className="min-h-48 whitespace-pre-wrap rounded-xl bg-muted p-4 font-sans text-sm leading-7">
              {result}
            </pre>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onToggleEdit}>
              {editing ? '完成编辑' : '编辑字幕'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
