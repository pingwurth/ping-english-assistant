import { useEffect, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, Upload, FileText } from 'lucide-react'
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
import { consumeTranscribeExport, readTranscribeExport } from '@/lib/transcribe-export'

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

/** 步骤状态 */
type StepStatus = 'done' | 'current' | 'pending'

/** 圆形步骤徽章 */
function StepBadge({ step, status }: { step: number; status: StepStatus }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors" data-status={status} style={{
      backgroundColor: status === 'pending' ? 'var(--muted)' : 'var(--primary)',
      color: status === 'pending' ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
      boxShadow: status === 'current' ? '0 0 0 4px oklch(from var(--primary) l c h / 0.2)' : 'none',
    }}>
      {status === 'done' ? <Check className="h-4 w-4" /> : step}
    </div>
  )
}

/** 步骤标签 + 步骤号组合 */
function StepHeader({ step, status, label }: { step: number; status: StepStatus; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <StepBadge step={step} status={status} />
      <span className="text-sm font-medium" style={{ color: status === 'pending' ? 'var(--muted-foreground)' : 'var(--foreground)' }}>{label}</span>
    </div>
  )
}

/** 连接两个步骤的横线 */
function StepConnector({ done }: { done: boolean }) {
  return (
    <div className="ml-4 h-6 w-px" style={{ backgroundColor: done ? 'var(--primary)' : 'var(--muted)' }} />
  )
}

/** 文件上传 dropzone 卡片 */
function FileDropzone({
  icon: Icon,
  accept,
  hint,
  selected,
  onChange,
}: {
  icon: typeof Upload | typeof FileText
  accept: string
  hint: string
  selected: React.ReactNode | null
  onChange: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={0}
        className="group flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]"
        style={{
          borderColor: dragging ? 'var(--primary)' : 'var(--border)',
          backgroundColor: dragging ? 'oklch(from var(--primary) l c h / 0.05)' : 'transparent',
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) onChange(f)
        }}
      >
        <Icon className="h-8 w-8 transition-colors" style={{ color: dragging ? 'var(--primary)' : 'var(--muted-foreground)' }} />
        <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>点击选择或拖拽文件到此处</span>
        <span className="text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>{hint}</span>
        <Input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f) }} />
      </div>
      {selected}
    </div>
  )
}

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
  const [fromTranscribe, setFromTranscribe] = useState(false)

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

  // 转写一键带入：?source=transcribe&taskId= 时自动填充 ①②
  useEffect(() => {
    if (source !== 'transcribe' || !taskId) return
    let alive = true
    readTranscribeExport(taskId).then(async (payload) => {
      if (!alive || !payload) return
      const { meta, audio } = payload
      const file = new File([audio], meta.audioFileName || 'audio.mp3', { type: audio.type || 'audio/mpeg' })
      setFromTranscribe(true)
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
  const canFinish = !!mediaFile && name.trim().length > 0 && !saving

  const finish = async () => {
    if (!canFinish || !mediaFile) return
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
          subtitle: subtitle ? { ref: `idb://materials/${id}`, format: subtitle.data.format, isBilingual: subtitle.data.isBilingual, sentenceCount: subtitle.data.sentences.length } : undefined,
          durationMs: mediaDurationMs ?? subtitle?.data.totalDurationMs ?? 0,
          createdAt: now, lastOpenedAt: now,
        },
        subtitleData: subtitle?.data, // 解析结果随元数据同存，避免重复解析（架构 §4.2）
      }
      await putMaterialRecord(record)
      if (fromTts && taskId) await consumeTtsExport(taskId)
      if (fromTranscribe && taskId) await consumeTranscribeExport(taskId)
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

  // 步骤状态计算
  const step1Status: StepStatus = mediaFile ? 'done' : 'current'
  const step2Status: StepStatus = subtitle ? 'done' : mediaFile ? 'current' : 'pending'
  const step3Status: StepStatus = mediaFile && name.trim() ? 'done' : mediaFile ? 'current' : 'pending'

  return (
    <Shell back>
      <div className="mx-auto max-w-xl px-4 py-10">
        <PageIntro title="导入材料" eyebrow="ADD MATERIAL">
          {fromTts && <Badge variant="secondary">由文字转语音生成</Badge>}
          {fromTranscribe && <Badge variant="secondary">由音频转文字生成</Badge>}
        </PageIntro>

        <Card>
          <CardContent className="flex flex-col gap-6 p-6">

            {/* ── 步骤 1：选择音视频文件 ── */}
            <StepHeader step={1} status={step1Status} label="选择音视频文件" />
            <FileDropzone
              icon={Upload}
              accept="audio/*,video/*"
              hint="支持 mp3、wav、m4a、mp4、mov 等格式"
              selected={
                mediaFile ? (
                  <div className="rounded-xl bg-primary/10 p-4 text-sm text-primary">
                    <Check data-icon="inline-start" />
                    {mediaFile.name} · {mediaFile.type.startsWith('video') ? '视频' : '音频'}
                    {mediaDurationMs != null && ` · ${formatDuration(mediaDurationMs)}`}
                    {' · '}{formatBytes(mediaFile.size)}
                  </div>
                ) : null
              }
              onChange={(f) => void handleMediaFile(f)}
            />

            <StepConnector done={!!mediaFile} />

            {/* ── 步骤 2：选择字幕文件（可选） ── */}
            <StepHeader step={2} status={step2Status} label="选择字幕文件（可选）" />
            <FileDropzone
              icon={FileText}
              accept=".srt,.lrc"
              hint="支持 SRT 和 LRC 字幕格式"
              selected={
                subtitle ? (
                  <div className="rounded-xl bg-primary/10 p-4 text-sm text-primary">
                    <Check data-icon="inline-start" />
                    {subtitle.data.format.toUpperCase()} 字幕 · {subtitle.data.isBilingual ? '双语' : '仅英文'} · {subtitle.data.sentences.length} 句 · 总时长 {formatDuration(subtitle.data.totalDurationMs)} · 解析成功
                  </div>
                ) : parseError ? (
                  <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
                    {parseError.message}{parseError.line > 0 && `，第 ${parseError.line} 行`}，请重新选择字幕文件
                  </div>
                ) : null
              }
              onChange={(f) => f.text().then((t) => applySubtitle(t)).catch(() => setParseError({ message: '无法读取文件内容', line: 0 }))}
            />

            {/* 时长偏差预警 */}
            {deviationMs != null && deviationMs > 5000 && (
              <div className="rounded-xl border p-4 text-sm text-muted-foreground">
                <AlertTriangle data-icon="inline-start" />字幕与媒体时长偏差超过 5 秒，可能不匹配（不影响导入）
              </div>
            )}

            <StepConnector done={!!mediaFile} />

            {/* ── 步骤 3：材料名称 ── */}
            <StepHeader step={3} status={step3Status} label="材料名称" />
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="默认取文件名" />

            {/* 提交区域 */}
            {finishError && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{finishError}</p>}
            <Button className="w-full" onClick={finish} disabled={!canFinish}>
              {saving ? '导入中…' : '完成导入'}
            </Button>
            {done && <p className="text-center text-sm text-primary">导入成功，正在打开播放器…</p>}

          </CardContent>
        </Card>
      </div>
    </Shell>
  )
}

export { ImportPage }
