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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Database, Download, FileArchive, Gauge, Repeat, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Shell, PageIntro } from '@/components/shared/shell'
import { ModelConfigListSection } from '@/components/shared/model-config-list-dialog'
import { formatBytes } from '@/lib/format'
import { RECORD_KEY_PREFIXES } from '@/platform/storage/schema'
import { parseBackupJson, type ImportStrategy } from '@/core/backup/backup-format'
import { isZipMagic } from '@/core/backup/zip'
import { buildBackup, buildFullBackupZip, downloadBlob, downloadJsonBackup, importBackup, importZipBackup, prepareZipImport, type ImportSummary } from '@/platform/storage/backup'
import { blobsStore, estimateUsage, materialsStore, recordsStore } from '@/platform/storage/idb'
import { initMaterials, materialStore, removeMaterial } from '@/stores/material-store'
import { getTrainingStats } from '@/stores/training-record-store'
import { useStore } from '@/stores/store'
import { DEFAULT_WHISPER_ALIGN_URL, DEFAULT_WHISPER_TRANSCRIBE_URL } from '@/lib/service-endpoints'
import {
  getDefaultLoop, getDefaultRate,
  PREF_LOOPS, PREF_RATES, setDefaultLoop, setDefaultRate,
  type PrefLoop, type PrefRate,
} from '@/lib/pref-keys'

/* ── helpers ─────────────────────────────────────────── */

const loopLabel = (v: PrefLoop) => (v === 0 ? '关' : v === 'inf' ? '∞' : `${v} 次`)

interface Stats { trainCount: number; avgScore: number; favCount: number }

/* ── 学习统计 ─────────────────────────────────────────── */

