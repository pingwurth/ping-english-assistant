/**
 * P10 我的 / 设置 —— 真源：docs/原型设计.md §4.11
 *
 * 标签页布局：学习统计 | 播放/训练设置 | 模型配置 | 存储管理
 * - 学习统计：records store 聚合（训练次数 / 平均成绩 / 收藏数）
 * - 播放/训练设置：读写 platform/storage/prefs.ts
 * - 模型配置：LLM provider / API key / model（原 llm-settings-dialog 内联）
 * - 存储管理：estimateUsage()、材料列表删除、清空全部数据
 * 所有浏览器 API 仅在 effect/回调内访问，SSR 安全。
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, Database, Gauge, Headphones, Mic, RefreshCw, Repeat, Settings2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
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

/**
 * 「文字转语音」页点击「添加模型」跳转过来时的定位目标：
 * 模型配置 → TTS 语音合成 → TTS 模型 输入框。
 * XPath 为页面当前渲染结构下的精确路径；DOM 变化导致失效时回退到 id 锚点。
 */
const TTS_MODEL_INPUT_XPATH = '/html/body/div[2]/main/div/div[2]/div[2]/div/div[3]/div/div[2]/div/div/div/input'
const TTS_MODEL_INPUT_ID = 'tts-model-input'

function findTtsModelInput(): HTMLInputElement | null {
  try {
    const result = document.evaluate(TTS_MODEL_INPUT_XPATH, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    if (result.singleNodeValue instanceof HTMLInputElement) return result.singleNodeValue
  } catch { /* XPath 求值异常时走 id 回退 */ }
  return document.getElementById(TTS_MODEL_INPUT_ID) as HTMLInputElement | null
}

const PROVIDERS = [
  { value: 'qwen', label: 'QwenAI (通义千问)' },
  { value: 'whisper', label: 'WhisperAI' },
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

function ModelConfigSection({ highlightTtsModel, onHighlightDone }: {
  /** 为真时（文字转语音页「添加模型」跳转）定位并高亮 TTS 模型输入框 */
  highlightTtsModel?: boolean
  /** 高亮触发后回调，用于清除 URL 中的 highlight 参数 */
  onHighlightDone?: () => void
}) {
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
  const [loading, setLoading] = useState(true)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAsrDropdown, setShowAsrDropdown] = useState(false)
  const [showTtsDropdown, setShowTtsDropdown] = useState(false)

  useEffect(() => {
    setLoading(true)
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
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // 「添加模型」跳转：定位 TTS 模型输入框并高亮 0.5 秒
  useEffect(() => {
    if (!highlightTtsModel || loading) return
    const timer = window.setTimeout(() => {
      const el = findTtsModelInput()
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ping-highlight-flash')
        window.setTimeout(() => el.classList.remove('ping-highlight-flash'), 600)
      }
      onHighlightDone?.()
    }, 200)
    return () => window.clearTimeout(timer)
  }, [highlightTtsModel, loading, onHighlightDone])

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

  const handleSave = useCallback(async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError('Base URL 和 API Key 是必填的')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
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
      setSuccess('配置已保存')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [provider, baseUrl, apiKey, asrModel, asrEndpoint, ttsModel, ttsEndpoint, whisperAlignUrl, whisperTranscribeUrl])

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
      {/* 提供商与凭据 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <CardTitle className="text-base"><Settings2 data-icon="inline-start" />模型提供商</CardTitle>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">模型提供商 <span className="text-destructive">*</span></label>
            <select
              value={provider}
              onChange={e => {
                setProvider(e.target.value)
                setModels([])
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Base URL <span className="text-destructive">*</span></label>
            <Input
              placeholder="例如: https://dashscope.aliyuncs.com/compatible-mode/v1 或 https://api.openai.com/v1"
              value={baseUrl}
              onChange={e => { setBaseUrl(e.target.value); setModels([]) }}
            />
            <p className="text-xs text-muted-foreground">API 接口地址，支持 OpenAI 兼容的服务</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">API Key <span className="text-destructive">*</span></label>
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setModels([]) }}
            />
            <p className="text-xs text-muted-foreground">你的 API 密钥，保存后不会再次显示</p>
          </div>
        </CardContent>
      </Card>

      {/* ASR 模型配置 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <CardTitle className="text-base"><Mic data-icon="inline-start" />ASR 语音识别</CardTitle>

          <ModelSelect
            label="ASR 模型"
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
            <Input
              placeholder="/audio/transcriptions"
              value={asrEndpoint}
              onChange={e => setAsrEndpoint(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              默认: /audio/transcriptions。如果 provider 使用不同路径，请修改
            </p>
          </div>
        </CardContent>
      </Card>

      {/* TTS 模型配置 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <CardTitle className="text-base"><Headphones data-icon="inline-start" />TTS 语音合成</CardTitle>

          <ModelSelect
            label="TTS 模型"
            value={ttsModel}
            models={models}
            showDropdown={showTtsDropdown}
            onValueChange={setTtsModel}
            onDropdownToggle={v => { setShowTtsDropdown(v); setShowAsrDropdown(false) }}
            fetching={fetchingModels}
            onFetch={fetchModels}
            disabled={!baseUrl.trim() || !apiKey.trim()}
            inputId={TTS_MODEL_INPUT_ID}
          />

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">TTS 端点路径</label>
            <Input
              placeholder="/audio/speech"
              value={ttsEndpoint}
              onChange={e => setTtsEndpoint(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              TTS 接口路径，不同 provider 可能不同
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 本地服务配置 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <CardTitle className="text-base"><Database data-icon="inline-start" />本地服务</CardTitle>

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
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}

      <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存配置'}</Button>
    </div>
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

const SETTINGS_TABS = ['stats', 'training', 'model', 'storage'] as const

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
            <TabsTrigger value="storage">存储管理</TabsTrigger>
          </TabsList>

          <TabsContent value="stats">
            <LearningStatsSection />
          </TabsContent>
          <TabsContent value="training">
            <TrainingSettingsSection />
          </TabsContent>
          <TabsContent value="model">
            <ModelConfigSection highlightTtsModel={highlightTtsModel} onHighlightDone={clearHighlight} />
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
