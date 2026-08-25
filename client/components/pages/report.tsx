/**
 * P9 分析报告 —— 真源：docs/原型设计.md §4.10 / docs/系统架构设计.md §3.3 契约③④ · §5.6
 *
 * 挂载即 takeReportPayload()（取后即清空，lib/report-session.ts）：
 *  - 有载荷：按 mode 调契约③（shadowing）/④（recitation）报告服务，SSE 流式渲染
 *    status 阶段提示 → token 纯文本分段追加（零新增依赖，不引 Markdown 库）
 *    → result 结构化评分卡（total/completeness/accuracy/fluency）→ done；
 *  - error 事件 / 异常：降级本地逐句 diff（core/training/dictation-diff，架构 §5.6）；
 *  - 无载荷（直达/刷新）：友好空态引导去训练，不崩溃；
 *  - 录音回听：recordingBlob → ObjectURL → audio 控件（effect 内创建，卸载 revoke）。
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Shell, PageIntro } from '@/components/shared/shell'
import { takeReportPayload, type ReportSessionPayload } from '@/lib/report-session'
import { getServices } from '@/services'
import { diffWords, sentenceAccuracy, toWords, type DiffToken } from '@/core/training/dictation-diff'
import { makeRecordId } from '@/core/training/session'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS } from '@/platform/storage/schema'
import { getPref } from '@/platform/storage/prefs'
import type { ReportDetail, TrainingRecord } from '@/types/training'

type Phase = 'running' | 'done' | 'degraded'

/** SSE status 阶段 → 中文提示（契约③④ stage 口径） */
const STAGE_LABELS: Record<string, string> = {
  comparing: '正在对齐原文与转写文本…',
  analyzing: '正在分析发音与节奏…',
  summarizing: '正在生成总结…',
}

/** 剥离 Markdown 粗体标记（纯文本渲染，不引 Markdown 库） */
function stripBold(s: string): string {
  return s.replace(/\*\*/g, '')
}

/** 流式 Markdown 文本 → 按行纯文本分段渲染（# 标题 / ## 小节 / - 列表 / 数字列表） */
function ReportText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {lines.map((raw, i) => {
        const line = raw.trimEnd()
        if (!line.trim()) return <div key={i} className="h-1" />
        if (line.startsWith('# ')) return <p key={i} className="font-serif text-xl font-semibold">{stripBold(line.slice(2))}</p>
        if (line.startsWith('## ')) return <p key={i} className="mt-2 font-serif text-base font-semibold text-primary">{stripBold(line.slice(3))}</p>
        if (line.startsWith('- ')) return <p key={i} className="pl-4"><span className="text-primary">·</span> {renderInline(line.slice(2))}</p>
        if (/^\d+\.\s/.test(line)) return <p key={i} className="pl-4">{renderInline(line)}</p>
        return <p key={i}>{renderInline(line)}</p>
      })}
    </div>
  )
}

/** 行内文本（粗体标记已剥离，原样输出） */
function renderInline(s: string): React.ReactNode {
  return stripBold(s)
}

/** 转写文本按句切分（用于降级 diff 的逐句配对；无标点时整体作单句） */
function splitTranscriptSegments(transcript: string): string[] {
  const parts = transcript.split(/([^.!?]+)/).filter((p) => p.trim().length > 0)
  const segs: string[] = []
  for (let i = 0; i < parts.length; i += 2) segs.push(((parts[i] ?? '') + (parts[i + 1] ?? '')).trim())
  return segs.filter((s) => s.length > 0)
}

/** 降级 diff 的逐词着色（correct 正常 / wrong 红删 / missing 红底 / extra 灰删） */
function DiffTokens({ tokens }: { tokens: DiffToken[] }) {
  return (
    <p className="leading-relaxed">
      {tokens.map((t, i) => {
        if (t.type === 'correct') return <span key={i}>{t.text} </span>
        if (t.type === 'wrong') return <span key={i} className="text-destructive"><span className="line-through">{t.text}</span>{t.input ? <span className="font-medium">（{t.input}）</span> : null} </span>
        if (t.type === 'missing') return <span key={i} className="rounded bg-destructive/10 px-0.5 font-medium text-destructive">{t.text} </span>
        return <span key={i} className="text-muted-foreground line-through">{t.text} </span>
      })}
    </p>
  )
}