function LearningStatsSection() {
  // 统计真源是 recordsStore（下方 refreshStats 全量扫描），不订阅 materialStore ——
  // 订阅会让全应用任意材料操作都白白重渲染本节
  const [stats, setStats] = useState<Stats>({ trainCount: 0, avgScore: 0, favCount: 0 })

  const refreshStats = useCallback(async () => {
    try {
      const [training, favorites] = await Promise.all([
        getTrainingStats(),
        recordsStore.getAllEntriesByPrefix(RECORD_KEY_PREFIXES.favorite),
      ])
      setStats({
        trainCount: training.count,
        avgScore: training.averageScore,
        favCount: favorites.length,
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

  useEffect(() => {
    setRate(getDefaultRate())
    setLoop(getDefaultLoop())
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

  return (
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
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/local-services')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        setWhisperAlignUrl(data.whisperAlignUrl || '')
        setWhisperTranscribeUrl(data.whisperTranscribeUrl || '')
      })
      .catch(() => setError('本地服务配置读取失败，下方显示的可能是默认值'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSuccess('')
    setError('')
    try {
      const res = await fetch('/api/settings/local-services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whisperAlignUrl: whisperAlignUrl.trim() || undefined,
          whisperTranscribeUrl: whisperTranscribeUrl.trim() || undefined,
        }),
      })
      // fetch 只在网络层 reject：403（公网/隧道主机被同源守卫拦下）或 5xx 时
      // res.ok 为 false，必须如实报错而不是提示「已保存」（2026-11 全仓复审）
      if (!res.ok) throw new Error(`保存失败（HTTP ${res.status}）`)
      setSuccess('已保存')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
      </CardContent>
    </Card>
  )
}

/* ── 备份与迁移 ─────────────────────────────────── */

/** 待确认导入的备份（已通过解析校验；kind 区分轻量 JSON / 完整 zip，json 路径 media* 恒 0） */
interface PendingImport {
  kind: 'json' | 'zip'
  json: string
  zipFile?: File
  exportedAt: number
  materialCount: number
  recordCount: number
  prefCount: number
  mediaCount: number
  mediaBytes: number
  mediaMissing: number
}

function BackupSection() {
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [strategy, setStrategy] = useState<ImportStrategy>('skipExisting')
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState('')
  const [exportingFull, setExportingFull] = useState(false)
  const [mediaInfo, setMediaInfo] = useState<{ count: number; bytes: number } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 本机可打包媒体统计（只碰 Blob 句柄不读内容，供完整备份前的体量提示）
  useEffect(() => {
    let alive = true
    void (async () => {
      const ids = await materialsStore.allKeys()
      // 每条只读 .size 却各付一次事务开销：并发读（评审 #56）
      const blobs = await Promise.all(ids.map((id) => blobsStore.get<Blob>(id)))
      let count = 0
      let bytes = 0
      for (const b of blobs) {
        if (b) { count++; bytes += b.size }
      }
      if (alive) setMediaInfo({ count, bytes })
    })().catch(() => { /* 统计失败静默，不影响主流程 */ })
    return () => { alive = false }
  }, [])

  const handleExport = async () => {
    setError('')
    try {
      const { filename, json } = await buildBackup()
      downloadJsonBackup(filename, json)
    } catch {
      setError('导出失败，请重试')
    }
  }

  const handleExportFull = async () => {
    setError('')
    setExportingFull(true)
    try {
      const { filename, blob } = await buildFullBackupZip()
      downloadBlob(filename, blob)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，请重试')
    } finally {
      setExportingFull(false)
    }
  }

  const handleFile = async (file: File) => {
    setError('')
    try {
      // 魔数识别（PK\x03\x04 / PK\x05\x06）：.zip 被改名 .json 也能正确分派
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
      if (isZipMagic(head)) {
        const preview = await prepareZipImport(file)
        setPending({
          kind: 'zip', json: '', zipFile: file,
          exportedAt: preview.parsed.exportedAt,
          materialCount: preview.parsed.materials.length,
          recordCount: Object.keys(preview.parsed.records).length,
          prefCount: Object.keys(preview.parsed.prefs).length,
          mediaCount: preview.parsed.media.length,
          mediaBytes: preview.mediaBytes,
          mediaMissing: preview.mediaMissing,
        })
        return
      }
      const text = await file.text()
      const parsed = parseBackupJson(text)
      if (!parsed.ok) { setError(parsed.error); return }
      setPending({
        kind: 'json', json: text,
        exportedAt: parsed.backup.exportedAt,
        materialCount: parsed.backup.materials.length,
        recordCount: Object.keys(parsed.backup.records).length,
        prefCount: Object.keys(parsed.backup.prefs).length,
        mediaCount: 0, mediaBytes: 0, mediaMissing: 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取备份文件')
    }
  }

  const confirmImport = async () => {
    if (!pending) return
    setImporting(true)
    setError('')
    try {
      const s = pending.kind === 'zip' && pending.zipFile
        ? await importZipBackup(pending.zipFile, strategy)
        : await importBackup(pending.json, strategy)
      setSummary(s)
      setPending(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <CardTitle className="text-base">📦 备份与迁移</CardTitle>
        <CardDescription>
          备份包含材料与字幕、学习进度、收藏、笔记、生词本、训练记录和设置。轻量备份导出为 JSON（不含音视频）；
          完整备份打包为 zip（含音视频文件）。换设备：旧设备导出 → 新设备导入。
        </CardDescription>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void handleExport()}>
            <Download data-icon="inline-start" />导出备份
          </Button>
          <Button variant="outline" disabled={exportingFull} onClick={() => void handleExportFull()}>
            <FileArchive data-icon="inline-start" />{exportingFull ? '打包中…' : '完整备份（含媒体）'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,application/zip,.zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload data-icon="inline-start" />导入备份
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          本机可打包媒体：{mediaInfo ? `${mediaInfo.count} 个 · 约 ${formatBytes(mediaInfo.bytes)}` : '统计中…'}
          ；导入支持 .json 与 .zip（自动识别），zip 导入需设备剩余存储空间充足。
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>

      {/* 导入确认：备份概要 + 冲突策略 */}
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null) }}>
        <DialogHeader>
          <DialogTitle>导入备份</DialogTitle>
          <DialogDescription>
            {pending
              ? `导出于 ${pending.exportedAt ? new Date(pending.exportedAt).toLocaleString() : '未知时间'} · 材料 ${pending.materialCount} · 记录 ${pending.recordCount} 条 · 设置 ${pending.prefCount} 项`
                + (pending.kind === 'zip' ? ` · 媒体 ${pending.mediaCount} 个（约 ${formatBytes(pending.mediaBytes)}）` : '')
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="flex flex-col gap-4">
            {pending && pending.kind === 'zip' && pending.mediaMissing > 0 && (
              <p className="text-sm text-amber-600">备份包中缺少 {pending.mediaMissing} 个媒体文件，对应材料导入后需单独补传媒体。</p>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">与本机已有数据冲突时：</p>
              <div className="flex flex-wrap gap-2">
                <Button variant={strategy === 'skipExisting' ? 'secondary' : 'outline'} size="sm" onClick={() => setStrategy('skipExisting')}>保留本机数据</Button>
                <Button variant={strategy === 'overwrite' ? 'secondary' : 'outline'} size="sm" onClick={() => setStrategy('overwrite')}>以备份覆盖</Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {strategy === 'skipExisting' ? '只导入本机没有的材料、记录与设置' : '同名材料与同 key 记录将被备份内容覆盖'}
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPending(null)}>取消</Button>
              <Button onClick={() => void confirmImport()} disabled={importing}>{importing ? '导入中…' : '开始导入'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 导入结果：计数 + 刷新生效 */}
      <Dialog open={!!summary} onOpenChange={(o) => { if (!o) window.location.reload() }}>
        <DialogHeader>
          <DialogTitle>导入完成</DialogTitle>
          <DialogDescription>刷新页面后生效</DialogDescription>
        </DialogHeader>
        <DialogContent>
          {summary && (
            <div className="flex flex-col gap-3">
              <div className={`grid gap-2 text-center ${summary.mediaWritten + summary.mediaSkipped + summary.mediaMissing > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                <div className="rounded-xl bg-muted p-3"><p className="font-serif text-2xl font-semibold text-primary">{summary.materialsWritten}</p><p className="text-xs text-muted-foreground">材料导入 / 跳过 {summary.materialsSkipped}</p></div>
                <div className="rounded-xl bg-muted p-3"><p className="font-serif text-2xl font-semibold text-primary">{summary.recordsWritten}</p><p className="text-xs text-muted-foreground">记录导入 / 跳过 {summary.recordsSkipped}</p></div>
                <div className="rounded-xl bg-muted p-3"><p className="font-serif text-2xl font-semibold text-primary">{summary.prefsWritten}</p><p className="text-xs text-muted-foreground">设置导入 / 跳过 {summary.prefsSkipped}</p></div>
                {summary.mediaWritten + summary.mediaSkipped + summary.mediaMissing > 0 && (
                  <div className="rounded-xl bg-muted p-3"><p className="font-serif text-2xl font-semibold text-primary">{summary.mediaWritten}</p><p className="text-xs text-muted-foreground">媒体导入 / 跳过 {summary.mediaSkipped}</p></div>
                )}
              </div>
              {summary.mediaWritten + summary.mediaSkipped > 0 ? (
                summary.mediaMissing > 0 && <p className="text-xs text-muted-foreground">备份包中缺失媒体 {summary.mediaMissing} 个，对应材料需单独补传媒体。</p>
              ) : (
                <p className="text-xs text-muted-foreground">轻量备份不含媒体文件，播放需重新导入对应媒体。</p>
              )}
              <div className="flex justify-end"><Button onClick={() => window.location.reload()}>刷新页面</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/* ── 存储管理 ─────────────────────────────────── */

function StorageSection() {
  const { records, collections } = useStore(materialStore)
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
  const collectionNameById = new Map(collections.map((c) => [c.id, c.name] as const))

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
                  {r.material.mediaType === 'video' ? '视频' : '音频'} · {r.material.subtitle?.sentenceCount ?? 0} 句{r.material.collectionId && collectionNameById.get(r.material.collectionId) ? ` · ${collectionNameById.get(r.material.collectionId)}` : ''}
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
            <TabsTrigger value="training">播放设置</TabsTrigger>
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
            <BackupSection />
            <div className="mt-4"><StorageSection /></div>
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  )
}

export { SettingsPage }
