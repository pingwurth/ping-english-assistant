/**
 * 模型配置管理弹窗 — 从 settings.tsx 提取，供转写页面和设置页面共享
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Eye, EyeOff, Headphones, Languages, Mic, Pencil, Plus, RefreshCw, Settings2, Sparkles, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getDefaultEndpoint, DEFAULT_LOCAL_MODEL_URL } from '@/lib/service-endpoints'
import { getKokoroModelId, setKokoroModelId } from '@/platform/kokoro-tts'

/* ── 类型 & 常量 ── */

export interface LlmConfigItem {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  asrModel?: string
  asrEndpoint?: string
  ttsModel?: string
  ttsEndpoint?: string
  translateModel?: string
  translateEndpoint?: string
  mnemonicModel?: string
  mnemonicEndpoint?: string
}

const PROVIDERS = [
  { value: 'qwen', label: 'QwenAI (通义千问)' },
  { value: 'dashscope', label: 'DashScope (阿里云百炼)' },
  { value: 'mimo', label: 'MiMo' },
  { value: 'local', label: '本地模型' },
]

const providerLabel = (v: string) => PROVIDERS.find(p => p.value === v)?.label || v

type ServiceKind = 'asr' | 'tts' | 'translate' | 'mnemonic'

const SERVICE_STYLES: Record<ServiceKind, { accent: string; softBg: string; mutedBg: string; borderColor: string }> = {
  asr:       { accent: '#2563eb', softBg: '#eff4ff', mutedBg: '#dbeafe', borderColor: '#bfdbfe' },
  tts:       { accent: '#7c3aed', softBg: '#f5f0ff', mutedBg: '#ede4ff', borderColor: '#d8b4fe' },
  translate: { accent: '#0d9488', softBg: '#edfcfa', mutedBg: '#ccfbf1', borderColor: '#99f6e4' },
  mnemonic:  { accent: '#d97706', softBg: '#fffbeb', mutedBg: '#fef3c7', borderColor: '#fde68a' },
}

const SERVICE_TYPES: { kind: ServiceKind; icon: typeof Mic; title: string; subtitle: string }[] = [
  { kind: 'asr', icon: Mic, title: 'ASR 模型', subtitle: '语音识别' },
  { kind: 'tts', icon: Headphones, title: 'TTS 模型', subtitle: '语音合成' },
  { kind: 'translate', icon: Languages, title: '翻译模型', subtitle: 'Translation' },
  { kind: 'mnemonic', icon: Sparkles, title: '助记模型', subtitle: 'Mnemonic' },
]

/* ── ModelSelect 子组件 ── */

function ModelSelect({
  label, value, models, showDropdown, onValueChange, onDropdownToggle,
  fetching, onFetch, disabled, inputId,
}: {
  label: string
  value: string
  models: string[]
  showDropdown: boolean
  onValueChange: (v: string) => void
  onDropdownToggle: (show: boolean) => void
  fetching: boolean
  onFetch: () => void
  disabled: boolean
  inputId?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id={inputId}
              placeholder="点击右侧按钮获取模型列表"
              value={value}
              onChange={e => onValueChange(e.target.value)}
              onFocus={() => { if (models.length > 0) onDropdownToggle(true) }}
              onBlur={() => { setTimeout(() => onDropdownToggle(false), 200) }}
              className="pr-8"
            />
            {models.length > 0 && (
              <ChevronDown className="absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={onFetch}
            disabled={fetching || disabled}
            title="获取模型列表"
          >
            <RefreshCw className={`size-4 ${fetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {showDropdown && models.length > 0 && (() => {
          const filtered = models.filter(m => m.toLowerCase().includes(value.toLowerCase()))
          return filtered.length > 0 ? (
            <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-background shadow-lg">
              {filtered.map(m => (
                <button
                  key={m}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${m === value ? 'bg-primary/10 text-primary' : ''}`}
                  onMouseDown={e => { e.preventDefault(); onValueChange(m); onDropdownToggle(false) }}
                >
                  {m}
                </button>
              ))}
            </div>
          ) : null
        })()}
      </div>
      <p className="text-xs text-muted-foreground">
        {models.length > 0 ? `已获取 ${models.length} 个模型，可从列表选择或直接输入` : '填写 Base URL 和 API Key 后，点击刷新按钮获取模型列表'}
      </p>
    </div>
  )
}

/* ── ModelConfigDialog — 新增/编辑共用弹窗（卡片分组布局）── */

