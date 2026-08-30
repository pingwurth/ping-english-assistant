import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SessionSummaryOverlay, SummaryStat, TrainingSessionShell, useTrainingMaterial } from '@/components/shared/training-session-shell'
import { SentencePlayer } from '@/core/player/sentence-player'
import {
  collectDistractorWords,
  getGridHint,
  gridScore,
  initGridState,
  selectGridWord,
  splitWords,
  type PuzzleGridState,
} from '@/core/training/puzzle'
import { formatElapsed, summarize } from '@/core/training/scoring'
import { attempt, createSession, currentSentence, hint, makeRecordId, next, submit, type SessionState } from '@/core/training/session'
import { HtmlPlayerController } from '@/platform/html-player'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'
import { getMediaBlob } from '@/stores/material-store'
import type { PuzzleDetail, TrainingRecord } from '@/types/training'

/** 每句提示上限（每次扣 2 分，由 gridScore 结算） */
const MAX_HINTS = 3
/** 每句最多提交次数 */
const MAX_ATTEMPTS = 2

function Puzzle() {
  const { record, loading } = useTrainingMaterial()
  const [session, setSession] = useState<SessionState | null>(null)
  const [gridState, setGridState] = useState<PuzzleGridState | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [verdict, setVerdict] = useState<{ correct: boolean; firstErrorIndex: number } | null>(null)
  const [resolved, setResolved] = useState(false)
  const [shakeIndex, setShakeIndex] = useState<number | null>(null)
  const [hintIndex, setHintIndex] = useState<number | null>(null)
  const [plays, setPlays] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const writtenRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)

  // 材料就绪 → 开启全文范围会话
  useEffect(() => {
    if (!record) return
    setSession(createSession('puzzle', record.subtitleData?.sentences ?? []))
    writtenRef.current = false
  }, [record])

  // 媒体 Blob → ObjectURL
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

  // 播放引擎：SentencePlayer
  useEffect(() => {
    if (!record || !mediaUrl) return
    const sentences = record.subtitleData?.sentences ?? []
    const mediaType = record.material.mediaType
    const controller = mediaType === 'audio' && audioRef.current
      ? new HtmlPlayerController('audio', audioRef.current)
      : new HtmlPlayerController(mediaType)
    const sp = new SentencePlayer(controller, sentences)
    playerRef.current = sp
    controller.load({ type: mediaType, src: mediaUrl }).catch(() => { /* 加载失败 → 播放置灰 */ })
    return () => { sp.destroy(); controller.destroy(); playerRef.current = null }
  }, [record, mediaUrl])

  const sentence = session ? currentSentence(session) : undefined
  const queue = session?.queue
  const cursor = session?.cursor

  // 当前句变化 → 初始化九宫格状态
  useEffect(() => {
    if (!sentence || !queue || !record) {
      setGridState(null)
      return
    }
    // 收集干扰词（其他句子的词）
    const allSentences = record.subtitleData?.sentences ?? []
    const distractorPool = collectDistractorWords(allSentences, sentence.index, new Set())
    setGridState(initGridState(sentence, distractorPool))
    setSelected([])
    setVerdict(null)
    setResolved(false)
    setShakeIndex(null)
    setPlays(0)
  }, [sentence, queue, record])

  const totalHints = session ? session.results.reduce((s, r) => s + (r.hints ?? 0), 0) : 0

  // 会话完成 → 写一条 train: 记录（仅一次）
  useEffect(() => {
    if (!session || session.status !== 'done' || writtenRef.current || !record) return
    if (session.queue.length === 0) return
    writtenRef.current = true
    const correctCount = session.results.filter((r) => r.correct).length
    const score = Math.round((gridScore(correctCount, totalHints) / (session.queue.length * 10)) * 100)
    const detail: PuzzleDetail = {
      completedSentenceCount: correctCount,
      hintUsedCount: totalHints,
      firstTryCorrect: session.results.length > 0 && session.results.every((r) => r.correct && (r.attempts ?? 1) <= 1),
    }
    const entry: TrainingRecord = {
      id: makeRecordId(),
      materialId: record.material.id,
      mode: 'puzzle',
      scope: { type: 'all' },
      score,
      detail,
      createdAt: Date.now(),
    }
    void recordsStore.put(RECORD_KEYS.training(entry.id), entry).catch(() => { /* 存储失败不影响训练流程 */ })
  }, [session, record, totalHints])

  if (loading) return <TrainingSessionShell eyebrow="九宫格训练" title="拼出正确句子" current={0} total={0}><div className="flex min-h-40 items-center justify-center text-muted-foreground">正在加载材料…</div></TrainingSessionShell>
  if (!record || !session || session.queue.length === 0) {
    return <TrainingSessionShell eyebrow="九宫格训练" title="拼出正确句子" current={0} total={0}><Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">该材料暂无字幕，无法进行拼句训练。</p><Link to="/"><Button variant="outline">返回材料库</Button></Link></CardContent></Card></TrainingSessionShell>
  }

  const summary = session.status === 'done' ? summarize(session.results, Date.now() - session.startedAt) : null

  const onGridPick = (index: number) => {
    if (!gridState || !session || !sentence || resolved) return
    if (gridState.done) return

    const result = selectGridWord(gridState, index)
    if (result.correct) {
      // 选对：推进 grid 状态，将词加入已选列表
      setGridState(result.state)
      const pickedWord = gridState.grid[index]!.text
      setSelected([...selected, pickedWord])
      setVerdict(null)
      setShakeIndex(null)

      // 检查句子是否完成（所有目标词已选完）
      if (result.state.done) {
        // 自动提交：全对
        const withAttempt = attempt(session)
        setSession(submit(withAttempt, { correct: true, accuracy: 100 }))
        setResolved(true)
      }
    } else {
      // 选错：抖动反馈
      setShakeIndex(index)
      setTimeout(() => setShakeIndex(null), 500)
      if (session) {
        const withAttempt = attempt(session)
        if (withAttempt.attemptCount >= MAX_ATTEMPTS) {
          // 提交次数用尽
          const targets = splitWords(sentence)
          const matched = selected.length
          const accuracy = targets.length ? Math.round((matched / targets.length) * 100) : 0
          setSession(submit(withAttempt, { correct: false, accuracy }))
          setResolved(true)
        } else {
          setSession(withAttempt)
        }
      }
    }
  }

  const useHintAction = () => {
    if (!session || !gridState || !sentence || resolved || session.hintCount >= MAX_HINTS) return
    const hintIdx = getGridHint(gridState)
    if (hintIdx < 0) return
    // 高亮答案格
    setHintIndex(hintIdx)
    setTimeout(() => setHintIndex(null), 1000)
    setSession(hint(session))
  }

  const playable = !!mediaUrl && !!sentence
  const playSegment = () => {
    const sp = playerRef.current
    if (!sp || !sentence) return
    sp.playRange(sentence.startMs, sentence.endMs)
    setPlays((p) => p + 1)
  }

  const onNext = () => { if (session) setSession(next(session)) }
  const restart = () => {
    if (record) {
      setSession(createSession('puzzle', record.subtitleData?.sentences ?? []))
      writtenRef.current = false
    }
  }

  const targets = sentence ? splitWords(sentence) : []
  const pickedCount = gridState ? gridState.cursor : 0

  return <TrainingSessionShell eyebrow="九宫格训练" title="拼出正确句子" current={session.cursor} total={session.queue.length}>
    <Card>
      <CardHeader>
        <CardTitle>按语序点击正确的词</CardTitle>
        <CardDescription>选对后该词消失并补入新词，每次选错消耗一次机会。提示会闪烁高亮正确答案（每次扣 2 分，每句最多 {MAX_HINTS} 次）。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* 播放句子 */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className="self-start" onClick={playSegment} disabled={!playable || resolved}>
            <Play data-icon="inline-start" />播放句子
            {plays > 0 && <span className="text-muted-foreground">已播放 {plays} 次</span>}
          </Button>
          {!mediaUrl && <p className="text-xs text-muted-foreground">演示材料无音频——导入真实材料后即可播放句段</p>}
        </div>

        {/* 拼句区：展示已选词 */}
        <div className="min-h-16 rounded-xl border-2 border-dashed p-3 text-lg leading-relaxed">
          {selected.map((word, i) => (
            <span key={`${word}-${i}`} className="mr-2 inline-block rounded-md bg-primary/10 px-2 py-1 text-primary">{word}</span>
          ))}
          {!selected.length && <span className="text-muted-foreground">点击下方正确的词…</span>}
        </div>

        {/* 九宫格 3×3 */}
        {gridState && !gridState.done && (
          <div className="grid grid-cols-3 gap-3">
            {gridState.grid.map((cell, i) => {
              const isAnswer = resolved && gridState.answerIndex === i
              const isShaking = shakeIndex === i
              const isHinting = hintIndex === i
              return (
                <button
                  key={cell.id}
                  onClick={() => onGridPick(i)}
                  disabled={resolved}
                  className={[
                    'flex h-14 items-center justify-center rounded-xl border text-base font-medium transition-all',
                    'hover:border-primary/60 hover:bg-primary/5 active:scale-95',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    isAnswer ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30' : 'border-border bg-card',
                    isShaking ? 'animate-shake' : '',
                    isHinting ? 'animate-hint-glow' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {cell.text}
                </button>
              )
            })}
          </div>
        )}

        {/* 进度与操作 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            已选 {pickedCount}/{targets.length} 词
            {session.hintCount > 0 && ` · 提示 ${session.hintCount}/${MAX_HINTS}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={useHintAction} disabled={resolved || !gridState || gridState.done || session.hintCount >= MAX_HINTS}>
              <CircleHelp data-icon="inline-start" />提示
            </Button>
          </div>
        </div>

        {/* 判定反馈 */}
        {verdict && (
          <div className={`rounded-xl p-4 ${verdict.correct ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
            {verdict.correct ? '完全正确！+10 分' : `首个错误在第 ${verdict.firstErrorIndex + 1} 个词`}
          </div>
        )}

        {resolved && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={playSegment} disabled={!playable}>重听</Button>
            <Button variant="outline" onClick={onNext}>
              {session.cursor === session.queue.length - 1 ? '查看小结' : '下一句 →'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>

    {mediaUrl && record.material.mediaType === 'audio' && <audio ref={audioRef} src={mediaUrl} preload="metadata" className="hidden" />}

    {summary && <SessionSummaryOverlay open title="本轮完成" description={record.material.name} footer={<><Link to="/"><Button variant="outline">返回材料库</Button></Link><Button onClick={restart}>再来一轮</Button></>}>
      <SummaryStat label="正确率" value={`${summary.correctCount} / ${summary.total}（${summary.accuracy}%）`} />
      <SummaryStat label="用时" value={formatElapsed(summary.durationMs)} />
      <SummaryStat label="得分" value={`${gridScore(summary.correctCount, totalHints)} 分（提示 -${totalHints * 2}）`} />
      {summary.weakest.length > 0 && <div className="rounded-xl border p-4"><p className="mb-2 text-sm text-muted-foreground">最弱句 TOP{summary.weakest.length}</p><ul className="flex flex-col gap-1 text-sm">{summary.weakest.map((idx) => <li key={idx} className="truncate">· {session.queue.find((s) => s.index === idx)?.textEn ?? `第 ${idx + 1} 句`}</li>)}</ul></div>}
    </SessionSummaryOverlay>}
  </TrainingSessionShell>
}

export { Puzzle }
