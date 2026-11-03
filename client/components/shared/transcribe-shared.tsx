import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Cpu, ExternalLink, FileAudio } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, toApiError } from '@/services'
import { Switch } from '@/components/ui/switch'
import { exportSrtRows, formatSrtTimestamp, parseSubtitle } from '@/core/subtitle'
import { translateSrtToBilingual, buildBilingualPreview } from '@/lib/translate'
import { useServiceConfigs } from '@/lib/use-service-configs'
import { probeMediaDuration } from '@/platform/media-probe'
import type { AsrTranscribeSegment } from '@/types/api'

/* ── SRT 工具（序列化统一走 core/subtitle 的 exportSrtRows，不再本地拷贝） ── */

/** 兼容别名：历史导出名，实现即 core/subtitle 的 formatSrtTimestamp */
export const formatSrtTime = formatSrtTimestamp

export function segmentsToSrt(segments: AsrTranscribeSegment[]): string {
  return exportSrtRows(segments.map((seg) => ({ startMs: seg.startMs, endMs: seg.endMs, lines: [seg.text] })))
}

/** 下载产物文件 —— 统一实现见 lib/download.ts（历史拷贝参数顺序相反，已对齐 (filename, blob)） */
export { downloadBlob } from '@/lib/download'

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

export async function callLlmTranscribe(file: File, signal?: AbortSignal, configId?: string): Promise<{ text: string; segments: AsrTranscribeSegment[] }> {
  const formData = new FormData()
  formData.append('audio', file)
  formData.append('lang', 'en')
  if (configId) formData.append('configId', configId)
  // 客户端实测时长（媒体 metadata）随请求上传：服务端比例分配兜底的时间轴质量完全
  // 取决于时长精度，按字节数估算只对 ~128kbps 近似（256kbps MP3 会估出 2 倍时长）
  const durationMs = await probeMediaDuration(file)
  if (durationMs != null) formData.append('durationMs', String(durationMs))

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

/* ── Local faster-whisper API 调用 ── */

export async function callLocalTranscribe(file: File, signal?: AbortSignal): Promise<{ text: string; segments: AsrTranscribeSegment[] }> {
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

async function checkLocalServerReady(signal?: AbortSignal): Promise<{ connected: boolean; error?: string }> {
  try {
    const res = await fetch('/api/transcribe/local', { signal })
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

  // ASR configs for multi-model selection（拉取/缓存/默认选择统一走 useServiceConfigs）
  const asrSel = useServiceConfigs<{ id: string; name: string; asrModel: string }>(true, 'asrModel',
    (c) => ({ id: c.id, name: String(c.name ?? ''), asrModel: String(c.asrModel ?? '') }))
  const asrConfigs = asrSel.configs
  const selectedAsrConfigId = asrSel.configId
  const setSelectedAsrConfigId = asrSel.setConfigId

  // 翻译开关与翻译模型配置（默认关闭，ai-transcribe-dialog 不渲染开关即永远单语）
  const [translateEnabled, setTranslateEnabled] = useState(false)
  const trSel = useServiceConfigs<{ id: string; name: string; translateModel: string }>(true, 'translateModel',
    (c) => ({ id: c.id, name: String(c.name ?? ''), translateModel: String(c.translateModel ?? '') }))
  const translateConfigs = trSel.configs
  const selectedTranslateConfigId = trSel.configId
  const setSelectedTranslateConfigId = trSel.setConfigId
  const [translateWarning, setTranslateWarning] = useState('')
  // 用 ref 保证转写回调闭包读取到最新的开关/配置值
  const translateEnabledRef = useRef(false)
  const translateConfigIdRef = useRef('')

  // 卸载时中止在途转写：路由离开后上传继续跑完只浪费 API 费用，结果无人消费
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // 用 useEffect 派生同步 ref：任何 state 变化（含配置加载时的默认值赋值）都自动同步，
  // 避免手工包装 setter 遗漏导致转写回调闭包读取过期值（如 translateConfigIdRef 恒为 ''）
  useEffect(() => { translateEnabledRef.current = translateEnabled }, [translateEnabled])
  useEffect(() => { translateConfigIdRef.current = selectedTranslateConfigId }, [selectedTranslateConfigId])

  /**
   * 在单语转写产物之上尝试翻译，生成双语 SRT 与双语预览。
   * 编排统一走 translateSrtToBilingual（与 TTS 页同一实现：中止/降级/漏翻提示
   * 语义不再两份漂移）；预览由双语 SRT 重新解析构造。
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
      const outcome = await translateSrtToBilingual(srtText, translateConfigIdRef.current || undefined, signal)
      if (outcome.warning) setTranslateWarning(outcome.warning)
      if (outcome.srt === srtText) return { srt: srtText, result: monoResult }
      return { srt: outcome.srt, result: buildBilingualPreview(parseSubtitle(outcome.srt).sentences) }
    } catch (err) {
      // 取消：编排函数统一抛 DOMException AbortError，这里转 ApiError('ABORTED') 由外层静默
      if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('ABORTED', '操作已取消', err)
      // 其余错误理论上已在编排内降级；兜底同样降级不抛（转写本身仍视为成功）
      setTranslateWarning('翻译失败，已保留单语字幕：' + (err instanceof Error ? err.message : '未知错误'))
      return { srt: srtText, result: monoResult }
    }
  }, [])

  const executeTranscribe = useCallback(async (
    file: File,
    signal: AbortSignal | undefined,
    configId: string | undefined,
    engine: 'model' | 'local',
  ) => {
    setStatus('running')
    setError('')
    setTranslateWarning('')
    setEditing(false)

    try {
      if (engine === 'local') {
        const health = await checkLocalServerReady(signal)
        // 取消落在探活窗口时 checkLocalServerReady 把 abort 吞成「连不上」的普通 Error，
        // 不复查 aborted 就会给已取消的会话弹红色失败（评审 #6，对齐 tts.tsx 同一防线）
        if (signal?.aborted) return
        if (!health.connected) {
          throw new Error(
            'faster-whisper 服务未启动。请先运行:\n' +
            '  cd server && ./start.sh --server transcribe\n\n' +
            '或在设置中配置转写服务地址。',
          )
        }
      }
      const res = engine === 'local'
        ? await callLocalTranscribe(file, signal)
        : await callLlmTranscribe(file, signal, configId)
      // 响应 resolve 与取消几乎同时发生时，不在已取消会话上提交 done（评审 #6）
      if (signal?.aborted) return
      const srtText = segmentsToSrt(res.segments)
      const { srt: finalSrt, result: finalResult } = await applyTranslation(res.segments, srtText, res.text, signal)
      if (signal?.aborted) return
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
  }, [applyTranslation])

  const start = useCallback(async (file: File | null) => {
    if (!file) return
    if (method === 'third-party') return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    if (method === 'model') {
      // 闭包里的 asrConfigs 可能过期（配置对话框刚保存、刷新配置的 fetch 还在途）——
      // 空时现查一次，避免“刚保存又弹出配置框、转写永不启动”
      let configs = asrConfigs
      if (configs.length === 0) configs = await asrSel.load(true)
      if (configs.length === 0) {
        setPendingFile(file)
        setShowModelConfig(true)
        return
      }
      // executeTranscribe 的闭包可能仍持有旧的空 selectedAsrConfigId；显式传本次解析到的默认配置。
      const configId = selectedAsrConfigId || configs[0]?.id
      await executeTranscribe(file, ctrl.signal, configId, 'model')
      return
    }

    await executeTranscribe(file, ctrl.signal, undefined, 'local')
  }, [method, executeTranscribe, asrConfigs, asrSel.load, selectedAsrConfigId])

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
    setEditing(false)
    setTranslateWarning('')
    setPendingFile(null)
  }, [])

  // 两者当前语义完全相同；保留两个导出名只为稳定调用方 API，避免两份状态复位逻辑漂移。
  const reset = cancel

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
    refreshConfigs: () => asrSel.load(true),
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

/**
 * 转写控制块（转写页与 AI 转写对话框共用）：方式选择 + 模型配置提示 + 翻译开关 + 开始/取消按钮。
 * 原先两处近逐字拷贝且已漂移（同一翻译开关两种交互路径），收敛于此；
 * 翻译开关的持久化与否由调用方传入的 onTranslateEnabledChange 决定。
 */
export function TranscribeControls({
  method, onMethodChange,
  onConfigureLlm,
  asrConfigs, selectedAsrConfigId, onAsrConfigChange,
  translateEnabled, onTranslateEnabledChange,
  translateConfigs, selectedTranslateConfigId, onTranslateConfigChange,
  status, canStart, onStart, onCancel,
}: {
  method: Method
  onMethodChange: (m: Method) => void
  onConfigureLlm: () => void
  asrConfigs: Array<{ id: string; name: string; asrModel: string }>
  selectedAsrConfigId: string
  onAsrConfigChange: (id: string) => void
  translateEnabled: boolean
  onTranslateEnabledChange: (v: boolean) => void
  translateConfigs: Array<{ id: string; name: string; translateModel: string }>
  selectedTranslateConfigId: string
  onTranslateConfigChange: (id: string) => void
  status: Status
  canStart: boolean
  onStart: () => void
  onCancel: () => void
}) {
  // 下拉截断后的完整文案（title 悬停可见）
  const selectedTranslateConfig = translateConfigs.find(c => c.id === selectedTranslateConfigId)
  return (
    <>
      <MethodSelector method={method} setMethod={onMethodChange} />
      <MethodHint
        method={method}
        onConfigureLlm={onConfigureLlm}
        asrConfigs={asrConfigs}
        selectedAsrConfigId={selectedAsrConfigId}
        onAsrConfigChange={onAsrConfigChange}
      />

      {(method === 'model' || method === 'local') && (
        <div className="flex flex-col gap-2 rounded-xl bg-muted p-4">
          <div className="flex items-center gap-2">
            <span className="shrink-0 whitespace-nowrap text-sm font-medium">翻译</span>
            <Switch checked={translateEnabled} onCheckedChange={onTranslateEnabledChange} aria-label="翻译开关" />
            {translateEnabled && (
              <select
                value={selectedTranslateConfigId || ''}
                onChange={e => onTranslateConfigChange(e.target.value)}
                disabled={translateConfigs.length === 0}
                title={selectedTranslateConfig ? `${selectedTranslateConfig.translateModel} · ${selectedTranslateConfig.name}` : undefined}
                className="min-w-0 truncate rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50"
              >
                {translateConfigs.map(c => (
                  <option key={c.id} value={c.id}>{c.translateModel} · {c.name}</option>
                ))}
              </select>
            )}
          </div>
          {translateEnabled && translateConfigs.length === 0 && (
            <p className="text-xs text-destructive">请先在「设置 → 模型配置」中配置翻译模型</p>
          )}
        </div>
      )}

      {status === 'running' ? (
        <Button className="w-full" variant="destructive" onClick={onCancel}>
          取消转换
        </Button>
      ) : (
        <Button className="w-full" disabled={!canStart || method === 'third-party'} onClick={onStart}>
          {status === 'error' ? '重新转换' : '开始转换'}
        </Button>
      )}
    </>
  )
}

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
  // 下拉截断后的完整文案（title 悬停可见）
  const selectedAsrConfig = asrConfigs?.find(c => c.id === selectedAsrConfigId)
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
            <span className="shrink-0 whitespace-nowrap text-xs text-primary/70">ASR 模型：</span>
            <select
              value={selectedAsrConfigId || ''}
              onChange={e => onAsrConfigChange?.(e.target.value)}
              title={selectedAsrConfig ? `${selectedAsrConfig.asrModel} · ${selectedAsrConfig.name}` : undefined}
              className="min-w-0 truncate rounded-md border border-primary/20 bg-background px-2 py-1 text-xs"
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