function ModelConfigDialog({
  open, onOpenChange, editingConfig, onSave, onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingConfig?: LlmConfigItem | null
  onSave: () => void
  onSaved?: () => void
}) {
  const isEdit = !!editingConfig
  const [provider, setProvider] = useState('qwen')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [asrModel, setAsrModel] = useState('')
  const [asrEndpoint, setAsrEndpoint] = useState('')
  const [ttsModel, setTtsModel] = useState('')
  const [ttsEndpoint, setTtsEndpoint] = useState('')
  const [translateModel, setTranslateModel] = useState('')
  const [translateEndpoint, setTranslateEndpoint] = useState('')
  const [mnemonicModel, setMnemonicModel] = useState('')
  const [mnemonicEndpoint, setMnemonicEndpoint] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [error, setError] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [enabledServices, setEnabledServices] = useState<Set<ServiceKind>>(new Set())
  const [activeDropdown, setActiveDropdown] = useState<ServiceKind | null>(null)

  useEffect(() => {
    if (!open) return
    if (editingConfig) {
      setProvider(editingConfig.provider || 'qwen')
      setName(editingConfig.name || '')
      setBaseUrl(editingConfig.baseUrl || '')
      setApiKey('')
      setAsrModel(editingConfig.asrModel || '')
      setAsrEndpoint(editingConfig.asrEndpoint || '')
      setTtsModel(editingConfig.ttsModel || '')
      setTtsEndpoint(editingConfig.ttsEndpoint || '')
      setTranslateModel(editingConfig.translateModel || '')
      setTranslateEndpoint(editingConfig.translateEndpoint || '')
      setMnemonicModel(editingConfig.mnemonicModel || '')
      setMnemonicEndpoint(editingConfig.mnemonicEndpoint || '')

      const enabled = new Set<ServiceKind>()
      if (editingConfig.asrModel) enabled.add('asr')
      if (editingConfig.ttsModel) enabled.add('tts')
      if (editingConfig.translateModel) enabled.add('translate')
      if (editingConfig.mnemonicModel) enabled.add('mnemonic')
      setEnabledServices(enabled)

      setLoadingConfig(true)
      fetch(`/api/settings/llm-configs?id=${encodeURIComponent(editingConfig.id)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) setApiKey(data.apiKey || '')
        })
        .catch(() => {})
        .finally(() => setLoadingConfig(false))
    } else {
      setProvider('qwen')
      setName('')
      setBaseUrl('')
      setApiKey('')
      setAsrModel('')
      setAsrEndpoint('')
      setTtsModel('')
      setTtsEndpoint('')
      setTranslateModel('')
      setTranslateEndpoint('')
      setMnemonicModel('')
      setMnemonicEndpoint('')
      setEnabledServices(new Set())
    }
    setModels([])
    setError('')
    setActiveDropdown(null)
    setShowApiKey(false)
  }, [open, editingConfig])

  const fetchModels = useCallback(async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError('请先填写 Base URL 和 API Key')
      return
    }
    setFetchingModels(true)
    setError('')
    setModels([])
    try {
      await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      })
      const res = await fetch('/api/models')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '获取模型列表失败')
      setModels(data.models || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }, [provider, baseUrl, apiKey])

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError('请填写配置名称'); return }
    if (!baseUrl.trim()) { setError('Base URL 是必填的'); return }
    if (!isEdit && !apiKey.trim()) { setError('API Key 是必填的'); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        name: name.trim(),
        provider,
        baseUrl: baseUrl.trim(),
        ...((!isEdit || apiKey.trim()) ? { apiKey: apiKey.trim() } : {}),
        asrModel: enabledServices.has('asr') ? (asrModel || null) : null,
        asrEndpoint: enabledServices.has('asr') ? (asrEndpoint.trim() || null) : null,
        ttsModel: enabledServices.has('tts') ? (ttsModel || null) : null,
        ttsEndpoint: enabledServices.has('tts') ? (ttsEndpoint.trim() || null) : null,
        translateModel: enabledServices.has('translate') ? (translateModel || null) : null,
        translateEndpoint: enabledServices.has('translate') ? (translateEndpoint.trim() || null) : null,
        mnemonicModel: enabledServices.has('mnemonic') ? (mnemonicModel || null) : null,
        mnemonicEndpoint: enabledServices.has('mnemonic') ? (mnemonicEndpoint.trim() || null) : null,
      }
      const url = '/api/settings/llm-configs'
      const res = isEdit
        ? await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingConfig!.id, ...body }) })
        : await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '保存失败')
      }
      onOpenChange(false)
      onSave()
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [name, provider, baseUrl, apiKey, asrModel, asrEndpoint, ttsModel, ttsEndpoint, translateModel, translateEndpoint, mnemonicModel, mnemonicEndpoint, enabledServices, isEdit, editingConfig, onOpenChange, onSave, onSaved])

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
    setModels([])
    setBaseUrl('')
    setApiKey('')
    setAsrModel('')
    setAsrEndpoint('')
    setTtsModel('')
    setTtsEndpoint('')
    setTranslateModel('')
    setTranslateEndpoint('')
    setMnemonicModel('')
    setMnemonicEndpoint('')
    if (newProvider === 'mimo') {
      setTtsEndpoint(getDefaultEndpoint('mimo', 'tts'))
      setAsrEndpoint(getDefaultEndpoint('mimo', 'asr'))
      setTranslateEndpoint(getDefaultEndpoint('mimo', 'translate'))
      setMnemonicEndpoint(getDefaultEndpoint('mimo', 'mnemonic'))
    }
    if (newProvider === 'dashscope') {
      setTtsEndpoint(getDefaultEndpoint('dashscope', 'tts'))
      setAsrEndpoint(getDefaultEndpoint('dashscope', 'asr'))
      setTranslateEndpoint(getDefaultEndpoint('dashscope', 'translate'))
      setMnemonicEndpoint(getDefaultEndpoint('dashscope', 'mnemonic'))
    }
    if (newProvider === 'local') {
      setBaseUrl(DEFAULT_LOCAL_MODEL_URL)
    }
    if (!name || PROVIDERS.some(p => p.label === name)) {
      setName(PROVIDERS.find(p => p.value === newProvider)?.label || newProvider)
    }
  }

  const addService = (kind: ServiceKind) => {
    setEnabledServices(prev => new Set(prev).add(kind))
  }

  const removeService = (kind: ServiceKind) => {
    setEnabledServices(prev => {
      const next = new Set(prev)
      next.delete(kind)
      return next
    })
    if (kind === 'asr') { setAsrModel(''); setAsrEndpoint('') }
    if (kind === 'tts') { setTtsModel(''); setTtsEndpoint('') }
    if (kind === 'translate') { setTranslateModel(''); setTranslateEndpoint('') }
    if (kind === 'mnemonic') { setMnemonicModel(''); setMnemonicEndpoint('') }
  }

  const getModelValue = (kind: ServiceKind) => {
    if (kind === 'asr') return asrModel
    if (kind === 'tts') return ttsModel
    if (kind === 'mnemonic') return mnemonicModel
    return translateModel
  }

  const setModelValue = (kind: ServiceKind, value: string) => {
    if (kind === 'asr') setAsrModel(value)
    if (kind === 'tts') setTtsModel(value)
    if (kind === 'mnemonic') setMnemonicModel(value)
    if (kind === 'translate') setTranslateModel(value)
  }

  const getEndpointValue = (kind: ServiceKind) => {
    if (kind === 'asr') return asrEndpoint
    if (kind === 'tts') return ttsEndpoint
    if (kind === 'mnemonic') return mnemonicEndpoint
    return translateEndpoint
  }

  const setEndpointValue = (kind: ServiceKind, value: string) => {
    if (kind === 'asr') setAsrEndpoint(value)
    if (kind === 'tts') setTtsEndpoint(value)
    if (kind === 'mnemonic') setMnemonicEndpoint(value)
    if (kind === 'translate') setTranslateEndpoint(value)
  }

  const pendingServices = SERVICE_TYPES.filter(s => !enabledServices.has(s.kind))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? '编辑模型配置' : '新增模型配置'}</DialogTitle>
        <DialogDescription>配置 API 地址和密钥，按需添加 ASR、TTS、翻译和助记模型</DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="flex flex-col gap-4">
          {/* 基础信息 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">配置名称 <span className="text-destructive">*</span></label>
            <Input
              placeholder="例如: Qwen ASR+TTS"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">模型提供商 <span className="text-destructive">*</span></label>
            <select
              value={provider}
              onChange={e => handleProviderChange(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Base URL <span className="text-destructive">*</span></label>
            <Input
              placeholder="Base URL（不含具体 API 路径）"
              value={baseUrl}
              onChange={e => { setBaseUrl(e.target.value); setModels([]) }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">API Key{!isEdit && <span className="text-destructive"> *</span>}</label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder={isEdit ? (loadingConfig ? '加载中…' : '留空则不修改') : 'sk-...'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setModels([]) }}
                disabled={loadingConfig}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {isEdit && <p className="text-xs text-muted-foreground">已回填原有 API Key，清空则不修改</p>}
          </div>

          {/* 服务模型区域 */}
          <div className="flex flex-col gap-3 pt-1">
            <label className="text-sm font-medium">服务模型</label>

            {/* 已启用的服务配置卡片 */}
            {SERVICE_TYPES.filter(s => enabledServices.has(s.kind)).map(s => {
              const Icon = s.icon
              const style = SERVICE_STYLES[s.kind]
              return (
                <div
                  key={s.kind}
                  className="rounded-xl border"
                  style={{ borderLeftWidth: 3, borderLeftColor: style.accent, background: style.softBg, borderColor: style.borderColor }}
                >
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4" style={{ color: style.accent }} />
                      <span className="text-sm font-medium">{s.title}</span>
                      <span className="text-xs text-muted-foreground">（{s.subtitle}）</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => removeService(s.kind)}
                    >
                      <Trash2 className="mr-1 size-3" />移除
                    </Button>
                  </div>
                  <div className="flex flex-col gap-3 px-4 py-3" style={{ borderTop: `1px solid ${style.borderColor}` }}>
                    <ModelSelect
                      label="模型"
                      value={getModelValue(s.kind)}
                      models={models}
                      showDropdown={activeDropdown === s.kind}
                      onValueChange={v => setModelValue(s.kind, v)}
                      onDropdownToggle={show => setActiveDropdown(show ? s.kind : null)}
                      fetching={fetchingModels}
                      onFetch={fetchModels}
                      disabled={!baseUrl.trim() || !apiKey.trim()}
                    />
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">端点路径</label>
                      <Input
                        placeholder={getDefaultEndpoint(provider || 'mimo', s.kind)}
                        value={getEndpointValue(s.kind)}
                        onChange={e => setEndpointValue(s.kind, e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}

            {/* 未启用的服务类型选择卡片 */}
            {pendingServices.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {pendingServices.map(s => {
                  const Icon = s.icon
                  const style = SERVICE_STYLES[s.kind]
                  return (
                    <button
                      key={s.kind}
                      type="button"
                      onClick={() => addService(s.kind)}
                      className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-3 py-4 text-muted-foreground transition-colors"
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = style.accent
                        e.currentTarget.style.background = style.softBg
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = ''
                        e.currentTarget.style.background = ''
                      }}
                    >
                      <span
                        className="flex size-8 items-center justify-center rounded-full"
                        style={{ background: style.mutedBg, color: style.accent }}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="text-xs font-medium">{s.title}</span>
                      <span className="text-[10px]">+ 添加</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ── KokoroConfigCard — Kokoro 本地 TTS 配置 ── */

function KokoroConfigCard() {
  const [modelId, setModelId] = useState('')
  const [modelPath, setModelPath] = useState('')
  const [editing, setEditing] = useState(false)
  const [editModelId, setEditModelId] = useState('')
  const [editModelPath, setEditModelPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/kokoro')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.modelId) setModelId(data.modelId)
        if (data?.modelPath) setModelPath(data.modelPath)
      })
      .catch(() => {})
  }, [])

  const handleEdit = () => {
    setEditModelId(modelId)
    setEditModelPath(modelPath)
    setEditing(true)
    setError('')
  }

  const handleCancel = () => {
    setEditing(false)
    setError('')
  }

  const handleSave = async () => {
    if (!editModelId.trim()) { setError('模型 ID 不能为空'); return }
    if (!editModelPath.trim()) { setError('模型路径不能为空'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/kokoro', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: editModelId.trim(), modelPath: editModelPath.trim() }),
      })
      if (!res.ok) throw new Error('保存失败')
      setModelId(editModelId.trim())
      setModelPath(editModelPath.trim())
      setKokoroModelId(editModelId.trim())
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base"><Headphones data-icon="inline-start" />Kokoro 配置</CardTitle>
          {!editing && (
            <Button size="sm" variant="outline" onClick={handleEdit}>
              <Pencil className="mr-1 size-3" />编辑
            </Button>
          )}
        </div>

        <div className="rounded-xl border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">本地离线语音合成模型（ONNX Runtime Web）</p>
          {editing ? (
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">模型 ID</label>
                <Input
                  value={editModelId}
                  onChange={e => setEditModelId(e.target.value)}
                  placeholder="onnx-community/Kokoro-82M-v1.0-ONNX"
                />
                <p className="text-xs text-muted-foreground">HuggingFace 模型 ID，用于下载模型文件</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">模型路径</label>
                <Input
                  value={editModelPath}
                  onChange={e => setEditModelPath(e.target.value)}
                  placeholder="/home/user/.ping-eng/kokoro-models"
                />
                <p className="text-xs text-muted-foreground">模型文件本地存储目录，启动时优先从此路径加载</p>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancel}>取消</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              <div>
                <p className="text-xs text-muted-foreground">模型 ID</p>
                <p className="truncate text-sm font-medium">{modelId || '加载中...'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">模型路径</p>
                <p className="truncate text-sm font-medium font-mono text-xs">{modelPath || '加载中...'}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                运行时状态：{getKokoroModelId() === modelId ? '已同步' : '待加载'}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── ModelConfigListSection — 模型配置列表 ── */

export function ModelConfigListSection({ highlightTtsModel, onHighlightDone, onConfigsChanged, onSaved }: {
  highlightTtsModel?: boolean
  onHighlightDone?: () => void
  onConfigsChanged?: () => void
  onSaved?: () => void
}) {
  const [configs, setConfigs] = useState<LlmConfigItem[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<LlmConfigItem | null>(null)

  const loadConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/llm-configs')
      const data = await res.json()
      setConfigs(data.configs || [])
      setDefaultId(data.defaultId || null)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void loadConfigs() }, [loadConfigs])

  useEffect(() => {
    if (!highlightTtsModel || loading) return
    setEditingConfig(null)
    setDialogOpen(true)
    onHighlightDone?.()
  }, [highlightTtsModel, loading, onHighlightDone])

  const handleAdd = () => {
    setEditingConfig(null)
    setDialogOpen(true)
  }

  const handleEdit = (config: LlmConfigItem) => {
    setEditingConfig(config)
    setDialogOpen(true)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定删除配置「${name}」？`)) return
    await fetch('/api/settings/llm-configs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    void loadConfigs()
    onConfigsChanged?.()
  }

  const handleSetDefault = async (id: string) => {
    await fetch('/api/settings/llm-configs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'setDefault' }),
    })
    void loadConfigs()
    onConfigsChanged?.()
  }

  const handleDialogSave = () => {
    void loadConfigs()
    onConfigsChanged?.()
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <div className="size-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base"><Settings2 data-icon="inline-start" />LLM 配置</CardTitle>
            <Button size="sm" onClick={handleAdd}><Plus data-icon="inline-start" />新增模型</Button>
          </div>

          {configs.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">暂无模型配置</p>
              <p className="mt-1 text-xs text-muted-foreground">点击「新增模型」添加你的第一个 AI 模型配置</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {configs.map(c => {
                const isDefault = c.id === defaultId
                return (
                  <div key={c.id} className="rounded-xl border px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          {isDefault && (
                            <Badge variant="default" className="shrink-0 gap-1">
                              <Star className="size-3" />默认
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{providerLabel(c.provider)}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">Base: {c.baseUrl}</p>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                          {c.asrModel && <span><Mic className="mr-1 inline size-3" />ASR: {c.asrModel}</span>}
                          {c.ttsModel && <span><Headphones className="mr-1 inline size-3" />TTS: {c.ttsModel}</span>}
                          {c.translateModel && <span><Languages className="mr-1 inline size-3" />翻译: {c.translateModel}</span>}
                          {!c.asrModel && !c.ttsModel && !c.translateModel && <span>未配置具体模型</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!isDefault && (
                          <Button variant="ghost" size="sm" onClick={() => void handleSetDefault(c.id)} title="设为默认">
                            <Star className="size-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(c)} title="编辑">
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => void handleDelete(c.id, c.name)} title="删除">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <KokoroConfigCard />

      <ModelConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingConfig={editingConfig}
        onSave={handleDialogSave}
        onSaved={onSaved}
      />
    </div>
  )
}

/* ── ModelConfigListDialog — 包装在 Dialog 中的完整配置管理 ── */

export function ModelConfigListDialog({
  open, onOpenChange, onConfigsChanged, onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfigsChanged?: () => void
  onSaved?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>模型配置管理</DialogTitle>
        <DialogDescription>查看、新增、编辑或删除模型配置</DialogDescription>
      </DialogHeader>
      <DialogContent>
        <ModelConfigListSection
          onConfigsChanged={onConfigsChanged}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  )
}
