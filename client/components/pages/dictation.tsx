import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { SessionSummaryOverlay, SummaryStat, TrainingSessionShell, useTrainingMaterial } from '@/components/shared/training-session-shell'
import { diffWords, sentenceAccuracy, toWords, type DiffToken } from '@/core/training/dictation-diff'
import { createSession, currentSentence, makeRecordId, next, retryAt, submit, type SessionState } from '@/core/training/session'
import { SentencePlayer } from '@/core/player/sentence-player'
import { HtmlPlayerController } from '@/platform/html-player'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'
import { getMediaBlob } from '@/stores/material-store'
import type { DictationDetail, TrainingRecord } from '@/types/training'

/** 逐词 diff 着色渲染：正确不变色 / 错词红删（附实际输入）/ 漏词绿插 / 多词灰 */
function DiffView({ tokens }: { tokens: DiffToken[] }) {
  return <p className="leading-loose">{tokens.map((t, i) => {
    if (t.type === 'wrong') return <span key={i}><span className="text-destructive line-through">{t.text}</span><span className="ml-0.5 text-xs text-destructive/80">({t.input})</span>{' '}</span>
    if (t.type === 'missing') return <span key={i} className="font-medium text-green-600 dark:text-green-400">+{t.text}+{' '}</span>
    if (t.type === 'extra') return <span key={i} className="text-muted-foreground">{t.text}{' '}</span>
    return <span key={i}>{t.text}{' '}</span>
  })}</p>
}

