import { useCallback, useRef, useState } from 'react'
import { Brain, Cpu, ExternalLink, FileAudio } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toApiError } from '@/services'
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

async function callLlmTranscribe(file: File, signal?: AbortSignal): Promise<{ text: string; segments: AsrTranscribeSegment[] }> {
  const formData = new FormData()
  formData.append('audio', file)
  formData.append('lang', 'en')

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
  const [showLlmSettings, setShowLlmSettings] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const executeTranscribe = useCallback(async (file: File, signal?: AbortSignal) => {
    setStatus('running')
    setError('')
    setEditing(false)

    try {
      const res = await callLlmTranscribe(file, signal)
      const srtText = segmentsToSrt(res.segments)
      setResult(res.text)
      setSrt(srtText)
      setStatus('done')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const apiErr = toApiError(err)
      if (apiErr.code === 'ABORTED') return
      setError(apiErr.message)
      setStatus('error')
    }
  }, [])

  const start = useCallback(async (file: File | null) => {
    if (!file) return
    if (method === 'third-party') return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // For 'model' method, check if LLM is configured
    if (method === 'model') {
      const configured = await checkLlmConfigured()
      if (!configured) {
        setPendingFile(file)
        setShowLlmSettings(true)
        return
      }

      await executeTranscribe(file, ctrl.signal)
      return
    }

    // For 'local' method, call faster-whisper via API proxy
    setStatus('running')
    setError('')
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
      setResult(res.text)
      setSrt(srtText)
      setStatus('done')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const apiErr = toApiError(err)
      if (apiErr.code === 'ABORTED') return
      setError(apiErr.message)
      setStatus('error')
    }
  }, [method, executeTranscribe])

  const handleLlmSettingsSaved = useCallback(() => {
    setShowLlmSettings(false)
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
    setPendingFile(null)
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
    setResult('')
    setSrt('')
    setError('')
    setEditing(false)
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
    showLlmSettings,
    setShowLlmSettings,
    handleLlmSettingsSaved,
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

export function MethodHint({ method, onConfigureLlm }: { method: Method; onConfigureLlm?: () => void }) {
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
