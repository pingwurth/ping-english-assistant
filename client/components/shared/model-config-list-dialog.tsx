/**
 * 模型配置管理弹窗 — 从 settings.tsx 提取，供转写页面和设置页面共享
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Eye, EyeOff, Headphones, Languages, Mic, Pencil, Plus, RefreshCw, Settings2, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

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
}

const PROVIDERS = [
  { value: 'qwen', label: 'QwenAI (通义千问)' },
  { value: 'whisper', label: 'WhisperAI' },
  { value: 'mimo', label: 'MiMo' },
]

const TRANSLATE_PROVIDERS = new Set(['qwen', 'mimo'])

const providerLabel = (v: string) => PROVIDERS.find(p => p.value === v)?.label || v

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

/* ── ModelConfigDialog — 新增/编辑共用弹窗 ── */

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
  const [models, setModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [error, setError] = useState('')
  const [showAsrDropdown, setShowAsrDropdown] = useState(false)
  const [showTtsDropdown, setShowTtsDropdown] = useState(false)
  const [showTranslateDropdown, setShowTranslateDropdown] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

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

      setLoadingConfig(true)
      fetch(`/api/settings/llm-configs?id=${encodeURIComponent(editingConfig.id)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setApiKey(data.apiKey || '')
          }
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
    }
    setModels([])
    setError('')
    setShowAsrDropdown(false)
    setShowTtsDropdown(false)
    setShowTranslateDropdown(false)
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
      setShowAsrDropdown(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }, [provider, baseUrl, apiKey])

  const supportsTranslate = TRANSLATE_PROVIDERS.has(provider)

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
        asrModel: asrModel || undefined,
        asrEndpoint: asrEndpoint.trim() || undefined,
        ttsModel: ttsModel || undefined,
        ttsEndpoint: ttsEndpoint.trim() || undefined,
        translateModel: translateModel || undefined,
        translateEndpoint: translateEndpoint.trim() || undefined,
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
  }, [name, provider, baseUrl, apiKey, asrModel, asrEndpoint, ttsModel, ttsEndpoint, translateModel, translateEndpoint, isEdit, editingConfig, onOpenChange, onSave, onSaved])

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
    if (newProvider === 'mimo') {
      setTtsEndpoint('/chat/completions')
      setTranslateEndpoint('/chat/completions')
    }
    if (!name || PROVIDERS.some(p => p.label === name)) {
      setName(PROVIDERS.find(p => p.value === newProvider)?.label || newProvider)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? '编辑模型配置' : '新增模型配置'}</DialogTitle>
        <DialogDescription>配置 API 地址和密钥，分别设置 ASR、TTS 和翻译模型</DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="flex flex-col gap-4">
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
              placeholder="例如: https://dashscope.aliyuncs.com/compatible-mode/v1"
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

          <ModelSelect
            label="ASR 模型 (语音识别)"
            value={asrModel}
            models={models}
            showDropdown={showAsrDropdown}
            onValueChange={setAsrModel}
            onDropdownToggle={v => { setShowAsrDropdown(v); setShowTtsDropdown(false) }}
            fetching={fetchingModels}
            onFetch={fetchModels}
            disabled={!baseUrl.trim() || !apiKey.trim()}
          />

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">ASR 端点路径</label>
            <Input placeholder="/audio/transcriptions" value={asrEndpoint} onChange={e => setAsrEndpoint(e.target.value)} />
            <p className="text-xs text-muted-foreground">默认: /audio/transcriptions</p>
          </div>

          <ModelSelect
            label="TTS 模型 (语音合成)"
            value={ttsModel}
            models={models}
            showDropdown={showTtsDropdown}
            onValueChange={setTtsModel}
            onDropdownToggle={v => { setShowTtsDropdown(v); setShowAsrDropdown(false) }}
            fetching={fetchingModels}
            onFetch={fetchModels}
            disabled={!baseUrl.trim() || !apiKey.trim()}
          />

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">TTS 端点路径</label>
            <Input placeholder="/audio/speech" value={ttsEndpoint} onChange={e => setTtsEndpoint(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {provider === 'mimo' ? 'MiMo 使用 /chat/completions 处理语音合成' : '默认: /audio/speech'}
            </p>
          </div>

          {supportsTranslate ? (
            <>
              <ModelSelect
                label="翻译模型 (Translation)"
                value={translateModel}
                models={models}
                showDropdown={showTranslateDropdown}
                onValueChange={setTranslateModel}
                onDropdownToggle={v => { setShowTranslateDropdown(v); setShowAsrDropdown(false); setShowTtsDropdown(false) }}
                fetching={fetchingModels}
                onFetch={fetchModels}
                disabled={!baseUrl.trim() || !apiKey.trim()}
              />

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">翻译端点路径</label>
                <Input
                  placeholder={provider === 'mimo' ? '/chat/completions' : '/translations'}
                  value={translateEndpoint}
                  onChange={e => setTranslateEndpoint(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {provider === 'mimo' ? 'MiMo 使用 /chat/completions 处理翻译' : '默认: /translations'}
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-3">
              <p className="text-xs text-muted-foreground">
                <Languages className="mr-1 inline size-3" />
                当前提供商 ({providerLabel(provider)}) 不支持翻译功能，仅 Qwen / MiMo 可用
              </p>
            </div>
          )}

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
            <CardTitle className="text-base"><Settings2 data-icon="inline-start" />模型配置</CardTitle>
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
