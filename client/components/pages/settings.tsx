/**
 * P10 我的 / 设置 —— 真源：docs/原型设计.md §4.11
 *
 * 标签页布局：学习统计 | 播放/训练设置 | 模型配置 | 本地服务 | 存储管理
 * - 学习统计：records store 聚合（训练次数 / 平均成绩 / 收藏数）
 * - 播放/训练设置：读写 platform/storage/prefs.ts
 * - 模型配置：多模型列表管理（新增/编辑/删除/设为默认）
 * - 本地服务：WhisperX 对齐、faster-whisper 转写服务地址配置
 * - 存储管理：estimateUsage()、材料列表删除、清空全部数据
 * 所有浏览器 API 仅在 effect/回调内访问，SSR 安全。
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, Database, Eye, EyeOff, Gauge, Headphones, Languages, Mic, Pencil, Plus, RefreshCw, Repeat, Settings2, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Shell, PageIntro } from '@/components/shared/shell'
import { blobsStore, estimateUsage, materialsStore, recordsStore } from '@/platform/storage/idb'
import { initMaterials, materialStore, removeMaterial } from '@/stores/material-store'
import { useStore } from '@/stores/store'
import {
  getDefaultLoop, getDefaultRate, getHeadphoneHint, getRecordMode,
  PREF_LOOPS, PREF_RATES, setDefaultLoop, setDefaultRate, setHeadphoneHint, setRecordMode,
  type PrefLoop, type PrefRate, type PrefRecordMode,
} from '@/lib/pref-keys'
import type { TrainingRecord } from '@/types/training'

/* ── helpers ─────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

const loopLabel = (v: PrefLoop) => (v === 0 ? '关' : v === 'inf' ? '∞' : `${v} 次`)

interface Stats { trainCount: number; avgScore: number; favCount: number }

/* ── 学习统计 ─────────────────────────────────────────── */

