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
import { Database, Gauge, Headphones, Mic, Repeat, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Shell, PageIntro } from '@/components/shared/shell'
import { ModelConfigListSection } from '@/components/shared/model-config-list-dialog'
import { blobsStore, estimateUsage, materialsStore, recordsStore } from '@/platform/storage/idb'
import { initMaterials, materialStore, removeMaterial } from '@/stores/material-store'
import { useStore } from '@/stores/store'
import { DEFAULT_WHISPER_ALIGN_URL, DEFAULT_WHISPER_TRANSCRIBE_URL } from '@/lib/service-endpoints'
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

/* ── 模型配置 ── 已提取至 @/components/shared/model-config-list-dialog ── */

/* ── 本地服务配置 ─────────────────────────────── */

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
            placeholder={DEFAULT_WHISPER_ALIGN_URL}
            value={whisperAlignUrl}
            onChange={e => setWhisperAlignUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            WhisperX 词级时间戳对齐服务地址。留空则使用默认地址 ({DEFAULT_WHISPER_ALIGN_URL})。
            <code className="ml-1 text-xs">./start.sh --server align</code>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">faster-whisper 转写服务</label>
          <Input
            placeholder={DEFAULT_WHISPER_TRANSCRIBE_URL}
            value={whisperTranscribeUrl}
            onChange={e => setWhisperTranscribeUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            本地 faster-whisper 转写服务地址。留空则使用默认地址 ({DEFAULT_WHISPER_TRANSCRIBE_URL})。
            <code className="ml-1 text-xs">./start.sh --server transcribe</code>
          </p>
        </div>

        {success && <p className="text-sm text-emerald-600">{success}</p>}
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
      </CardContent>
    </Card>
  )
}

/* ── 存储管理 ─────────────────────────────────── */

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
    if (typeof window !== 'undefined' && !window.confirm(`确定删除材料「${name} 」？相关进度与训练记录将一并清理。`)) return
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