function Report() {
  /** 载荷只取一次：ref 守卫兼容 StrictMode 双挂载（第二次 effect 复用已取载荷） */
  const payloadRef = useRef<ReportSessionPayload | null>(null)
  const takenRef = useRef(false)
  /** 每次报告会话只写一条 train: 记录（result 事件时），口径同 read-aloud */
  const recordWrittenRef = useRef(false)
  const [phase, setPhase] = useState<Phase | 'empty'>('empty')
  const [stageText, setStageText] = useState('准备分析…')
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ total: number; completeness: number; accuracy: number; fluency: number } | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)

  // 挂载即消费载荷（取一次，ref 守卫兼容 StrictMode 双挂载），随后：
  // 录音回听 ObjectURL 创建/卸载 revoke + 按 mode 发起流式分析（自动开始，无需手动操作）
  useEffect(() => {
    if (!takenRef.current) {
      takenRef.current = true
      payloadRef.current = takeReportPayload()
    }
    const payload = payloadRef.current
    if (!payload) { setPhase('empty'); return }

    let objectUrl: string | null = null
    if (payload.recordingBlob) {
      objectUrl = URL.createObjectURL(payload.recordingBlob)
      setRecordingUrl(objectUrl)
    }

    const abort = new AbortController()
    setPhase('running')
    setText('')
    setResult(null)

    const degrade = (message: string) => {
      if (abort.signal.aborted) return
      setErrMsg(message)
      setPhase('degraded')
    }

    ;(async () => {
      try {
        const { shadowingReport, recitationReport } = getServices()
        const request = { transcript: payload.transcript, sentences: payload.sentences, materialTitle: payload.materialTitle }
        // while + next() 消费（避免 for-await 的低 target 编译依赖）
        const gen = payload.mode === 'shadowing'
          ? shadowingReport.shadowing(request, abort.signal)
          : recitationReport.recitation(request, abort.signal)
        for (;;) {
          const step = await gen.next()
          if (step.done) break
          const ev = step.value
          if (ev.event === 'status') {
            setStageText(STAGE_LABELS[ev.data.stage] ?? `正在处理（${ev.data.stage}）…`)
          } else if (ev.event === 'token') {
            setText((prev) => prev + ev.data.text)
          } else if (ev.event === 'result') {
            setResult(ev.data)
            // 成绩持久化：写一条 train: 记录（批次 C key 约定 + ReportDetail 类型），
            // 训练中心"上次成绩"与设置统计据此可见（mode/materialId 与载荷一致）
            if (!recordWrittenRef.current) {
              recordWrittenRef.current = true
              const detail: ReportDetail = { total: ev.data.total, completeness: ev.data.completeness, accuracy: ev.data.accuracy, fluency: ev.data.fluency }
              const tr: TrainingRecord = {
                id: makeRecordId(),
                materialId: payload.materialId,
                mode: payload.mode,
                scope: { type: 'all' },
                score: ev.data.total,
                detail,
                createdAt: Date.now(),
              }
              void recordsStore.put(RECORD_KEYS.training(tr.id), tr).catch(() => { /* 存储失败不影响报告展示 */ })
            }
          } else if (ev.event === 'error') {
            degrade(ev.data.message || '报告生成失败')
            return
          } else if (ev.event === 'done') {
            setPhase('done')
            return
          }
        }
        // 流提前结束且未 done：按降级处理
        degrade('报告流意外中断')
      } catch {
        degrade('报告生成失败，已降级为逐句对比')
      }
    })()

    return () => {
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [])

  const payload = payloadRef.current

  // 无载荷（直达 / 刷新）：友好空态，引导去训练
  if (phase === 'empty') {
    const trainingId = getPref<string>('training-material', 'mock-001')
    return (
      <Shell back>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <PageIntro title="分析报告" eyebrow="YOUR PROGRESS" />
          <Card>
            <CardContent className="flex min-h-48 flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="text-muted-foreground">还没有可分析的训练会话。完成一次影子跟读或全文背诵后，报告会自动在这里生成。</p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link to={`/training/${trainingId}`}><Button>去训练</Button></Link>
                <Link to="/"><Button variant="outline">返回材料库</Button></Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </Shell>
    )
  }

  const modeLabel = payload?.mode === 'recitation' ? '全文背诵' : '影子跟读'

  return (
    <Shell back>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <PageIntro title="分析报告" eyebrow="YOUR PROGRESS">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{modeLabel}</Badge>
            {payload && <Badge variant="outline">{payload.materialTitle}</Badge>}
          </div>
        </PageIntro>

        <div className="flex flex-col gap-4">
          {/* 结构化评分卡（result 事件） */}
          {result && (
            <Card>
              <CardContent className="grid gap-6 p-8 text-center sm:grid-cols-4">
                <div><p className="font-serif text-5xl font-semibold text-primary">{result.total}</p><p className="mt-2 text-muted-foreground">综合得分</p></div>
                <div><p className="font-serif text-5xl font-semibold">{result.completeness}%</p><p className="mt-2 text-muted-foreground">完整度</p></div>
                <div><p className="font-serif text-5xl font-semibold">{result.accuracy}%</p><p className="mt-2 text-muted-foreground">准确度</p></div>
                <div><p className="font-serif text-5xl font-semibold">{result.fluency}</p><p className="mt-2 text-muted-foreground">流利度</p></div>
              </CardContent>
            </Card>
          )}

          {/* AI 详细分析：流式追加渲染 */}
          <Card>
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">AI 详细分析</p>
                {phase === 'running' && <Badge variant="secondary"><Loader2 data-icon="inline-start" className="animate-spin" />分析中</Badge>}
                {phase === 'done' && <Badge variant="secondary">已完成</Badge>}
                {phase === 'degraded' && <Badge variant="destructive"><AlertTriangle data-icon="inline-start" />已降级</Badge>}
              </div>
              {phase === 'running' && <p className="text-sm text-muted-foreground">{stageText}</p>}
              {text ? <ReportText text={text} /> : phase === 'running' ? <p className="text-sm text-muted-foreground">等待分析结果输出…</p> : null}

              {/* 降级：本地逐句 diff（架构 §5.6；transcript 与原文逐句对比标色） */}
              {phase === 'degraded' && payload && (
                <div className="flex flex-col gap-3">
                  <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{errMsg || '报告生成失败'}。以下为转写文本与原文的逐句对比：</p>
                  {(() => {
                    const segs = splitTranscriptSegments(payload.transcript)
                    return payload.sentences.map((s, i) => {
                      const tokens = diffWords(segs[i] ?? '', s.textEn)
                      const acc = sentenceAccuracy(tokens, toWords(s.textEn).length)
                      return (
                        <div key={s.index} className="rounded-xl bg-muted p-4">
                          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>第 {i + 1} 句</span>
                            <span className="tabular-nums">匹配度 {acc}%</span>
                          </div>
                          <DiffTokens tokens={tokens} />
                        </div>
                      )
                    })
                  })()}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span><span className="text-destructive line-through">红删</span> = 读错/漏读</span>
                    <span><span className="rounded bg-destructive/10 px-1 text-destructive">红底</span> = 未读出</span>
                    <span><span className="text-muted-foreground line-through">灰删</span> = 多读出</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 录音回听 */}
          {recordingUrl && (
            <Card>
              <CardContent className="flex flex-col gap-3 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">▶ 回听我的录音</p>
                <audio controls src={recordingUrl} className="w-full" preload="metadata" />
              </CardContent>
            </Card>
          )}

          {/* 行动按钮 */}
          {payload && phase !== 'running' && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link to={payload.mode === 'recitation' ? '/training/recitation' : '/training/shadowing'} className="flex-1">
                <Button variant="outline" className="w-full"><RotateCcw data-icon="inline-start" />再次练习</Button>
              </Link>
              <Link to={`/player/${payload.materialId}`} className="flex-1">
                <Button className="w-full">返回精听 →</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}

export { Report }
