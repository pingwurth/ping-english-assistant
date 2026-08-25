import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Shell, PageIntro } from '@/components/shared/shell'
import { formatDuration } from '@/components/shared/player-parts'
import { parseSubtitle, SubtitleParseError } from '@/core/subtitle'
import type { SubtitleData } from '@/types/subtitle'
import { putMaterialRecord, putMediaBlob, deleteMediaBlob } from '@/stores/material-store'
import type { MaterialRecord } from '@/platform/storage/schema'
import { estimateUsage } from '@/platform/storage/idb'
import { consumeTtsExport, readTtsExport } from '@/lib/tts-export'

/** 探测媒体真实时长（loadedmetadata；失败返回 null，不阻断导入） */
function probeMediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof URL === 'undefined' || typeof document === 'undefined') return resolve(null)
    const url = URL.createObjectURL(file)
    const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio')
    const cleanup = () => URL.revokeObjectURL(url)
    el.preload = 'metadata'
    el.onloadedmetadata = () => { const d = Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null; cleanup(); resolve(d) }
    el.onerror = () => { cleanup(); resolve(null) }
    el.src = url
  })
}
function formatBytes(n: number): string { return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB` }
function baseName(fileName: string): string { return fileName.replace(/\.[^.]+$/, '').slice(0, 50) }

function ImportPage() {
  const [searchParams] = useSearchParams()
  const source = searchParams.get('source')
  const taskId = searchParams.get('taskId')
  const [name, setName] = useState('')
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaDurationMs, setMediaDurationMs] = useState<number | null>(null)
  const [subtitle, setSubtitle] = useState<{ raw: string; format?: 'srt' | 'lrc'; data: SubtitleData } | null>(null)
  const [parseError, setParseError] = useState<{ message: string; line: number } | null>(null)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [doneId, setDoneId] = useState<string | null>(null)
  const [fromTts, setFromTts] = useState(false)

  /** 即时解析字幕文本：成功渲染摘要，失败红字 + 行号（文档 P1 校验规则） */
  const applySubtitle = (text: string, format?: 'srt' | 'lrc') => {
    try {
      const data = parseSubtitle(text, format, mediaDurationMs ?? undefined)
      setSubtitle({ raw: text, format, data })
      setParseError(null)
    } catch (e) {
      setSubtitle(null)
      setParseError(e instanceof SubtitleParseError ? { message: e.message, line: e.line } : { message: '字幕解析失败', line: 0 })
    }
  }

  // 媒体时长探测完成后回填 LRC 末句 endMs（LRC 无结束时间，避免末句零时长）
  useEffect(() => {
    if (mediaDurationMs == null) return
    setSubtitle((prev) => {
      if (!prev || prev.data.format !== 'lrc') return prev
      try { return { ...prev, data: parseSubtitle(prev.raw, prev.format, mediaDurationMs) } }
      catch { return prev }
    })
  }, [mediaDurationMs])

  const handleMediaFile = async (file: File | null) => {
    if (!file) return
    setMediaFile(file)
    setName(baseName(file.name)) // 材料名默认取文件名（可编辑）
    setMediaDurationMs(await probeMediaDuration(file))
  }

  // TTS 一键带入：?source=tts&taskId= 时自动填充 ①②（产物由批次E 经 lib/tts-export 写入；缺失时空态兜底）
  useEffect(() => {
    if (source !== 'tts' || !taskId) return
    let alive = true
    readTtsExport(taskId).then(async (payload) => {
      if (!alive || !payload) return
      const { meta, audio } = payload
      const file = new File([audio], meta.audioFileName || 'tts-audio.wav', { type: audio.type || 'audio/wav' })
      setFromTts(true)
      setMediaFile(file)
      setName((meta.name || baseName(file.name)).slice(0, 50))
      setMediaDurationMs(await probeMediaDuration(file))
      applySubtitle(meta.subtitleText, meta.subtitleFormat)
    }).catch(() => { /* 空态兜底：用户可手动选择文件 */ })
    return () => { alive = false }
  }, [source, taskId])

  // 时长偏差预警：未回填的 LRC（totalDurationMs=末句起点）必然偏差巨大 → 跳过警告避免误报
  const lastStartMs = subtitle ? (subtitle.data.sentences[subtitle.data.sentences.length - 1]?.startMs ?? 0) : 0
  const lrcUnfilled = !!subtitle && subtitle.data.format === 'lrc' && subtitle.data.totalDurationMs <= lastStartMs
  const deviationMs = mediaFile && mediaDurationMs != null && subtitle && !lrcUnfilled ? Math.abs(mediaDurationMs - subtitle.data.totalDurationMs) : null
  const canFinish = !!mediaFile && !!subtitle && name.trim().length > 0 && !saving

  const finish = async () => {
    if (!canFinish || !mediaFile || !subtitle) return
    setFinishError(null)
    setSaving(true)
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    try {
      // 写入前余量检查：quota-usage 不足文件大小×1.2 时中止；estimate 不可用（quota=0）时跳过
      const { usage, quota } = await estimateUsage()
      if (quota > 0 && usage + mediaFile.size * 1.2 > quota) {
        setFinishError('存储空间不足，请释放本地空间后重试')
        setSaving(false)
        return
      }
      await putMediaBlob(id, mediaFile) // 媒体 File → blobs store（key = materialId）
      const now = Date.now()
      const record: MaterialRecord = {
        material: {
          id, name: name.trim(),
          mediaType: mediaFile.type.startsWith('video') ? 'video' : 'audio',
          mediaRef: `idb://blobs/${id}`, mediaFileName: mediaFile.name, mediaSizeBytes: mediaFile.size,
          subtitle: { ref: `idb://materials/${id}`, format: subtitle.data.format, isBilingual: subtitle.data.isBilingual, sentenceCount: subtitle.data.sentences.length },
          durationMs: mediaDurationMs ?? subtitle.data.totalDurationMs,
          createdAt: now, lastOpenedAt: now,
        },
        subtitleData: subtitle.data, // 解析结果随元数据同存，避免重复解析（架构 §4.2）
      }
      await putMaterialRecord(record)
      if (fromTts && taskId) await consumeTtsExport(taskId)
      setDone(true)
      setDoneId(id)
    } catch {
      // 回滚已写入的 blob，避免孤儿数据
      await deleteMediaBlob(id).catch(() => {})
      setFinishError('导入失败，请重试')
      setSaving(false)
    }
  }

  if (doneId) return <Navigate to={`/player/${doneId}`} replace />

  return <Shell back><div className="mx-auto max-w-xl px-4 py-10"><PageIntro title="导入材料" eyebrow="ADD MATERIAL">{fromTts && <Badge variant="secondary">由文字转语音生成</Badge>}</PageIntro><Card><CardContent className="flex flex-col gap-6 p-6"><label className="flex flex-col gap-2 text-sm font-medium">1. 选择音视频文件<Input type="file" accept="audio/*,video/*" onChange={e => { void handleMediaFile(e.target.files?.[0] ?? null) }} /></label>{mediaFile ? <div className="rounded-xl bg-primary/10 p-4 text-sm text-primary"><Check data-icon="inline-start" />{mediaFile.name} · {mediaFile.type.startsWith('video') ? '视频' : '音频'}{mediaDurationMs != null && ` · ${formatDuration(mediaDurationMs)}`} · {formatBytes(mediaFile.size)}</div> : <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">支持 mp3、wav、m4a、mp4、mov 等格式</div>}<label className="flex flex-col gap-2 text-sm font-medium">2. 选择字幕文件<Input type="file" accept=".srt,.lrc" onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then((t) => applySubtitle(t)).catch(() => setParseError({ message: '无法读取文件内容', line: 0 })) }} /></label>{subtitle && <div className="rounded-xl bg-primary/10 p-4 text-sm text-primary"><Check data-icon="inline-start" />{subtitle.data.format.toUpperCase()} 字幕 · {subtitle.data.isBilingual ? '双语' : '仅英文'} · {subtitle.data.sentences.length} 句 · 总时长 {formatDuration(subtitle.data.totalDurationMs)} · 解析成功</div>}{parseError && <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{parseError.message}{parseError.line > 0 && `，第 ${parseError.line} 行`}，请重新选择字幕文件</div>}{deviationMs != null && deviationMs > 5000 && <div className="rounded-xl border p-4 text-sm text-muted-foreground"><AlertTriangle data-icon="inline-start" />字幕与媒体时长偏差超过 5 秒，可能不匹配（不影响导入）</div>}<label className="flex flex-col gap-2 text-sm font-medium">3. 材料名称<Input value={name} onChange={e=>setName(e.target.value)} maxLength={50} placeholder="默认取文件名" /></label>{finishError && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{finishError}</p>}<Button className="w-full" onClick={finish} disabled={!canFinish}>{saving ? '导入中…' : '完成导入'}</Button>{done && <p className="text-center text-sm text-primary">导入成功，正在打开播放器…</p>}</CardContent></Card></div></Shell>
}

export { ImportPage }