function Dictation() {
  const { record, loading } = useTrainingMaterial()
  const [session, setSession] = useState<SessionState | null>(null)
  const [value, setValue] = useState('')
  const [tokens, setTokens] = useState<DiffToken[] | null>(null)
  const [plays, setPlays] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)
  /** 每句只写一条 train: 记录（首次核对时） */
  const writtenRef = useRef<Set<number>>(new Set())

  // 材料就绪 → 开启会话
  useEffect(() => {
    if (!record) return
    setSession(createSession('dictation', record.subtitleData?.sentences ?? []))
    writtenRef.current = new Set()
  }, [record])

  // 媒体 Blob → ObjectURL（SSR 安全：仅 effect 内）
  useEffect(() => {
    if (!record) return
    let cancelled = false
    let objectUrl: string | null = null
    ;(async () => {
      const blob = await getMediaBlob(record.material.id)
      if (cancelled) return
      if (blob) { objectUrl = URL.createObjectURL(blob); setMediaUrl(objectUrl) }
    })().catch(() => { /* 无媒体：播放按钮置灰 */ })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [record])

  // 播放引擎：真实播放当前句段 [startMs, endMs]（播几遍计几遍）
  useEffect(() => {
    if (!record || !mediaUrl) return
    const sentences = record.subtitleData?.sentences ?? []
    const mediaType = record.material.mediaType
    const controller = mediaType === 'audio' && audioRef.current
      ? new HtmlPlayerController('audio', audioRef.current)
      : new HtmlPlayerController(mediaType)
    const sp = new SentencePlayer(controller, sentences)
    playerRef.current = sp
    let cancelled = false
    controller.load({ type: mediaType, src: mediaUrl }).catch(() => { /* 加载失败 → 播放置灰 */ })
    return () => { cancelled = true; sp.destroy(); controller.destroy(); playerRef.current = null }
  }, [record, mediaUrl])

  const sentence = session ? currentSentence(session) : undefined
  const cursor = session?.cursor
  const queue = session?.queue

  // 游标变化 → 重置本句输入与计数
  useEffect(() => { setValue(''); setTokens(null); setPlays(0) }, [cursor, queue])

  const playable = !!mediaUrl && !!sentence
  const playSegment = () => {
    const sp = playerRef.current
    if (!sp || !sentence) return
    sp.playRange(sentence.startMs, sentence.endMs)
    setPlays((p) => p + 1)
  }

  const onCheck = () => {
    if (!session || !sentence || tokens) return
    const target = sentence.textEn
    const diff = diffWords(value, target)
    const accuracy = sentenceAccuracy(diff, toWords(target).length)
    const entry = { correct: accuracy === 100, accuracy, plays }
    setSession(submit(session, entry))
    setTokens(diff)
    // 首次核对该句 → 写 train: 记录（DictationDetail 按句存）
    if (!writtenRef.current.has(sentence.index) && record) {
      writtenRef.current.add(sentence.index)
      const detail: DictationDetail = { accuracy, sentenceIndex: sentence.index }
      const rec: TrainingRecord = {
        id: makeRecordId(),
        materialId: record.material.id,
        mode: 'dictation',
        scope: { type: 'all' },
        score: accuracy,
        detail,
        createdAt: Date.now(),
      }
      void recordsStore.put(RECORD_KEYS.training(rec.id), rec).catch(() => { /* 存储失败不影响训练 */ })
    }
  }
  const onNext = () => { if (session) setSession(next(session)) }
  const onRetryWeak = (idx: number) => { if (session) { setSession(retryAt(session, idx)); writtenRef.current.delete(idx) } }
  const restart = () => { if (record) { setSession(createSession('dictation', record.subtitleData?.sentences ?? [])); writtenRef.current = new Set() } }

  if (loading) return <TrainingSessionShell eyebrow="单句听写" title="听音写下完整句子" current={0} total={0}><div className="flex min-h-40 items-center justify-center text-muted-foreground">正在加载材料…</div></TrainingSessionShell>
  if (!record || !session || session.queue.length === 0) {
    return <TrainingSessionShell eyebrow="单句听写" title="听音写下完整句子" current={0} total={0}><Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">该材料暂无字幕，无法进行听写训练。</p><Link to="/"><Button variant="outline">返回材料库</Button></Link></CardContent></Card></TrainingSessionShell>
  }

  const summary = session.status === 'done' ? summarizeFor(session) : null
  function summarizeFor(st: SessionState) {
    const total = st.results.length
    const accuracy = total ? Math.round(st.results.reduce((s, r) => s + r.accuracy, 0) / total) : 0
    const totalPlays = st.results.reduce((s, r) => s + (r.plays ?? 0), 0)
    const weakest = st.results.filter((r) => !r.correct).sort((a, b) => a.accuracy - b.accuracy).slice(0, 3).map((r) => r.sentenceIndex)
    return { total, accuracy, totalPlays, weakest }
  }
  const checkedAccuracy = tokens && sentence ? sentenceAccuracy(tokens, toWords(sentence.textEn).length) : null

  return <TrainingSessionShell eyebrow="单句听写" title="听音写下完整句子" current={session.cursor} total={session.queue.length}>
    <Card><CardContent className="flex flex-col gap-6 p-6 md:p-8"><div className="flex flex-wrap items-center gap-3"><Button variant="outline" className="self-start" onClick={playSegment} disabled={!playable || !!tokens}><Play data-icon="inline-start" />播放句子 <span className="text-muted-foreground">已播放 {plays} 次</span></Button>{!mediaUrl && <p className="text-xs text-muted-foreground">演示材料无音频——导入真实材料后即可播放句段</p>}</div><Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="在这里输入你听到的句子…" className="min-h-40 text-lg" disabled={!!tokens} /><div className="flex justify-between gap-3"><Button variant="ghost" onClick={() => { setValue(''); setTokens(null) }} disabled={!!tokens}><X data-icon="inline-start" />清空</Button><Button onClick={onCheck} disabled={!!tokens}><Check data-icon="inline-start" />核对答案</Button></div>{tokens && sentence && <div className="rounded-xl bg-muted p-5"><p className="mb-2 text-sm text-muted-foreground">你的答案 vs 原文（正确不变色 · <span className="text-destructive line-through">错词红删</span> · <span className="text-green-600 dark:text-green-400">+漏词绿插+</span> · <span className="text-muted-foreground">多词灰</span>）</p><DiffView tokens={tokens} /><Separator className="my-4" /><p className="leading-relaxed text-primary">{sentence.textEn}</p><p className="mt-4 font-semibold">本句正确率 {checkedAccuracy}%</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={playSegment} disabled={!playable}>重听</Button><Button variant="outline" size="sm" onClick={onNext}>{session.cursor === session.queue.length - 1 ? '查看小结' : '下一句 →'}</Button></div></div>}</CardContent></Card>
    {mediaUrl && record.material.mediaType === 'audio' && <audio ref={audioRef} src={mediaUrl} preload="metadata" className="hidden" />}

    {summary && <SessionSummaryOverlay open title="本轮完成" description={record.material.name} footer={<><Link to="/"><Button variant="outline">返回材料库</Button></Link><Button onClick={restart}>再来一轮</Button></>}>
      <SummaryStat label="平均正确率" value={`${summary.accuracy}%（${summary.total} 句）`} />
      <SummaryStat label="总播放次数" value={`${summary.totalPlays} 次`} />
      {summary.weakest.length > 0 && <div className="rounded-xl border p-4"><p className="mb-2 text-sm text-muted-foreground">最弱句 TOP{summary.weakest.length}（点击重练）</p><ul className="flex flex-col gap-1">{summary.weakest.map((idx) => { const s = session.queue.find((q) => q.index === idx); return <li key={idx}><button onClick={() => onRetryWeak(idx)} className="w-full truncate rounded-lg px-2 py-1 text-left text-sm transition-colors hover:bg-muted">{s?.textEn ?? `第 ${idx + 1} 句`}</button></li> })}</ul></div>}
    </SessionSummaryOverlay>}
  </TrainingSessionShell>
}

export { Dictation }
