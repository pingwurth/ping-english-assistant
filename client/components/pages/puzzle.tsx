import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SessionSummaryOverlay, SummaryStat, TrainingSessionShell, useTrainingMaterial } from '@/components/shared/training-session-shell'
import { buildTiles, checkAnswer, nextHint, puzzleScore, splitTargets, type PuzzleTile } from '@/core/training/puzzle'
import { formatElapsed, summarize } from '@/core/training/scoring'
import { attempt, createSession, currentSentence, hint, makeRecordId, next, submit, type SessionState } from '@/core/training/session'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'
import type { PuzzleDetail, TrainingRecord } from '@/types/training'

/** 每句提示上限（每次扣 2 分，由 puzzleScore 结算） */
const MAX_HINTS = 3
/** 每句最多提交次数（首次错误允许原位修正后再交一次） */
const MAX_ATTEMPTS = 2

function Puzzle() {
  const { record, loading } = useTrainingMaterial()
  const [session, setSession] = useState<SessionState | null>(null)
  const [selected, setSelected] = useState<PuzzleTile[]>([])
  const [verdict, setVerdict] = useState<{ correct: boolean; firstErrorIndex: number } | null>(null)
  /** 本句已定案（全对 或 提交次数用尽），等待 [下一句] */
  const [resolved, setResolved] = useState(false)
  const writtenRef = useRef(false)

  // 材料就绪 → 开启全文范围会话
  useEffect(() => {
    if (!record) return
    setSession(createSession('puzzle', record.subtitleData?.sentences ?? []))
    writtenRef.current = false
  }, [record])

  const sentence = session ? currentSentence(session) : undefined
  const queue = session?.queue
  const cursor = session?.cursor

  // 词块：按当前句生成（乱序）；游标/队列不变时不重洗
  const tiles = useMemo(() => (sentence && queue ? buildTiles(sentence) : []), [sentence, queue])

  // 游标变化 → 重置本句本地状态
  useEffect(() => { setSelected([]); setVerdict(null); setResolved(false) }, [cursor, queue])

  const totalHints = session ? session.results.reduce((s, r) => s + (r.hints ?? 0), 0) : 0

  // 会话完成 → 写一条 train: 记录（仅一次）
  useEffect(() => {
    if (!session || session.status !== 'done' || writtenRef.current || !record) return
    if (session.queue.length === 0) return
    writtenRef.current = true
    const correctCount = session.results.filter((r) => r.correct).length
    const score = Math.round((puzzleScore(correctCount, totalHints) / (session.queue.length * 10)) * 100)
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

  const selectedIds = new Set(selected.map((t) => t.id))
  const summary = session.status === 'done' ? summarize(session.results, Date.now() - session.startedAt) : null

  const pick = (tile: PuzzleTile) => {
    if (resolved || selectedIds.has(tile.id)) return
    if (verdict && !verdict.correct) setVerdict(null) // 修正模式：清除上次错误标记
    setSelected([...selected, tile])
  }
  const unpick = (i: number) => {
    if (resolved) return
    if (verdict && !verdict.correct) setVerdict(null)
    setSelected(selected.filter((_, j) => j !== i))
  }
  const useHint = () => {
    if (!session || !sentence || resolved || session.hintCount >= MAX_HINTS) return
    const word = nextHint(selected.length, sentence)
    if (!word) return
    const tile = tiles.find((t) => t.text === word && !selectedIds.has(t.id))
    if (!tile) return
    if (verdict && !verdict.correct) setVerdict(null)
    setSelected([...selected, tile])
    setSession(hint(session))
  }
  const onSubmit = () => {
    if (!session || !sentence || !selected.length || resolved) return
    const withAttempt = attempt(session)
    const result = checkAnswer(selected, sentence)
    if (result.correct) {
      setSession(submit(withAttempt, { correct: true, accuracy: 100 }))
      setVerdict(result)
      setResolved(true)
      return
    }
    if (withAttempt.attemptCount >= MAX_ATTEMPTS) {
      // 提交次数用尽：按正确位比例记分，定案并展示正确答案
      const targets = splitTargets(sentence)
      let matched = 0
      for (let i = 0; i < Math.min(selected.length, targets.length); i++) if (selected[i]!.text === targets[i]) matched += 1
      const accuracy = targets.length ? Math.round((matched / targets.length) * 100) : 0
      setSession(submit(withAttempt, { correct: false, accuracy }))
      setVerdict(result)
      setResolved(true)
    } else {
      setVerdict(result) // 标红首个错误位，允许原位修正后再提交
    }
  }
  const onNext = () => { if (session) setSession(next(session)) }
  const restart = () => { if (record) { setSession(createSession('puzzle', record.subtitleData?.sentences ?? [])); writtenRef.current = false } }

  const showFinalAnswer = resolved && verdict && !verdict.correct

  return <TrainingSessionShell eyebrow="九宫格训练" title="拼出正确句子" current={session.cursor} total={session.queue.length}>
    <Card><CardHeader><CardTitle>先想，再按语序点选</CardTitle><CardDescription>点击已选词可以撤回。提示会揭示下一个正确词（每次扣 2 分，每句最多 {MAX_HINTS} 次）。</CardDescription></CardHeader><CardContent className="flex flex-col gap-8"><div className="min-h-24 rounded-xl border-2 border-dashed p-4 text-lg leading-loose">{selected.map((w, i) => <button key={`${w.id}-${i}`} onClick={() => unpick(i)} disabled={resolved} className={`mr-2 rounded-md px-2 py-1 ${verdict && !verdict.correct && i === verdict.firstErrorIndex ? 'bg-destructive/10 text-destructive ring-1 ring-destructive/40' : 'bg-primary/10 text-primary'}`}>{w.text}</button>)}{!selected.length && <span className="text-muted-foreground">你的答案会出现在这里…</span>}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{tiles.map((w) => <Button key={w.id} variant={selectedIds.has(w.id) ? 'secondary' : 'outline'} disabled={selectedIds.has(w.id) || resolved} onClick={() => pick(w)}>{w.text}</Button>)}</div><div className="flex flex-wrap justify-between gap-2"><Button variant="ghost" onClick={() => setSelected([])} disabled={resolved || !selected.length}><X data-icon="inline-start" />清空</Button><Button variant="outline" onClick={useHint} disabled={resolved || session.hintCount >= MAX_HINTS}><CircleHelp data-icon="inline-start" />提示{session.hintCount ? `（已用 ${session.hintCount}/${MAX_HINTS}）` : ''}</Button><Button onClick={onSubmit} disabled={resolved || !selected.length}>提交</Button></div>{verdict && <div className={`rounded-xl p-4 ${verdict.correct ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{verdict.correct ? '完全正确！+10 分' : showFinalAnswer ? `正确答案：${sentence?.textEn ?? ''}` : `首个错误在第 ${verdict.firstErrorIndex + 1} 个词，修正后再提交（剩余 ${MAX_ATTEMPTS - session.attemptCount} 次机会）`}{resolved && <div className="mt-3"><Button variant="outline" onClick={onNext}>{session.cursor === session.queue.length - 1 ? '查看小结' : '下一句 →'}</Button></div>}</div>}</CardContent></Card>

    {summary && <SessionSummaryOverlay open title="本轮完成" description={record.material.name} footer={<><Link to="/"><Button variant="outline">返回材料库</Button></Link><Button onClick={restart}>再来一轮</Button></>}>
      <SummaryStat label="正确率" value={`${summary.correctCount} / ${summary.total}（${summary.accuracy}%）`} />
      <SummaryStat label="用时" value={formatElapsed(summary.durationMs)} />
      <SummaryStat label="得分" value={`${puzzleScore(summary.correctCount, totalHints)} 分（提示 -${totalHints * 2}）`} />
      {summary.weakest.length > 0 && <div className="rounded-xl border p-4"><p className="mb-2 text-sm text-muted-foreground">最弱句 TOP{summary.weakest.length}</p><ul className="flex flex-col gap-1 text-sm">{summary.weakest.map((idx) => <li key={idx} className="truncate">· {session.queue.find((s) => s.index === idx)?.textEn ?? `第 ${idx + 1} 句`}</li>)}</ul></div>}
    </SessionSummaryOverlay>}
  </TrainingSessionShell>
}

export { Puzzle }