function LearningStatsSection() {
  const { records } = useStore(materialStore)
  const [stats, setStats] = useState<Stats>({ trainCount: 0, avgScore: 0, favCount: 0 })

  const refreshStats = useCallback(async () => {
    try {
      const keys = await recordsStore.allKeys()
      const trainKeys = keys.filter((k) => k.startsWith('train:'))
      const loaded = await Promise.all(trainKeys.map((k) => recordsStore.get<TrainingRecord>(k)))
      const scores = loaded.filter((r): r is TrainingRecord => !!r && typeof r.score === 'number')
      setStats({
        trainCount: trainKeys.length,
        avgScore: scores.length > 0 ? Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length) : 0,
        favCount: keys.filter((k) => k.startsWith('fav:')).length,
      })
    } catch { /* 统计失败不影响设置页 */ }
  }, [])

  useEffect(() => { void refreshStats() }, [refreshStats])

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <CardTitle className="text-base">📊 学习统计</CardTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-muted p-4 text-center">
            <p className="font-serif text-3xl font-semibold text-primary">{stats.trainCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">训练次数</p>
          </div>
          <div className="rounded-xl bg-muted p-4 text-center">
            <p className="font-serif text-3xl font-semibold text-primary">{stats.avgScore}</p>
            <p className="mt-1 text-xs text-muted-foreground">平均成绩</p>
          </div>
          <div className="rounded-xl bg-muted p-4 text-center">
            <p className="font-serif text-3xl font-semibold text-primary">{stats.favCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">收藏句子</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── 播放/训练设置 ─────────────────────────────────────────── */

function TrainingSettingsSection() {
  const [rate, setRate] = useState<PrefRate>(1)
  const [loop, setLoop] = useState<PrefLoop>(0)
  const [recordMode, setRecordModeState] = useState<PrefRecordMode>('hold')
  const [headphoneHint, setHeadphoneHintState] = useState(true)

  useEffect(() => {
    setRate(getDefaultRate())
    setLoop(getDefaultLoop())
    setRecordModeState(getRecordMode())
    setHeadphoneHintState(getHeadphoneHint())
  }, [])

  const cycleRate = () => {
    const next = PREF_RATES[(PREF_RATES.indexOf(rate) + 1) % PREF_RATES.length] ?? 1
    setRate(next)
    setDefaultRate(next)
  }
  const cycleLoop = () => {
    const next = PREF_LOOPS[(PREF_LOOPS.indexOf(loop) + 1) % PREF_LOOPS.length] ?? 0
    setLoop(next)
    setDefaultLoop(next)
  }
  const cycleRecordMode = () => {
    const next: PrefRecordMode = recordMode === 'hold' ? 'tap' : 'hold'
    setRecordModeState(next)
    setRecordMode(next)
  }
  const toggleHeadphoneHint = () => {
    setHeadphoneHintState(!headphoneHint)
    setHeadphoneHint(!headphoneHint)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 播放设置 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <CardTitle className="text-base"><Gauge data-icon="inline-start" />播放设置</CardTitle>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">默认倍速</p>
              <CardDescription>进入播放器时的初始播放速度</CardDescription>
            </div>
            <Button variant="outline" onClick={cycleRate} aria-label="切换默认倍速">{rate}x</Button>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">单句循环次数</p>
              <CardDescription>播放器 A-B 循环的默认档位</CardDescription>
            </div>
            <Button variant="outline" onClick={cycleLoop} aria-label="切换默认循环次数">
              <Repeat data-icon="inline-start" />{loopLabel(loop)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 训练设置 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <CardTitle className="text-base"><Mic data-icon="inline-start" />训练设置</CardTitle>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">录音交互方式</p>
              <CardDescription>跟读/背诵页的录音按钮操作</CardDescription>
            </div>
            <Button variant="outline" onClick={cycleRecordMode} aria-label="切换录音交互方式">
              {recordMode === 'hold' ? '按住录音' : '点击录音'}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">耳机提示</p>
              <CardDescription>开始跟读前提醒佩戴耳机</CardDescription>
            </div>
            <Button
              variant={headphoneHint ? 'secondary' : 'outline'}
              onClick={toggleHeadphoneHint}
              aria-pressed={headphoneHint}
              aria-label="切换耳机提示"
            >
              <Headphones data-icon="inline-start" />{headphoneHint ? '已开启' : '已关闭'}
              <Badge variant={headphoneHint ? 'default' : 'secondary'}>{headphoneHint ? '开' : '关'}</Badge>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ── 模型配置 ─────────────────────────────────────────── */

const PROVIDERS = [
  { value: 'qwen', label: 'QwenAI (通义千问)' },
  { value: 'whisper', label: 'WhisperAI' },
  { value: 'mimo', label: 'MiMo' },
]

/** 通用模型列表下拉组件 */
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

/** 支持翻译功能的提供商 */
const TRANSLATE_PROVIDERS = new Set(['qwen', 'mimo'])

const providerLabel = (v: string) => PROVIDERS.find(p => p.value === v)?.label || v

interface LlmConfigItem {
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

/** 模型配置弹窗 — 新增/编辑共用 */
function ModelConfigDialog({
  open, onOpenChange, editingConfig, onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingConfig?: LlmConfigItem | null
  onSave: () => void
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

  // Reset form when dialog opens; fetch full config (with raw API Key) in edit mode
  useEffect(() => {
    if (!open) return
    if (editingConfig) {
      // 先用列表中的掩码数据填充，再异步获取完整配置
      setProvider(editingConfig.provider || 'qwen')
      setName(editingConfig.name || '')
      setBaseUrl(editingConfig.baseUrl || '')
      setApiKey('') // 等待完整配置返回后回填
      setAsrModel(editingConfig.asrModel || '')
      setAsrEndpoint(editingConfig.asrEndpoint || '')
      setTtsModel(editingConfig.ttsModel || '')
      setTtsEndpoint(editingConfig.ttsEndpoint || '')
      setTranslateModel(editingConfig.translateModel || '')
      setTranslateEndpoint(editingConfig.translateEndpoint || '')

      // 异步获取完整配置（含明文 API Key）
      setLoadingConfig(true)
      fetch(`/api/settings/llm-configs?id=${encodeURIComponent(editingConfig.id)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setApiKey(data.apiKey || '')
          }
        })
        .catch(() => { /* 获取失败不影响其他字段编辑 */ })
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
      // Temporarily save credentials to server so /api/models can use them
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
        // 编辑模式：空值不传，后端保留原值
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [name, provider, baseUrl, apiKey, asrModel, asrEndpoint, ttsModel, ttsEndpoint, translateModel, translateEndpoint, isEdit, editingConfig, onOpenChange, onSave])

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
    // Auto-suggest name
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

          {/* 翻译模型配置 — 仅支持的提供商可见 */}
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

function ModelConfigListSection({ highlightTtsModel, onHighlightDone }: {
  highlightTtsModel?: boolean
  onHighlightDone?: () => void
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

  // highlight=tts-model → auto-open add dialog
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
  }

  const handleSetDefault = async (id: string) => {
    await fetch('/api/settings/llm-configs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'setDefault' }),
    })
    void loadConfigs()
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
        onSave={loadConfigs}
      />
    </div>
  )
}

/* ── 本地服务配置 ─────────────────────────────────────── */

function LocalServicesSection() {
  const [whisperAlignUrl, setWhisperAlignUrl] = useState('')
  const [whisperTranscribeUrl, setWhisperTranscribeUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetch('/api/settings/local-services')
      .then(res => res.json())
      .then(data => {
        setWhisperAlignUrl(data.whisperAlignUrl || '')
        setWhisperTranscribeUrl(data.whisperTranscribeUrl || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSuccess('')
    try {
      await fetch('/api/settings/local-services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whisperAlignUrl: whisperAlignUrl.trim() || undefined,
          whisperTranscribeUrl: whisperTranscribeUrl.trim() || undefined,
        }),
      })
      setSuccess('已保存')
      setTimeout(() => setSuccess(''), 3000)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }, [whisperAlignUrl, whisperTranscribeUrl])

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
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <CardTitle className="text-base"><Database data-icon="inline-start" />本地服务配置</CardTitle>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">WhisperX 对齐服务</label>
          <Input
            placeholder="http://127.0.0.1:8765"
            value={whisperAlignUrl}
            onChange={e => setWhisperAlignUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            WhisperX 词级时间戳对齐服务地址。留空则使用默认地址 (http://127.0.0.1:8765)。
            <code className="ml-1 text-xs">./start.sh --server align</code>
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
            本地 faster-whisper 转写服务地址。留空则使用默认地址 (http://127.0.0.1:8766)。
            <code className="ml-1 text-xs">./start.sh --server transcribe</code>
          </p>
        </div>

        {success && <p className="text-sm text-emerald-600">{success}</p>}
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
      </CardContent>
    </Card>
  )
}

/* ── 存储管理 ─────────────────────────────────────────── */

function StorageSection() {
  const { records } = useStore(materialStore)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    void initMaterials()
    void estimateUsage().then(setUsage)
  }, [])

  const refreshUsage = useCallback(async () => {
    setUsage(await estimateUsage())
  }, [])

  const handleRemove = async (id: string, name: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`确定删除材料「${name}」？相关进度与训练记录将一并清理。`)) return
    await removeMaterial(id)
    await refreshUsage()
  }

  const clearAll = async () => {
    if (typeof window !== 'undefined' && !window.confirm('确定清空全部数据？材料、学习进度、训练记录与设置都将删除，并恢复为初始示例内容。')) return
    setClearing(true)
    try {
      await Promise.all([materialsStore.clear(), blobsStore.clear(), recordsStore.clear()])
      try {
        if (typeof localStorage !== 'undefined') {
          const drop: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && k.startsWith('ping-english:')) drop.push(k)
          }
          drop.forEach((k) => localStorage.removeItem(k))
        }
      } catch { /* 隐私模式等场景静默 */ }
      window.location.reload()
    } catch {
      setClearing(false)
    }
  }

  const usagePct = usage && usage.quota > 0 ? Math.min(100, Math.max(1, Math.round((usage.usage / usage.quota) * 100))) : 0

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <CardTitle className="text-base">🗄 存储管理</CardTitle>

        <div className="rounded-xl bg-muted p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">已用空间</span>
            <span className="font-medium tabular-nums">{usage ? formatBytes(usage.usage) : '…'}</span>
          </div>
          <Progress value={usage ? usagePct : 0} />
          <p className="mt-2 text-xs text-muted-foreground">材料与学习进度保存在此设备（IndexedDB / localStorage）</p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">本地材料（{records.length}）</p>
          {records.length === 0 ? (
            <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">暂无材料</p>
          ) : records.map((r) => (
            <div key={r.material.id} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.material.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.material.mediaType === 'video' ? '视频' : '音频'} · {r.material.subtitle?.sentenceCount ?? 0} 句
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`删除材料 ${r.material.name}`} onClick={() => void handleRemove(r.material.id, r.material.name)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="destructive" onClick={() => void clearAll()} disabled={clearing}>
          <Trash2 data-icon="inline-start" />{clearing ? '正在清空…' : '清空全部数据'}
        </Button>
      </CardContent>
    </Card>
  )
}

/* ── 页面主组件 ───────────────────────────────────────── */

const SETTINGS_TABS = ['stats', 'training', 'model', 'services', 'storage'] as const

function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightTtsModel = searchParams.get('highlight') === 'tts-model'
  const tabParam = searchParams.get('tab')
  // highlight 请求强制定位到「模型配置」页
  const [activeTab, setActiveTab] = useState<string>(() =>
    highlightTtsModel ? 'model'
      : (SETTINGS_TABS as readonly string[]).includes(tabParam ?? '') ? tabParam! : 'stats')

  const clearHighlight = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('highlight')
      return next
    }, { replace: true })
  }, [setSearchParams])

  return (
    <Shell back>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <PageIntro title="我的 / 设置" eyebrow="PREFERENCES" />

        <Tabs defaultValue={activeTab} value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="stats">学习统计</TabsTrigger>
            <TabsTrigger value="training">播放/训练设置</TabsTrigger>
            <TabsTrigger value="model">模型配置</TabsTrigger>
            <TabsTrigger value="services">本地服务</TabsTrigger>
            <TabsTrigger value="storage">存储管理</TabsTrigger>
          </TabsList>

          <TabsContent value="stats">
            <LearningStatsSection />
          </TabsContent>
          <TabsContent value="training">
            <TrainingSettingsSection />
          </TabsContent>
          <TabsContent value="model">
            <ModelConfigListSection highlightTtsModel={highlightTtsModel} onHighlightDone={clearHighlight} />
          </TabsContent>
          <TabsContent value="services">
            <LocalServicesSection />
          </TabsContent>
          <TabsContent value="storage">
            <StorageSection />
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  )
}

export { SettingsPage }
