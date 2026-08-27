import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog'

interface LlmSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

const PROVIDERS = [
  { value: 'qwen', label: 'QwenAI (通义千问)' },
  { value: 'whisper', label: 'WhisperAI' },
  { value: 'mimo', label: 'MiMo' },
]

export function LlmSettingsDialog({ open, onOpenChange, onSaved }: LlmSettingsDialogProps) {
  const [provider, setProvider] = useState('qwen')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [asrModel, setAsrModel] = useState('')
  const [asrEndpoint, setAsrEndpoint] = useState('')
  const [ttsModel, setTtsModel] = useState('')
  const [ttsEndpoint, setTtsEndpoint] = useState('')
  const [whisperAlignUrl, setWhisperAlignUrl] = useState('')
  const [whisperTranscribeUrl, setWhisperTranscribeUrl] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAsrDropdown, setShowAsrDropdown] = useState(false)
  const [showTtsDropdown, setShowTtsDropdown] = useState(false)

  // Load existing settings when dialog opens
  useEffect(() => {
    if (!open) return

    setLoading(true)
    setError('')
    setModels([])

    fetch('/api/settings/llm')
      .then(res => res.json())
      .then(data => {
        if (data.configured) {
          setProvider(data.provider || 'qwen')
          setBaseUrl(data.baseUrl || '')
          setAsrModel(data.asrModel || '')
          setAsrEndpoint(data.asrEndpoint || '')
          setTtsModel(data.ttsModel || '')
          setTtsEndpoint(data.ttsEndpoint || '')
          setWhisperAlignUrl(data.whisperAlignUrl || '')
          setWhisperTranscribeUrl(data.whisperTranscribeUrl || '')
          // Don't fill in masked API key
        }
      })
      .catch(() => {
        // Ignore load errors
      })
      .finally(() => setLoading(false))
  }, [open])

  const fetchModels = useCallback(async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError('请先填写 Base URL 和 API Key')
      return
    }

    setFetchingModels(true)
    setError('')
    setModels([])

    try {
      // First save the current settings so the API can use them
      await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
        }),
      })

      // Then fetch models
      const res = await fetch('/api/models')
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || '获取模型列表失败')
      }

      setModels(data.models || [])
      setShowAsrDropdown(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }, [provider, baseUrl, apiKey])

  const handleSave = useCallback(async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError('Base URL 和 API Key 是必填的')
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          asrModel: asrModel || undefined,
          asrEndpoint: asrEndpoint.trim() || undefined,
          ttsModel: ttsModel || undefined,
          ttsEndpoint: ttsEndpoint.trim() || undefined,
          whisperAlignUrl: whisperAlignUrl.trim() || undefined,
          whisperTranscribeUrl: whisperTranscribeUrl.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '保存失败')
      }

      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [provider, baseUrl, apiKey, asrModel, asrEndpoint, ttsModel, ttsEndpoint, whisperAlignUrl, whisperTranscribeUrl, onOpenChange, onSaved])

  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      setError('')
      setShowAsrDropdown(false)
      setShowTtsDropdown(false)
    }
    onOpenChange(open)
  }, [onOpenChange])

  /** 渲染模型选择下拉 */
  const renderModelSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    showDropdown: boolean,
    setDropdown: (v: boolean) => void,
  ) => (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              placeholder="点击右侧按钮获取模型列表"
              value={value}
              onChange={e => onChange(e.target.value)}
              onFocus={() => { if (models.length > 0) setDropdown(true) }}
              onBlur={() => { setTimeout(() => setDropdown(false), 200) }}
              className="pr-8"
            />
            {models.length > 0 && (
              <ChevronDown className="absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchModels}
            disabled={fetchingModels || !baseUrl.trim() || !apiKey.trim()}
            title="获取模型列表"
          >
            <RefreshCw className={`size-4 ${fetchingModels ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {showDropdown && models.length > 0 && (
          <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-background shadow-lg">
            {models.map(m => (
              <button
                key={m}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                  m === value ? 'bg-primary/10 text-primary' : ''
                }`}
                onClick={() => { onChange(m); setDropdown(false) }}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {models.length > 0
          ? `已获取 ${models.length} 个模型，点击下拉选择`
          : '填写 Base URL 和 API Key 后，点击刷新按钮获取模型列表'}
      </p>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogHeader>
        <DialogTitle>配置大模型</DialogTitle>
        <DialogDescription>
          配置 API 地址和密钥，分别设置 ASR 和 TTS 模型
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="size-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* 提供商 */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                模型提供商
                <span className="ml-1 text-destructive">*</span>
              </label>
              <select
                value={provider}
                onChange={e => {
                  const newProvider = e.target.value
                  setProvider(newProvider)
                  setModels([])
                  // 切换提供商时清空所有输入框
                  setBaseUrl('')
                  setApiKey('')
                  setAsrModel('')
                  setAsrEndpoint('')
                  setTtsModel('')
                  setTtsEndpoint('')
                  setWhisperAlignUrl('')
                  setWhisperTranscribeUrl('')
                  // MiMo 使用 /chat/completions 作为 TTS 端点
                  if (newProvider === 'mimo') {
                    setTtsEndpoint('/chat/completions')
                  }
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Base URL */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                Base URL
                <span className="ml-1 text-destructive">*</span>
              </label>
              <Input
                placeholder="例如: https://dashscope.aliyuncs.com/compatible-mode/v1 或 https://api.openai.com/v1"
                value={baseUrl}
                onChange={e => { setBaseUrl(e.target.value); setModels([]) }}
              />
            </div>

            {/* API Key */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                API Key
                <span className="ml-1 text-destructive">*</span>
              </label>
              <Input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setModels([]) }}
              />
            </div>

            {/* ASR 模型 */}
            {renderModelSelect('ASR 模型 (语音识别)', asrModel, setAsrModel, showAsrDropdown, v => { setShowAsrDropdown(v); setShowTtsDropdown(false) })}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">ASR 端点路径</label>
              <Input
                placeholder="/audio/transcriptions"
                value={asrEndpoint}
                onChange={e => setAsrEndpoint(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                默认: /audio/transcriptions
              </p>
            </div>

            {/* TTS 模型 */}
            {renderModelSelect('TTS 模型 (语音合成)', ttsModel, setTtsModel, showTtsDropdown, v => { setShowTtsDropdown(v); setShowAsrDropdown(false) })}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">TTS 端点路径</label>
              <Input
                placeholder="/audio/speech"
                value={ttsEndpoint}
                onChange={e => setTtsEndpoint(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {provider === 'mimo'
                  ? 'MiMo 使用 /chat/completions 处理语音合成'
                  : '默认: /audio/speech'}
              </p>
            </div>

            {/* 本地服务 */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">WhisperX 对齐服务</label>
              <Input
                placeholder="http://127.0.0.1:8765"
                value={whisperAlignUrl}
                onChange={e => setWhisperAlignUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                词级时间戳对齐服务地址，默认 http://127.0.0.1:8765
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">faster-whisper 转写服务</label>
              <Input
                placeholder="http://127.0.0.1:8766"
                value={whisperTranscribeUrl}
                onChange={e => setWhisperTranscribeUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                本地转写服务地址，默认 http://127.0.0.1:8766
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
