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
  { value: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com' },
  { value: 'mimo', label: 'Xiaomi MiMo', defaultBaseUrl: 'https://api.xiaomimimo.com/v1' },
  { value: 'custom', label: '自定义', defaultBaseUrl: '' },
]

export function LlmSettingsDialog({ open, onOpenChange, onSaved }: LlmSettingsDialogProps) {
  const [provider, setProvider] = useState('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [whisperAlignUrl, setWhisperAlignUrl] = useState('')
  const [whisperTranscribeUrl, setWhisperTranscribeUrl] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

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
          setProvider(data.provider || 'openai')
          setBaseUrl(data.baseUrl || '')
          setModel(data.model || '')
          setEndpoint(data.endpoint || '')
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
      if (data.models?.length > 0 && !model) {
        // Auto-select first model if none selected
        setModel(data.models[0])
      }
      setShowDropdown(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }, [provider, baseUrl, apiKey, model])

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
          model: model || undefined,
          endpoint: endpoint.trim() || undefined,
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
  }, [provider, baseUrl, apiKey, model, endpoint, whisperTranscribeUrl, onOpenChange, onSaved])

  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      setError('')
      setShowDropdown(false)
    }
    onOpenChange(open)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogHeader>
        <DialogTitle>配置大模型</DialogTitle>
        <DialogDescription>
          配置 API 地址和密钥，获取可用模型列表用于音频转文字
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="size-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
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
                  const p = PROVIDERS.find(p => p.value === newProvider)
                  if (p && p.defaultBaseUrl) {
                    setBaseUrl(p.defaultBaseUrl)
                  }
                  if (newProvider === 'mimo') {
                    setModel('mimo-v2.5-asr')
                  }
                  setShowDropdown(false)
                  setModels([])
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                选择模型提供商，自动填充对应的 API 地址
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                Base URL
                <span className="ml-1 text-destructive">*</span>
              </label>
              <Input
                placeholder="例如: https://api.openai.com/v1"
                value={baseUrl}
                onChange={e => {
                  setBaseUrl(e.target.value)
                  setShowDropdown(false)
                  setModels([])
                }}
              />
              <p className="text-xs text-muted-foreground">
                API 接口地址，支持 OpenAI 兼容的服务
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                API Key
                <span className="ml-1 text-destructive">*</span>
              </label>
              <Input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => {
                  setApiKey(e.target.value)
                  setShowDropdown(false)
                  setModels([])
                }}
              />
              <p className="text-xs text-muted-foreground">
                你的 API 密钥，保存后不会再次显示
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">模型</label>
              <div className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      placeholder="点击右侧按钮获取模型列表"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      onClick={() => models.length > 0 && setShowDropdown(!showDropdown)}
                      className="pr-8"
                      readOnly={models.length > 0}
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

                {/* Dropdown */}
                {showDropdown && models.length > 0 && (
                  <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-background shadow-lg">
                    {models.map(m => (
                      <button
                        key={m}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                          m === model ? 'bg-primary/10 text-primary' : ''
                        }`}
                        onClick={() => {
                          setModel(m)
                          setShowDropdown(false)
                        }}
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

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">转写端点路径</label>
              <Input
                placeholder={provider === 'mimo' ? '/chat/completions（MiMo 自动处理）' : '/audio/transcriptions'}
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {provider === 'mimo'
                  ? 'MiMo ASR 使用 /chat/completions 端点，通常无需修改'
                  : '默认: /audio/transcriptions。如果 provider 使用不同路径，请修改'}
              </p>
            </div>

            {provider === 'mimo' && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">WhisperX 对齐服务</label>
                <Input
                  placeholder="http://127.0.0.1:8765"
                  value={whisperAlignUrl}
                  onChange={e => setWhisperAlignUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  本地 WhisperX 服务地址，用于精确时间戳对齐。留空则使用估算时间戳。
                  <a
                    href="https://github.com/m-bain/whisperX"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-primary underline"
                  >
                    安装说明
                  </a>
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">faster-whisper 转写服务</label>
              <Input
                placeholder="http://127.0.0.1:8766"
                value={whisperTranscribeUrl}
                onChange={e => setWhisperTranscribeUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                本地 faster-whisper 转写服务地址。留空则使用默认地址 (http://127.0.0.1:8766)。
                <code className="ml-1 text-xs">./start.sh --server transcribe</code>
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
